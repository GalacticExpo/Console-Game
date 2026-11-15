// Tests for the browser version's simulation. Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CT = require("../web/sim.js");
const BASIC = Object.fromEntries(CT.D.CATEGORIES.map((c) => [c, 0]));
const ACTION = { ...CT.D.GENRES.Action };

test("console launches and sells", () => {
  const s = CT.createGame("T", 42);
  const c = s.designConsole("Gizmo", BASIC, 149);
  for (let i = 0; i < 4; i++) s.advance();
  assert.strictEqual(c.status, "active");
  assert.ok(c.installed_base > 0);
});

test("game waits for its console, then gets reviewed", () => {
  const s = CT.createGame("T", 7);
  s.designConsole("Gizmo", BASIC, 149);
  const g = s.startGame("Ninja Run", "Action", "Ninjas", "Small", "Gizmo", ACTION);
  s.advance(); s.advance();
  assert.strictEqual(g.status, "dev");
  s.advance();
  assert.strictEqual(g.status, "released");
  assert.strictEqual(g.reviews.length, 4);
  assert.match(g.feedback[0], /an Action game/);
});

test("rules are enforced", () => {
  const s = CT.createGame("T", 1);
  assert.throws(() => s.designConsole("X", { ...BASIC, CPU: 1 }, 199), CT.GameError);
  s.designConsole("Gizmo", BASIC, 149);
  assert.throws(() => s.startGame("Big", "RPG", "Fantasy", "Medium", "Gizmo", ACTION), CT.GameError);
  assert.throws(() => s.startGame("Bad", "Action", "Ninjas", "Small", "Gizmo", { ...ACTION, Gameplay: 9 }), CT.GameError);
});

test("deterministic and survives a save round trip", () => {
  const a = CT.createGame("A", 11), b = CT.createGame("A", 11);
  for (let i = 0; i < 60; i++) { a.advance(); b.advance(); }
  assert.deepStrictEqual(a.toDict(), b.toDict());
  const c = CT.State.fromDict(JSON.parse(JSON.stringify(a)));
  a.advance(); c.advance();
  assert.strictEqual(c.money, a.money);
});

test("saves load in the Python version", () => {
  const s = CT.createGame("Cross Play", 5);
  s.designConsole("Gizmo", BASIC, 149);
  s.startGame("Ninja Run", "Action", "Ninjas", "Small", "Gizmo", ACTION);
  for (let i = 0; i < 12; i++) s.advance();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ct-")), "save.json");
  fs.writeFileSync(file, JSON.stringify(s));
  const root = path.join(__dirname, "..");
  const out = execFileSync("python3", ["-c",
    "import sys; from console_tycoon.sim import State; s = State.load(sys.argv[1]); s.advance(); print(s.company, s.month)", file],
    { cwd: root, encoding: "utf8" });
  assert.strictEqual(out.trim(), "Cross Play 13");
});
