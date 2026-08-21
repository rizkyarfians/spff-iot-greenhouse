#!/usr/bin/env python3
"""Temporary SPFF MQTT -> PostgreSQL telemetry ingestion worker."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import signal
import time
from datetime import datetime, timezone
from typing import Any

import paho.mqtt.client as mqtt
import psycopg2


FLOAT_SENSOR_KEYS = {
    "soil_1_moisture", "soil_1_temp", "soil_1_ec_us_cm", "soil_1_ph",
    "soil_2_moisture", "soil_2_temp", "soil_2_ec_us_cm", "soil_2_ph",
    "liquid_ph", "liquid_ec_us_cm", "liquid_temp",
    "air_temp", "air_humidity",
    "tank_water_distance_cm", "tank_water_level_pct",
    "tank_fert_distance_cm", "tank_fert_level_pct",
    "flow_water_lpm", "flow_water_total_l",
    "flow_fert_lpm", "flow_fert_total_l",
    "battery_voltage",
}

INTEGER_SENSOR_KEYS = {
    "soil_1_n", "soil_1_p", "soil_1_k",
    "soil_2_n", "soil_2_p", "soil_2_k",
}

ALL_SENSOR_KEYS = FLOAT_SENSOR_KEYS | INTEGER_SENSOR_KEYS

SENSOR_COLUMNS = [
    "soil_1_moisture", "soil_1_temp", "soil_1_ec_us_cm", "soil_1_ph",
    "soil_1_n", "soil_1_p", "soil_1_k",
    "soil_2_moisture", "soil_2_temp", "soil_2_ec_us_cm", "soil_2_ph",
    "soil_2_n", "soil_2_p", "soil_2_k",
    "liquid_ph", "liquid_ec_us_cm", "liquid_temp",
    "air_temp", "air_humidity",
    "tank_water_distance_cm", "tank_water_level_pct",
    "tank_fert_distance_cm", "tank_fert_level_pct",
    "flow_water_lpm", "flow_water_total_l",
    "flow_fert_lpm", "flow_fert_total_l",
    "battery_voltage",
]

INSERT_COLUMNS = [
    "schema_version", "site_id", "device_id", "message_id", "sequence", "recorded_at",
    *SENSOR_COLUMNS,
    "sensor_valid", "raw_payload",
]

INSERT_SQL = f"""
INSERT INTO spff.telemetry_samples ({', '.join(INSERT_COLUMNS)})
VALUES ({', '.join(['%s'] * len(INSERT_COLUMNS))})
ON CONFLICT (site_id, device_id, message_id)
DO NOTHING
RETURNING telemetry_id;
"""


class ValidationError(Exception):
    pass


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def parse_recorded_at(value: Any) -> datetime:
    if not isinstance(value, str) or not value:
        raise ValidationError("recordedAt wajib string ISO 8601 UTC")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValidationError("recordedAt invalid") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise ValidationError("recordedAt wajib UTC (Z / +00:00)")
    return parsed


def validate_payload(topic: str, payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("root payload wajib object")

    parts = topic.split("/")
    if len(parts) != 6 or parts[:2] != ["spff", "v1"] or parts[5] != "telemetry":
        raise ValidationError(f"topic tidak valid: {topic}")

    if payload.get("schemaVersion") != 1:
        raise ValidationError("schemaVersion yang didukung hanya 1")

    site_id = payload.get("siteId")
    device_id = payload.get("deviceId")
    message_id = payload.get("messageId")
    sequence = payload.get("sequence")

    if not isinstance(site_id, str) or not site_id:
        raise ValidationError("siteId wajib string")
    if not isinstance(device_id, str) or not device_id:
        raise ValidationError("deviceId wajib string")
    if site_id != parts[2] or device_id != parts[3]:
        raise ValidationError("siteId/deviceId tidak cocok dengan topic")
    if not isinstance(message_id, str) or not message_id:
        raise ValidationError("messageId wajib string")
    if not isinstance(sequence, int) or isinstance(sequence, bool) or sequence < 0:
        raise ValidationError("sequence wajib integer >= 0")

    recorded_at = parse_recorded_at(payload.get("recordedAt"))

    sensors = payload.get("sensors")
    if not isinstance(sensors, dict):
        raise ValidationError("sensors wajib object")

    unknown = sorted(set(sensors) - ALL_SENSOR_KEYS)
    if unknown:
        raise ValidationError("sensor key tidak dikenal: " + ", ".join(unknown))

    for key in FLOAT_SENSOR_KEYS:
        if key in sensors and sensors[key] is not None and not is_number(sensors[key]):
            raise ValidationError(f"{key} wajib number atau null")

    for key in INTEGER_SENSOR_KEYS:
        if key in sensors and sensors[key] is not None:
            if not isinstance(sensors[key], int) or isinstance(sensors[key], bool):
                raise ValidationError(f"{key} wajib integer atau null")

    diagnostics = payload.get("diagnostics", {})
    if not isinstance(diagnostics, dict):
        raise ValidationError("diagnostics wajib object")
    sensor_valid = diagnostics.get("sensor_valid", True)
    if not isinstance(sensor_valid, bool):
        raise ValidationError("diagnostics.sensor_valid wajib boolean")

    return {
        "schema_version": 1,
        "site_id": site_id,
        "device_id": device_id,
        "message_id": message_id,
        "sequence": sequence,
        "recorded_at": recorded_at,
        "sensors": sensors,
        "sensor_valid": sensor_valid,
    }


class Worker:
    def __init__(self, args: argparse.Namespace, mqtt_password: str, db_password: str) -> None:
        self.args = args
        self.db_password = db_password
        self.db = None
        self.running = True
        self.last_sequence: dict[tuple[str, str], int] = {}

        self.client = mqtt.Client(client_id="spff-python-telemetry-worker", protocol=mqtt.MQTTv311)
        self.client.username_pw_set(args.mqtt_user, mqtt_password)
        self.client.reconnect_delay_set(min_delay=1, max_delay=30)
        self.client.on_connect = self.on_connect
        self.client.on_disconnect = self.on_disconnect
        self.client.on_message = self.on_message

    def connect_db(self):
        if self.db is not None and self.db.closed == 0:
            return self.db
        self.db = psycopg2.connect(
            host=self.args.db_host,
            port=self.args.db_port,
            dbname=self.args.db_name,
            user=self.args.db_user,
            password=self.db_password,
            connect_timeout=5,
            application_name="spff-python-telemetry-worker",
        )
        return self.db

    def on_connect(self, client, userdata, flags, rc):
        if rc != 0:
            print(f"[MQTT] connect gagal rc={rc}")
            return
        print(f"[MQTT] connected {self.args.mqtt_host}:{self.args.mqtt_port}")
        client.subscribe("spff/v1/+/+/telemetry", qos=1)
        print("[MQTT] subscribed spff/v1/+/+/telemetry QoS 1")

    def on_disconnect(self, client, userdata, rc):
        print(f"[MQTT] disconnected rc={rc}")

    def warn_sequence(self, site_id: str, device_id: str, sequence: int) -> None:
        key = (site_id, device_id)
        prev = self.last_sequence.get(key)
        if prev is not None:
            if sequence == prev:
                print(f"[WARN] duplicate sequence {site_id}/{device_id} seq={sequence}")
            elif sequence < prev:
                print(f"[WARN] out-of-order {site_id}/{device_id}: prev={prev} current={sequence}")
            elif sequence > prev + 1:
                print(f"[WARN] sequence gap {site_id}/{device_id}: prev={prev} current={sequence}")
        if prev is None or sequence > prev:
            self.last_sequence[key] = sequence

    def insert(self, v: dict[str, Any], raw_payload: dict[str, Any]):
        values = [
            v["schema_version"], v["site_id"], v["device_id"], v["message_id"],
            v["sequence"], v["recorded_at"],
            *[v["sensors"].get(column) for column in SENSOR_COLUMNS],
            v["sensor_valid"], json.dumps(raw_payload, ensure_ascii=False),
        ]
        db = self.connect_db()
        try:
            with db.cursor() as cur:
                cur.execute(INSERT_SQL, values)
                row = cur.fetchone()
            db.commit()
            return None if row is None else int(row[0])
        except Exception:
            db.rollback()
            raise

    def on_message(self, client, userdata, msg):
        try:
            raw = msg.payload.decode("utf-8")
            payload = json.loads(raw)
        except UnicodeDecodeError:
            print(f"[REJECT] {msg.topic}: payload bukan UTF-8")
            return
        except json.JSONDecodeError as exc:
            print(f"[REJECT] {msg.topic}: JSON invalid: {exc}")
            return

        try:
            v = validate_payload(msg.topic, payload)
        except ValidationError as exc:
            print(f"[REJECT] {msg.topic}: {exc}")
            return

        try:
            telemetry_id = self.insert(v, payload)
        except psycopg2.errors.ForeignKeyViolation:
            if self.db is not None:
                self.db.rollback()
            print(f"[REJECT] device belum terdaftar: {v['site_id']}/{v['device_id']}")
            return
        except Exception as exc:
            if self.db is not None:
                self.db.rollback()
            print(f"[DB ERROR] {type(exc).__name__}: {exc}")
            return

        self.warn_sequence(v["site_id"], v["device_id"], v["sequence"])

        if telemetry_id is None:
            print(f"[DEDUP] {v['site_id']}/{v['device_id']} messageId={v['message_id']}")
        else:
            print(
                f"[INSERT] id={telemetry_id} {v['site_id']}/{v['device_id']} "
                f"seq={v['sequence']} messageId={v['message_id']}"
            )

    def stop(self) -> None:
        self.running = False
        try:
            self.client.disconnect()
        except Exception:
            pass

    def run(self) -> None:
        self.connect_db()
        print(f"[DB] connected {self.args.db_host}:{self.args.db_port}/{self.args.db_name}")

        delay = 1
        while self.running:
            try:
                print(f"[MQTT] connecting {self.args.mqtt_host}:{self.args.mqtt_port}...")
                self.client.connect(self.args.mqtt_host, self.args.mqtt_port, keepalive=30)
                self.client.loop_forever()
            except KeyboardInterrupt:
                break
            except Exception as exc:
                if not self.running:
                    break
                print(f"[MQTT ERROR] {type(exc).__name__}: {exc}; retry {delay}s")
                time.sleep(delay)
                delay = min(delay * 2, 30)
            else:
                delay = 1

        if self.db is not None and self.db.closed == 0:
            self.db.close()
        print("[WORKER] stopped")


def main() -> int:
    parser = argparse.ArgumentParser(description="SPFF temporary telemetry ingestion worker")
    parser.add_argument("--mqtt-host", default=os.getenv("MQTT_HOST", "127.0.0.1"))
    parser.add_argument("--mqtt-port", type=int, default=int(os.getenv("MQTT_PORT", "1883")))
    parser.add_argument("--mqtt-user", default=os.getenv("MQTT_USERNAME", "spff_worker"))
    parser.add_argument("--db-host", default=os.getenv("PGHOST", "127.0.0.1"))
    parser.add_argument("--db-port", type=int, default=int(os.getenv("PGPORT", "5432")))
    parser.add_argument("--db-name", default=os.getenv("PGDATABASE", "spff"))
    parser.add_argument("--db-user", default=os.getenv("PGUSER", "spff_app"))
    args = parser.parse_args()

    mqtt_password = os.getenv("MQTT_PASSWORD") or getpass.getpass(
        f"MQTT password untuk {args.mqtt_user}: "
    )
    db_password = os.getenv("PGPASSWORD") or getpass.getpass(
        f"PostgreSQL password untuk {args.db_user}: "
    )

    worker = Worker(args, mqtt_password, db_password)
    signal.signal(signal.SIGTERM, lambda *_: worker.stop())
    signal.signal(signal.SIGINT, lambda *_: worker.stop())

    try:
        worker.run()
    except psycopg2.OperationalError as exc:
        print(f"[DB ERROR] gagal connect PostgreSQL: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
