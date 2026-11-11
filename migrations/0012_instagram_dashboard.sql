-- Additive Instagram production tracking. No metrics, grants or posts are changed.
CREATE TABLE instagram_work_items (
 tenant_id TEXT NOT NULL,client_id TEXT NOT NULL,project_id TEXT NOT NULL,id TEXT NOT NULL,
 format TEXT NOT NULL CHECK(format IN ('reel','post')),title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 300),
 idea TEXT NOT NULL CHECK(length(idea) BETWEEN 1 AND 4000),platform TEXT NOT NULL CHECK(platform='instagram'),
 status TEXT NOT NULL CHECK(status IN ('proposed','queued','in_progress','completed','declined')),
 content_url TEXT,evidence TEXT,revision INTEGER NOT NULL CHECK(revision>=1),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,updated_by TEXT NOT NULL,
 PRIMARY KEY(tenant_id,client_id,project_id,id),
 FOREIGN KEY(tenant_id,client_id,project_id) REFERENCES projects(tenant_id,client_id,id),
 CHECK((status='completed' AND content_url IS NOT NULL AND evidence IS NOT NULL) OR (status!='completed' AND content_url IS NULL AND evidence IS NULL))
);
CREATE TABLE instagram_work_events (
 tenant_id TEXT NOT NULL,client_id TEXT NOT NULL,project_id TEXT NOT NULL,item_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,operation TEXT NOT NULL CHECK(operation IN ('upsert','decision')),
 answer TEXT CHECK(answer IN ('yes','no')),revision INTEGER NOT NULL CHECK(revision>=1),
 payload_hash TEXT NOT NULL,result_json TEXT NOT NULL CHECK(json_valid(result_json)),recorded_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,actor_id,idempotency_key),
 UNIQUE(tenant_id,client_id,project_id,item_id,revision),
 FOREIGN KEY(tenant_id,client_id,project_id,item_id) REFERENCES instagram_work_items(tenant_id,client_id,project_id,id),
 CHECK((operation='decision' AND answer IS NOT NULL) OR (operation='upsert' AND answer IS NULL))
);
CREATE INDEX instagram_work_project ON instagram_work_items(tenant_id,client_id,project_id,status,updated_at);
CREATE TRIGGER instagram_events_no_update BEFORE UPDATE ON instagram_work_events BEGIN
 SELECT RAISE(ABORT,'Instagram history is append-only');
END;
CREATE TRIGGER instagram_events_no_delete BEFORE DELETE ON instagram_work_events BEGIN
 SELECT RAISE(ABORT,'Instagram history is append-only');
END;
