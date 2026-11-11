-- Default-off app-specific eligibility. No existing operator or grant changes.
CREATE TABLE oauth_operator_app_policies (
 id TEXT PRIMARY KEY NOT NULL,
 operator_id TEXT NOT NULL REFERENCES oauth_operators(id),
 oauth_client_id TEXT NOT NULL,
 connection_mode TEXT NOT NULL CHECK(connection_mode IN ('bounded','ongoing')),
 client_access_mode TEXT NOT NULL CHECK(client_access_mode IN ('selected','all')),
 scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json)),
 created_at TEXT NOT NULL,
 revoked_at TEXT
);
CREATE UNIQUE INDEX oauth_one_active_app_policy ON oauth_operator_app_policies(operator_id,oauth_client_id) WHERE revoked_at IS NULL;
ALTER TABLE oauth_delegations ADD COLUMN app_policy_id TEXT REFERENCES oauth_operator_app_policies(id);
ALTER TABLE oauth_delegations ADD COLUMN client_access_mode TEXT NOT NULL DEFAULT 'selected' CHECK(client_access_mode IN ('selected','all'));
ALTER TABLE oauth_pending_consents ADD COLUMN app_policy_id TEXT REFERENCES oauth_operator_app_policies(id);
ALTER TABLE oauth_pending_consents ADD COLUMN all_clients_offered INTEGER NOT NULL DEFAULT 0 CHECK(all_clients_offered IN (0,1));
CREATE TABLE oauth_app_policy_events (
 id TEXT PRIMARY KEY NOT NULL,
 policy_id TEXT NOT NULL REFERENCES oauth_operator_app_policies(id),
 recorded_at TEXT NOT NULL,
 event TEXT NOT NULL CHECK(event IN ('created','changed')),
 previous_json TEXT,
 next_json TEXT NOT NULL CHECK(json_valid(next_json))
);
CREATE TRIGGER oauth_app_policy_created AFTER INSERT ON oauth_operator_app_policies BEGIN
 INSERT INTO oauth_app_policy_events VALUES(lower(hex(randomblob(16))),NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'created',NULL,json_object('operatorId',NEW.operator_id,'oauthClientId',NEW.oauth_client_id,'connectionMode',NEW.connection_mode,'clientAccessMode',NEW.client_access_mode,'scopes',json(NEW.scopes_json),'revokedAt',NEW.revoked_at));
END;
CREATE TRIGGER oauth_app_policy_changed AFTER UPDATE ON oauth_operator_app_policies BEGIN
 INSERT INTO oauth_app_policy_events VALUES(lower(hex(randomblob(16))),NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'changed',json_object('connectionMode',OLD.connection_mode,'clientAccessMode',OLD.client_access_mode,'scopes',json(OLD.scopes_json),'revokedAt',OLD.revoked_at),json_object('connectionMode',NEW.connection_mode,'clientAccessMode',NEW.client_access_mode,'scopes',json(NEW.scopes_json),'revokedAt',NEW.revoked_at));
END;
CREATE TRIGGER oauth_app_policy_identity_immutable BEFORE UPDATE OF id,operator_id,oauth_client_id,connection_mode,client_access_mode,scopes_json,created_at ON oauth_operator_app_policies BEGIN
 SELECT RAISE(ABORT,'OAuth app policy identity is immutable');
END;
CREATE TRIGGER oauth_app_policy_revocation_terminal BEFORE UPDATE OF revoked_at ON oauth_operator_app_policies
WHEN OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at BEGIN
 SELECT RAISE(ABORT,'Revoked app policy cannot be reactivated');
END;
CREATE TRIGGER oauth_delegation_boundary_immutable BEFORE UPDATE OF app_policy_id,client_access_mode ON oauth_delegations
WHEN NEW.app_policy_id IS NOT OLD.app_policy_id OR NEW.client_access_mode IS NOT OLD.client_access_mode BEGIN
 SELECT RAISE(ABORT,'OAuth client boundary requires new consent');
END;
CREATE TRIGGER oauth_app_policy_events_no_update BEFORE UPDATE ON oauth_app_policy_events BEGIN
 SELECT RAISE(ABORT,'OAuth app policy audit events are append-only');
END;
CREATE TRIGGER oauth_app_policy_events_no_delete BEFORE DELETE ON oauth_app_policy_events BEGIN
 SELECT RAISE(ABORT,'OAuth app policy audit events are append-only');
END;
CREATE TRIGGER oauth_delegation_all_requires_policy BEFORE INSERT ON oauth_delegations
WHEN NEW.client_access_mode='all' AND NEW.app_policy_id IS NULL BEGIN
 SELECT RAISE(ABORT,'All-client access requires an app policy');
END;
