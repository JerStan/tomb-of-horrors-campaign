"""Regression tests for shared GameVault mechanics. Run: python -m unittest discover -s gateway/tests -v"""
import pathlib
import sys
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from rules_engine import apply_mechanics, movement_rate, preferences, gm_guidance, MechanicsError

class GameVaultMechanicsTests(unittest.TestCase):
    def test_branch_c_run_without_movement_value_does_not_fabricate_rate(self):
        state = {"campaignId": "branch-C", "character": {"name": "Ser"}, "mechanics": {"actionCount": 0, "elapsedRounds": 0}}
        self.assertIsNone(movement_rate(state))
        updated, clock = apply_mechanics(state, {"durationRounds": 1})
        self.assertEqual(clock.action_count, 1)
        self.assertEqual(clock.rounds, 1)
        self.assertIsNone(clock.minutes)
        self.assertIsNone(clock.movement_rate)
        self.assertEqual(state["mechanics"]["actionCount"], 0)
        self.assertIn("do not guarantee escape", gm_guidance(state).lower())

    def test_ruleset_known_movement_rate_used(self):
        s = {"character": {"movementRate": 12}, "rules": {"movementRate": 6}}
        self.assertEqual(movement_rate(s), 12)

    def test_ruleset_time_conversion_only_when_explicit(self):
        old = {"rules": {"minutesPerRound": 1 / 6}, "mechanics": {"actionCount": 3, "elapsedRounds": 6, "elapsedMinutes": 1.0}}
        new, clock = apply_mechanics(old, {"durationRounds": 3, "durationMinutes": 300})
        self.assertEqual(clock.action_count, 4)
        self.assertEqual(clock.rounds, 9)
        self.assertAlmostEqual(clock.minutes, 1.5)

    def test_missing_time_conversion_never_invents_minutes(self):
        new, result = apply_mechanics({}, {"durationRounds": 2, "durationMinutes": 10000})
        self.assertNotIn("elapsedMinutes", new["mechanics"])
        self.assertIsNone(result.minutes)

    def test_clarification_costs_nothing(self):
        s = {"mechanics": {"actionCount": 39, "elapsedRounds": 390}}
        new, result = apply_mechanics(s, {"durationRounds": 999}, clarification=True)
        self.assertEqual(result.action_count, 39)
        self.assertEqual(result.rounds, 390)

    def test_separate_branches_unchanged(self):
        a = {"campaignId": "A", "exploredAreas": ["room1"], "inventory": ["key"]}
        b = {"campaignId": "B", "exploredAreas": ["room2"]}
        a2, _ = apply_mechanics(a, {"durationRounds": 1})
        self.assertEqual(a2["exploredAreas"], ["room1"])
        self.assertEqual(a2["inventory"], ["key"])
        self.assertNotIn("mechanics", a)
        self.assertNotIn("mechanics", b)

    def test_invalid_durations_are_rejected(self):
        for bad in (-1, 1.5, "1", True, 10001):
            with self.subTest(bad=bad), self.assertRaises(MechanicsError):
                apply_mechanics({}, {"durationRounds": bad})

    def test_speed_and_model_independent(self):
        s = {"preferences": {"responseSpeed": "fast", "model": "gpt-5.1-codex"}}
        self.assertEqual(preferences(s), s["preferences"])
        s["preferences"]["model"] = "default"
        self.assertEqual(preferences(s)["responseSpeed"], "fast")

    def test_defaults_do_not_modify_old_save(self):
        state = {"character": "Seraphina Vale", "journal": ["old"]}
        self.assertEqual(preferences(state), {"responseSpeed": "standard", "model": "default"})
        self.assertNotIn("preferences", state)

if __name__ == "__main__":
    unittest.main()
