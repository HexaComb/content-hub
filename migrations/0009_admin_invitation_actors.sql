-- Browser administrators are audit actors, never MCP credentials. These rows
-- retain existing invitation/audit foreign keys without expanding agent scopes
-- or granting access to clients. Existing projects and recipient grants stay put.
CREATE TABLE admin_invitation_actors (
 tenant_id TEXT NOT NULL,
 principal_id TEXT NOT NULL,
 identity_issuer TEXT NOT NULL,
 identity_subject TEXT NOT NULL,
 verified_email TEXT NOT NULL,
 PRIMARY KEY(tenant_id,principal_id),
 UNIQUE(tenant_id,identity_issuer,identity_subject),
 FOREIGN KEY(tenant_id,principal_id) REFERENCES principals(tenant_id,id)
);
CREATE TRIGGER admin_invitation_actor_immutable BEFORE UPDATE ON admin_invitation_actors BEGIN
 SELECT RAISE(ABORT,'Administrator invitation identity is immutable');
END;
