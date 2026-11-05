import copy
import unittest
from datetime import timedelta

from app.dashboard_summary import present_shadow_dashboard
from app.models import Config
from app.tank_inventory_policy import policy_fingerprint
from test_production_guide_profile import NOW, observation

SCOPE = ('greenhouse-01', 'esp32-s3-01', 'soil-1')


def fingerprint(config=None, capacity=5000.0):
    return policy_fingerprint(config or Config(), capacity_l=capacity, height_cm=180.0,
        site_id=SCOPE[0], device_id=SCOPE[1], zone_id=SCOPE[2])


def summary(sample=None, config=None, approval=None, now=NOW):
    return present_shadow_dashboard([], now, simulation_config=config or Config(),
        planning_observation=sample if sample is not None else observation(),
        tank_inventory_approval=approval if approval is not None else fingerprint(), inventory_scope=SCOPE)


class TankInventoryProfileTests(unittest.TestCase):
    def test_target_is_entire_existing_inventory_not_score_times_capacity(self):
        result = summary()
        fuzzy = result['production_fuzzy']
        self.assertEqual(fuzzy['status'], 'READY')
        self.assertEqual(result['operational_profile']['status'], 'TANK_BOUND')
        self.assertEqual(fuzzy['target_water_l'], result['tank_preview']['estimated_available_l'])
        self.assertEqual(fuzzy['target_water_l'], 2095.0)
        self.assertAlmostEqual(fuzzy['score'], 0.844445)
        self.assertFalse(fuzzy['can_dispatch'])
        self.assertEqual(fuzzy['stop_policy'], 'DEVICE_LOW_LEVEL_INTERLOCK')
        self.assertIn('inventory_volume_not_physically_calibrated', fuzzy['execution_blockers'])
        self.assertEqual(fuzzy['applies_to'], 'ALL_PROGRAMS')

    def test_wet_soil_does_not_allocate_water(self):
        sample = observation()
        sample['telemetry']['soil_2_moisture'] = 90.0
        sample['telemetry']['sensor_health']['soil_2_moisture']['raw'] = 900
        result = summary(sample)['production_fuzzy']
        self.assertEqual(result['status'], 'READY')
        self.assertFalse(result['irrigation_needed'])
        self.assertEqual(result['target_water_l'], 0)

    def test_inventory_policy_applies_independently_of_guide_methods_and_dates(self):
        for method in ('Tabur', 'Semprot', 'Kocor'):
            sample = observation()
            activity = sample['guide_programs']['programs'][0]['activities'][0]
            activity.update(method=method, calendar_status='FUTURE')
            self.assertEqual(summary(sample)['production_fuzzy']['status'], 'READY')
        sample['guide_programs'] = {}
        self.assertEqual(summary(sample)['production_fuzzy']['target_water_l'], 2095.0)

    def test_rules_scope_or_geometry_changes_require_review_but_simulation_max_is_irrelevant(self):
        sample = observation()
        changed = Config(fuzzy_off_threshold=0.05)
        self.assertEqual(summary(sample, config=changed)['production_fuzzy']['status'], 'BLOCKED')
        self.assertNotEqual(fingerprint(capacity=6000.0), fingerprint())
        changed = Config(max_irrigation_l=99999)
        self.assertEqual(fingerprint(changed), fingerprint())
        self.assertEqual(summary(config=changed)['production_fuzzy']['target_water_l'], 2095.0)

    def test_invalid_stale_or_inconsistent_tank_and_soil_data_never_allocate(self):
        for condition in ('stale', 'tank_invalid', 'tank_conflict', 'soil_invalid', 'empty'):
            sample = observation()
            if condition == 'stale': sample['telemetry']['recorded_at'] = (NOW-timedelta(minutes=5)).isoformat()
            if condition == 'tank_invalid': sample['telemetry']['sensor_health']['tank_water_level_pct']['valid'] = False
            if condition == 'tank_conflict': sample['telemetry']['tank_water_distance_cm'] = 160
            if condition == 'soil_invalid': sample['telemetry']['sensor_health']['soil_2_moisture']['valid'] = False
            if condition == 'empty':
                sample['telemetry']['tank_water_level_pct'] = 0
                sample['telemetry']['tank_water_distance_cm'] = 0
            with self.subTest(condition=condition):
                result = summary(sample)['production_fuzzy']
                self.assertEqual(result['status'], 'BLOCKED')
                self.assertIsNone(result['target_water_l'])

    def test_reading_result_does_not_mutate_guide_or_sensor_or_require_guide_profile(self):
        sample = observation()
        before = copy.deepcopy(sample)
        first = summary(sample)
        second = summary(sample)
        self.assertEqual(sample, before)
        self.assertEqual(first['production_fuzzy'], second['production_fuzzy'])
        self.assertIsNone(first['calculation']['fertilizer_mass_g'])


if __name__ == '__main__':
    unittest.main()
