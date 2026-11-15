// Tests for the Console Tycoon simulation. Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert");

const CT = require("../web/sim.js");
const { D, GameError } = CT;
const parts = (tier) => Object.fromEntries(CT.SLOTS.map((s) => [s, tier]));
const ACTION = { ...D.GENRES.Action };

test("designing a console costs money and it launches after its build time", () => {
  const s = CT.createGame("T", 42);
  const c = s.designConsole("Gizmo", parts(0), 170);
  assert.strictEqual(s.money, D.STARTING_MONEY - CT.devCost(parts(0)));
  for (let i = 0; i < CT.devMonths(parts(0)); i++) s.advance();
  assert.strictEqual(c.status, "active");
  s.advance();
  assert.ok(c.installed_base > 0);
  assert.ok(s.money > D.STARTING_MONEY - CT.devCost(parts(0)));
});

test("hardware is locked to the earliest parts", () => {
  const s = CT.createGame("T", 1);
  s.money = 1e7;
  for (const slot of CT.SLOTS) {
    assert.strictEqual(s.unlocked[slot], 0);
    assert.throws(() => s.designConsole("Too Good", { ...parts(0), [slot]: 1 }, 200), GameError);
  }
  s.unlocked = { ...parts(6) };
  const c = s.designConsole("Monster", parts(6), 999);
  assert.strictEqual(CT.power(c), 21);
  assert.strictEqual(CT.appeal(c), 21);
});

test("saves without unlock data still load, locked to the earliest parts", () => {
  const s = CT.createGame("T", 1);
  const d = s.toDict();
  delete d.unlocked;
  assert.deepStrictEqual(CT.State.fromDict(JSON.parse(JSON.stringify(d))).unlocked, parts(0));
});

test("a game started during console development ships at launch", () => {
  const s = CT.createGame("T", 7);
  s.designConsole("Gizmo", parts(0), 170);
  const g = s.startGame("Ninja Run", "Action", "Ninjas", "Small", "Gizmo", ACTION);
  s.advance(); s.advance();
  assert.strictEqual(g.status, "dev");
  s.advance();
  assert.strictEqual(g.status, "released");
  assert.strictEqual(g.reviews.length, 4);
  assert.match(g.feedback[0], /an Action game/);
});

test("rules: storage limits game size, one project of each kind at a time", () => {
  const s = CT.createGame("T", 1);
  s.designConsole("Gizmo", parts(0), 170);
  assert.throws(() => s.designConsole("Second", parts(0), 170), GameError);
  assert.throws(() => s.startGame("Big", "RPG", "Fantasy", "Medium", "Gizmo", ACTION), GameError);
  assert.throws(() => s.startGame("Bad", "Action", "Ninjas", "Small", "Gizmo", { ...ACTION, Gameplay: 9 }), GameError);
  s.startGame("One", "Action", "Ninjas", "Small", "Gizmo", ACTION);
  assert.throws(() => s.startGame("Two", "Action", "Ninjas", "Small", "Gizmo", ACTION), GameError);
  assert.throws(() => s.startGame("gizmo", "Action", "Ninjas", "Small", "Gizmo", ACTION), GameError);
});

test("good design reviews better than bad design", () => {
  let good = 0, bad = 0;
  for (let seed = 1; seed <= 20; seed++) {
    for (const [focus, topic, add] of [[ACTION, "Ninjas", (x) => { good += x; }],
      [{ Gameplay: 0, Graphics: 0, Story: 10, Audio: 0 }, "Soccer", (x) => { bad += x; }]]) {
      const s = CT.createGame("T", seed);
      s.money = 1e6;
      s.designConsole("Box", parts(0), 170);
      for (let i = 0; i < 3; i++) s.advance();
      const g = s.startGame("G", "Action", topic, "Small", "Box", focus);
      s.advance(); s.advance();
      add(g.score);
    }
  }
  assert.ok(good / 20 > bad / 20 + 3, `good ${good / 20} vs bad ${bad / 20}`);
});

test("console power helps graphics-heavy games", () => {
  let weak = 0, strong = 0;
  const shooter = { ...D.GENRES.Shooter };
  for (let seed = 1; seed <= 20; seed++) {
    for (const [tier, add] of [[0, (x) => { weak += x; }], [6, (x) => { strong += x; }]]) {
      const s = CT.createGame("T", seed);
      s.money = 1e7;
      s.unlocked = { ...parts(6) };
      s.designConsole("Box", { ...parts(tier), Storage: 0 }, 300);
      for (let i = 0; i < 6; i++) s.advance();
      const g = s.startGame("G", "Shooter", "Space", "Small", "Box", shooter);
      s.advance(); s.advance();
      add(g.score);
    }
  }
  assert.ok(strong > weak, `strong ${strong / 20} vs weak ${weak / 20}`);
});

test("overpricing hurts sales", () => {
  const run = (price) => {
    const s = CT.createGame("T", 5);
    const c = s.designConsole("Box", parts(0), price);
    for (let i = 0; i < 9; i++) s.advance();
    return c.installed_base;
  };
  assert.ok(run(170) > run(500) * 3);
});

test("deterministic and survives a save round trip", () => {
  const play = () => {
    const s = CT.createGame("A", 11);
    s.designConsole("Box", parts(0), 170);
    s.startGame("G", "Action", "Ninjas", "Small", "Box", ACTION);
    for (let i = 0; i < 24; i++) s.advance();
    return s;
  };
  const a = play(), b = play();
  assert.deepStrictEqual(a.toDict(), b.toDict());
  const c = CT.State.fromDict(JSON.parse(JSON.stringify(a)));
  a.advance(); c.advance();
  assert.strictEqual(c.money, a.money);
  assert.throws(() => CT.State.fromDict({ company: "old save" }), GameError);
});

test("consoles keep their paint colour; unknown colours fall back to the default", () => {
  const s = CT.createGame("T", 1);
  const c = s.designConsole("Red One", parts(0), 170, "#c8372a");
  assert.strictEqual(c.color, "#c8372a");
  s.advance(); s.advance(); s.advance();
  const t = CT.createGame("T", 2);
  assert.strictEqual(t.designConsole("Odd", parts(0), 170, "#123456").color, D.CONSOLE_COLORS[0][1]);
  assert.strictEqual(CT.State.fromDict(JSON.parse(JSON.stringify(s))).consoles[0].color, "#c8372a");
});
