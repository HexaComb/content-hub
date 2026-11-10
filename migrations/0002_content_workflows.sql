-- Approval snapshots bind exact payload revision and destination.
ALTER TABLE content_items ADD COLUMN approved_revision INTEGER;
ALTER TABLE content_items ADD COLUMN approved_channel TEXT;
ALTER TABLE content_items ADD COLUMN approved_account_ref TEXT;
ALTER TABLE content_items ADD COLUMN last_operation_id TEXT;
CREATE TABLE content_audit (
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  content_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  details_json TEXT NOT NULL CHECK(json_valid(details_json)),
  PRIMARY KEY (tenant_id, operation_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, client_id, content_id) REFERENCES content_items(tenant_id, client_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES principals(tenant_id, id)
);
CREATE INDEX content_audit_item ON content_audit(tenant_id, client_id, content_id, revision);
