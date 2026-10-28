set +e
S() { echo 'orangepi' | sudo -S -p '' "$@" 2>/dev/null; }
echo "=== FIRMWARE ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT to_char(received_at AT TIME ZONE 'Asia/Jakarta','HH24:MI:SS') AS wib, raw_payload->>'firmwareVersion' AS fw, raw_payload->>'pulseBootId' AS boot FROM spff.device_status_events ORDER BY received_at DESC LIMIT 2;"
echo
echo "=== UMUR DATA TANAH (6 sampel terakhir) ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "
SELECT to_char(received_at AT TIME ZONE 'Asia/Jakarta','HH24:MI:SS') AS wib,
       (SELECT count(*) FROM jsonb_each(raw_payload->'sensorHealth') e(k,v)
         WHERE k LIKE 'soil%' AND v->>'valid'='true') AS valid,
       (SELECT count(*) FROM jsonb_each(raw_payload->'sensorHealth') e(k,v)
         WHERE k LIKE 'soil%' AND v ? 'rawAgeMs'
           AND (v->>'rawAgeMs')::bigint > 120000) AS lewat_2menit,
       (SELECT max((v->>'rawAgeMs')::bigint)/1000 FROM jsonb_each(raw_payload->'sensorHealth') e(k,v)
         WHERE k LIKE 'soil%' AND v ? 'rawAgeMs') AS max_usia_s,
       (SELECT round(avg((v->>'rawAgeMs')::bigint)/1000) FROM jsonb_each(raw_payload->'sensorHealth') e(k,v)
         WHERE k LIKE 'soil%' AND v ? 'rawAgeMs') AS rata_usia_s
FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 6;"
echo
echo "=== COUNTER (latest) ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "
SELECT k AS field, v->>'pollTotalAttempts' AS att, v->>'pollTotalSuccesses' AS ok, v->>'lastPollResult' AS res
FROM (SELECT raw_payload->'sensorHealth' AS h FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 1) t,
     jsonb_each(h) e(k,v) WHERE k LIKE 'soil%' ORDER BY k;"
