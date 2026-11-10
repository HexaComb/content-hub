-- Existing projects remain one-off projects. References are public account IDs
-- or handles, never passwords, tokens, URLs, or OAuth credentials.
ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'one_off_project' CHECK(kind IN ('instagram_account','one_off_project'));
ALTER TABLE projects ADD COLUMN platform_account_ref TEXT CHECK(platform_account_ref IS NULL OR (length(platform_account_ref) BETWEEN 1 AND 100 AND platform_account_ref NOT GLOB '*[^a-zA-Z0-9_.@-]*'));
CREATE TRIGGER project_identity_required BEFORE INSERT ON projects
WHEN NEW.kind = 'instagram_account' AND NEW.platform_account_ref IS NULL BEGIN
  SELECT RAISE(ABORT,'Instagram accounts require a public account reference');
END;
CREATE TRIGGER project_identity_immutable BEFORE UPDATE OF kind,platform_account_ref ON projects
WHEN NEW.kind != OLD.kind OR NEW.platform_account_ref IS NOT OLD.platform_account_ref BEGIN
  SELECT RAISE(ABORT,'Target identity is immutable; create a new target');
END;
