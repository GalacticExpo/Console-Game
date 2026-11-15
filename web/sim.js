// Console Tycoon simulation: design consoles, make games for them, watch them sell.
"use strict";

(function (root) {
  const D = root.CT_DATA || (typeof require !== "undefined" ? require("./data.js") : null);

  const RETAIL_SHARE = 0.75;      // share of a console's price you keep after retailers
  const GAME_SHARE = 0.70;        // share of a game's price you keep
  const CONSOLE_DEMAND = 600;     // base console buyers per month
  const SLOTS = [...D.POWER_SLOTS, ...D.APPEAL_SLOTS];
  const SIZE_NAMES = Object.keys(D.GAME_SIZES);

  class GameError extends Error {}

  // ------------------------------------------------------------ random
  class Rng {
    constructor(seed) { this.seed(seed); }
    seed(n) { this.a = (Math.floor(n) ^ 0x9e3779b9) >>> 0; for (let i = 0; i < 4; i++) this.random(); }
    random() { // mulberry32
      let t = (this.a = (this.a + 0x6d2b79f5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    uniform(a, b) { return a + (b - a) * this.random(); }
    gauss(mu, sigma) {
      const u = 1 - this.random(), v = this.random();
      return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
  }

  // ------------------------------------------------------------ console stats
  const part = (c, slot) => D.COMPONENTS[slot][c.parts[slot]];
  const power = (c) => D.POWER_SLOTS.reduce((t, s) => t + part(c, s).rating, 0);
  const appeal = (c) => D.APPEAL_SLOTS.reduce((t, s) => t + part(c, s).rating, 0);
  const capacity = (c) => part(c, "Storage").capacity;
  const unitCost = (c) => SLOTS.reduce((t, s) => t + part(c, s).unit_cost, 0);
  const fairPrice = (c) => Math.round(80 + 15 * (power(c) + appeal(c)));
  const devCost = (parts) => 15000 + 1000 * SLOTS.reduce((t, s) => t + D.COMPONENTS[s][parts[s]].unit_cost, 0);
  const devMonths = (parts) => 3 + Math.floor(Math.max(...Object.values(parts)) / 2);
  const biggestSize = (cap) => SIZE_NAMES.filter((k) => D.GAME_SIZES[k].capacity <= cap).pop();
  const withArticle = (w) => (/^[AEIOU]/.test(w) ? `an ${w}` : `a ${w}`);

  function newConsole(f) {
    return Object.assign({ name: "", parts: {}, price: 0, color: D.CONSOLE_COLORS[0][1], status: "dev", dev_months_left: 0,
      launch_month: -1, installed_base: 0, revenue: 0, profit: 0, last_sales: 0 }, f);
  }
  function newGame(f) {
    return Object.assign({ title: "", genre: "", topic: "", size: "", platform: "", focus: {},
      status: "dev", months_left: 0, release_month: -1, score: 0, reviews: [], feedback: [],
      units_sold: 0, revenue: 0, last_sales: 0 }, f);
  }

  const FIELDS = ["version", "company", "seed", "money", "month", "unlocked", "consoles", "games", "news"];

  class State {
    constructor(f) {
      Object.assign(this, { version: 2, company: "", seed: 1, money: D.STARTING_MONEY, month: 0,
        // Best tier unlocked in each part slot. Everything starts at the earliest type.
        unlocked: Object.fromEntries(SLOTS.map((s) => [s, 0])),
        consoles: [], games: [], news: [] }, f || {});
      this.consoles = this.consoles.map(newConsole);
      this.games = this.games.map(newGame);
      this.rng = new Rng(this.seed * 1000 + this.month);
    }

    get date() { return `${D.MONTH_NAMES[this.month % 12]} ${D.START_YEAR + Math.floor(this.month / 12)}`; }
    say(text) { this.news.push(`[${this.date}] ${text}`); }

    console(name) {
      const c = this.consoles.find((x) => x.name === name);
      if (!c) throw new GameError(`No console named "${name}".`);
      return c;
    }
    consoleInDev() { return this.consoles.find((c) => c.status === "dev") || null; }
    gameInDev() { return this.games.find((g) => g.status === "dev") || null; }
    platforms() { return this.consoles.filter((c) => c.status !== "retired" || c.installed_base > 0); }
    nameTaken(name) {
      const n = name.toLowerCase();
      return this.consoles.some((c) => c.name.toLowerCase() === n) || this.games.some((g) => g.title.toLowerCase() === n);
    }
    spend(amount) {
      if (amount > this.money) throw new GameError(`Not enough money: need ${fmtMoney(amount)}, have ${fmtMoney(this.money)}.`);
      this.money -= amount;
    }

    // ---------------------------------------------------------- consoles
    designConsole(name, parts, price, color) {
      name = (name || "").trim();
      if (!name) throw new GameError("Your console needs a name.");
      if (this.nameTaken(name)) throw new GameError(`The name "${name}" is already in use.`);
      for (const s of SLOTS) {
        if (!(parts[s] >= 0 && parts[s] < D.COMPONENTS[s].length)) throw new GameError(`Pick a ${s}.`);
        if (parts[s] > this.unlocked[s]) throw new GameError(`The ${D.COMPONENTS[s][parts[s]].name} is locked.`);
      }
      if (!(price > 0)) throw new GameError("Price must be more than $0.");
      if (this.consoleInDev()) throw new GameError("Your hardware team is already building a console.");
      const cost = devCost(parts);
      this.spend(cost);
      if (!D.CONSOLE_COLORS.some(([, hex]) => hex === color)) color = D.CONSOLE_COLORS[0][1];
      const c = newConsole({ name, parts: { ...parts }, price: Math.round(price), color, dev_months_left: devMonths(parts) });
      this.consoles.push(c);
      this.say(`Hardware team began building the ${name} (${fmtMoney(cost)}).`);
      return c;
    }
    setPrice(name, price) {
      if (!(price > 0)) throw new GameError("Price must be more than $0.");
      this.console(name).price = Math.round(price);
    }
    discontinue(name) {
      const c = this.console(name);
      if (c.status !== "active") throw new GameError("Only consoles on sale can be discontinued.");
      c.status = "retired";
      this.say(`${c.name} discontinued after selling ${fmtNum(c.installed_base)} units.`);
    }

    // ---------------------------------------------------------- games
    startGame(title, genre, topic, size, platform, focus) {
      title = (title || "").trim();
      if (!title) throw new GameError("Your game needs a title.");
      if (this.nameTaken(title)) throw new GameError(`The name "${title}" is already in use.`);
      if (!(genre in D.GENRES) || !(topic in D.TOPICS) || !(size in D.GAME_SIZES)) throw new GameError("Pick a genre, topic and size.");
      const vals = D.FOCUS_AREAS.map((a) => focus[a]);
      if (vals.some((v) => !Number.isInteger(v) || v < 0) || vals.reduce((a, b) => a + b, 0) !== D.FOCUS_POINTS) {
        throw new GameError(`Use exactly ${D.FOCUS_POINTS} focus points.`);
      }
      const plat = this.console(platform);
      if (!this.platforms().includes(plat)) throw new GameError(`You can't make games for the ${plat.name}.`);
      if (capacity(plat) < D.GAME_SIZES[size].capacity) throw new GameError(`A ${size} game won't fit on the ${plat.name}'s ${part(plat, "Storage").name}.`);
      if (this.gameInDev()) throw new GameError("Your studio is already making a game.");
      this.spend(D.GAME_SIZES[size].cost);
      const g = newGame({ title, genre, topic, size, platform: plat.name, focus: { ...focus }, months_left: D.GAME_SIZES[size].months });
      this.games.push(g);
      this.say(`Started work on ${title} (${size} ${topic} ${genre}) for the ${plat.name}.`);
      return g;
    }

    comboRating(genre, topic) {
      const [good, bad] = D.TOPICS[topic];
      return good.includes(genre) ? "great" : bad.includes(genre) ? "poor" : "okay";
    }
    focusMatch(genre, focus) {
      const ideal = D.GENRES[genre];
      return 1 - D.FOCUS_AREAS.reduce((t, a) => t + Math.abs(focus[a] - ideal[a]), 0) / (2 * D.FOCUS_POINTS);
    }
    // How much the console's power lifts or limits a game's graphics.
    graphicsFactor(plat) { return Math.min(1.4, Math.max(0.6, power(plat) / 12)); }

    reviewGame(g) {
      const plat = this.console(g.platform);
      let q = 2.3 + 6.5 * this.focusMatch(g.genre, g.focus) ** 1.5;
      q *= { great: 1.12, okay: 1.0, poor: 0.75 }[this.comboRating(g.genre, g.topic)];
      const gf = this.graphicsFactor(plat);
      q *= gf ** (0.05 * g.focus.Graphics);
      q *= D.GAME_SIZES[g.size].polish;
      const prev = this.games.filter((x) => x.status === "released").sort((a, b) => b.release_month - a.release_month)[0];
      if (prev && prev.genre === g.genre && prev.topic === g.topic) q *= 0.85;
      q += this.rng.gauss(0, 0.5);
      g.reviews = [0, 1, 2, 3].map(() => Math.min(10, Math.max(1, Math.round(q + this.rng.gauss(0, 0.6)))));
      g.score = g.reviews.reduce((a, b) => a + b, 0) / 4;
      g.feedback = this.critique(g, gf, prev);
    }

    critique(g, gf, prev) {
      const notes = [];
      const ideal = D.GENRES[g.genre];
      const diffs = Object.fromEntries(D.FOCUS_AREAS.map((a) => [a, g.focus[a] - ideal[a]]));
      const worst = D.FOCUS_AREAS.reduce((a, b) => (Math.abs(diffs[b]) > Math.abs(diffs[a]) ? b : a));
      if (Object.values(diffs).every((d) => Math.abs(d) <= 1)) notes.push(`Critics felt the focus was just right for ${withArticle(g.genre)} game.`);
      else if (diffs[worst] < 0) notes.push(`Critics wanted more ${worst} from ${withArticle(g.genre)} game.`);
      else notes.push(`Critics thought too much effort went into ${worst} for ${withArticle(g.genre)} game.`);
      const rating = this.comboRating(g.genre, g.topic);
      if (rating === "great") notes.push(`${g.topic} and ${g.genre} are a fantastic match!`);
      else if (rating === "poor") notes.push(`Players found ${g.topic} a strange theme for ${withArticle(g.genre)} game.`);
      if (gf < 0.8 && g.focus.Graphics >= 3) notes.push(`The ${g.platform}'s weak hardware held the graphics back.`);
      else if (gf > 1.2 && g.focus.Graphics >= 3) notes.push(`The ${g.platform}'s power made the graphics shine.`);
      if (prev && prev.genre === g.genre && prev.topic === g.topic) notes.push("Players felt they had played this before.");
      return notes;
    }

    // ---------------------------------------------------------- sales
    libraryFactor(c) {
      const hits = this.games.filter((g) => g.status === "released" && g.platform === c.name && this.month - g.release_month <= 36)
        .reduce((t, g) => t + 2 ** (g.score - 6) * D.GAME_SIZES[g.size].reach, 0);
      return 0.6 + Math.min(2.0, hits / 6);
    }
    consoleDemand(c) {
      const age = this.month - c.launch_month;
      const quality = ((power(c) + appeal(c)) / 12) ** 0.8;
      const priceFactor = Math.min(4, Math.max(0.05, (fairPrice(c) / c.price) ** 2));
      const hype = age < 3 ? 1.4 : 1;
      return CONSOLE_DEMAND * quality * priceFactor * this.libraryFactor(c) * hype * 0.975 ** age;
    }

    // ---------------------------------------------------------- the clock
    advance() {
      const start = this.news.length;
      this.month += 1;
      this.rng.seed(this.seed * 1000 + this.month);
      const before = this.money;

      for (const c of this.consoles) {
        if (c.status === "dev" && --c.dev_months_left <= 0) {
          c.status = "active";
          c.launch_month = this.month;
          this.say(`The ${c.name} is in stores! Launch price $${c.price}.`);
        }
      }
      for (const g of this.games) {
        if (g.status !== "dev" || --g.months_left > 0) continue;
        const plat = this.console(g.platform);
        if (plat.status === "dev") { g.months_left = 1; continue; } // ships with the console
        this.reviewGame(g);
        g.status = "released";
        g.release_month = this.month;
        this.say(`${g.title} released on the ${plat.name}! Reviews: ${g.reviews.join(" / ")} (avg ${g.score.toFixed(1)})`);
        for (const n of g.feedback) this.say(`  - ${n}`);
      }

      for (const c of this.consoles) {
        c.last_sales = 0;
        if (c.status !== "active") continue;
        const units = Math.trunc(this.consoleDemand(c) * this.rng.uniform(0.9, 1.1));
        const rev = Math.trunc(units * c.price * RETAIL_SHARE);
        const profit = rev - units * unitCost(c);
        c.last_sales = units;
        c.installed_base += units;
        c.revenue += rev;
        c.profit += profit;
        this.money += profit;
      }

      for (const g of this.games) {
        g.last_sales = 0;
        if (g.status !== "released") continue;
        const age = this.month - g.release_month;
        const plat = this.console(g.platform);
        let copies = plat.installed_base * 0.02 * 2 ** (g.score - 6) * D.GAME_SIZES[g.size].reach * 0.8 ** age;
        if (plat.status === "retired") copies *= 0.5;
        copies = Math.min(Math.trunc(copies), plat.installed_base);
        if (copies < 20 || age > 36) continue;
        const rev = Math.trunc(copies * D.GAME_SIZES[g.size].price * GAME_SHARE);
        g.last_sales = copies;
        g.units_sold += copies;
        g.revenue += rev;
        this.money += rev;
      }

      const fresh = this.news.slice(start);
      this.news = this.news.slice(-100);
      return { lines: fresh, delta: this.money - before };
    }

    toDict() { return Object.fromEntries(FIELDS.map((f) => [f, this[f]])); }
    toJSON() { return this.toDict(); }
    static fromDict(d) {
      if (!d || d.version !== 2) throw new GameError("That save is from a different version of the game.");
      return new State(d);
    }
  }

  function createGame(company, seed) {
    const s = new State({ company, seed: seed === undefined ? 1 + Math.floor(Math.random() * 999999) : seed });
    s.say(`${company} opens its doors in a garage. Design a console, then make games for it!`);
    return s;
  }

  function fmtMoney(n) {
    const sign = n < 0 ? "-" : "", a = Math.abs(n);
    if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 10000) return `${sign}$${Math.round(a / 1000)}K`;
    return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
  }
  function fmtNum(n) {
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (n >= 10000) return `${Math.round(n / 1000)}K`;
    return Math.trunc(n).toLocaleString("en-US");
  }

  const api = { D, State, GameError, createGame, fmtMoney, fmtNum, part, power, appeal, capacity, unitCost,
    fairPrice, devCost, devMonths, biggestSize, SLOTS, SIZE_NAMES, RETAIL_SHARE, GAME_SHARE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CT = api;
})(typeof window !== "undefined" ? window : globalThis);
