-- Opt-in configuration only. Existing projects, observations and grants are unchanged.
CREATE TABLE project_plugins (
 tenant_id TEXT NOT NULL, client_id TEXT NOT NULL, project_id TEXT NOT NULL,
 key TEXT NOT NULL CHECK(key IN ('seo','instagram')),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 revision INTEGER NOT NULL CHECK(revision>=1),
 metric_ids_json TEXT NOT NULL CHECK(json_valid(metric_ids_json) AND json_type(metric_ids_json)='array' AND length(metric_ids_json)<=25000),
 updated_at TEXT NOT NULL, updated_by TEXT NOT NULL,
 PRIMARY KEY(tenant_id,client_id,project_id,key),
 FOREIGN KEY(tenant_id,client_id,project_id) REFERENCES projects(tenant_id,client_id,id)
);
CREATE TABLE plugin_events (
 tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
 client_id TEXT NOT NULL, project_id TEXT NOT NULL, key TEXT NOT NULL CHECK(key IN ('seo','instagram')),
 revision INTEGER NOT NULL CHECK(revision>=1), payload_hash TEXT NOT NULL,
 result_json TEXT NOT NULL CHECK(json_valid(result_json)), recorded_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,actor_id,idempotency_key),
 UNIQUE(tenant_id,client_id,project_id,key,revision),
 FOREIGN KEY(tenant_id,client_id,project_id) REFERENCES projects(tenant_id,client_id,id)
);
CREATE TRIGGER plugin_events_no_update BEFORE UPDATE ON plugin_events BEGIN
 SELECT RAISE(ABORT,'Plugin history is append-only');
END;
CREATE TRIGGER plugin_events_no_delete BEFORE DELETE ON plugin_events BEGIN
 SELECT RAISE(ABORT,'Plugin history is append-only');
END;
CREATE TRIGGER plugin_metrics_insert BEFORE INSERT ON project_plugins
WHEN EXISTS(SELECT 1 FROM json_each(NEW.metric_ids_json) j WHERE NOT EXISTS(SELECT 1 FROM project_metrics pm WHERE pm.tenant_id=NEW.tenant_id AND pm.client_id=NEW.client_id AND pm.project_id=NEW.project_id AND pm.metric_id=j.value)) BEGIN
 SELECT RAISE(ABORT,'Plugin metrics must belong to this project');
END;
CREATE TRIGGER plugin_metrics_update BEFORE UPDATE OF metric_ids_json ON project_plugins
WHEN EXISTS(SELECT 1 FROM json_each(NEW.metric_ids_json) j WHERE NOT EXISTS(SELECT 1 FROM project_metrics pm WHERE pm.tenant_id=NEW.tenant_id AND pm.client_id=NEW.client_id AND pm.project_id=NEW.project_id AND pm.metric_id=j.value)) BEGIN
 SELECT RAISE(ABORT,'Plugin metrics must belong to this project');
END;
