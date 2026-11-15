import builtins
import io
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock

from console_tycoon import data, ui
from console_tycoon.sim import GameError, State, new_game

BASIC = {c: 0 for c in data.CATEGORIES}
PERFECT_ACTION = dict(data.GENRES["Action"])


class ConsoleTests(unittest.TestCase):
    def setUp(self):
        self.s = new_game("Test Co", seed=42)

    def test_new_game_has_rivals(self):
        rivals = [c for c in self.s.consoles if not c.is_player]
        self.assertEqual(len(rivals), 2)
        self.assertTrue(all(c.status == "active" for c in rivals))

    def test_design_console_costs_money_and_launches(self):
        before = self.s.money
        c = self.s.design_console("Gizmo", BASIC, 149)
        self.assertEqual(self.s.money, before - self.s.console_dev_cost(BASIC))
        self.assertEqual(c.status, "dev")
        for _ in range(self.s.console_dev_months(BASIC)):
            self.s.advance()
        self.assertEqual(c.status, "active")
        self.s.advance()
        self.assertGreater(c.installed_base, 0)
        self.assertGreater(c.revenue, 0)

    def test_cannot_use_unresearched_parts(self):
        parts = dict(BASIC, CPU=1)
        with self.assertRaises(GameError):
            self.s.design_console("Too Soon", parts, 199)

    def test_only_one_console_in_development(self):
        self.s.design_console("One", BASIC, 149)
        with self.assertRaises(GameError):
            self.s.design_console("Two", BASIC, 149)

    def test_duplicate_names_rejected(self):
        self.s.design_console("Gizmo", BASIC, 149)
        with self.assertRaises(GameError):
            self.s.start_game("gizmo", "Action", "Ninjas", "Small", "Gizmo", PERFECT_ACTION)

    def test_overpricing_hurts_sales(self):
        cheap, pricey = new_game("A", seed=1), new_game("B", seed=1)
        for st, price in ((cheap, 140), (pricey, 600)):
            st.design_console("Box", BASIC, price)
            for _ in range(6):
                st.advance()
        self.assertGreater(cheap.console("Box").installed_base,
                           pricey.console("Box").installed_base * 3)

    def test_research_requires_points_and_year(self):
        with self.assertRaises(GameError):
            self.s.research("CPU")       # not until 1988
        self.s.month = 36
        self.s.rp = 100
        tier = self.s.research("CPU")
        self.assertEqual(tier["name"], "16-bit Duo")
        self.assertEqual(self.s.unlocked["CPU"], 1)
        self.assertEqual(self.s.rp, 70)


class GameDevTests(unittest.TestCase):
    def setUp(self):
        self.s = new_game("Test Co", seed=7)
        self.s.design_console("Gizmo", BASIC, 149)

    def test_game_waits_for_console_launch(self):
        g = self.s.start_game("Ninja Run", "Action", "Ninjas", "Small", "Gizmo", PERFECT_ACTION)
        self.s.advance()
        self.s.advance()
        self.assertEqual(g.status, "dev")          # console still being built
        self.s.advance()
        self.assertEqual(g.status, "released")
        self.assertEqual(len(g.reviews), 4)
        self.assertTrue(g.feedback)

    def test_game_size_limited_by_storage(self):
        self.s.staff = 5
        with self.assertRaises(GameError):
            self.s.start_game("Big One", "RPG", "Fantasy", "Medium", "Gizmo", PERFECT_ACTION)

    def test_staff_limit(self):
        for i in range(3):
            self.s.start_game(f"G{i}", "Action", "Ninjas", "Small", "Gizmo", PERFECT_ACTION)
        with self.assertRaises(GameError):
            self.s.start_game("G4", "Action", "Ninjas", "Small", "Gizmo", PERFECT_ACTION)

    def test_focus_must_sum_to_ten(self):
        bad = dict(PERFECT_ACTION, Gameplay=9)
        with self.assertRaises(GameError):
            self.s.start_game("Bad", "Action", "Ninjas", "Small", "Gizmo", bad)

    def test_good_design_beats_bad_design(self):
        good, bad = [], []
        for seed in range(20):
            for focus, topic, out in ((PERFECT_ACTION, "Ninjas", good),
                                      ({"Gameplay": 0, "Graphics": 0, "Story": 10, "Audio": 0},
                                       "Soccer", bad)):
                st = new_game("X", seed=seed)
                rival = st.consoles[0].name
                g = st.start_game("T", "Action", topic, "Small", rival, focus)
                st.advance()
                st.advance()
                out.append(g.score)
        self.assertGreater(sum(good) / 20, sum(bad) / 20 + 3)

    def test_games_earn_money_on_rival_console(self):
        rival = self.s.consoles[0].name
        g = self.s.start_game("Licensed", "Action", "Ninjas", "Small", rival, PERFECT_ACTION)
        for _ in range(4):
            self.s.advance()
        self.assertGreater(g.units_sold, 0)
        self.assertGreater(g.revenue, 0)


class LifecycleTests(unittest.TestCase):
    def test_bankruptcy(self):
        s = new_game("Broke", seed=3)
        s.money = 1_000
        s.staff = 5
        for _ in range(5):
            s.advance()
        self.assertTrue(s.over)
        self.assertEqual(s.over_reason, "bankrupt")

    def test_game_ends_in_final_year(self):
        s = new_game("Rich", seed=3)
        s.money = 10**12
        while not s.over:
            s.advance()
        self.assertEqual(s.over_reason, "retired")
        self.assertEqual(s.year, data.END_YEAR)

    def test_save_and_load_roundtrip(self):
        s = new_game("Saver", seed=5)
        s.design_console("Gizmo", BASIC, 149)
        s.start_game("Ninja Run", "Action", "Ninjas", "Small", "Gizmo", PERFECT_ACTION)
        for _ in range(6):
            s.advance()
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "save.json")
            s.save(path)
            loaded = State.load(path)
        self.assertEqual(loaded.to_dict(), s.to_dict())
        # Both copies continue identically.
        s.advance()
        loaded.advance()
        self.assertEqual(loaded.money, s.money)

    def test_simulation_is_deterministic(self):
        a, b = new_game("A", seed=11), new_game("A", seed=11)
        for _ in range(60):
            a.advance()
            b.advance()
        self.assertEqual(a.to_dict(), b.to_dict())


class UiSmokeTest(unittest.TestCase):
    def test_scripted_session(self):
        inputs = iter([
            "1", "Smoke Co",                                    # new company
            "3", "", "", "", "", "", "", "Box", "149", "y", "",  # design console
            "4", "3", "1", "1", "14", "4", "3", "1", "Ninja!", "",  # game for own console
            "2", "6",                                            # skip 6 months
            "5", "b", "6", "n", "7", "b", "8", "b", "9", "",     # browse screens
            "q",
        ])
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as d, \
                mock.patch.object(ui, "SAVE_DIR", d), \
                mock.patch.object(builtins, "input", lambda _="": next(inputs)), \
                redirect_stdout(out):
            ui.run()
            self.assertTrue(os.path.exists(os.path.join(d, "smoke-co.json")))
        text = out.getvalue()
        self.assertIn("The Box is in stores!", text)
        self.assertIn("Ninja! released on the Box!", text)
        self.assertIn("MARKET REPORT", text)
        self.assertIn("Thanks for playing!", text)


if __name__ == "__main__":
    unittest.main()
