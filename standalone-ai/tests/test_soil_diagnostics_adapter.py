"""Verify actual ESP32 sensor diagnostics normalization without DB or hardware."""
import unittest

from app.source import normalize_soil_diagnostics


class SoilDiagnosticsAdapterTests(unittest.TestCase):
    def test_firmware_control_eligible_true_maps_with_raw_freshness(self):
        sample = {
            "sensor_health": {"soil_2_moisture": {"valid": True}},
            "raw_payload": {"sensorHealth": {"soil_2_moisture": {
                "raw": 246, "rawAgeMs": 26344, "rawFresh": True,
                "lastPollOk": True, "pollBootId": "6200c2e50bd42105",
                "controlEligible": True, "diagBaud": 4800,
                "lastPollHex": "private-transport-data",
            }}},
        }
        normalize_soil_diagnostics(sample)
        health = sample["sensor_health"]["soil_2_moisture"]
        self.assertEqual(health, {
            "valid": True, "raw": 246, "rawAgeMs": 26344,
            "rawFresh": True, "lastPollOk": True,
            "pollBootId": "6200c2e50bd42105", "controlValid": True,
        })
        self.assertNotIn("raw_payload", sample)

    def test_firmware_control_eligible_false_blocks_even_if_valid(self):
        sample = {
            "sensor_health": {"soil_2_moisture": {"valid": True}},
            "raw_payload": {"sensorHealth": {"soil_2_moisture": {
                "raw": 245, "rawAgeMs": 39076, "rawFresh": True,
                "lastPollOk": True, "pollBootId": "boot",
                "controlEligible": False,
            }}},
        }
        normalize_soil_diagnostics(sample)
        self.assertIs(sample["sensor_health"]["soil_2_moisture"]["controlValid"], False)

    def test_missing_firmware_health_does_not_fabricate_freshness(self):
        sample = {
            "sensor_health": {"soil_2_moisture": {"valid": True}},
            "raw_payload": {"sensorHealth": {}},
        }
        normalize_soil_diagnostics(sample)
        self.assertEqual(sample["sensor_health"]["soil_2_moisture"], {"valid": True})
        self.assertNotIn("raw_payload", sample)

    def test_legacy_control_valid_supported_but_explicit_rejection_wins(self):
        sample = {
            "sensor_health": {"soil_2_moisture": {"valid": True}},
            "raw_payload": {"sensorHealth": {"soil_2_moisture": {
                "controlEligible": False, "controlValid": True,
            }}},
        }
        normalize_soil_diagnostics(sample)
        self.assertIs(sample["sensor_health"]["soil_2_moisture"]["controlValid"], False)


if __name__ == "__main__":
    unittest.main()
