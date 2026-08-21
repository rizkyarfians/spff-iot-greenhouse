#!/usr/bin/env python3
"""
SPFF ESP32 MQTT Simulator (Windows)

Tujuan:
- Mensimulasikan ESP32-S3 via MQTT tanpa hardware asli.
- Publish telemetry QoS 1.
- Publish state/status retained.
- Subscribe command.
- Membalas command dengan ACK + actual state.
- Sequence disimpan lokal agar tidak reset setiap restart.

Semua nilai sensor pada script ini adalah DATA SIMULASI untuk testing.
"""

from __future__ import annotations

import argparse
import getpass
import json
import random
import signal
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import paho.mqtt.client as mqtt


def utc_now() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


def randf(base: float, spread: float, digits: int = 2) -> float:
    return round(base + random.uniform(-spread, spread), digits)


class SpffSimulator:
    def __init__(
        self,
        host: str,
        port: int,
        username: str,
        password: str,
        site_id: str,
        device_id: str,
        interval: float,
    ) -> None:
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.site_id = site_id
        self.device_id = device_id
        self.interval = interval

        self.running = threading.Event()
        self.running.set()

        self.sequence_file = Path(f".spff-sequence-{device_id}.txt")
        self.sequence = self._load_sequence()

        self.pump_water = False
        self.pump_fert = False
        self.system_state = "automatic"
        self.growth_phase = "vegetative"

        base = f"spff/v1/{self.site_id}/{self.device_id}"
        self.topic_telemetry = f"{base}/telemetry"
        self.topic_state = f"{base}/state"
        self.topic_status = f"{base}/status"
        self.topic_command = f"{base}/commands"
        self.topic_ack = f"{base}/ack"

        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"{self.device_id}-windows-sim",
            protocol=mqtt.MQTTv311,
        )
        self.client.username_pw_set(self.username, self.password)

        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message

        offline = {
            "schemaVersion": 1,
            "siteId": self.site_id,
            "deviceId": self.device_id,
            "status": "offline",
        }
        self.client.will_set(
            self.topic_status,
            json.dumps(offline, separators=(",", ":")),
            qos=1,
            retain=True,
        )

    def _load_sequence(self) -> int:
        try:
            return int(self.sequence_file.read_text(encoding="utf-8").strip())
        except (FileNotFoundError, ValueError):
            return 0

    def _save_sequence(self) -> None:
        self.sequence_file.write_text(str(self.sequence), encoding="utf-8")

    def _publish_json(
        self,
        topic: str,
        payload: dict[str, Any],
        *,
        retain: bool = False,
    ) -> bool:
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        info = self.client.publish(topic, body, qos=1, retain=retain)
        info.wait_for_publish(timeout=10)

        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            print(f"[ERROR] publish gagal rc={info.rc} topic={topic}")
            return False

        return True

    def _on_connect(
        self,
        client: mqtt.Client,
        userdata: Any,
        flags: mqtt.ConnectFlags,
        reason_code: mqtt.ReasonCode,
        properties: mqtt.Properties | None,
    ) -> None:
        if reason_code.is_failure:
            print(f"[ERROR] MQTT connect gagal: {reason_code}")
            return

        print(f"[MQTT] Connected ke {self.host}:{self.port}")
        print(f"[MQTT] Subscribe: {self.topic_command}")

        client.subscribe(self.topic_command, qos=1)

        self.publish_status("online")
        self.publish_state()

    def _on_disconnect(
        self,
        client: mqtt.Client,
        userdata: Any,
        disconnect_flags: mqtt.DisconnectFlags,
        reason_code: mqtt.ReasonCode,
        properties: mqtt.Properties | None,
    ) -> None:
        if reason_code != 0:
            print(f"[MQTT] Disconnected tidak normal: {reason_code}")
        else:
            print("[MQTT] Disconnected")

    def _on_message(
        self,
        client: mqtt.Client,
        userdata: Any,
        msg: mqtt.MQTTMessage,
    ) -> None:
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            print(f"[COMMAND] JSON invalid: {exc}")
            return

        print("\n[COMMAND] diterima:")
        print(json.dumps(payload, indent=2, ensure_ascii=False))

        self.handle_command(payload)

    def generate_sensors(self) -> dict[str, Any]:
        # Semua angka di bawah adalah data SIMULASI, bukan pembacaan hardware.
        return {
            "soil_1_moisture": randf(67.0, 2.0),
            "soil_1_temp": randf(25.5, 0.7),
            "soil_1_ec_us_cm": randf(1350.0, 35.0, 1),
            "soil_1_ph": randf(6.4, 0.12),
            "soil_1_n": random.randint(135, 145),
            "soil_1_p": random.randint(60, 70),
            "soil_1_k": random.randint(200, 220),

            "soil_2_moisture": randf(65.0, 2.0),
            "soil_2_temp": randf(25.3, 0.7),
            "soil_2_ec_us_cm": randf(1320.0, 35.0, 1),
            "soil_2_ph": randf(6.3, 0.12),
            "soil_2_n": random.randint(133, 143),
            "soil_2_p": random.randint(58, 68),
            "soil_2_k": random.randint(195, 215),

            "liquid_ph": randf(6.1, 0.10),
            "liquid_ec_us_cm": randf(1450.0, 30.0, 1),
            "liquid_temp": randf(24.7, 0.5),

            "air_temp": randf(27.0, 1.0),
            "air_humidity": randf(74.0, 3.0),

            "tank_water_distance_cm": randf(32.0, 1.0),
            "tank_water_level_pct": randf(73.0, 1.5),

            "tank_fert_distance_cm": randf(18.0, 0.8),
            "tank_fert_level_pct": randf(84.0, 1.0),

            "flow_water_lpm": randf(2.35 if self.pump_water else 0.0, 0.08),
            "flow_water_total_l": randf(241.7, 0.4),

            "flow_fert_lpm": randf(0.32 if self.pump_fert else 0.0, 0.03),
            "flow_fert_total_l": randf(37.8, 0.15),

            "battery_voltage": randf(12.48, 0.06),
        }

    def publish_telemetry(self) -> None:
        self.sequence += 1

        payload = {
            "schemaVersion": 1,
            "siteId": self.site_id,
            "deviceId": self.device_id,
            "messageId": str(uuid.uuid4()),
            "sequence": self.sequence,
            "recordedAt": utc_now(),
            "sensors": self.generate_sensors(),
            "diagnostics": {
                "sensor_valid": True,
                "simulated": True,
            },
        }

        if self._publish_json(self.topic_telemetry, payload, retain=False):
            self._save_sequence()
            print(
                f"[TELEMETRY] seq={self.sequence} "
                f"messageId={payload['messageId']}"
            )

    def publish_state(self) -> None:
        payload = {
            "schemaVersion": 1,
            "siteId": self.site_id,
            "deviceId": self.device_id,
            "recordedAt": utc_now(),
            "actuators": {
                "pump_water": self.pump_water,
                "pump_fert": self.pump_fert,
            },
            "system": {
                "system_state": self.system_state,
                "growth_phase": self.growth_phase,
            },
            "simulated": True,
        }

        if self._publish_json(self.topic_state, payload, retain=True):
            print(
                "[STATE] "
                f"pump_water={self.pump_water} "
                f"pump_fert={self.pump_fert}"
            )

    def publish_status(self, status: str) -> None:
        payload = {
            "schemaVersion": 1,
            "siteId": self.site_id,
            "deviceId": self.device_id,
            "status": status,
            "recordedAt": utc_now(),
            "simulated": True,
        }

        self._publish_json(self.topic_status, payload, retain=True)

    def publish_ack(
        self,
        command_id: str,
        status: str,
        *,
        reason: str | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            "schemaVersion": 1,
            "siteId": self.site_id,
            "deviceId": self.device_id,
            "commandId": command_id,
            "recordedAt": utc_now(),
            "status": status,
            "actualState": {
                "pump_water": self.pump_water,
                "pump_fert": self.pump_fert,
            },
            "simulated": True,
        }

        if reason:
            payload["reason"] = reason

        self._publish_json(self.topic_ack, payload, retain=False)

    def handle_command(self, payload: dict[str, Any]) -> None:
        command_id = payload.get("commandId")
        target = payload.get("target")
        action = payload.get("action")

        if not isinstance(command_id, str) or not command_id:
            print("[COMMAND] ditolak: commandId invalid")
            return

        expires_at = payload.get("expiresAt")
        if isinstance(expires_at, str):
            try:
                expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                if datetime.now(timezone.utc) > expiry:
                    print(f"[COMMAND] expired: {command_id}")
                    self.publish_ack(
                        command_id,
                        "rejected",
                        reason="command_expired",
                    )
                    return
            except ValueError:
                self.publish_ack(
                    command_id,
                    "rejected",
                    reason="invalid_expiresAt",
                )
                return

        if target not in {"pump_water", "pump_fert"}:
            self.publish_ack(
                command_id,
                "rejected",
                reason="unsupported_target",
            )
            return

        if action not in {"on", "off"}:
            self.publish_ack(
                command_id,
                "rejected",
                reason="unsupported_action",
            )
            return

        desired = action == "on"

        if target == "pump_water":
            self.pump_water = desired
        elif target == "pump_fert":
            self.pump_fert = desired

        # Simulator menganggap perubahan aktual berhasil di titik ini.
        # Firmware ESP asli nanti wajib cek interlock/fail-safe/hardware aktual.
        self.publish_ack(command_id, "completed")
        self.publish_state()

        print(
            f"[COMMAND] completed: {command_id} "
            f"{target}={desired}"
        )

    def run(self) -> None:
        print("=== SPFF ESP32 Windows Simulator ===")
        print(f"Broker    : {self.host}:{self.port}")
        print(f"Site      : {self.site_id}")
        print(f"Device    : {self.device_id}")
        print(f"Username  : {self.username}")
        print(f"Interval  : {self.interval}s")
        print("Ctrl+C untuk stop.\n")

        self.client.connect(self.host, self.port, keepalive=30)
        self.client.loop_start()

        try:
            while self.running.is_set():
                self.publish_telemetry()

                stop_at = time.monotonic() + self.interval
                while self.running.is_set() and time.monotonic() < stop_at:
                    time.sleep(0.1)

        finally:
            print("\n[STOP] publish status offline...")
            try:
                self.publish_status("offline")
                time.sleep(0.2)
            except Exception:
                pass

            self.client.disconnect()
            self.client.loop_stop()

    def stop(self) -> None:
        self.running.clear()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="SPFF ESP32 MQTT simulator untuk Windows"
    )
    parser.add_argument("--host", required=True, help="IP Orange Pi")
    parser.add_argument("--port", type=int, default=1883)
    parser.add_argument("--username", default="simulator-01")
    parser.add_argument("--site", default="test")
    parser.add_argument("--device", default="simulator-01")
    parser.add_argument("--interval", type=float, default=5.0)
    args = parser.parse_args()

    password = getpass.getpass(
        f"MQTT password untuk {args.username}: "
    )

    simulator = SpffSimulator(
        host=args.host,
        port=args.port,
        username=args.username,
        password=password,
        site_id=args.site,
        device_id=args.device,
        interval=args.interval,
    )

    def handle_signal(signum: int, frame: Any) -> None:
        simulator.stop()

    signal.signal(signal.SIGINT, handle_signal)

    try:
        simulator.run()
    except KeyboardInterrupt:
        simulator.stop()
    except ConnectionRefusedError:
        print(
            "\n[ERROR] Koneksi ditolak. "
            "Cek IP Orange Pi, port 1883, firewall, dan Mosquitto."
        )
        return 1
    except Exception as exc:
        print(f"\n[ERROR] {type(exc).__name__}: {exc}")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
