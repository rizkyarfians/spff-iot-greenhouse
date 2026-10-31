"""Disposable PostgreSQL tests using the real audited SPFF migrations 033/034."""
import os
import unittest
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.guide_programs import read_guide_programs
from test_guide_programs import saved_program


@unittest.skipUnless(os.getenv("AI_TEST_DATABASE_DSN"), "disposable PostgreSQL test DSN not configured")
class GuidePostgresTests(unittest.TestCase):
    def test_real_schema_read_permissions_scope_and_snapshot(self):
        import psycopg
        from psycopg.rows import dict_row
        from psycopg.types.json import Jsonb
        dsn = os.environ["AI_TEST_DATABASE_DSN"]
        fixture = saved_program()
        program_id = uuid4()
        role = "ai_guide_test_" + uuid4().hex
        now = datetime(2026, 10, 31, tzinfo=timezone.utc)
        with psycopg.connect(dsn, row_factory=dict_row) as connection:
            if connection.execute("SELECT to_regnamespace('spff') AS schema").fetchone()["schema"] is not None:
                raise RuntimeError("test requires an empty disposable database without spff schema")
        created = False
        try:
            with psycopg.connect(dsn, row_factory=dict_row) as connection:
                connection.execute("SET TRANSACTION READ ONLY")
                result = read_guide_programs(connection, "greenhouse-01", "esp32-s3-01", "soil-1", now)
                self.assertEqual(len(result["missing_relations"]), 3)
            with psycopg.connect(dsn) as connection:
                connection.execute("CREATE SCHEMA spff; CREATE TABLE spff.sites(site_id text PRIMARY KEY); CREATE TABLE spff.site_crop_selections(site_id text,zone_id text,crop_id text);")
                for name in ("033.sql", "034.sql"):
                    connection.execute((Path(__file__).parent / "fixtures" / name).read_text())
                connection.execute("INSERT INTO spff.sites VALUES ('greenhouse-01'),('other')")
                connection.execute("INSERT INTO spff.site_crop_selections VALUES ('greenhouse-01','soil-1','sweet-potato')")
                sql = "INSERT INTO spff.guide_programs(site_id,program_id,revision,config,source_sha256,guide_revision,sheet_snapshot,plan,updated_by) VALUES (%s,%s,1,%s,%s,0,%s,%s,'test')"
                def insert(site, pid, config):
                    connection.execute(sql, (site, pid, Jsonb(config), fixture["source_sha256"], Jsonb(fixture["sheet_snapshot"]), Jsonb(fixture["plan"])))
                insert("greenhouse-01", program_id, fixture["config"])
                insert("other", uuid4(), fixture["config"])
                insert("greenhouse-01", uuid4(), {**fixture["config"], "deviceId": "other-device"})
                # Generated alphanumeric role name; no operator input is interpolated.
                connection.execute(f"CREATE ROLE {role} NOLOGIN")
                connection.execute(f"GRANT USAGE ON SCHEMA spff TO {role}")
                connection.execute(f"GRANT SELECT ON spff.site_crop_selections TO {role}")
            created = True
            with psycopg.connect(dsn, row_factory=dict_row) as connection:
                connection.execute("SET TRANSACTION READ ONLY")
                connection.execute(f"SET LOCAL ROLE {role}")
                denied = read_guide_programs(connection, "greenhouse-01", "esp32-s3-01", "soil-1", now)
                self.assertEqual(len(denied["select_permission_required"]), 3)
                self.assertFalse(denied["can_dispatch"])
            with psycopg.connect(dsn) as connection:
                connection.execute(f"GRANT SELECT ON spff.guide_programs,spff.protocol_guide_edits,spff.guide_program_completions TO {role}")
            with psycopg.connect(dsn, row_factory=dict_row) as connection:
                connection.execute("SET TRANSACTION READ ONLY")
                connection.execute(f"SET LOCAL ROLE {role}")
                result = read_guide_programs(connection, "greenhouse-01", "esp32-s3-01", "soil-1", now)
                self.assertEqual(result["status"], "READ_ONLY_PREVIEW")
                self.assertEqual(len(result["programs"]), 1)
                p = result["programs"][0]
                self.assertEqual(p["program_id"], str(program_id))
                self.assertEqual(p["plant_count"], 20000)
                self.assertEqual(p["activities"][0]["products"][0]["product_mass_g"], 50000)
                self.assertFalse(p["can_dispatch"])
                self.assertEqual(connection.execute("SHOW transaction_read_only").fetchone()["transaction_read_only"], "on")
                with self.assertRaises(psycopg.errors.ReadOnlySqlTransaction):
                    connection.execute("UPDATE spff.guide_programs SET revision=revision+1")
            with psycopg.connect(dsn) as connection:
                connection.execute(f"SET LOCAL ROLE {role}")
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    connection.execute("UPDATE spff.guide_programs SET revision=revision+1")
        finally:
            if created:
                with psycopg.connect(dsn) as connection:
                    connection.execute("DROP SCHEMA spff CASCADE")
                    connection.execute(f"DROP ROLE {role}")
