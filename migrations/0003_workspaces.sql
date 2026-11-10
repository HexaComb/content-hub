-- Keep legacy clients columns unchanged, including operator provisioning.
CREATE TABLE client_versions (
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  PRIMARY KEY (tenant_id, client_id),
  FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id)
);
INSERT INTO client_versions(tenant_id,client_id) SELECT tenant_id,id FROM clients;
CREATE TRIGGER client_version_insert AFTER INSERT ON clients BEGIN
  INSERT INTO client_versions(tenant_id,client_id) VALUES(NEW.tenant_id,NEW.id);
END;
CREATE TABLE projects (
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  description TEXT NOT NULL CHECK(length(description) <= 4000),
  status TEXT NOT NULL CHECK(status IN ('active','paused','completed','archived')),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, client_id, id),
  FOREIGN KEY (tenant_id,client_id) REFERENCES clients(tenant_id,id)
);
CREATE TABLE project_metrics (
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  metric_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id,client_id,project_id,metric_id),
  FOREIGN KEY (tenant_id,client_id,project_id) REFERENCES projects(tenant_id,client_id,id),
  FOREIGN KEY (tenant_id,client_id,metric_id) REFERENCES metrics(tenant_id,client_id,id)
);
-- Immutable application audit and idempotency receipts, scoped to credential.
CREATE TABLE workspace_events (
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  client_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,principal_id,idempotency_key),
  FOREIGN KEY (tenant_id,principal_id) REFERENCES principals(tenant_id,id),
  FOREIGN KEY (tenant_id,client_id) REFERENCES clients(tenant_id,id)
);
