-- Default-off policy. Existing operators, pending requests and grants stay bounded.
ALTER TABLE oauth_operators ADD COLUMN connection_mode TEXT NOT NULL DEFAULT 'bounded' CHECK(connection_mode IN ('bounded','ongoing'));
ALTER TABLE oauth_delegations ADD COLUMN connection_mode TEXT NOT NULL DEFAULT 'bounded' CHECK(connection_mode IN ('bounded','ongoing'));
ALTER TABLE oauth_delegations ADD COLUMN client_name TEXT NOT NULL DEFAULT 'Connected application';
ALTER TABLE oauth_delegations ADD COLUMN provider_revoked_at TEXT;
ALTER TABLE oauth_pending_consents ADD COLUMN connection_mode TEXT NOT NULL DEFAULT 'bounded' CHECK(connection_mode IN ('bounded','ongoing'));
ALTER TABLE oauth_pending_consents ADD COLUMN proposed_expires_at TEXT;

CREATE TABLE oauth_connection_events (
 id TEXT PRIMARY KEY NOT NULL,
 tenant_id TEXT NOT NULL,
 operator_id TEXT NOT NULL,
 delegation_id TEXT NOT NULL,
 event TEXT NOT NULL CHECK(event IN ('consent_approved','refresh_accepted','revoked','issuance_failed')),
 recorded_at TEXT NOT NULL,
 detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
 FOREIGN KEY(tenant_id,operator_id) REFERENCES oauth_operators(tenant_id,id),
 FOREIGN KEY(delegation_id) REFERENCES oauth_delegations(id)
);
CREATE TABLE oauth_operator_policy_events (
 id TEXT PRIMARY KEY NOT NULL,
 operator_id TEXT NOT NULL REFERENCES oauth_operators(id),
 recorded_at TEXT NOT NULL,
 previous_json TEXT NOT NULL CHECK(json_valid(previous_json)),
 next_json TEXT NOT NULL CHECK(json_valid(next_json))
);
CREATE TRIGGER oauth_operator_policy_audit AFTER UPDATE OF connection_mode,scopes_json,expires_at,revoked_at ON oauth_operators
WHEN NEW.connection_mode IS NOT OLD.connection_mode OR NEW.scopes_json IS NOT OLD.scopes_json OR NEW.expires_at IS NOT OLD.expires_at OR NEW.revoked_at IS NOT OLD.revoked_at BEGIN
 INSERT INTO oauth_operator_policy_events VALUES(lower(hex(randomblob(16))),NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),json_object('connectionMode',OLD.connection_mode,'scopes',json(OLD.scopes_json),'expiresAt',OLD.expires_at,'revokedAt',OLD.revoked_at),json_object('connectionMode',NEW.connection_mode,'scopes',json(NEW.scopes_json),'expiresAt',NEW.expires_at,'revokedAt',NEW.revoked_at));
END;
CREATE TRIGGER oauth_delegation_mode_immutable BEFORE UPDATE OF connection_mode ON oauth_delegations
WHEN NEW.connection_mode IS NOT OLD.connection_mode BEGIN
 SELECT RAISE(ABORT,'OAuth connection lifetime requires new consent');
END;
CREATE TRIGGER oauth_connection_events_no_update BEFORE UPDATE ON oauth_connection_events BEGIN
 SELECT RAISE(ABORT,'OAuth audit events are append-only');
END;
CREATE TRIGGER oauth_connection_events_no_delete BEFORE DELETE ON oauth_connection_events BEGIN
 SELECT RAISE(ABORT,'OAuth audit events are append-only');
END;
CREATE TRIGGER oauth_operator_policy_events_no_update BEFORE UPDATE ON oauth_operator_policy_events BEGIN
 SELECT RAISE(ABORT,'OAuth policy audit events are append-only');
END;
CREATE TRIGGER oauth_operator_policy_events_no_delete BEFORE DELETE ON oauth_operator_policy_events BEGIN
 SELECT RAISE(ABORT,'OAuth policy audit events are append-only');
END;
