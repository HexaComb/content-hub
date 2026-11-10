import pathlib
import sqlite3
import unittest

SCHEMA = pathlib.Path(__file__).resolve().parents[1] / 'migrations/0001_initial.sql'

class SchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript(SCHEMA.read_text())
        for tenant in ('a', 'b'):
            self.db.execute('INSERT INTO tenants VALUES (?,?)', (tenant, tenant))
            self.db.execute('INSERT INTO clients VALUES (?,?,?,?)', (tenant, 'client', 'Synthetic client', 'UTC'))
            self.db.execute('INSERT INTO principals VALUES (?,?,?,?,?,?,?)', (tenant, 'agent', 'Test', tenant * 64, '2099-01-01T00:00:00Z', None, '["metrics:read"]'))
        self.db.execute("INSERT INTO metrics VALUES ('a','client','metric','arbitrary','Arbitrary number','custom','count','higher','custom','UTC','{}','Test-only definition','agent','2026-11-01T00:00:00Z')")

    def insert(self, revision=1, value=1, quality='complete', reason=None, tenant='a', key='key1'):
        self.db.execute('INSERT INTO observations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (tenant, 'client', f'{key}-{revision}', 'metric', '2026-10-01', '2026-11-01', revision, value, quality, '{}', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 'agent', key, 'a' * 64, reason))

    def test_tenant_relationships_reject_cross_tenant_metrics(self):
        with self.assertRaises(sqlite3.IntegrityError): self.insert(tenant='b')

    def test_idempotency_and_revision_uniqueness(self):
        self.insert()
        with self.assertRaises(sqlite3.IntegrityError): self.insert(key='different')
        with self.assertRaises(sqlite3.IntegrityError): self.insert(revision=2, reason='Correction')

    def test_history_retained(self):
        self.insert()
        self.insert(revision=2, value=5, reason='Source corrected', key='key2')
        self.assertEqual(self.db.execute('SELECT value FROM observations ORDER BY revision').fetchall(), [(1,), (5,)])

    def test_corrections_require_reason(self):
        for reason in (None, '', '  '):
            with self.assertRaises(sqlite3.IntegrityError): self.insert(revision=2, reason=reason)

    def test_missing_is_not_zero(self):
        self.insert(value=None, quality='missing')
        with self.assertRaises(sqlite3.IntegrityError): self.insert(value=None, key='key2')

    def test_content_cannot_schedule_without_approval(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO content_items(tenant_id,client_id,id,channel,account_ref,title,caption,assets_json,status,scheduled_at,created_at,updated_at) VALUES ('a','client','post','instagram','demo','Draft','Caption','[]','scheduled','2026-11-15T12:00:00Z','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')")

    def tearDown(self): self.db.close()

if __name__ == '__main__': unittest.main()
