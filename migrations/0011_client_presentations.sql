-- Immutable, private client-page design history. No report data or grants change.
CREATE TABLE presentation_revisions (
 tenant_id TEXT NOT NULL, client_id TEXT NOT NULL, project_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=1),
 operation TEXT NOT NULL CHECK(operation IN ('save','publish','restore')),
 source_revision INTEGER,
 document_json TEXT NOT NULL CHECK(json_valid(document_json) AND length(document_json)<=48000),
 created_at TEXT NOT NULL, actor_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,client_id,project_id,revision),
 FOREIGN KEY(tenant_id,client_id,project_id) REFERENCES projects(tenant_id,client_id,id),
 FOREIGN KEY(tenant_id,client_id,project_id,source_revision) REFERENCES presentation_revisions(tenant_id,client_id,project_id,revision)
);
CREATE TABLE project_presentations (
 tenant_id TEXT NOT NULL, client_id TEXT NOT NULL, project_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=1), draft_revision INTEGER NOT NULL, published_revision INTEGER,
 PRIMARY KEY(tenant_id,client_id,project_id),
 FOREIGN KEY(tenant_id,client_id,project_id) REFERENCES projects(tenant_id,client_id,id),
 FOREIGN KEY(tenant_id,client_id,project_id,revision) REFERENCES presentation_revisions(tenant_id,client_id,project_id,revision),
 FOREIGN KEY(tenant_id,client_id,project_id,draft_revision) REFERENCES presentation_revisions(tenant_id,client_id,project_id,revision),
 FOREIGN KEY(tenant_id,client_id,project_id,published_revision) REFERENCES presentation_revisions(tenant_id,client_id,project_id,revision)
);
CREATE TABLE presentation_events (
 tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
 client_id TEXT NOT NULL, project_id TEXT NOT NULL, revision INTEGER NOT NULL,
 payload_hash TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)), recorded_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,actor_id,idempotency_key), UNIQUE(tenant_id,client_id,project_id,revision),
 FOREIGN KEY(tenant_id,client_id,project_id,revision) REFERENCES presentation_revisions(tenant_id,client_id,project_id,revision)
);
CREATE TRIGGER presentation_revisions_no_update BEFORE UPDATE ON presentation_revisions BEGIN SELECT RAISE(ABORT,'Presentation history is append-only'); END;
CREATE TRIGGER presentation_revisions_no_delete BEFORE DELETE ON presentation_revisions BEGIN SELECT RAISE(ABORT,'Presentation history is append-only'); END;
CREATE TRIGGER presentation_events_no_update BEFORE UPDATE ON presentation_events BEGIN SELECT RAISE(ABORT,'Presentation audit is append-only'); END;
CREATE TRIGGER presentation_events_no_delete BEFORE DELETE ON presentation_events BEGIN SELECT RAISE(ABORT,'Presentation audit is append-only'); END;
