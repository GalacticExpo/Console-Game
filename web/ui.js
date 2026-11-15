// Console Tycoon touch UI. Renders screens into #app and handles taps.
"use strict";

(function () {
  const { D, State, GameError, createGame, fmtMoney, fmtNum, part, power, appeal, capacity, isPlayer,
    biggestSize, SIZE_NAMES, OWN_GAME_SHARE, LICENSED_GAME_SHARE } = window.CT;

  const SAVE_KEY = "console-tycoon-save-v1";
  const app = document.getElementById("app");

  let s = null;          // game State
  let view = "start";
  let draft = {};        // in-progress form values for the current screen
  let flash = null;      // {kind, text}
  let report = null;     // result of the last time skip
  let confirmKey = null; // a destructive button waiting for its second tap

  // ------------------------------------------------------------ utils
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (x) => `${Math.round(x * 100)}%`;
  const signed = (n) => (n >= 0 ? "+" : "") + fmtMoney(n);
  // Compact money for the narrow status strip: $950, $6.6K, $1.2M.
  function short(n) {
    const a = Math.abs(n), sign = n < 0 ? "-" : "";
    if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
    if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
    return `${sign}$${Math.round(a)}`;
  }

  function store(key, value) {
    try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
  }
  function load(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function autosave() { if (s) store(SAVE_KEY, JSON.stringify(s)); }

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

  function go(v, keepDraft) {
    view = v;
    if (!keepDraft) draft = {};
    confirmKey = null;
    render();
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------ pieces
  function topbar() {
    if (!s) return "";
    const debt = s.money < 0 ? " neg" : "";
    return `
    <header class="lcd">
      <div class="lcd-head">
        <button class="logo" data-act="go" data-arg="home" aria-label="Back to headquarters">${esc(s.company)}</button>
        <span class="date">${s.date}</span>
      </div>
      <div class="lcd-stats">
        <div class="stat${debt}"><b>${short(s.money)}</b><small>cash</small></div>
        <div class="stat"><b>${short(s.monthlyExpenses)}</b><small>bills</small></div>
        <div class="stat"><b>${s.freeStaff}/${s.staff}</b><small>free</small></div>
        <div class="stat"><b>${Math.round(s.reputation)}</b><small>rep</small></div>
        <div class="stat"><b>${Math.floor(s.rp)}</b><small>RP</small></div>
      </div>
    </header>`;
  }

  function flashBox() {
    if (!flash) return "";
    const f = flash;
    flash = null;
    return `<div class="flash ${f.kind}" role="status">${esc(f.text)}</div>`;
  }

  function screen(title, body, back = true) {
    return `
      ${topbar()}
      <main class="screen">
        <div class="screen-head">
          ${back ? `<button class="back" data-act="go" data-arg="home">&larr; HQ</button>` : ""}
          <h1>${title}</h1>
        </div>
        ${flashBox()}
        ${body}
      </main>`;
  }

  function newsLine(line) {
    const m = line.match(/^\[(\w+ \d+)\] (.*)$/);
    const when = m ? m[1] : "";
    let text = m ? m[2] : line;
    let cls = "";
    if (/^EVENT:/.test(text)) { cls = "event"; text = text.replace(/^EVENT: /, ""); }
    if (/WARNING|GAME OVER/.test(text)) cls = "warn";
    if (/^ {2}- /.test(text)) { cls += " note"; text = text.trim().slice(2); }
    if (/released on|is in stores/.test(text)) cls += " big";
    return `<li class="${cls}"><time>${esc(when)}</time><span>${esc(text)}</span></li>`;
  }

  function consoleSummary(c) {
    if (c.status === "dev") {
      const total = s.consoleDevMonths(c.parts);
      const done = total - c.dev_months_left;
      return `<div class="row"><div class="row-main"><b>${esc(c.name)}</b>
        <span class="sub">Hardware in development · launches in ${c.dev_months_left} mo</span>
        ${progress(done / total)}</div></div>`;
    }
    const t = s.tech(c);
    return `<div class="row"><div class="row-main"><b>${esc(c.name)}</b>
      <span class="sub">${c.status === "active" ? "On sale" : "Discontinued"} · $${c.price} · ${fmtNum(c.installed_base)} owners · ${fmtNum(c.last_sales)}/mo</span>
      </div><span class="pill ${t < 0.5 ? "bad" : t < 0.8 ? "mid" : "good"}" title="Power compared with what buyers expect today">${pct(t)} power</span></div>`;
  }

  function progress(frac) {
    return `<div class="bar"><i style="width:${Math.max(4, Math.min(100, frac * 100))}%"></i></div>`;
  }

  function canResearchSomething() {
    return D.CATEGORIES.some((cat) => { const t = s.nextTier(cat); return t && s.year >= t.year && s.rp >= t.rp; });
  }

  // ------------------------------------------------------------ views
  const views = {};

  views.start = () => {
    const saved = load(SAVE_KEY);
    let savedInfo = "";
    if (saved) {
      try { const d = JSON.parse(saved); savedInfo = `${esc(d.company)} · ${D.MONTH_NAMES[d.month % 12]} ${D.START_YEAR + Math.floor(d.month / 12)}`; } catch (e) { savedInfo = ""; }
    }
    return `
    <main class="screen start">
      <div class="title-card">
        <p class="eyebrow">A text tycoon · ${D.START_YEAR}–${D.END_YEAR}</p>
        <h1 class="big-title">Console<br>Tycoon</h1>
        <p class="lede">You have a garage, three friends and $150K. Design a games console, make games for it, and outlast the giants until ${D.END_YEAR}.</p>
      </div>
      ${flashBox()}
      ${savedInfo ? `<button class="btn primary wide" data-act="continue">Continue <span class="btn-sub">${savedInfo}</span></button>` : ""}
      <form class="card" data-form="new">
        <label for="company">Company name</label>
        <input id="company" name="company" maxlength="30" autocomplete="off" placeholder="Garage Games" value="${esc(draft.company || "")}" data-bind="company">
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
    const mine = s.playerConsoles().filter((c) => c.status !== "retired");
    const dev = s.games.filter((g) => g.status === "dev");
    const sellers = s.games.filter((g) => g.status === "released" && g.last_sales).sort((a, b) => b.last_sales - a.last_sales).slice(0, 3);
    let rep = "";
    if (report) {
      rep = `<section class="card report">
        <div class="report-head"><h2>${report.months === 1 ? s.date : `${report.from} – ${s.date}`}</h2>
        <span class="delta ${report.delta < 0 ? "neg" : "pos"}">${signed(report.delta)}</span></div>
        ${report.lines.length ? `<ul class="news">${report.lines.map(newsLine).join("")}</ul>` : `<p class="hint">A quiet month.</p>`}
      </section>`;
    }
    const hw = mine.length ? mine.map(consoleSummary).join("")
      : `<div class="empty"><p>You don't have a console yet. Design one, then make a game for a rival's console while it's being built.</p>
         <button class="btn primary" data-act="go" data-arg="design">Design your first console</button></div>`;
    const sw = dev.length ? dev.map((g) => {
      const total = D.GAME_SIZES[g.size].months;
      return `<div class="row"><div class="row-main"><b>${esc(g.title)}</b>
        <span class="sub">${g.size} ${g.topic} ${g.genre} for ${esc(g.platform)} · ${g.months_left} mo left</span>
        ${progress((total - g.months_left) / total)}</div></div>`;
    }).join("") : `<div class="empty"><p>No games in development. ${s.freeStaff} staff are free.</p>
      <button class="btn" data-act="go" data-arg="game">Make a game</button></div>`;
    const top = sellers.length ? `<section><h2>Best sellers last month</h2>${sellers.map((g) => `<div class="row"><div class="row-main"><b>${esc(g.title)}</b><span class="sub">${esc(g.platform)} · score ${g.score.toFixed(1)}</span></div><span class="num">${fmtNum(g.last_sales)}</span></div>`).join("")}</section>` : "";
    // Newest first, but keep critic notes under the headline they belong to.
    const groups = [];
    for (const line of s.news.slice(-10)) {
      if (/^\[[^\]]+\] {2}- /.test(line) && groups.length) groups[groups.length - 1].push(line);
      else groups.push([line]);
    }
    const news = groups.reverse().flat().slice(0, 10);
    return `
      ${topbar()}
      <main class="screen home">
        ${flashBox()}
        ${rep}
        <section><h2>Hardware</h2>${hw}</section>
        <section><h2>In the studio</h2>${sw}</section>
        ${top}
        <nav class="grid" aria-label="Actions">
          <button class="tile" data-act="go" data-arg="design"><b>Design console</b><small>Build new hardware</small></button>
          <button class="tile" data-act="go" data-arg="game"><b>Make a game</b><small>${s.freeStaff} staff free</small></button>
          <button class="tile" data-act="go" data-arg="consoles"><b>Your consoles</b><small>Price, ads, retire</small></button>
          <button class="tile" data-act="go" data-arg="games"><b>Your games</b><small>${s.games.filter((g) => g.status === "released").length} released</small></button>
          <button class="tile ${canResearchSomething() ? "ready" : ""}" data-act="go" data-arg="research"><b>Research</b><small>${canResearchSomething() ? "Upgrade ready!" : `${Math.floor(s.rp)} points`}</small></button>
          <button class="tile" data-act="go" data-arg="staff"><b>Staff & office</b><small>${s.officeInfo[0]}</small></button>
          <button class="tile" data-act="go" data-arg="market"><b>Market report</b><small>${s.activeConsoles().length} consoles on sale</small></button>
          <button class="tile" data-act="go" data-arg="saves"><b>Save & help</b><small>Export, import, rules</small></button>
        </nav>
        ${news.length && !report ? `<section><h2>News</h2><ul class="news">${news.map(newsLine).join("")}</ul></section>` : ""}
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
  function designDraft() {
    if (!draft.parts) draft.parts = { ...s.unlocked };
    return draft;
  }

  views.design = () => {
    if (s.playerConsoles().some((c) => c.status === "dev")) {
      return screen("Design a console", `<div class="empty"><p>Your hardware team is already building a console. You can design the next one after it launches.</p></div>`);
    }
    const d = designDraft();
    const proto = s.previewConsole(d.parts);
    const cost = s.consoleDevCost(d.parts);
    const months = s.consoleDevMonths(d.parts);
    const fair = s.fairPrice(proto);
    const price = d.priceTouched ? d.price : fair;
    const cats = D.CATEGORIES.map((cat) => {
      const tiers = D.COMPONENTS[cat].slice(0, s.unlocked[cat] + 1);
      const opts = tiers.map((t, i) => {
        const bits = [];
        if (t.power) bits.push(`${t.power} power`);
        if (t.appeal) bits.push(`+${t.appeal} appeal`);
        if (t.capacity) bits.push(`fits ${biggestSize(t.capacity)} games`);
        return `<button class="opt ${d.parts[cat] === i ? "on" : ""}" data-act="part" data-arg="${cat}:${i}" aria-pressed="${d.parts[cat] === i}">
          <b>${t.name}</b><small>${bits.join(" · ")}</small><span class="num">$${t.unit_cost}</span></button>`;
      }).join("");
      const locked = s.nextTier(cat);
      return `<fieldset><legend>${cat}</legend>${opts}${locked ? `<p class="hint">Next: ${locked.name} (research)</p>` : ""}</fieldset>`;
    }).join("");
    const afford = cost <= s.money;
    return screen("Design a console", `
      <p class="hint">Pick a part for each slot. CPU, GPU and memory set power; the rest add appeal. Today's buyers expect about ${Math.round(s.expectedPower())} power.</p>
      ${cats}
      <section class="card spec">
        <h2>Spec sheet</h2>
        <dl>
          <dt>Power</dt><dd>${power(proto)} <small>(${pct(s.tech(proto))} of today, ~${pct(s.tech(proto, s.month + months))} at launch)</small></dd>
          <dt>Appeal</dt><dd>${appeal(proto)}</dd>
          <dt>Largest game</dt><dd>${biggestSize(capacity(proto))}</dd>
          <dt>Build cost</dt><dd>~$${s.unitCost(proto)} per unit</dd>
          <dt>Development</dt><dd>${fmtMoney(cost)} · ${months} months</dd>
          <dt>Fair price</dt><dd>about $${fair} <small>(you keep 75%)</small></dd>
        </dl>
        <label for="cname">Console name</label>
        <input id="cname" maxlength="24" autocomplete="off" placeholder="e.g. Gizmo 64" value="${esc(d.name || "")}" data-bind="name">
        <label for="cprice">Launch price ($)</label>
        <input id="cprice" type="number" inputmode="numeric" min="1" value="${price}" data-bind="price" data-num="1">
        <button class="btn primary wide" data-act="build" ${afford ? "" : "disabled"}>${afford ? `Build it for ${fmtMoney(cost)}` : `Need ${fmtMoney(cost)}`}</button>
      </section>`);
  };

  // ---------- make a game
  views.game = () => {
    const d = draft;
    if (!d.focus) d.focus = { Gameplay: 4, Graphics: 2, Story: 2, Audio: 2 };
    const plats = s.platformsForGames();
    if (!plats.length) return screen("Make a game", `<div class="empty"><p>There are no consoles to make games for.</p></div>`);
    if (d.platform && !plats.some((c) => c.name === d.platform)) d.platform = null;
    const plat = d.platform ? s.console(d.platform) : null;

    const platOpts = plats.map((c) => {
      const mine = isPlayer(c);
      const where = c.status === "dev" ? "in development" : `${fmtNum(c.installed_base)} owners`;
      return `<button class="opt ${d.platform === c.name ? "on" : ""}" data-act="pick" data-arg="platform:${esc(c.name)}">
        <b>${esc(c.name)}</b><small>${mine ? "Yours" : esc(c.owner)} · ${where} · up to ${biggestSize(capacity(c))}</small>
        <span class="num">keep ${pct(mine ? OWN_GAME_SHARE : LICENSED_GAME_SHARE)}</span></button>`;
    }).join("");

    const sizeOpts = SIZE_NAMES.map((name) => {
      const sp = D.GAME_SIZES[name];
      const why = [];
      if (plat && sp.capacity > capacity(plat)) why.push("won't fit");
      if (sp.staff > s.freeStaff) why.push(`needs ${sp.staff} staff`);
      if (sp.cost > s.money) why.push("too expensive");
      return `<button class="opt ${d.size === name ? "on" : ""}" data-act="pick" data-arg="size:${name}" ${why.length ? "disabled" : ""}>
        <b>${name}</b><small>${sp.months} months · ${sp.staff} staff · sells at $${sp.price}${why.length ? ` · ${why.join(", ")}` : ""}</small>
        <span class="num">${fmtMoney(sp.cost)}</span></button>`;
    }).join("");

    const chips = (key, list) => `<div class="chips">${list.map((x) =>
      `<button class="chip ${d[key] === x ? "on" : ""}" data-act="pick" data-arg="${key}:${x}" aria-pressed="${d[key] === x}">${x}</button>`).join("")}</div>`;

    const used = D.FOCUS_AREAS.reduce((t, a) => t + d.focus[a], 0);
    const left = D.FOCUS_POINTS - used;
    const focus = D.FOCUS_AREAS.map((a) => `
      <div class="stepper">
        <span>${a}</span>
        <button class="step" data-act="focus" data-arg="${a}:-1" aria-label="Less ${a}" ${d.focus[a] <= 0 ? "disabled" : ""}>&minus;</button>
        <output>${d.focus[a]}</output>
        <button class="step" data-act="focus" data-arg="${a}:1" aria-label="More ${a}" ${left <= 0 ? "disabled" : ""}>+</button>
        <span class="pips">${"■".repeat(d.focus[a])}</span>
      </div>`).join("");

    // What you've learned so far about this genre and topic.
    let lessons = "";
    if (d.genre || d.topic) {
      const past = s.games.filter((g) => g.status === "released" && (g.genre === d.genre || g.topic === d.topic))
        .sort((a, b) => b.release_month - a.release_month).slice(0, 3);
      if (past.length) {
        lessons = `<div class="lessons"><h3>Your notes</h3>${past.map((g) => `<p><b>${esc(g.title)}</b> (${g.topic} ${g.genre}, ${D.FOCUS_AREAS.map((a) => g.focus[a]).join("/")}) scored ${g.score.toFixed(1)}. ${g.feedback.map(esc).join(" ")}</p>`).join("")}</div>`;
      }
    }

    const ready = d.platform && d.size && d.genre && d.topic && left === 0 && (d.title || "").trim();
    return screen("Make a game", `
      <fieldset><legend>Platform</legend>${platOpts}</fieldset>
      <fieldset><legend>Size</legend>${sizeOpts}</fieldset>
      <fieldset><legend>Genre</legend>${chips("genre", Object.keys(D.GENRES).sort())}</fieldset>
      <fieldset><legend>Topic</legend>${chips("topic", Object.keys(D.TOPICS).sort())}</fieldset>
      <fieldset><legend>Focus <span class="legend-note">${left === 0 ? "all 10 points used" : `${left} point${left === 1 ? "" : "s"} left`}</span></legend>
        <p class="hint">Each genre has a hidden ideal split. Reviews tell you how close you got.</p>
        ${focus}
        ${lessons}
      </fieldset>
      <section class="card">
        <label for="gtitle">Title</label>
        <input id="gtitle" maxlength="30" autocomplete="off" placeholder="e.g. Neon Ninja" value="${esc(d.title || "")}" data-bind="title">
        <button class="btn primary wide" data-act="startgame" ${ready ? "" : "disabled"}>Start development</button>
        <p class="hint" id="gamehint" ${ready ? "hidden" : ""}>Pick a platform, size, genre and topic, use all 10 focus points, and give it a title.</p>
      </section>`);
  };

  // ---------- your consoles
  views.consoles = () => {
    const mine = s.playerConsoles();
    if (!mine.length) return screen("Your consoles", `<div class="empty"><p>You haven't designed a console yet.</p><button class="btn primary" data-act="go" data-arg="design">Design a console</button></div>`);
    const cards = mine.slice().reverse().map((c) => {
      const parts = D.CATEGORIES.map((cat) => part(c, cat).name).join(" · ");
      if (c.status === "dev") return `<section class="card">${consoleSummary(c)}<p class="hint">${parts}</p></section>`;
      const own = s.games.filter((g) => g.platform === c.name && g.status === "released").length;
      const key = `retire:${c.name}`;
      return `<section class="card">
        ${consoleSummary(c)}
        <p class="hint">${parts}</p>
        <dl>
          <dt>Build cost</dt><dd>$${s.unitCost(c)} / unit</dd>
          <dt>Fair price</dt><dd>$${s.fairPrice(c)}</dd>
          <dt>Revenue</dt><dd>${fmtMoney(c.revenue)}</dd>
          <dt>Profit</dt><dd class="${c.profit < 0 ? "neg" : ""}">${fmtMoney(c.profit)}</dd>
          <dt>Games</dt><dd>${own} yours · ${c.third_party_titles} third-party</dd>
          ${c.hype_months ? `<dt>Ads</dt><dd>${c.hype_months} months left</dd>` : ""}
        </dl>
        ${c.status === "active" ? `
        <div class="inline">
          <label for="p-${esc(c.name)}" class="sr">Price</label>
          <input id="p-${esc(c.name)}" type="number" inputmode="numeric" min="1" value="${c.price}" data-price-for="${esc(c.name)}">
          <button class="btn" data-act="setprice" data-arg="${esc(c.name)}">Set price</button>
        </div>
        <div class="split">
          <button class="btn" data-act="ads" data-arg="${esc(c.name)}">Ad campaign · ${fmtMoney(s.marketingCost())}</button>
          <button class="btn danger" data-act="retire" data-arg="${esc(c.name)}">${confirmKey === key ? "Tap again to discontinue" : "Discontinue"}</button>
        </div>` : ""}
      </section>`;
    }).join("");
    return screen("Your consoles", cards);
  };

  // ---------- your games
  views.games = () => {
    if (!s.games.length) return screen("Your games", `<div class="empty"><p>No games yet.</p><button class="btn primary" data-act="go" data-arg="game">Make a game</button></div>`);
    const list = s.games.slice().sort((a, b) => (a.status === "dev" ? -1 : 0) - (b.status === "dev" ? -1 : 0) || b.release_month - a.release_month);
    return screen("Your games", list.map((g) => {
      if (g.status === "dev") {
        return `<div class="row"><div class="row-main"><b>${esc(g.title)}</b><span class="sub">${g.size} ${g.topic} ${g.genre} · ${esc(g.platform)} · ${g.months_left} mo left</span></div><span class="pill">in dev</span></div>`;
      }
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

  // ---------- research
  views.research = () => {
    const cards = D.CATEGORIES.map((cat) => {
      const have = D.COMPONENTS[cat][s.unlocked[cat]].name;
      const t = s.nextTier(cat);
      let action = `<span class="pill good">Maxed out</span>`;
      let sub = "Fully researched";
      if (t) {
        const early = s.year < t.year;
        const short = s.rp < t.rp;
        sub = `Next: ${t.name} · ${t.rp} RP${early ? ` · from ${t.year}` : ""}`;
        action = `<button class="btn ${!early && !short ? "primary" : ""}" data-act="research" data-arg="${cat}" ${early || short ? "disabled" : ""}>${early ? `${t.year}` : short ? `${Math.floor(s.rp)}/${t.rp}` : "Research"}</button>`;
      }
      return `<div class="row"><div class="row-main"><b>${cat}: ${have}</b><span class="sub">${sub}</span></div>${action}</div>`;
    }).join("");
    return screen("Research lab", `<p class="hint">You have ${Math.floor(s.rp)} research points and earn ${s.rpPerMonth.toFixed(1)} a month. More staff and more skill research faster.</p>${cards}`);
  };

  // ---------- staff & office
  views.staff = () => {
    const [oname, cap, rent] = s.officeInfo;
    const next = D.OFFICES[s.office + 1];
    return screen("Staff & office", `
      <section class="card">
        <dl>
          <dt>Office</dt><dd>${oname} · room for ${cap} · rent ${fmtMoney(rent)}/mo</dd>
          <dt>Staff</dt><dd>${s.staff} (${s.freeStaff} free) · ${fmtMoney(s.salary)}/mo each</dd>
          <dt>Team skill</dt><dd>${s.skill.toFixed(1)} / 10 <small>(grows as you ship games)</small></dd>
        </dl>
        <p class="hint">Recruiting costs ${fmtMoney(s.hireCost())} per person. New hires are a little less experienced.</p>
        <div class="split">
          <button class="btn primary" data-act="hire" data-arg="1">Hire 1</button>
          <button class="btn" data-act="hire" data-arg="5">Hire 5</button>
          <button class="btn" data-act="fire" data-arg="1">Let 1 go</button>
        </div>
      </section>
      ${next ? `<section class="card">
        <h2>Move to a ${next[0]}</h2>
        <p>Room for ${next[1]} staff · rent ${fmtMoney(next[2])}/mo · costs ${fmtMoney(next[3])} to move.</p>
        <button class="btn wide" data-act="office" ${s.money < next[3] ? "disabled" : ""}>${s.money < next[3] ? `Need ${fmtMoney(next[3])}` : "Move offices"}</button>
      </section>` : `<p class="hint">You're in the biggest office there is.</p>`}`);
  };

  // ---------- market
  views.market = () => {
    const shares = s.marketShares();
    const rows = s.activeConsoles().sort((a, b) => (shares[b.name] || 0) - (shares[a.name] || 0)).map((c) => `
      <tr class="${isPlayer(c) ? "you" : ""}"><td><b>${esc(c.name)}</b><small>${isPlayer(c) ? "You" : esc(c.owner)}</small></td>
      <td>${pct(s.tech(c))}</td><td>$${c.price}</td><td>${fmtNum(c.last_sales)}</td><td>${pct(shares[c.name])}</td><td>${fmtNum(c.installed_base)}</td></tr>`).join("");
    return screen("Market report", `
      <p class="hint">About ${fmtNum(s.marketSize())} people shop for a console each month; most leave without buying. Buyers expect about ${Math.round(s.expectedPower())} power today.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Console</th><th>Power</th><th>Price</th><th>Last mo</th><th>Share</th><th>Owners</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`);
  };

  // ---------- saves & help
  const HELP = `
    <ul class="rules">
      <li><b>Design a console</b> from parts. More power and appeal sell more units but cost more to build. Price it near what buyers think is fair.</li>
      <li><b>Consoles take months to build.</b> You can start a game for it while it's in development; the game ships when the console launches.</li>
      <li><b>Make games</b> for your own console (you keep 70%) or license them for a rival's (you keep 45%). That's handy before your hardware exists.</li>
      <li><b>Split 10 focus points</b> between Gameplay, Graphics, Story and Audio. Each genre has a hidden ideal split, and some topics suit some genres. The critics' notes tell you what to change.</li>
      <li><b>Great games sell your console.</b> Popular consoles also attract third-party games that pay you royalties.</li>
      <li><b>Hardware ages fast.</b> Research new parts and launch successors.</li>
      <li><b>Hire staff</b> to make bigger games and research faster. Move offices to grow.</li>
      <li><b>Three months in a row in debt</b> and the company goes bankrupt. Reach ${D.END_YEAR} for your final score.</li>
    </ul>`;

  views.help = () => (s ? screen("How to play", HELP) : `<main class="screen"><div class="screen-head"><button class="back" data-act="go" data-arg="start">&larr; Back</button><h1>How to play</h1></div>${HELP}</main>`);

  views.saves = () => {
    const exportBox = s ? `
      <section class="card">
        <h2>Export save</h2>
        <p class="hint">Your game saves itself on this device after every move. To move it to another device or to the Python version, copy this code into a file named <code>something.json</code> in the <code>saves</code> folder.</p>
        <textarea id="exporttext" readonly rows="4">${esc(JSON.stringify(s))}</textarea>
        <button class="btn wide" data-act="copy">Copy save code</button>
      </section>` : "";
    const restartKey = "restart";
    const body = `
      ${exportBox}
      <section class="card">
        <h2>Import save</h2>
        <p class="hint">Paste a save code from another device or a Python save file.</p>
        <textarea id="importtext" rows="4" placeholder='{"company": ...}' data-bind="importText">${esc(draft.importText || "")}</textarea>
        <button class="btn wide" data-act="import">Load this save</button>
      </section>
      ${s ? `<section class="card"><h2>Start over</h2><p class="hint">Ends this company and deletes its save on this device.</p>
        <button class="btn danger wide" data-act="restart">${confirmKey === restartKey ? "Tap again to delete and start over" : "Start a new company"}</button></section>` : ""}
      ${s ? `<section><h2>How to play</h2>${HELP}</section>` : ""}`;
    if (s) return screen("Save & help", body);
    return `<main class="screen"><div class="screen-head"><button class="back" data-act="go" data-arg="start">&larr; Back</button><h1>Import a save</h1></div>${flashBox()}${body}</main>`;
  };

  views.over = () => {
    const mine = s.playerConsoles();
    const released = s.games.filter((g) => g.status === "released");
    const bestC = mine.length ? mine.reduce((a, b) => (b.installed_base > a.installed_base ? b : a)) : null;
    const bestG = released.length ? released.reduce((a, b) => (b.score > a.score || (b.score === a.score && b.units_sold > a.units_sold) ? b : a)) : null;
    return `${topbar()}
      <main class="screen over">
        <div class="title-card">
          <p class="eyebrow">${s.over_reason === "bankrupt" ? "Bankrupt" : "Retired"} · ${s.date}</p>
          <h1 class="big-title">${s.over_reason === "bankrupt" ? "Game over" : "The end"}</h1>
          <p class="final">Score <b>${s.finalScore().toLocaleString("en-US")}</b></p>
        </div>
        <section class="card"><dl>
          <dt>Bank balance</dt><dd>${fmtMoney(s.money)}</dd>
          <dt>Consoles sold</dt><dd>${fmtNum(mine.reduce((t, c) => t + c.installed_base, 0))}</dd>
          <dt>Games released</dt><dd>${released.length} · ${fmtNum(released.reduce((t, g) => t + g.units_sold, 0))} copies</dd>
          ${bestC ? `<dt>Best console</dt><dd>${esc(bestC.name)} (${fmtNum(bestC.installed_base)})</dd>` : ""}
          ${bestG ? `<dt>Best game</dt><dd>${esc(bestG.title)} (${bestG.score.toFixed(1)})</dd>` : ""}
        </dl></section>
        <section class="card"><h2>Final news</h2><ul class="news">${s.news.slice(-6).reverse().map(newsLine).join("")}</ul></section>
        <button class="btn primary wide" data-act="newafterend">Start a new company</button>
      </main>`;
  };

  // ------------------------------------------------------------ actions
  const actions = {
    go: (v) => go(v),
    continue: () => {
      try { s = State.fromDict(JSON.parse(load(SAVE_KEY))); } catch (e) { flash = { kind: "err", text: "That save couldn't be read." }; return render(); }
      report = null;
      go(s.over ? "over" : "home");
    },
    advance: (n) => {
      const from = s.date;
      const before = s.money;
      let lines = [];
      const count = Number(n);
      let done = 0;
      for (let i = 0; i < count && !s.over; i++) {
        lines = lines.concat(s.advance());
        done++;
        // Stop a long skip early when something important happens.
        if (count > 1 && s.debt_months > 0) break;
      }
      report = { months: done, from: nextDate(from), delta: s.money - before, lines };
      autosave();
      go(s.over ? "over" : "home");
    },
    part: (arg) => {
      const [cat, i] = arg.split(":");
      designDraft().parts[cat] = Number(i);
      render();
    },
    build: () => {
      const d = designDraft();
      const proto = s.previewConsole(d.parts);
      const price = d.priceTouched ? Number(d.price) : s.fairPrice(proto);
      const name = (d.name || "").trim();
      if (attempt(() => s.designConsole(name, d.parts, price), `Engineers are building the ${name}. It launches in ${s.consoleDevMonths(d.parts)} months.`)) go("home");
      else render();
    },
    pick: (arg) => {
      const i = arg.indexOf(":");
      const key = arg.slice(0, i);
      const val = arg.slice(i + 1);
      draft[key] = val;
      if (key === "platform" && draft.size) {
        const plat = s.console(val);
        if (D.GAME_SIZES[draft.size].capacity > capacity(plat)) draft.size = null;
      }
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
      attempt(() => s.setPrice(name, Number(input.value)), `${name} now sells for $${Math.round(Number(input.value))}.`);
      render();
    },
    ads: (name) => { attempt(() => s.runMarketing(name), `Ads for the ${name} run for 3 months.`); render(); },
    retire: (name) => {
      const key = `retire:${name}`;
      if (confirmKey !== key) { confirmKey = key; return render(); }
      confirmKey = null;
      attempt(() => s.discontinue(name), `${name} discontinued.`);
      render();
    },
    research: (cat) => {
      let tier = null;
      attempt(() => { tier = s.research(cat); }, null);
      if (tier) flash = { kind: "ok", text: `Unlocked ${tier.name}!` };
      render();
    },
    hire: (n) => { attempt(() => s.hire(Number(n)), `Hired ${n}.`); render(); },
    fire: (n) => { attempt(() => s.fire(Number(n)), `Let ${n} go.`); render(); },
    office: () => { attempt(() => s.upgradeOffice(), "Moved offices!"); render(); },
    copy: () => {
      const box = document.getElementById("exporttext");
      const text = box.value;
      const fallback = () => { box.focus(); box.select(); flash = { kind: "ok", text: "Selected. Use your phone's Copy." }; render(); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => { flash = { kind: "ok", text: "Save code copied." }; render(); }, fallback);
      } else fallback();
    },
    import: () => {
      try {
        const loaded = State.fromDict(JSON.parse(draft.importText || ""));
        s = loaded;
        report = null;
        autosave();
        flash = { kind: "ok", text: `Loaded ${s.company}.` };
        go(s.over ? "over" : "home");
      } catch (e) {
        flash = { kind: "err", text: "That doesn't look like a Console Tycoon save. Paste the whole code, including the { and }." };
        render();
      }
    },
    restart: () => {
      if (confirmKey !== "restart") { confirmKey = "restart"; return render(); }
      s = null;
      report = null;
      store(SAVE_KEY, null);
      go("start");
    },
    newafterend: () => { s = null; report = null; store(SAVE_KEY, null); go("start"); },
  };

  function nextDate(dateStr) {
    // "Jan 1987" -> the month after it, used to label multi-month reports.
    const [m, y] = dateStr.split(" ");
    let i = D.MONTH_NAMES.indexOf(m) + 1;
    let year = Number(y);
    if (i === 12) { i = 0; year++; }
    return `${D.MONTH_NAMES[i]} ${year}`;
  }

  // ------------------------------------------------------------ wiring
  function render() {
    const fn = views[view] || views.start;
    app.innerHTML = fn();
  }

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
      // Enable the start button without re-rendering (keeps the keyboard open).
      const btn = app.querySelector('[data-act="startgame"]');
      const d = draft;
      const left = D.FOCUS_POINTS - D.FOCUS_AREAS.reduce((t, a) => t + d.focus[a], 0);
      const ok = Boolean(d.platform && d.size && d.genre && d.topic && left === 0 && el.value.trim());
      if (btn) btn.disabled = !ok;
      const hint = document.getElementById("gamehint");
      if (hint) hint.hidden = ok;
    }
  });

  app.addEventListener("submit", (e) => {
    e.preventDefault();
    if (e.target.dataset.form === "new") {
      const name = (draft.company || "").trim() || "Garage Games";
      s = createGame(name);
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
    if (!s) view = "start";
    render();
  }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(() => ({ save: s ? s.toDict() : null, view, draft }));
  if (hot && hot.ready) hot.ready(start); else start(hot && hot.data ? hot.data : {});
})();
