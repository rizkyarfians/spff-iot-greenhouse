import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Dedicated disposable PostgreSQL only: this test creates the complete schema.
test('planner SQL: migration, revision conflicts, transactional audit and schedule/dose evidence',
  { skip: !process.env.SPFF_TEST_PLANNER_DATABASE_URL && !process.env.SPFF_TEST_PGLITE_MODULE }, async () => {
    process.env.DATABASE_URL = process.env.SPFF_TEST_PLANNER_DATABASE_URL ?? 'postgres://test:test@localhost/test';
    const { pool } = await import('../lib/services/postgresRepository.js');
    let temporaryDb;
    const realEnd = pool.end.bind(pool);
    if (process.env.SPFF_TEST_PGLITE_MODULE) {
      const { PGlite } = await import(pathToFileURL(process.env.SPFF_TEST_PGLITE_MODULE).href);
      temporaryDb = new PGlite();
      const query = async (sql, values = []) => {
        const result = values.length ? await temporaryDb.query(sql, values) : null;
        if (result) return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
        const results = await temporaryDb.exec(sql);
        const last = results.at(-1) ?? { rows: [] };
        return { ...last, rowCount: last.rows.length || last.affectedRows || 0 };
      };
      pool.query = query;
      // PGlite has one connection: give each transaction exclusive use of it.
      let available = Promise.resolve();
      pool.connect = async () => {
        const previous = available;
        let release;
        available = new Promise(resolve => { release = resolve; });
        await previous;
        return { query, release };
      };
    }
    const { savePlannerProfile, getPlannerProfile, loadPlannerEvidence } = await import('../lib/services/fertigationPlannerRepository.js');
    const { createFertigationRecipe } = await import('../lib/services/fertigationRepository.js');
    const identity = { deviceId: 'esp32-s3-01', recipeId: '00000000-0000-4000-8000-000000000001' };
    const profile = {
      calibrationReference: 'SQL TEST FIXTURE', plantCount: 100,
      waterLPerPlantPerMoisturePoint: 0.01, maxWaterLPerPlant: 1, fertilizerGPerPlant: 1,
      calibratedWaterLpm: 10, calibratedStockLpm: 1, stockFlowMeasuresInjection: true,
      stockTankVolumeCurve: [{ levelPercent: 0, volumeL: 0 }, { levelPercent: 100, volumeL: 100 }],
      stockReserveL: 2, maxDailyStockL: 5, stabilizationSeconds: 5, flushWaterL: 5,
      mixingSeconds: 1, ecKpMsPerUsCm: 10, minPulseMs: 1500, maxPulseMs: 10000,
    };
    try {
      const migrations = resolve(import.meta.dirname, '../../infrastructure/postgres/migrations');
      for (const name of readdirSync(migrations).sort()) await pool.query(readFileSync(resolve(migrations, name), 'utf8'));
      await pool.query(`INSERT INTO spff.sites(site_id,name) VALUES('greenhouse-01','Planner test');
        INSERT INTO spff.devices(site_id,device_id,display_name) VALUES('greenhouse-01','esp32-s3-01','Test');
        INSERT INTO spff.actuators(site_id,device_id,actuator_key,display_name) VALUES
          ('greenhouse-01','esp32-s3-01','pump_water','Water'),('greenhouse-01','esp32-s3-01','pump_fert','Stock');`);
      const recipe = await createFertigationRecipe({ cropId: 'tomato', cropName: 'Tomat', hstFrom: 0, hstTo: 100,
        plantingDate: '2026-10-01', applicationDate: '2026-10-26', applicationMode: 'once', applicationIntervalDays: null,
        triggerSampleCount: 3, targetWaterL: 50, targetStockL: 2, fertilizerName: 'Test only', stockConcentrationGPerL: 100,
        minWaterTankPercent: 10, minStockTankPercent: 10, sourceReference: 'Test only', useForEvaluation: true,
        moistureLowPercent: 30, moistureTargetPercent: 60, ecLowUsCm: 500, ecTargetUsCm: 1000, ecHighUsCm: 1500 }, 'test');
      identity.recipeId = recipe.recipeId;
      const input = { ...identity, profile, expectedRevision: 0, expectedRecipeRevision: recipe.revision };
      assert.equal((await savePlannerProfile(input, 'admin')).revision, 1);
      await assert.rejects(savePlannerProfile(input, 'stale'), /Profil sudah berubah/);
      const outcomes = await Promise.allSettled([
        savePlannerProfile({ ...input, expectedRevision: 1 }, 'editor-a'),
        savePlannerProfile({ ...input, expectedRevision: 1 }, 'editor-b'),
      ]);
      assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal((await getPlannerProfile(identity.deviceId, identity.recipeId)).revision, 2);
      assert.equal(Number((await pool.query('SELECT count(*) AS n FROM spff.fertigation_planner_profile_revisions')).rows[0].n), 2);
      await assert.rejects(savePlannerProfile({ ...input, expectedRevision: 2, expectedRecipeRevision: 999 }, 'stale'), /Aturan sudah berubah/);
      const now = new Date('2026-10-26T05:00:00Z'); // noon WIB
      await pool.query(`INSERT INTO spff.actuator_schedules(schedule_id,site_id,device_id,actuator_key,on_time,off_time,repeat_rule,requested_by)
        VALUES ('water','greenhouse-01','esp32-s3-01','pump_water','11:00','12:10','daily','test'),
          ('fert','greenhouse-01','esp32-s3-01','pump_fert','11:00','12:05','daily','test');
        UPDATE spff.device_schedule_sync_state SET acknowledged_revision=revision,acknowledgement_status='applied';`);
      const evidence = await loadPlannerEvidence(identity.deviceId, true, now);
      assert.equal(evidence.remainingSeconds, 300);
      assert.equal(evidence.dailyStockUsedL, 0);
      assert.deepEqual(evidence.holdReasons, []);
      assert.equal((await loadPlannerEvidence(identity.deviceId, false, now)).remainingSeconds, 600);
      assert.equal((await loadPlannerEvidence(identity.deviceId, true, new Date('2026-10-26T05:05:00Z'))).remainingSeconds, null);
      await pool.query(`UPDATE spff.device_schedule_sync_state SET acknowledgement_status='rejected'`);
      assert.ok((await loadPlannerEvidence(identity.deviceId, true, now)).holdReasons.length > 0);
      await pool.query(`INSERT INTO spff.fertigation_sessions
        (session_id,site_id,device_id,recipe_id,target_water_l,target_stock_l,status,pumps_off,last_recorded_at)
        VALUES('00000000-0000-4000-8000-000000000099','greenhouse-01','esp32-s3-01',$1,40,1,'fault',false,$2)`, [recipe.recipeId, now]);
      assert.equal((await loadPlannerEvidence(identity.deviceId, true, now)).dailyStockUsedL, null);
    } finally { if (temporaryDb) await temporaryDb.close(); await realEnd(); }
  });
