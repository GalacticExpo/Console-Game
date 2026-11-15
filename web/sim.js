// Console Tycoon simulation: a JavaScript port of console_tycoon/sim.py.
// Game data (DATA) is generated from console_tycoon/data.py by tools/build_web.py.
// Saves use the same JSON shape as the Python version, so they move between both.
"use strict";

(function (root) {
  const D = root.CT_DATA || (typeof require !== "undefined" ? require("./data.json") : null);

  const PLAYER = "player";
  const STARTING_MONEY = 150000;
  const RETAIL_SHARE = 0.75;
  const OWN_GAME_SHARE = 0.70;
  const LICENSED_GAME_SHARE = 0.45;
  const THIRD_PARTY_ROYALTY = 6;
  const OUTSIDE_OPTION = 4.0;
  const BANKRUPT_AFTER = 3;
  const SIZE_NAMES = Object.keys(D.GAME_SIZES);

  class GameError extends Error {}

  // ------------------------------------------------------------ random
  class Rng {
    constructor(seed) { this.seed(seed); }
    seed(n) { this.a = (Math.floor(n) ^ 0x9e3779b9) >>> 0; this.spare = null; for (let i = 0; i < 4; i++) this.random(); }
    random() { // mulberry32
      let t = (this.a = (this.a + 0x6d2b79f5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    uniform(a, b) { return a + (b - a) * this.random(); }
    randrange(n) { return Math.floor(this.random() * n); }
    randint(a, b) { return a + this.randrange(b - a + 1); }
    choice(arr) { return arr[this.randrange(arr.length)]; }
    gauss(mu, sigma) {
      const u = 1 - this.random(), v = this.random();
      return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
  }

  // ------------------------------------------------------------ consoles
  const part = (c, cat) => D.COMPONENTS[cat][c.parts[cat]];
  const withArticle = (word) => (/^[AEIOU]/.test(word) ? `an ${word}` : `a ${word}`);
  const isPlayer = (c) => c.owner === PLAYER;
  const power = (c) => D.POWER_CATEGORIES.reduce((t, cat) => t + part(c, cat).power, 0);
  const appeal = (c) => D.CATEGORIES.reduce((t, cat) => t + part(c, cat).appeal, 0);
  const capacity = (c) => part(c, "Storage").capacity;
  const biggestSize = (cap) => SIZE_NAMES.filter((k) => D.GAME_SIZES[k].capacity <= cap).pop();

  function newConsole(fields) {
    return Object.assign({
      name: "", owner: PLAYER, parts: {}, price: 0, status: "dev", dev_months_left: 0,
      design_month: 0, launch_month: -1, installed_base: 0, third_party_titles: 0,
      revenue: 0, profit: 0, last_sales: 0, hype_months: 0,
    }, fields);
  }

  function newGame(fields) {
    return Object.assign({
      title: "", genre: "", topic: "", size: "", platform: "", focus: {}, staff: 0,
      status: "dev", months_left: 0, start_month: 0, release_month: -1, score: 0.0,
      reviews: [], feedback: [], units_sold: 0, revenue: 0, last_sales: 0,
    }, fields);
  }

  const FIELDS = ["company", "seed", "money", "month", "staff", "office", "skill", "reputation",
    "fans", "rp", "unlocked", "consoles", "games", "effects", "news", "debt_months", "over",
    "over_reason", "history"];

  class State {
    constructor(fields) {
      Object.assign(this, {
        company: "", seed: 0, money: STARTING_MONEY, month: 0, staff: 3, office: 0, skill: 3.0,
        reputation: 20.0, fans: 0, rp: 0.0, unlocked: Object.fromEntries(D.CATEGORIES.map((c) => [c, 0])),
        consoles: [], games: [], effects: {}, news: [], debt_months: 0, over: false,
        over_reason: "", history: [],
      }, fields || {});
      this.consoles = this.consoles.map(newConsole);
      this.games = this.games.map(newGame);
      this.rng = new Rng(this.seed * 1000 + this.month);
    }

    // ---------------------------------------------------------- calendar
    get year() { return D.START_YEAR + Math.floor(this.month / 12); }
    get yearsElapsed() { return this.month / 12; }
    get date() { return `${D.MONTH_NAMES[this.month % 12]} ${this.year}`; }
    get finalMonth() { return (D.END_YEAR - D.START_YEAR) * 12; }

    // ---------------------------------------------------------- economy
    get salary() { return Math.trunc(2000 * 1.035 ** this.yearsElapsed); }
    get officeInfo() { return D.OFFICES[this.office]; }
    get maxStaff() { return this.officeInfo[1]; }
    get monthlyExpenses() { return this.staff * this.salary + this.officeInfo[2]; }
    get busyStaff() { return this.games.filter((g) => g.status === "dev").reduce((t, g) => t + g.staff, 0); }
    get freeStaff() { return this.staff - this.busyStaff; }
    get rpPerMonth() { return this.staff * (0.5 + this.skill / 10); }

    expectedPower(month) {
      const y = (month === undefined ? this.month : month) / 12;
      return 9 * 1.27 ** Math.min(y, 22) * 1.12 ** Math.max(0, y - 22);
    }
    tech(c, month) { return power(c) / this.expectedPower(month); }

    unitCost(c) {
      let total = 0;
      for (const cat of D.CATEGORIES) {
        const p = part(c, cat);
        const age = Math.max(0, this.year - p.year);
        total += p.unit_cost * Math.max(0.4, 1 - 0.06 * age);
      }
      if ("shortage" in this.effects) total *= 1.15;
      return Math.round(total);
    }

    fairPrice(c) {
      const base = 150 + 10 * this.yearsElapsed;
      return Math.round(base * Math.min(this.tech(c), 2.5) ** 0.5);
    }

    // ---------------------------------------------------------- helpers
    say(text) { this.news.push(`[${this.date}] ${text}`); }

    console(name) {
      const c = this.consoles.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!c) throw new GameError(`No console named "${name}".`);
      return c;
    }
    playerConsoles() { return this.consoles.filter(isPlayer); }
    activeConsoles() { return this.consoles.filter((c) => c.status === "active"); }
    platformsForGames() {
      return this.consoles.filter((c) => c.status === "active" || (isPlayer(c) && c.status === "dev")
        || (isPlayer(c) && c.status === "retired" && c.installed_base > 0));
    }
    nameTaken(name) {
      const n = name.toLowerCase();
      return this.consoles.some((c) => c.name.toLowerCase() === n) || this.games.some((g) => g.title.toLowerCase() === n);
    }
    spend(amount) {
      if (amount > this.money) throw new GameError(`Not enough money: need ${fmtMoney(amount)}, have ${fmtMoney(this.money)}.`);
      this.money -= amount;
    }

    // ---------------------------------------------------------- consoles
    consoleDevCost(parts) {
      const unit = D.CATEGORIES.reduce((t, c) => t + D.COMPONENTS[c][parts[c]].unit_cost, 0);
      return Math.trunc(30000 * 1.6 ** Math.max(...Object.values(parts)) + unit * 500);
    }
    consoleDevMonths(parts) { return 3 + Math.max(...Object.values(parts)); }
    previewConsole(parts, name) { return newConsole({ name: name || "Prototype", parts: { ...parts } }); }

    designConsole(name, parts, price) {
      name = (name || "").trim();
      if (!name) throw new GameError("Your console needs a name.");
      if (this.nameTaken(name)) throw new GameError(`The name "${name}" is already in use.`);
      for (const cat of D.CATEGORIES) {
        if (!(cat in parts)) throw new GameError(`Missing a ${cat}.`);
        if (parts[cat] < 0 || parts[cat] > this.unlocked[cat]) throw new GameError(`You haven't researched that ${cat} yet.`);
      }
      if (!(price > 0)) throw new GameError("Price must be positive.");
      if (this.playerConsoles().some((c) => c.status === "dev")) throw new GameError("Your hardware team is already building a console.");
      const cost = this.consoleDevCost(parts);
      this.spend(cost);
      const c = newConsole({ name, parts: { ...parts }, price: Math.round(price),
        dev_months_left: this.consoleDevMonths(parts), design_month: this.month });
      this.consoles.push(c);
      this.say(`Hardware team began building the ${name} (${fmtMoney(cost)}).`);
      return c;
    }

    setPrice(name, price) {
      const c = this.console(name);
      if (!isPlayer(c)) throw new GameError("That's not your console.");
      if (!(price > 0)) throw new GameError("Price must be positive.");
      c.price = Math.round(price);
    }

    discontinue(name) {
      const c = this.console(name);
      if (!isPlayer(c) || c.status !== "active") throw new GameError("You can only discontinue your own consoles on sale.");
      c.status = "retired";
      this.say(`${c.name} discontinued after selling ${c.installed_base.toLocaleString()} units.`);
    }

    marketingCost() { return Math.trunc(20000 * 1.08 ** this.yearsElapsed); }
    runMarketing(name) {
      const c = this.console(name);
      if (!isPlayer(c) || c.status === "retired") throw new GameError("You can only promote your own consoles.");
      this.spend(this.marketingCost());
      c.hype_months += 3;
      this.say(`Ad campaign for the ${c.name} is running for 3 months.`);
    }

    // ---------------------------------------------------------- games
    startGame(title, genre, topic, size, platform, focus) {
      title = (title || "").trim();
      if (!title) throw new GameError("Your game needs a title.");
      if (this.nameTaken(title)) throw new GameError(`The name "${title}" is already in use.`);
      if (!(genre in D.GENRES) || !(topic in D.TOPICS) || !(size in D.GAME_SIZES)) throw new GameError("Unknown genre, topic or size.");
      const vals = D.FOCUS_AREAS.map((a) => focus[a]);
      if (vals.some((v) => !Number.isInteger(v) || v < 0) || vals.reduce((a, b) => a + b, 0) !== D.FOCUS_POINTS) {
        throw new GameError(`Focus must split exactly ${D.FOCUS_POINTS} points.`);
      }
      const plat = this.console(platform);
      if (!this.platformsForGames().includes(plat)) throw new GameError(`You can't make games for the ${plat.name}.`);
      const spec = D.GAME_SIZES[size];
      if (capacity(plat) < spec.capacity) throw new GameError(`A ${size} game won't fit on the ${plat.name}'s ${part(plat, "Storage").name}.`);
      if (spec.staff > this.freeStaff) throw new GameError(`A ${size} game needs ${spec.staff} free staff; you have ${this.freeStaff}.`);
      this.spend(spec.cost);
      const g = newGame({ title, genre, topic, size, platform: plat.name, focus: { ...focus },
        staff: spec.staff, months_left: spec.months, start_month: this.month });
      this.games.push(g);
      this.say(`Started work on ${title} (${size} ${topic} ${genre}) for the ${plat.name}.`);
      return g;
    }

    comboRating(genre, topic) {
      const [good, bad] = D.TOPICS[topic];
      if (good.includes(genre)) return "great";
      if (bad.includes(genre)) return "poor";
      return "okay";
    }

    focusMatch(genre, focus) {
      const ideal = D.GENRES[genre];
      const dist = D.FOCUS_AREAS.reduce((t, a) => t + Math.abs(focus[a] - ideal[a]), 0);
      return 1 - dist / (2 * D.FOCUS_POINTS);
    }

    reviewGame(g) {
      const plat = this.console(g.platform);
      const match = this.focusMatch(g.genre, g.focus);
      let q = 1.5 + 6.5 * match ** 1.5 + 2 * this.skill / 10;
      q *= { great: 1.12, okay: 1.0, poor: 0.75 }[this.comboRating(g.genre, g.topic)];
      const tf = Math.min(1.5, Math.max(0.4, this.tech(plat)));
      q *= tf ** (0.05 * g.focus.Graphics);
      q *= D.GAME_SIZES[g.size].polish;
      const released = this.games.filter((x) => x.status === "released");
      if (released.length) {
        const last = released.reduce((a, b) => (b.release_month > a.release_month ? b : a));
        if (last.genre === g.genre && last.topic === g.topic) q *= 0.85;
      }
      q += this.rng.gauss(0, 0.5);
      g.reviews = [0, 1, 2, 3].map(() => Math.trunc(Math.min(10, Math.max(1, Math.round(q + this.rng.gauss(0, 0.6))))));
      g.score = g.reviews.reduce((a, b) => a + b, 0) / g.reviews.length;
      g.feedback = this.critique(g, tf);
    }

    critique(g, techFactor) {
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
      if (techFactor < 0.7 && g.focus.Graphics >= 3) notes.push("The aging hardware held the graphics back.");
      return notes;
    }

    releaseGame(g) {
      const plat = this.console(g.platform);
      if (plat.status === "dev") { g.months_left = 1; return; }
      this.reviewGame(g);
      g.status = "released";
      g.release_month = this.month;
      this.skill = Math.min(10.0, this.skill + D.GAME_SIZES[g.size].xp * (10.5 - this.skill) / 7);
      const weight = 0.08 + 0.04 * SIZE_NAMES.indexOf(g.size);
      this.reputation += (g.score * 10 - this.reputation) * weight;
      this.say(`${g.title} released on the ${plat.name}! Reviews: ${g.reviews.join(" / ")} (avg ${g.score.toFixed(1)})`);
      for (const note of g.feedback) this.say(`  - ${note}`);
    }

    // ---------------------------------------------------------- research
    nextTier(cat) {
      const idx = this.unlocked[cat] + 1;
      return idx < D.COMPONENTS[cat].length ? D.COMPONENTS[cat][idx] : null;
    }
    research(cat) {
      const tier = this.nextTier(cat);
      if (!tier) throw new GameError(`No more ${cat} upgrades exist.`);
      if (this.year < tier.year) throw new GameError(`${tier.name} can't be researched until ${tier.year}.`);
      if (this.rp < tier.rp) throw new GameError(`Need ${tier.rp} research points; you have ${Math.floor(this.rp)}.`);
      this.rp -= tier.rp;
      this.unlocked[cat] += 1;
      this.say(`Research complete: ${tier.name} (${cat}).`);
      return tier;
    }

    // ---------------------------------------------------------- staff
    hireCost() { return this.salary * 2; }
    hire(n) {
      if (n <= 0) throw new GameError("Hire at least one person.");
      if (this.staff + n > this.maxStaff) throw new GameError(`Your ${this.officeInfo[0]} only fits ${this.maxStaff} staff.`);
      this.spend(this.hireCost() * n);
      this.skill = (this.skill * this.staff + Math.max(2.0, this.skill - 1) * n) / (this.staff + n);
      this.staff += n;
    }
    fire(n) {
      if (n <= 0) throw new GameError("Let go of at least one person.");
      if (n > this.freeStaff) throw new GameError(`Only ${this.freeStaff} staff aren't working on a game.`);
      if (this.staff - n < 1) throw new GameError("You need at least one employee (yourself!).");
      this.staff -= n;
    }
    upgradeOffice() {
      if (this.office + 1 >= D.OFFICES.length) throw new GameError("You already have the biggest office.");
      this.spend(D.OFFICES[this.office + 1][3]);
      this.office += 1;
      this.say(`Moved into a ${this.officeInfo[0]}!`);
    }

    // ---------------------------------------------------------- market
    attractiveness(c) {
      let a = Math.min(this.tech(c), 2.5) ** 0.9;
      a *= 1 + appeal(c) / 25;
      const price = isPlayer(c) ? c.price : this.fairPrice(c) * 0.95;
      a *= Math.min(4.0, Math.max(0.05, (this.fairPrice(c) / Math.max(1, price)) ** 2));
      const age = this.month - c.launch_month;
      if (isPlayer(c)) {
        a *= this.libraryFactor(c);
        a *= 0.6 + this.reputation / 100;
        a *= 1 + Math.min(0.5, this.fans / 2000000);
        if (c.hype_months > 0) a *= 1.5;
        if ("retail_push" in this.effects) a *= 1.3;
      } else {
        a *= 0.6 + Math.min(1.4, age / 20);
      }
      if (age < 3) a *= 1.3;
      return a;
    }

    libraryFactor(c) {
      const recent = this.games.filter((g) => g.status === "released" && g.platform === c.name && this.month - g.release_month <= 36);
      const impact = recent.map((g) => Math.max(0, g.score - 6) ** 1.5 * D.GAME_SIZES[g.size].reach).sort((a, b) => b - a);
      const hits = impact.slice(0, 5).reduce((a, b) => a + b, 0);
      return 0.5 + Math.min(0.8, recent.length * 0.1 + c.third_party_titles * 0.04) + Math.min(2.5, hits / 12);
    }

    marketSize() { return Math.trunc(8000 * 1.13 ** this.yearsElapsed); }

    marketShares() {
      const active = this.activeConsoles();
      const weights = active.map((c) => this.attractiveness(c));
      const total = weights.reduce((a, b) => a + b, 0) + OUTSIDE_OPTION;
      const out = {};
      active.forEach((c, i) => { out[c.name] = weights[i] / total; });
      return out;
    }

    // ---------------------------------------------------------- rivals
    rivalName() {
      for (let i = 0; i < 100; i++) {
        let name = `${this.rng.choice(D.CONSOLE_PREFIXES)} ${this.rng.choice(D.CONSOLE_SUFFIXES)}`;
        if (this.rng.random() < 0.3) name += ` ${this.rng.randint(2, 9)}`;
        if (!this.nameTaken(name)) return name;
      }
      return `Console ${this.consoles.length + 1}`;
    }

    spawnRival(launchAge = 0) {
      const parts = {};
      for (const cat of D.CATEGORIES) {
        let best = 0;
        D.COMPONENTS[cat].forEach((t, i) => { if (t.year <= this.year) best = i; });
        parts[cat] = Math.max(0, best - (this.rng.random() < 0.3 ? 1 : 0));
      }
      const busy = new Set(this.activeConsoles().map((c) => c.owner));
      let owners = D.RIVAL_COMPANIES.filter((o) => !busy.has(o));
      if (!owners.length) owners = D.RIVAL_COMPANIES;
      const c = newConsole({ name: this.rivalName(), owner: this.rng.choice(owners), parts,
        status: "active", launch_month: this.month - launchAge });
      c.price = Math.round(this.fairPrice(c) * 0.95);
      c.installed_base = launchAge * 1500;
      this.consoles.push(c);
      return c;
    }

    updateRivals() {
      for (const c of this.activeConsoles().filter((x) => !isPlayer(x))) {
        if (this.tech(c) < 0.3 || this.month - c.launch_month > 96) {
          c.status = "retired";
          this.say(`${c.owner} discontinued the ${c.name}.`);
        }
      }
      const rivals = this.activeConsoles().filter((x) => !isPlayer(x));
      const newest = rivals.length ? Math.max(...rivals.map((c) => c.launch_month)) : -999;
      const wantNew = rivals.length < 2 || (rivals.length < 4 && this.month - newest > 30 && this.rng.random() < 0.08);
      if (wantNew) {
        const c = this.spawnRival();
        this.say(`${c.owner} launched the ${c.name} at $${c.price}!`);
      }
      for (const c of this.activeConsoles()) if (!isPlayer(c)) c.price = Math.round(this.fairPrice(c) * 0.95);
    }

    // ---------------------------------------------------------- software
    gameWeight(g) {
      const age = this.month - g.release_month;
      if (age > 48) return 0;
      return 2.0 ** (g.score - 5) * D.GAME_SIZES[g.size].reach * 0.8 ** age;
    }
    backgroundWeight(c) {
      if (isPlayer(c)) return 1 + Math.min(15.0, c.third_party_titles * 0.3);
      return 4 + Math.min(60, Math.max(0, this.month - c.launch_month)) / 5;
    }
    softwareSales() {
      let income = 0;
      const fanBoost = 1 + Math.min(0.5, this.fans / 1000000);
      for (const g of this.games) g.last_sales = 0;
      for (const c of this.consoles) {
        if (c.status === "dev" || c.installed_base === 0) continue;
        const mine = this.games.filter((g) => g.status === "released" && g.platform === c.name);
        const weights = mine.map((g) => this.gameWeight(g) * fanBoost);
        const bg = this.backgroundWeight(c);
        const total = weights.reduce((a, b) => a + b, 0) + bg;
        let demand = c.installed_base * 0.08 * total / (total + 5);
        if (c.status !== "active") demand *= 0.4;
        const share = isPlayer(c) ? OWN_GAME_SHARE : LICENSED_GAME_SHARE;
        mine.forEach((g, i) => {
          const copies = Math.trunc(demand * weights[i] / total);
          if (copies < 20) return;
          const rev = Math.trunc(copies * D.GAME_SIZES[g.size].price * share);
          g.last_sales = copies;
          g.units_sold += copies;
          g.revenue += rev;
          income += rev;
          if (g.score >= 7) this.fans += Math.trunc(copies * 0.1);
        });
        if (isPlayer(c) && c.third_party_titles) {
          const royalty = Math.trunc(demand * bg / total) * THIRD_PARTY_ROYALTY;
          c.revenue += royalty;
          c.profit += royalty;
          income += royalty;
        }
      }
      return income;
    }

    // ---------------------------------------------------------- events
    randomEvent() {
      if (this.rng.random() > 0.08) return;
      const mineActive = this.playerConsoles().some((c) => c.status === "active");
      const roll = this.rng.randrange(6);
      if (roll === 0 && mineActive) {
        this.effects.retail_push = 1;
        this.say("EVENT: A big retail chain is featuring your hardware this month! (+30% appeal)");
      } else if (roll === 1 && mineActive) {
        this.effects.shortage = 3;
        this.say("EVENT: Chip shortage! Manufacturing costs +15% for 3 months.");
      } else if (roll === 2) {
        this.reputation = Math.min(100.0, this.reputation + 5);
        this.say("EVENT: A gaming magazine profiles your company. Reputation +5.");
      } else if (roll === 3) {
        const gained = Math.trunc(5000 + this.fans * 0.05);
        this.fans += gained;
        this.say(`EVENT: A fan video goes viral. +${gained.toLocaleString()} fans.`);
      } else if (roll === 4) {
        const amount = Math.trunc(10000 * 1.05 ** this.yearsElapsed);
        this.money += amount;
        this.say(`EVENT: Government tech grant awarded: +${fmtMoney(amount)}.`);
      } else if (roll === 5 && this.money > 50000) {
        const amount = Math.min(Math.trunc(this.money * 0.05), 250000);
        this.money -= amount;
        this.say(`EVENT: Patent troll lawsuit settled for ${fmtMoney(amount)}.`);
      }
    }

    // ---------------------------------------------------------- the clock
    advance() {
      if (this.over) return [];
      const start = this.news.length;
      this.month += 1;
      this.rng.seed(this.seed * 1000 + this.month);
      let income = 0;
      this.rp += this.rpPerMonth;

      for (const c of this.playerConsoles()) {
        if (c.status === "dev") {
          c.dev_months_left -= 1;
          if (c.dev_months_left <= 0) {
            c.status = "active";
            c.launch_month = this.month;
            this.say(`The ${c.name} is in stores! Launch price $${c.price}.`);
          }
        }
      }
      for (const g of this.games) {
        if (g.status === "dev") {
          g.months_left -= 1;
          if (g.months_left <= 0) this.releaseGame(g);
        }
      }
      this.updateRivals();

      const buyers = this.marketSize();
      for (const [name, share] of Object.entries(this.marketShares())) {
        const c = this.console(name);
        const units = Math.trunc(buyers * share * this.rng.uniform(0.9, 1.1));
        c.last_sales = units;
        c.installed_base += units;
        if (isPlayer(c)) {
          const rev = Math.trunc(units * c.price * RETAIL_SHARE);
          const profit = rev - units * this.unitCost(c);
          c.revenue += rev;
          c.profit += profit;
          income += profit;
        }
      }
      for (const c of this.consoles) {
        if (c.status !== "active") c.last_sales = 0;
        if (c.hype_months > 0) c.hype_months -= 1;
      }

      for (const c of this.playerConsoles()) {
        if (c.status === "active") {
          const expected = c.installed_base / 150000;
          const tries = Math.trunc(expected) + 1;
          for (let i = 0; i < tries; i++) if (this.rng.random() < Math.min(1.0, expected)) c.third_party_titles += 1;
        }
      }
      income += this.softwareSales();

      this.money += income - this.monthlyExpenses;
      for (const k of Object.keys(this.effects)) {
        this.effects[k] -= 1;
        if (this.effects[k] <= 0) delete this.effects[k];
      }
      this.randomEvent();

      this.history.push([this.month, this.money]);
      if (this.money < 0) {
        this.debt_months += 1;
        if (this.debt_months >= BANKRUPT_AFTER) {
          this.over = true;
          this.over_reason = "bankrupt";
          this.say("Your creditors have closed the company. GAME OVER.");
        } else {
          this.say(`WARNING: You are in debt! Bankruptcy in ${BANKRUPT_AFTER - this.debt_months} month(s) if this continues.`);
        }
      } else {
        this.debt_months = 0;
      }
      if (!this.over && this.month >= this.finalMonth) {
        this.over = true;
        this.over_reason = "retired";
        this.say("Thirty years in the console business. Time to retire!");
      }
      const fresh = this.news.slice(start);
      this.news = this.news.slice(-200);
      return fresh;
    }

    // ---------------------------------------------------------- scoring & saves
    finalScore() {
      const units = this.playerConsoles().reduce((t, c) => t + c.installed_base, 0);
      const gameUnits = this.games.reduce((t, g) => t + g.units_sold, 0);
      const best = Math.max(0, ...this.games.filter((g) => g.status === "released").map((g) => g.score));
      return Math.trunc(Math.max(0, this.money) / 1000 + units / 1000 + gameUnits / 2000 + this.reputation * 10 + best * 50);
    }
    toDict() { return Object.fromEntries(FIELDS.map((f) => [f, this[f]])); }
    toJSON() { return this.toDict(); }
    static fromDict(d) {
      for (const f of FIELDS) if (!(f in d)) throw new GameError(`Save is missing "${f}".`);
      return new State(d);
    }
  }

  function createGame(company, seed) {
    if (seed === undefined) seed = 1 + Math.floor(Math.random() * 999999);
    const s = new State({ company, seed });
    s.spawnRival(14);
    s.spawnRival(5);
    s.say(`${company} opens its doors in a garage. Design a console, then make games for it!`);
    return s;
  }

  function fmtMoney(n) {
    const sign = n < 0 ? "-" : "";
    n = Math.abs(n);
    if (n >= 1e9) return `${sign}$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${sign}$${(n / 1e6).toFixed(2)}M`;
    if (n >= 10000) return `${sign}$${Math.round(n / 1000)}K`;
    return `${sign}$${Math.round(n).toLocaleString("en-US")}`;
  }
  function fmtNum(n) {
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (n >= 10000) return `${Math.round(n / 1000)}K`;
    return Math.trunc(n).toLocaleString("en-US");
  }

  const api = { D, State, GameError, createGame, fmtMoney, fmtNum, part, power, appeal, capacity,
    isPlayer, biggestSize, PLAYER, OWN_GAME_SHARE, LICENSED_GAME_SHARE, RETAIL_SHARE, SIZE_NAMES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CT = api;
})(typeof window !== "undefined" ? window : globalThis);
