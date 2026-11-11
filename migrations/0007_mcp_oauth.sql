-- OAuth principals keep all existing business/audit foreign keys. Their reserved
-- non-hex marker is an identifier, never a credential or the hash of a secret.
ALTER TABLE principals ADD COLUMN auth_kind TEXT NOT NULL DEFAULT 'service'
 CHECK ((auth_kind = 'service' AND substr(token_hash,1,6) != 'oauth:') OR
        (auth_kind = 'oauth' AND substr(token_hash,1,6) = 'oauth:' AND length(token_hash) = 64));

-- Explicit operator provisioning only. No email-based membership auto-creation.
CREATE TABLE oauth_operators (
 id TEXT PRIMARY KEY CHECK(length(id)>0 AND instr(id,':')=0),
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 identity_issuer TEXT NOT NULL,
 identity_subject TEXT NOT NULL,
 verified_email TEXT NOT NULL,
 scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json)),
 expires_at TEXT NOT NULL,
 revoked_at TEXT,
 UNIQUE(identity_issuer,identity_subject),
 UNIQUE(tenant_id,id)
);
CREATE TABLE oauth_operator_clients (
 tenant_id TEXT NOT NULL,
 operator_id TEXT NOT NULL,
 client_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,operator_id,client_id),
 FOREIGN KEY(tenant_id,operator_id) REFERENCES oauth_operators(tenant_id,id),
 FOREIGN KEY(tenant_id,client_id) REFERENCES clients(tenant_id,id)
);
CREATE TABLE oauth_delegations (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 operator_id TEXT NOT NULL,
 principal_id TEXT NOT NULL,
 oauth_client_id TEXT NOT NULL,
 oauth_grant_id TEXT,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 revoked_at TEXT,
 UNIQUE(tenant_id,principal_id),
 FOREIGN KEY(tenant_id,operator_id) REFERENCES oauth_operators(tenant_id,id),
 FOREIGN KEY(tenant_id,principal_id) REFERENCES principals(tenant_id,id)
);
-- Browser-bound library consent plus an atomic D1 one-use identity/policy binding.
CREATE TABLE oauth_pending_consents (
 handle_hash TEXT PRIMARY KEY,
 operator_id TEXT NOT NULL REFERENCES oauth_operators(id),
 identity_issuer TEXT NOT NULL,
 identity_subject TEXT NOT NULL,
 oauth_client_id TEXT NOT NULL,
 requested_scopes_json TEXT NOT NULL CHECK(json_valid(requested_scopes_json)),
 expires_at TEXT NOT NULL,
 consumed_at TEXT
);

-- Reassignment must be a newly approved mapping, never an edit that transfers
-- already-issued tokens to a different human, agency or application.
CREATE TRIGGER oauth_operator_identity_immutable BEFORE UPDATE OF id,tenant_id,identity_issuer,identity_subject,verified_email ON oauth_operators
WHEN NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.identity_issuer IS NOT OLD.identity_issuer OR NEW.identity_subject IS NOT OLD.identity_subject OR NEW.verified_email IS NOT OLD.verified_email BEGIN
 SELECT RAISE(ABORT,'OAuth operator identity is immutable');
END;
CREATE TRIGGER oauth_delegation_identity_immutable BEFORE UPDATE OF id,tenant_id,operator_id,principal_id,oauth_client_id ON oauth_delegations
WHEN NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.operator_id IS NOT OLD.operator_id OR NEW.principal_id IS NOT OLD.principal_id OR NEW.oauth_client_id IS NOT OLD.oauth_client_id BEGIN
 SELECT RAISE(ABORT,'OAuth delegation identity is immutable');
END;
