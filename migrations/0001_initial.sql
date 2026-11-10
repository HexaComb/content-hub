PRAGMA foreign_keys = ON;

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE clients (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- Store only hashes of high-entropy service credentials. Provisioning is an
-- operator task; this application does not mint or log live credentials.
CREATE TABLE principals (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json)),
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE client_grants (
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, principal_id, client_id),
  FOREIGN KEY (tenant_id, principal_id) REFERENCES principals(tenant_id, id),
  FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id)
);

CREATE TABLE metrics (
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  id TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('higher', 'lower', 'neutral')),
  semantics TEXT NOT NULL CHECK(semantics IN ('period_total', 'period_average', 'snapshot', 'custom')),
  timezone TEXT NOT NULL,
  dimensions_json TEXT NOT NULL CHECK(json_valid(dimensions_json)),
  definition TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, client_id, key),
  UNIQUE (tenant_id, client_id, id),
  FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES principals(tenant_id, id)
);

-- Append-only revisions. Corrections never erase the previous reading.
-- The interval is [period_start, period_end) in the metric's timezone.
CREATE TABLE observations (
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  id TEXT NOT NULL,
  metric_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL CHECK(period_end > period_start),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  value REAL,
  quality TEXT NOT NULL CHECK(quality IN ('complete', 'partial', 'missing')),
  source_json TEXT NOT NULL CHECK(json_valid(source_json)),
  collected_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  correction_reason TEXT,
  CHECK((quality = 'missing' AND value IS NULL) OR (quality != 'missing' AND value IS NOT NULL)),
  CHECK(revision = 1 OR (correction_reason IS NOT NULL AND length(trim(correction_reason)) > 0)),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, metric_id, period_start, period_end, revision),
  FOREIGN KEY (tenant_id, client_id, metric_id) REFERENCES metrics(tenant_id, client_id, id),
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES principals(tenant_id, id)
);
CREATE INDEX observations_period ON observations(tenant_id, client_id, period_start, period_end, metric_id, revision DESC);

CREATE TABLE content_items (
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(length(channel) <= 80),
  account_ref TEXT NOT NULL CHECK(length(account_ref) <= 200),
  title TEXT NOT NULL CHECK(length(title) <= 300),
  caption TEXT NOT NULL CHECK(length(caption) <= 20000),
  assets_json TEXT NOT NULL CHECK(json_valid(assets_json) AND json_type(assets_json) = 'array' AND length(assets_json) <= 32768),
  status TEXT NOT NULL CHECK(status IN ('draft', 'approved', 'scheduled', 'publishing', 'published', 'failed', 'cancelled')),
  scheduled_at TEXT,
  schedule_timezone TEXT,
  approved_by TEXT,
  approved_at TEXT,
  published_at TEXT,
  external_post_id TEXT CHECK(length(external_post_id) <= 300),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(status != 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK(status NOT IN ('scheduled', 'publishing') OR (scheduled_at IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK(status != 'published' OR (published_at IS NOT NULL AND external_post_id IS NOT NULL)),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, client_id, id),
  FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id)
);
CREATE INDEX content_schedule ON content_items(tenant_id, client_id, status, scheduled_at, id);
CREATE TABLE content_metrics (
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  content_id TEXT NOT NULL,
  metric_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, content_id, metric_id),
  FOREIGN KEY (tenant_id, client_id, content_id) REFERENCES content_items(tenant_id, client_id, id),
  FOREIGN KEY (tenant_id, client_id, metric_id) REFERENCES metrics(tenant_id, client_id, id)
);
