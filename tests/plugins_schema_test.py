import pathlib
import sqlite3
import unittest

class PluginMigrationTests(unittest.TestCase):
    def test_additive_migration_preserves_every_existing_row(self):
        db = sqlite3.connect(':memory:')
        root = pathlib.Path(__file__).resolve().parents[1] / 'migrations'
        for migration in sorted(root.glob('*.sql')):
            if migration.name < '0010':
                db.executescript(migration.read_text())
        db.execute("INSERT INTO tenants VALUES ('t','Tenant')")
        db.execute("INSERT INTO clients VALUES ('t','c','Client','UTC')")
        db.execute("INSERT INTO principals(tenant_id,id,name,token_hash,expires_at,scopes_json) VALUES ('t','a','Agent',?,'2099-01-01','[]')", ('a'*64,))
        db.execute("INSERT INTO client_grants VALUES ('t','a','c')")
        db.execute("INSERT INTO projects(tenant_id,client_id,id,name,description,status,revision,created_at,updated_at) VALUES ('t','c','p','Project','','active',1,'now','now')")
        db.execute("INSERT INTO metrics VALUES ('t','c','m','views','Views','custom','count','higher','custom','UTC','{}','Definition','a','now')")
        db.execute("INSERT INTO project_metrics VALUES ('t','c','p','m')")
        db.execute("INSERT INTO observations VALUES ('t','c','o','m','2026-10-01','2026-11-01',1,10,'complete','{}','now','now','a','key','hash',NULL)")
        tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        before = {table: db.execute('SELECT * FROM '+table).fetchall() for table in tables}
        db.executescript((root/'0010_project_plugins.sql').read_text())
        self.assertEqual(before, {table: db.execute('SELECT * FROM '+table).fetchall() for table in tables})
        self.assertEqual(db.execute('SELECT * FROM project_plugins').fetchall(), [])
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO project_plugins VALUES ('t','c','p','seo',1,1,'[\"missing\"]','now','actor')")
        self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
