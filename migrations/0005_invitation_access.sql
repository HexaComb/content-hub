CREATE TABLE invitations (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, client_id TEXT NOT NULL, project_id TEXT NOT NULL,
 recipient_email TEXT NOT NULL, metric_ids_json TEXT NOT NULL CHECK(json_valid(metric_ids_json)),
 target_revision INTEGER NOT NULL, preview_json TEXT NOT NULL, approval_digest TEXT NOT NULL,
 created_by TEXT NOT NULL, approved_by TEXT, created_at TEXT NOT NULL, invite_expires_at TEXT NOT NULL,
 grant_expires_at TEXT NOT NULL, token_hash TEXT UNIQUE, delivery_state TEXT NOT NULL DEFAULT 'prepared'
 CHECK(delivery_state IN ('prepared','sending','accepted','failed','uncertain')),
 provider_id TEXT, accepted_at TEXT, acceptance_id TEXT UNIQUE, revoked_at TEXT,
 FOREIGN KEY(tenant_id,client_id,project_id) REFERENCES projects(tenant_id,client_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES principals(tenant_id,id)
);
CREATE TABLE invitation_challenges (
 token_hash TEXT PRIMARY KEY, invitation_id TEXT NOT NULL REFERENCES invitations(id), code_hash TEXT NOT NULL,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 consumed_at TEXT, delivery_state TEXT NOT NULL DEFAULT 'sending'
);
CREATE INDEX challenge_invitation ON invitation_challenges(invitation_id,created_at);
CREATE TABLE human_sessions (
 token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE invitation_rate_limits (bucket TEXT PRIMARY KEY, hits INTEGER NOT NULL);
CREATE TABLE invitation_audit (
 id TEXT PRIMARY KEY, invitation_id TEXT NOT NULL REFERENCES invitations(id), actor TEXT NOT NULL,
 action TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE TABLE login_challenges (
 token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, code_hash TEXT NOT NULL, created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, consumed_at TEXT, redemption_id TEXT UNIQUE,
 delivery_state TEXT NOT NULL DEFAULT 'sending'
);
CREATE INDEX login_challenge_email ON login_challenges(email,created_at);
