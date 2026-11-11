-- Presentation is independent of project metadata, metric membership and data.
CREATE TABLE project_themes (
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  theme_json TEXT CHECK(theme_json IS NULL OR (json_valid(theme_json) AND length(theme_json) <= 40000)),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (tenant_id,client_id,project_id),
  FOREIGN KEY (tenant_id,client_id,project_id) REFERENCES projects(tenant_id,client_id,id),
  FOREIGN KEY (tenant_id,updated_by) REFERENCES principals(tenant_id,id)
);
-- A reset keeps the revision and audit history; it does not delete the record.
CREATE TABLE theme_events (
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  client_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('update_project_theme','reset_project_theme')),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  payload_hash TEXT NOT NULL,
  theme_json TEXT CHECK(theme_json IS NULL OR (json_valid(theme_json) AND length(theme_json) <= 40000)),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,principal_id,idempotency_key),
  UNIQUE (tenant_id,client_id,project_id,revision),
  FOREIGN KEY (tenant_id,client_id,project_id) REFERENCES projects(tenant_id,client_id,id),
  FOREIGN KEY (tenant_id,principal_id) REFERENCES principals(tenant_id,id)
);
CREATE TRIGGER theme_events_no_update BEFORE UPDATE ON theme_events BEGIN
  SELECT RAISE(ABORT,'Theme history is append-only');
END;
CREATE TRIGGER theme_events_no_delete BEFORE DELETE ON theme_events BEGIN
  SELECT RAISE(ABORT,'Theme history is append-only');
END;
