// Console Tycoon touch UI. Renders screens into #app and handles taps.
"use strict";

(function () {
  const { D, State, GameError, createGame, fmtMoney, fmtNum, part, power, appeal, capacity, unitCost,
    fairPrice, devCost, devMonths, biggestSize, SLOTS, SIZE_NAMES, RETAIL_SHARE } = window.CT;

  const SAVE_KEY = "console-tycoon-save-v2";
  const app = document.getElementById("app");

  let s = null;          // game State
  let view = "start";
  let draft = {};        // in-progress form values for the current screen
  let flash = null;      // {kind, text}
  let report = null;     // result of the last time skip
  let confirmKey = null; // a destructive button waiting for its second tap

  // ------------------------------------------------------------ utils
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const signed = (n) => (n >= 0 ? "+" : "") + fmtMoney(n);
  function short(n) { // compact money for the status strip
    const a = Math.abs(n), sign = n < 0 ? "-" : "";
    if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
    if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
    return `${sign}$${Math.round(a)}`;
  }

  function store(value) {
    try { if (value === null) localStorage.removeItem(SAVE_KEY); else localStorage.setItem(SAVE_KEY, value); } catch (e) { /* storage unavailable */ }
  }
  function loadSaved() {
    try { return localStorage.getItem(SAVE_KEY); } catch (e) { return null; }
  }
  function autosave() { if (s) store(JSON.stringify(s)); }

  function attempt(fn, okText) {
    try {
      fn();
      if (okText) flash = { kind: "ok", text: okText };
      autosave();
      return true;
    } catch (e) {
      if (!(e instanceof GameError)) throw e;
      flash = { kind: "err", text: e.message };
      return false;
    }
  }

  function go(v) {
    view = v;
    draft = {};
    confirmKey = null;
    render();
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------ pieces
  function topbar() {
    const owners = s.consoles.reduce((t, c) => t + c.installed_base, 0);
    const copies = s.games.reduce((t, g) => t + g.units_sold, 0);
    return `
    <header class="lcd">
      <div class="lcd-head">
        <button class="logo" data-act="go" data-arg="home" aria-label="Back to headquarters">${esc(s.company)}</button>
        <span class="date">${s.date}</span>
      </div>
      <div class="lcd-stats">
        <div class="stat"><b>${short(s.money)}</b><small>cash</small></div>
        <div class="stat"><b>${fmtNum(owners)}</b><small>consoles sold</small></div>
        <div class="stat"><b>${fmtNum(copies)}</b><small>games sold</small></div>
      </div>
    </header>`;
  }

  function flashBox() {
    if (!flash) return "";
    const f = flash;
    flash = null;
    return `<div class="flash ${f.kind}" role="status">${esc(f.text)}</div>`;
  }

  function screen(title, body) {
    return `${topbar()}
      <main class="screen">
        <div class="screen-head"><button class="back" data-act="go" data-arg="home">&larr; HQ</button><h1>${title}</h1></div>
        ${flashBox()}
        ${body}
      </main>`;
  }

  function newsLine(line) {
    const m = line.match(/^\[(\w+ \d+)\] (.*)$/);
    let text = m ? m[2] : line;
    let cls = "";
    if (/^ {2}- /.test(text)) { cls = "note"; text = text.trim().slice(2); }
    if (/released on|is in stores/.test(text)) cls = "big";
    return `<li class="${cls}"><time>${esc(m ? m[1] : "")}</time><span>${esc(text)}</span></li>`;
  }

  // Newest first, keeping critic notes under the headline they belong to.
  function latestNews(n) {
    const groups = [];
    for (const line of s.news.slice(-n - 6)) {
      if (/^\[[^\]]+\] {2}- /.test(line) && groups.length) groups[groups.length - 1].push(line);
      else groups.push([line]);
    }
    return groups.reverse().flat().slice(0, n);
  }

  const progress = (frac) => `<div class="bar"><i style="width:${Math.max(4, Math.min(100, frac * 100))}%"></i></div>`;

  function consoleRow(c) {
    if (c.status === "dev") {
      const total = devMonths(c.parts);
      return `<div class="row"><div class="row-main"><b>${esc(c.name)}</b>
        <span class="sub">Being built · launches in ${c.dev_months_left} mo</span>${progress((total - c.dev_months_left) / total)}</div></div>`;
    }
    const state = c.status === "active" ? `$${c.price} · ${fmtNum(c.last_sales)} sold last month` : "Discontinued";
    return `<div class="row"><div class="row-main"><b>${esc(c.name)}</b>
      <span class="sub">${state} · ${fmtNum(c.installed_base)} owners</span></div>
      <span class="pill">${power(c)} pwr · ${appeal(c)} app</span></div>`;
  }

  function gameRow(g) {
    const total = D.GAME_SIZES[g.size].months;
    return `<div class="row"><div class="row-main"><b>${esc(g.title)}</b>
      <span class="sub">${g.size} ${g.topic} ${g.genre} for ${esc(g.platform)} · ${g.months_left} mo left</span>
      ${progress((total - g.months_left) / total)}</div></div>`;
  }

  // ------------------------------------------------------------ views
  const views = {};

  views.start = () => {
    let savedInfo = "";
    const saved = loadSaved();
    if (saved) {
      try { const st = State.fromDict(JSON.parse(saved)); savedInfo = `${esc(st.company)} · ${st.date}`; } catch (e) { savedInfo = ""; }
    }
    return `
    <main class="screen start">
      <div class="title-card">
        <p class="eyebrow">A console-making game</p>
        <h1 class="big-title">Console<br>Tycoon</h1>
        <p class="lede">You have a garage and ${fmtMoney(D.STARTING_MONEY)}. Design a games console, make games for it, and watch them sell.</p>
      </div>
      ${flashBox()}
      ${savedInfo ? `<button class="btn primary wide" data-act="continue">Continue <span class="btn-sub">${savedInfo}</span></button>` : ""}
      <form class="card" data-form="new">
        <label for="company">Company name</label>
        <input id="company" maxlength="30" autocomplete="off" placeholder="Garage Games" value="${esc(draft.company || "")}" data-bind="company">
        <button class="btn ${savedInfo ? "" : "primary"} wide" type="submit">${savedInfo ? "Start a new company" : "Start your company"}</button>
        ${savedInfo ? `<p class="hint">Starting over replaces your saved game.</p>` : ""}
      </form>
      <div class="split">
        <button class="btn" data-act="go" data-arg="help">How to play</button>
        <button class="btn" data-act="go" data-arg="saves">Import a save</button>
      </div>
    </main>`;
  };

  views.home = () => {
    const consoles = s.consoles.filter((c) => c.status !== "retired");
    const dev = s.gameInDev();
    const sellers = s.games.filter((g) => g.last_sales).sort((a, b) => b.last_sales - a.last_sales).slice(0, 3);
    const rep = report ? `<section class="card report">
        <div class="report-head"><h2>${report.months === 1 ? s.date : `${report.from} – ${s.date}`}</h2>
        <span class="delta ${report.delta < 0 ? "neg" : "pos"}">${signed(report.delta)}</span></div>
        ${report.lines.length ? `<ul class="news">${report.lines.map(newsLine).join("")}</ul>` : `<p class="hint">A quiet month.</p>`}
      </section>` : "";
    const hw = consoles.length ? consoles.map(consoleRow).join("") + (s.consoleInDev() ? "" : `<button class="btn" data-act="go" data-arg="design">Design another console</button>`)
      : `<div class="empty"><p>You don't have a console yet. Design one first; you can start a game for it while it's being built.</p>
         <button class="btn primary" data-act="go" data-arg="design">Design your first console</button></div>`;
    const sw = dev ? gameRow(dev) : s.consoles.length
      ? `<div class="empty"><p>Your studio is free.</p><button class="btn ${consoles.length ? "primary" : ""}" data-act="go" data-arg="game">Make a game</button></div>`
      : `<p class="hint">Design a console first, then make games for it.</p>`;
    const top = sellers.length ? `<section><h2>Best sellers last month</h2>${sellers.map((g) =>
      `<div class="row"><div class="row-main"><b>${esc(g.title)}</b><span class="sub">${esc(g.platform)} · score ${g.score.toFixed(1)}</span></div><span class="num">${fmtNum(g.last_sales)}</span></div>`).join("")}</section>` : "";
    const news = latestNews(8);
    return `${topbar()}
      <main class="screen home">
        ${flashBox()}
        ${rep}
        <section><h2>Your consoles</h2>${hw}</section>
        <section><h2>Your studio</h2>${sw}</section>
        ${top}
        <nav class="grid" aria-label="Actions">
          <button class="tile" data-act="go" data-arg="consoles"><b>Consoles</b><small>${s.consoles.length} designed</small></button>
          <button class="tile" data-act="go" data-arg="games"><b>Games</b><small>${s.games.filter((g) => g.status === "released").length} released</small></button>
        </nav>
        ${news.length && !report ? `<section><h2>News</h2><ul class="news">${news.map(newsLine).join("")}</ul></section>` : ""}
        <button class="btn quiet" data-act="go" data-arg="saves">Save, load &amp; how to play</button>
      </main>
      <footer class="dock">
        <div class="skip">
          <button class="btn" data-act="advance" data-arg="3">+3 mo</button>
          <button class="btn" data-act="advance" data-arg="6">+6 mo</button>
          <button class="btn" data-act="advance" data-arg="12">+1 yr</button>
        </div>
        <button class="btn primary next" data-act="advance" data-arg="1">Next month &rarr;</button>
      </footer>`;
  };

  // ---------- design a console
  views.design = () => {
    if (s.consoleInDev()) {
      return screen("Design a console", `<div class="empty"><p>Your hardware team is already building a console. Design the next one after it launches.</p></div>`);
    }
    if (!draft.parts) draft.parts = Object.fromEntries(SLOTS.map((sl) => [sl, 0]));
    const proto = { parts: draft.parts };
    const cost = devCost(draft.parts);
    const fair = fairPrice(proto);
    const price = draft.priceTouched ? draft.price : fair;
    const slots = SLOTS.map((slot) => {
      const kind = D.POWER_SLOTS.includes(slot) ? "power" : "appeal";
      const opts = D.COMPONENTS[slot].map((t, i) => `
        <button class="opt ${draft.parts[slot] === i ? "on" : ""}" data-act="part" data-arg="${slot}:${i}" aria-pressed="${draft.parts[slot] === i}">
          <b>${t.name}</b><small>+${t.rating} ${kind}${t.capacity ? ` · fits ${biggestSize(t.capacity)} games` : ""}</small>
          <span class="num">$${t.unit_cost}</span></button>`).join("");
      return `<fieldset><legend>${slot}</legend>${opts}</fieldset>`;
    }).join("");
    const afford = cost <= s.money;
    return screen("Design a console", `
      <p class="hint">Pick a part for each slot. CPU, GPU and memory add power, which makes games look better. Storage, controller and case add appeal. Better parts cost more per console.</p>
      ${slots}
      <section class="card spec">
        <h2>Spec sheet</h2>
        <dl>
          <dt>Power</dt><dd>${power(proto)} / 21</dd>
          <dt>Appeal</dt><dd>${appeal(proto)} / 21</dd>
          <dt>Largest game</dt><dd>${biggestSize(capacity(proto))}</dd>
          <dt>Cost per unit</dt><dd>$${unitCost(proto)}</dd>
          <dt>Development</dt><dd>${fmtMoney(cost)} · ${devMonths(draft.parts)} months</dd>
          <dt>Fair price</dt><dd>about $${fair} <small>(you keep ${Math.round(RETAIL_SHARE * 100)}%, ~$${Math.round(fair * RETAIL_SHARE - unitCost(proto))} profit each)</small></dd>
        </dl>
        <label for="cname">Console name</label>
        <input id="cname" maxlength="24" autocomplete="off" placeholder="e.g. Gizmo 64" value="${esc(draft.name || "")}" data-bind="name">
        <label for="cprice">Price ($)</label>
        <input id="cprice" type="number" inputmode="numeric" min="1" value="${price}" data-bind="price">
        <button class="btn primary wide" data-act="build" ${afford ? "" : "disabled"}>${afford ? `Build it for ${fmtMoney(cost)}` : `Need ${fmtMoney(cost)}`}</button>
      </section>`);
  };

  // ---------- make a game
  function gameReady() {
    const d = draft;
    const used = D.FOCUS_AREAS.reduce((t, a) => t + d.focus[a], 0);
    return Boolean(d.platform && d.size && d.genre && d.topic && used === D.FOCUS_POINTS && (d.title || "").trim());
  }

  views.game = () => {
    const d = draft;
    if (!d.focus) d.focus = { Gameplay: 4, Graphics: 2, Story: 2, Audio: 2 };
    const plats = s.platforms();
    if (!plats.length) return screen("Make a game", `<div class="empty"><p>Design a console first, then make games for it.</p><button class="btn primary" data-act="go" data-arg="design">Design a console</button></div>`);
    if (s.gameInDev()) return screen("Make a game", `<div class="empty"><p>Your studio is busy with ${esc(s.gameInDev().title)}. Start the next game when it ships.</p></div>`);
    if (!d.platform && plats.length === 1) d.platform = plats[0].name;
    const plat = d.platform ? s.console(d.platform) : null;
    if (d.size && plat && D.GAME_SIZES[d.size].capacity > capacity(plat)) d.size = null;

    const platOpts = plats.map((c) => `
      <button class="opt ${d.platform === c.name ? "on" : ""}" data-act="pick" data-arg="platform:${esc(c.name)}">
        <b>${esc(c.name)}</b><small>${c.status === "dev" ? "Being built" : `${fmtNum(c.installed_base)} owners`} · ${power(c)} power · up to ${biggestSize(capacity(c))}</small></button>`).join("");

    const sizeOpts = SIZE_NAMES.map((name) => {
      const sp = D.GAME_SIZES[name];
      const why = [];
      if (plat && sp.capacity > capacity(plat)) why.push("won't fit");
      if (sp.cost > s.money) why.push("too expensive");
      return `<button class="opt ${d.size === name ? "on" : ""}" data-act="pick" data-arg="size:${name}" ${why.length ? "disabled" : ""}>
        <b>${name}</b><small>${sp.months} months · sells at $${sp.price}${why.length ? ` · ${why.join(", ")}` : ""}</small>
        <span class="num">${fmtMoney(sp.cost)}</span></button>`;
    }).join("");

    const chips = (key, list) => `<div class="chips">${list.map((x) =>
      `<button class="chip ${d[key] === x ? "on" : ""}" data-act="pick" data-arg="${key}:${x}" aria-pressed="${d[key] === x}">${x}</button>`).join("")}</div>`;

    const left = D.FOCUS_POINTS - D.FOCUS_AREAS.reduce((t, a) => t + d.focus[a], 0);
    const focus = D.FOCUS_AREAS.map((a) => `
      <div class="stepper">
        <span>${a}</span>
        <button class="step" data-act="focus" data-arg="${a}:-1" aria-label="Less ${a}" ${d.focus[a] <= 0 ? "disabled" : ""}>&minus;</button>
        <output>${d.focus[a]}</output>
        <button class="step" data-act="focus" data-arg="${a}:1" aria-label="More ${a}" ${left <= 0 ? "disabled" : ""}>+</button>
        <span class="pips">${"■".repeat(d.focus[a])}</span>
      </div>`).join("");

    let lessons = "";
    if (d.genre || d.topic) {
      const past = s.games.filter((g) => g.status === "released" && (g.genre === d.genre || g.topic === d.topic))
        .sort((a, b) => b.release_month - a.release_month).slice(0, 3);
      if (past.length) {
        lessons = `<div class="lessons"><h3>Your notes</h3>${past.map((g) => `<p><b>${esc(g.title)}</b> (${g.topic} ${g.genre}, ${D.FOCUS_AREAS.map((a) => g.focus[a]).join("/")}) scored ${g.score.toFixed(1)}. ${g.feedback.map(esc).join(" ")}</p>`).join("")}</div>`;
      }
    }

    const ready = gameReady();
    return screen("Make a game", `
      <fieldset><legend>Console</legend>${platOpts}</fieldset>
      <fieldset><legend>Size</legend>${sizeOpts}</fieldset>
      <fieldset><legend>Genre</legend>${chips("genre", Object.keys(D.GENRES).sort())}</fieldset>
      <fieldset><legend>Topic</legend>${chips("topic", Object.keys(D.TOPICS).sort())}</fieldset>
      <fieldset><legend>Focus <span class="legend-note">${left === 0 ? "all 10 points used" : `${left} point${left === 1 ? "" : "s"} left`}</span></legend>
        <p class="hint">Each genre has a hidden ideal split. Reviews tell you how close you got. Graphics look better on powerful consoles.</p>
        ${focus}
        ${lessons}
      </fieldset>
      <section class="card">
        <label for="gtitle">Title</label>
        <input id="gtitle" maxlength="30" autocomplete="off" placeholder="e.g. Neon Ninja" value="${esc(d.title || "")}" data-bind="title">
        <button class="btn primary wide" data-act="startgame" ${ready ? "" : "disabled"}>Start development</button>
        <p class="hint" id="gamehint" ${ready ? "hidden" : ""}>Pick a console, size, genre and topic, use all 10 focus points, and give it a title.</p>
      </section>`);
  };

  // ---------- consoles
  views.consoles = () => {
    if (!s.consoles.length) return screen("Consoles", `<div class="empty"><p>You haven't designed a console yet.</p><button class="btn primary" data-act="go" data-arg="design">Design a console</button></div>`);
    const cards = s.consoles.slice().reverse().map((c) => {
      const parts = SLOTS.map((sl) => part(c, sl).name).join(" · ");
      const head = `${consoleRow(c)}<p class="hint">${parts}</p>`;
      if (c.status === "dev") return `<section class="card">${head}</section>`;
      const own = s.games.filter((g) => g.platform === c.name && g.status === "released").length;
      const key = `retire:${c.name}`;
      return `<section class="card">
        ${head}
        <dl>
          <dt>Cost per unit</dt><dd>$${unitCost(c)} · fair price $${fairPrice(c)}</dd>
          <dt>Revenue</dt><dd>${fmtMoney(c.revenue)}</dd>
          <dt>Profit</dt><dd class="${c.profit < 0 ? "neg" : ""}">${fmtMoney(c.profit)}</dd>
          <dt>Games</dt><dd>${own}</dd>
        </dl>
        ${c.status === "active" ? `
        <div class="inline">
          <label for="p-${esc(c.name)}" class="sr">Price</label>
          <input id="p-${esc(c.name)}" type="number" inputmode="numeric" min="1" value="${c.price}" data-price-for="${esc(c.name)}">
          <button class="btn" data-act="setprice" data-arg="${esc(c.name)}">Set price</button>
        </div>
        <button class="btn danger" data-act="retire" data-arg="${esc(c.name)}">${confirmKey === key ? "Tap again to discontinue" : "Discontinue"}</button>` : ""}
      </section>`;
    }).join("");
    return screen("Consoles", (s.consoleInDev() ? "" : `<button class="btn primary wide" data-act="go" data-arg="design">Design a new console</button>`) + cards);
  };

  // ---------- games
  views.games = () => {
    const newBtn = s.consoles.length && !s.gameInDev() ? `<button class="btn primary wide" data-act="go" data-arg="game">Make a new game</button>` : "";
    if (!s.games.length) return screen("Games", newBtn || `<div class="empty"><p>Design a console first, then make games for it.</p></div>`);
    const dev = s.gameInDev();
    const released = s.games.filter((g) => g.status === "released").sort((a, b) => b.release_month - a.release_month);
    return screen("Games", newBtn + (dev ? gameRow(dev) : "") + released.map((g) => {
      const cls = g.score >= 8 ? "good" : g.score >= 6 ? "mid" : "bad";
      return `<details class="row game">
        <summary><div class="row-main"><b>${esc(g.title)}</b><span class="sub">${g.size} ${g.topic} ${g.genre} · ${esc(g.platform)} · ${fmtNum(g.units_sold)} sold</span></div>
        <span class="score ${cls}">${g.score.toFixed(1)}</span></summary>
        <div class="detail">
          <p>Reviews ${g.reviews.join(" / ")} · Revenue ${fmtMoney(g.revenue)}</p>
          <p>Focus: ${D.FOCUS_AREAS.map((a) => `${a} ${g.focus[a]}`).join(", ")}</p>
          <ul>${g.feedback.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
        </div>
      </details>`;
    }).join(""));
  };

  // ---------- saves & help
  const HELP = `
    <ul class="rules">
      <li><b>Design a console</b> from six parts. CPU, GPU and memory add power; storage, controller and case add appeal. Storage also limits how big a game fits.</li>
      <li><b>Price it</b> near what buyers think is fair. Cheaper sells more units, but you make less on each one.</li>
      <li><b>Make games</b> for your consoles. You can start one while the console is being built; it ships at launch.</li>
      <li><b>Split 10 focus points</b> between Gameplay, Graphics, Story and Audio. Each genre has a hidden ideal split, and some topics suit some genres. The critics' notes tell you what to change.</li>
      <li><b>Good games sell consoles</b>, and more console owners means more game sales.</li>
      <li><b>Console sales fade</b> over time. Design a new one to keep growing.</li>
    </ul>`;

  views.help = () => (s ? screen("How to play", HELP)
    : `<main class="screen"><div class="screen-head"><button class="back" data-act="go" data-arg="start">&larr; Back</button><h1>How to play</h1></div>${HELP}</main>`);

  views.saves = () => {
    const body = `
      ${s ? `<section class="card">
        <h2>Export save</h2>
        <p class="hint">The game saves itself on this device after every move. Copy this code to move your game to another device.</p>
        <textarea id="exporttext" readonly rows="4">${esc(JSON.stringify(s))}</textarea>
        <button class="btn wide" data-act="copy">Copy save code</button>
      </section>` : ""}
      <section class="card">
        <h2>Import save</h2>
        <p class="hint">Paste a save code from another device.</p>
        <textarea id="importtext" rows="4" placeholder='{"version": 2, ...}' data-bind="importText">${esc(draft.importText || "")}</textarea>
        <button class="btn wide" data-act="import">Load this save</button>
      </section>
      ${s ? `<section class="card"><h2>Start over</h2><p class="hint">Ends this company and deletes its save on this device.</p>
        <button class="btn danger wide" data-act="restart">${confirmKey === "restart" ? "Tap again to delete and start over" : "Start a new company"}</button></section>
        <section><h2>How to play</h2>${HELP}</section>` : ""}`;
    if (s) return screen("Save &amp; help", body);
    return `<main class="screen"><div class="screen-head"><button class="back" data-act="go" data-arg="start">&larr; Back</button><h1>Import a save</h1></div>${flashBox()}${body}</main>`;
  };

  // ------------------------------------------------------------ actions
  function nextDate(dateStr) {
    const [m, y] = dateStr.split(" ");
    const i = (D.MONTH_NAMES.indexOf(m) + 1) % 12;
    return `${D.MONTH_NAMES[i]} ${Number(y) + (i === 0 ? 1 : 0)}`;
  }

  const actions = {
    go: (v) => go(v),
    continue: () => {
      try { s = State.fromDict(JSON.parse(loadSaved())); } catch (e) { flash = { kind: "err", text: "That save couldn't be read." }; return render(); }
      report = null;
      go("home");
    },
    advance: (n) => {
      const from = nextDate(s.date);
      let lines = [], delta = 0;
      for (let i = 0; i < Number(n); i++) {
        const r = s.advance();
        lines = lines.concat(r.lines);
        delta += r.delta;
      }
      report = { months: Number(n), from, delta, lines };
      autosave();
      go("home");
    },
    part: (arg) => {
      const [slot, i] = arg.split(":");
      draft.parts[slot] = Number(i);
      render();
    },
    build: () => {
      const proto = { parts: draft.parts };
      const price = draft.priceTouched ? Number(draft.price) : fairPrice(proto);
      const name = (draft.name || "").trim();
      if (attempt(() => s.designConsole(name, draft.parts, price), `Engineers are building the ${name}. It launches in ${devMonths(draft.parts)} months.`)) go("home");
      else render();
    },
    pick: (arg) => {
      const i = arg.indexOf(":");
      draft[arg.slice(0, i)] = arg.slice(i + 1);
      render();
    },
    focus: (arg) => {
      const [area, delta] = arg.split(":");
      const used = D.FOCUS_AREAS.reduce((t, a) => t + draft.focus[a], 0);
      const v = draft.focus[area] + Number(delta);
      if (v >= 0 && used + Number(delta) <= D.FOCUS_POINTS) draft.focus[area] = v;
      render();
    },
    startgame: () => {
      const d = draft;
      if (attempt(() => s.startGame(d.title, d.genre, d.topic, d.size, d.platform, d.focus), `Development started on ${d.title.trim()}.`)) go("home");
      else render();
    },
    setprice: (name) => {
      const input = document.querySelector(`[data-price-for="${CSS.escape(name)}"]`);
      const price = Number(input.value);
      attempt(() => s.setPrice(name, price), `The ${name} now sells for $${Math.round(price)}.`);
      render();
    },
    retire: (name) => {
      const key = `retire:${name}`;
      if (confirmKey !== key) { confirmKey = key; return render(); }
      confirmKey = null;
      attempt(() => s.discontinue(name), `${name} discontinued.`);
      render();
    },
    copy: () => {
      const box = document.getElementById("exporttext");
      const fallback = () => { box.focus(); box.select(); flash = { kind: "ok", text: "Selected. Use your phone's Copy." }; render(); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(box.value).then(() => { flash = { kind: "ok", text: "Save code copied." }; render(); }, fallback);
      } else fallback();
    },
    import: () => {
      try {
        s = State.fromDict(JSON.parse(draft.importText || ""));
      } catch (e) {
        flash = { kind: "err", text: e instanceof GameError ? e.message : "That doesn't look like a save code. Paste the whole code, including the { and }." };
        return render();
      }
      report = null;
      autosave();
      flash = { kind: "ok", text: `Loaded ${s.company}.` };
      go("home");
    },
    restart: () => {
      if (confirmKey !== "restart") { confirmKey = "restart"; return render(); }
      s = null;
      report = null;
      store(null);
      go("start");
    },
  };

  // ------------------------------------------------------------ wiring
  function render() { app.innerHTML = (views[view] || views.start)(); }

  app.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    e.preventDefault();
    const act = actions[el.dataset.act];
    if (act) act(el.dataset.arg);
  });

  app.addEventListener("input", (e) => {
    const el = e.target;
    if (!el.dataset || !el.dataset.bind) return;
    draft[el.dataset.bind] = el.value;
    if (el.dataset.bind === "price") draft.priceTouched = true;
    if (view === "game" && el.dataset.bind === "title") {
      // Update the start button without re-rendering, so the keyboard stays open.
      const ok = gameReady();
      const btn = app.querySelector('[data-act="startgame"]');
      const hint = document.getElementById("gamehint");
      if (btn) btn.disabled = !ok;
      if (hint) hint.hidden = ok;
    }
  });

  app.addEventListener("submit", (e) => {
    e.preventDefault();
    if (e.target.dataset.form === "new") {
      s = createGame((draft.company || "").trim() || "Garage Games");
      report = null;
      autosave();
      go("home");
    }
  });

  // Keep the game across live updates of the page.
  function start(data) {
    if (data && data.save) {
      try { s = State.fromDict(data.save); view = data.view || "home"; draft = data.draft || {}; } catch (e) { s = null; }
    }
    if (!s) view = view === "help" || view === "saves" ? view : "start";
    render();
  }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(() => ({ save: s ? s.toDict() : null, view, draft }));
  if (hot && hot.ready) hot.ready(start); else start(hot && hot.data ? hot.data : {});
})();
