"""Static migration/query cross-check; not a PostgreSQL parser/execution test."""
import ast
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]


def schema_catalog():
    catalog = {}
    for path in sorted((ROOT/'infrastructure/postgres/migrations').glob('*.sql')):
        text = re.sub(r'--[^\n]*', '', path.read_text(encoding='utf-8'))
        for match in re.finditer(r'CREATE TABLE (?:IF NOT EXISTS )?spff\.(\w+)\s*\(', text, re.I):
            depth, end = 1, match.end()
            while depth and end < len(text):
                depth += (text[end] == '(') - (text[end] == ')')
                end += 1
            body = text[match.end():end-1]
            # Top-level comma splitting preserves inline CHECK/FK expressions.
            parts, start, depth = [], 0, 0
            for i, ch in enumerate(body):
                depth += (ch == '(') - (ch == ')')
                if ch == ',' and depth == 0:
                    parts.append(body[start:i]); start = i+1
            parts.append(body[start:])
            columns = set()
            for part in parts:
                column = re.match(r'\s*(\w+)\s+(?:text|uuid|integer|bigint|smallint|boolean|double\s+precision|jsonb|timestamptz|date|time)\b',part,re.I)
                if column:
                    columns.add(column[1])
            catalog[match[1]] = columns
        for match in re.finditer(r'ALTER TABLE (?:IF EXISTS )?spff\.(\w+)(.*?);',text,re.I|re.S):
            for column in re.finditer(r'ADD COLUMN (?:IF NOT EXISTS )?(\w+)',match[2],re.I):
                catalog.setdefault(match[1],set()).add(column[1])
    return catalog


def queries():
    tree=ast.parse((ROOT/'python-ai/src/spff_ai/repository.py').read_text())
    result=[]
    for node in ast.walk(tree):
        if isinstance(node,ast.Constant) and isinstance(node.value,str) and re.search(r'\b(?:SELECT|INSERT|UPDATE|SET TRANSACTION)\b',node.value) and not node.value.startswith('PostgreSQL adapter:'):
            result.append((node.lineno,node.value))
    return result


class SchemaContractTests(unittest.TestCase):
    def test_all_query_relations_and_insert_columns_exist(self):
        catalog=schema_catalog()
        self.assertGreater(len(queries()),20)
        for line,sql in queries():
            for table in re.findall(r'\b(?:FROM|JOIN|INTO|UPDATE)\s+spff\.(\w+)',sql,re.I):
                self.assertIn(table,catalog,f'line {line}: {table}')
            for table,columns in re.findall(r'INSERT INTO spff\.(\w+)\s*\(([^)]+)\)',sql,re.I):
                for column in columns.split(','):
                    self.assertIn(column.strip(),catalog[table],f'line {line}: {table}.{column}')

    def test_telemetry_fields_and_recipe_schedule_types_declared(self):
        from spff_ai.core import RANGES
        catalog=schema_catalog()
        self.assertTrue(set(RANGES).issubset(catalog['telemetry_samples']))
        self.assertTrue({'planting_date','application_date','hst_from','hst_to','application_mode',
                         'application_interval_days','revision','crop_id','zone_id'}.issubset(catalog['fertigation_recipes']))
        self.assertTrue({'actual_water_l','actual_stock_l','pumps_off','status','started_at','last_recorded_at'}.issubset(catalog['fertigation_sessions']))

    def test_existing_views_and_event_evidence_definitions_present(self):
        sql='\n'.join(p.read_text(encoding='utf-8') for p in (ROOT/'infrastructure/postgres/migrations').glob('*.sql'))
        for view in ('latest_telemetry','latest_device_status'):
            self.assertRegex(sql,rf'CREATE OR REPLACE VIEW spff\.{view}\b')
        self.assertTrue({'session_id','message_id','sequence','payload','recorded_at'}.issubset(schema_catalog()['fertigation_session_events']))

    def test_all_writes_are_shadow_only_and_parameterized(self):
        for line,sql in queries():
            for table in re.findall(r'\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+spff\.(\w+)',sql,re.I):
                self.assertTrue(table.startswith('adaptive_ai_'),f'non-shadow write line {line}')
        for path in (ROOT/'python-ai/src/spff_ai').glob('*.py'):
            tree=ast.parse(path.read_text())
            for node in ast.walk(tree):
                if isinstance(node,ast.Import):
                    self.assertFalse(any(n.name.split('.')[0] in ('serial','paho','mqtt') for n in node.names))
                if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=='execute':
                    self.assertFalse(isinstance(node.args[0],ast.JoinedStr),'SQL must not interpolate identities')

    def test_validation_migration_only_alters_shadow_tables(self):
        text=(ROOT/'infrastructure/postgres/migrations/035_adaptive_ai_validation.sql').read_text()
        self.assertNotRegex(text,r'(?i)\b(?:DROP|TRUNCATE|DELETE)\b')
        for table in re.findall(r'ALTER TABLE spff\.(\w+)',text):
            self.assertTrue(table.startswith('adaptive_ai_'))
