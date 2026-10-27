import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

test('API settings upsert can sync alarm thresholds without granting worker writes',
 {skip:!process.env.SPFF_TEST_PGLITE_MODULE},async()=>{
  const {PGlite}=await import(pathToFileURL(process.env.SPFF_TEST_PGLITE_MODULE).href);
  const db=new PGlite();
  const dir=resolve(import.meta.dirname,'../../infrastructure/postgres/migrations');
  const fix=readFileSync(resolve(dir,'031_settings_alarm_rule_permissions.sql'),'utf8');
  try {
    await db.exec('CREATE ROLE spff_app; CREATE ROLE spff_api_role; CREATE ROLE spff_worker;');
    for(const name of readdirSync(dir).sort().filter(n=>!n.startsWith('031_')))
      await db.exec(readFileSync(resolve(dir,name),'utf8'));
    await db.exec(`INSERT INTO spff.sites(site_id,name) VALUES('greenhouse-01','Test');
      INSERT INTO spff.site_settings(site_id) VALUES('greenhouse-01');
      GRANT USAGE ON SCHEMA spff TO spff_app,spff_api_role;
      GRANT SELECT,INSERT,UPDATE ON spff.site_settings TO spff_app,spff_api_role;`);
    // Reproduce the reported failure using the real trigger as the API role.
    await db.exec('SET ROLE spff_app');
    await assert.rejects(db.exec(`UPDATE spff.site_settings SET temperature_min=20 WHERE site_id='greenhouse-01'`),
      /permission denied for table alarm_rules/);
    await db.exec('RESET ROLE');
    await db.exec(fix);await db.exec(fix); // safe to reapply
    for(const role of ['spff_app','spff_api_role']) {
      await db.exec(`SET ROLE ${role}`);
      await db.exec(`INSERT INTO spff.site_settings(site_id,temperature_min,temperature_max,humidity_min,humidity_max)
        VALUES('greenhouse-01',20,35,40,85) ON CONFLICT(site_id) DO UPDATE
        SET temperature_min=EXCLUDED.temperature_min,temperature_max=EXCLUDED.temperature_max,
          humidity_min=EXCLUDED.humidity_min,humidity_max=EXCLUDED.humidity_max`);
      await db.exec('RESET ROLE');
    }
    const rules=(await db.query(`SELECT rule_key,threshold_value FROM spff.alarm_rules
      WHERE site_id='greenhouse-01' AND rule_key IN ('air_temperature_low','air_temperature_high','air_humidity_low','air_humidity_high')`)).rows;
    assert.deepEqual(Object.fromEntries(rules.map(r=>[r.rule_key,r.threshold_value])),
      {air_temperature_low:20,air_temperature_high:35,air_humidity_low:40,air_humidity_high:85});
    const worker=(await db.query(`SELECT has_table_privilege('spff_worker','spff.alarm_rules','UPDATE') AS allowed`)).rows[0];
    assert.equal(worker.allowed,false);
  }finally{await db.close();}
});
