// Draws the showroom models: consoles built from their parts, and game cartridges / boxes.
// Every function returns an SVG string.
"use strict";

(function (root) {
  const D = root.CT_DATA;
  let uid = 0;

  // ------------------------------------------------------------ colour helpers
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shade(hex, amt) { // amt -1..1: darker..lighter
    const [r, g, b] = hexToRgb(hex);
    const f = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }
  const isLight = (hex) => { const [r, g, b] = hexToRgb(hex); return r * 0.299 + g * 0.587 + b * 0.114 > 150; };
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seeded(seed) {
    let a = seed || 1;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ------------------------------------------------------------ console
  // Case tiers: front-face height, corner radius and finish.
  const CASES = [
    { h: 92, rx: 5, ridges: true },                // Plastic Box
    { h: 84, rx: 26 },                             // Sleek Shell
    { h: 90, rx: 12, clear: true },                // Translucent Shell
    { h: 58, rx: 10 },                             // Compact Slim
    { h: 78, rx: 14, metal: true },                // Premium Alloy
    { h: 92, rx: 3, slant: true },                 // Designer Edition
    { h: 86, rx: 43, glow: true },                 // Morphing Shell
  ];

  function consoleSVG({ parts, color, name }) {
    const id = `m${++uid}`;
    const cs = CASES[parts.Case] || CASES[0];
    const W = 250, x0 = 70, base = 206, top = base - cs.h, dx = 26, dy = -18;
    const body = color || "#2b2d33";
    const ink = isLight(body) ? "#24262c" : "#f1eee6";
    const power = ["CPU", "GPU", "Memory"].reduce((t, s) => t + parts[s] + 1, 0);
    const flat = cs.rx > 16;
    const out = [];

    out.push(`<defs>
      <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${shade(body, cs.metal ? 0.35 : 0.08)}"/>
        <stop offset="1" stop-color="${shade(body, cs.metal ? -0.35 : -0.12)}"/>
      </linearGradient>
      <radialGradient id="${id}g" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#7fd7ff" stop-opacity="0.8"/><stop offset="1" stop-color="#7fd7ff" stop-opacity="0"/></radialGradient>
    </defs>`);
    out.push(`<ellipse cx="${x0 + W / 2 + 12}" cy="${base + 10}" rx="${W / 2 + 40}" ry="14" fill="#000" opacity="0.35"/>`);
    if (cs.glow) out.push(`<ellipse cx="${x0 + W / 2}" cy="${top + cs.h / 2}" rx="${W / 2 + 30}" ry="${cs.h}" fill="url(#${id}g)" opacity="0.5"/>`);

    // Side and top faces give a little depth to boxy cases.
    if (!flat) {
      out.push(`<polygon points="${x0 + W},${top} ${x0 + W + dx},${top + dy} ${x0 + W + dx},${base + dy} ${x0 + W},${base}" fill="${shade(body, -0.35)}"/>`);
      out.push(`<polygon points="${x0},${top} ${x0 + W},${top} ${x0 + W + dx},${top + dy} ${x0 + dx},${top + dy}" fill="${shade(body, 0.22)}"/>`);
      if (cs.ridges) {
        for (let i = 1; i <= 5; i++) {
          const x = x0 + W * 0.62 + i * 14;
          out.push(`<line x1="${x}" y1="${top - 1}" x2="${x + dx}" y2="${top + dy - 1}" stroke="${shade(body, -0.2)}" stroke-width="3"/>`);
        }
      }
    }

    // Storage on top (cartridge slots, CD lid) is drawn before the front face.
    const st = parts.Storage;
    const sx = x0 + W * 0.36, sy = top + (flat ? 6 : dy / 2);
    if (st <= 1) {
      const cw = st === 0 ? 74 : 92, ch = st === 0 ? 58 : 64;
      out.push(`<rect x="${sx - 6}" y="${sy - 4}" width="${cw + 12}" height="9" rx="3" fill="#111"/>`);
      out.push(`<rect x="${sx}" y="${sy - ch}" width="${cw}" height="${ch + 2}" rx="5" fill="#8d8f96"/>`);
      for (let i = 0; i < 4; i++) out.push(`<rect x="${sx + 8}" y="${sy - ch + 6 + i * 5}" width="${cw - 16}" height="2" fill="#6f7178"/>`);
      out.push(`<rect x="${sx + 8}" y="${sy - ch + 28}" width="${cw - 16}" height="${ch - 34}" rx="2" fill="${st === 0 ? "#e9e4d4" : "#f2c14e"}"/>`);
      out.push(`<rect x="${sx + 14}" y="${sy - ch + 34}" width="${cw - 28}" height="5" fill="${st === 0 ? "#c8372a" : "#2c48c4"}"/>`);
    } else if (st === 2) {
      out.push(`<ellipse cx="${sx + 40}" cy="${sy}" rx="${flat ? 48 : 52}" ry="${flat ? 7 : 11}" fill="${shade(body, -0.25)}" stroke="${shade(body, 0.3)}" stroke-width="2"/>`);
      out.push(`<ellipse cx="${sx + 40}" cy="${sy}" rx="10" ry="2.5" fill="${shade(body, 0.4)}"/>`);
    } else if (st === 6) {
      for (let i = 1; i <= 3; i++) out.push(`<path d="M ${sx + 40 - i * 14} ${sy - 10 - i * 4} q ${i * 14} ${-i * 12} ${i * 28} 0" fill="none" stroke="#7fd7ff" stroke-width="3" stroke-linecap="round" opacity="${1 - i * 0.2}"/>`);
    }

    // Front face.
    if (cs.slant) {
      out.push(`<polygon points="${x0 + 18},${top} ${x0 + W},${top} ${x0 + W - 10},${base} ${x0},${base}" fill="url(#${id}f)"/>`);
      out.push(`<polygon points="${x0 + 18},${top} ${x0 + W},${top} ${x0 + W + dx},${top + dy} ${x0 + 18 + dx},${top + dy}" fill="${shade(body, 0.22)}"/>`);
    } else {
      out.push(`<rect x="${x0}" y="${top}" width="${W}" height="${cs.h}" rx="${cs.rx}" fill="url(#${id}f)" ${cs.clear ? 'fill-opacity="0.72"' : ""}/>`);
    }
    if (cs.clear) {
      out.push(`<rect x="${x0 + 100}" y="${top + 22}" width="64" height="38" rx="3" fill="#2f7a4a" opacity="0.45"/>`);
      for (let i = 0; i < 6; i++) out.push(`<rect x="${x0 + 106 + i * 10}" y="${top + 30}" width="6" height="22" fill="#1e2025" opacity="0.4"/>`);
    }
    if (cs.metal) out.push(`<rect x="${x0 + 10}" y="${top + 6}" width="${W - 20}" height="3" rx="1.5" fill="#fff" opacity="0.35"/>`);

    // Front details: drive slots, vents (one per point of power), LED, name badge.
    if (st === 3 || st === 4) {
      out.push(`<rect x="${x0 + 22}" y="${top + 12}" width="96" height="7" rx="3.5" fill="#111"/>`);
      if (st === 4) out.push(`<rect x="${x0 + 26}" y="${top + 21}" width="88" height="2" fill="#4f7cff"/>`);
    } else if (st === 5) {
      out.push(`<rect x="${x0 + 22}" y="${top + 13}" width="96" height="3" rx="1.5" fill="#7fd7ff" opacity="0.9"/>`);
    }
    const vents = Math.min(power, 8);
    for (let i = 0; i < vents; i++) {
      const vx = x0 + W - 24 - i * 7;
      out.push(`<rect x="${vx}" y="${top + cs.h * 0.3}" width="3" height="${cs.h * 0.45}" rx="1.5" fill="${shade(body, -0.45)}"/>`);
    }
    out.push(`<circle cx="${x0 + 22}" cy="${base - 18}" r="4.5" fill="#ff5a4a"/><circle cx="${x0 + 22}" cy="${base - 18}" r="9" fill="#ff5a4a" opacity="0.25"/>`);
    out.push(`<rect x="${x0 + 36}" y="${base - 24}" width="26" height="12" rx="3" fill="${shade(body, -0.3)}"/>`);
    const label = esc((name || "").slice(0, 16).toUpperCase());
    if (label) out.push(`<text x="${x0 + 22}" y="${top + (cs.h < 70 ? 31 : cs.h * 0.5)}" font-family="Silkscreen, 'Courier New', monospace" font-size="${cs.h < 70 ? 12 : 15}" fill="${ink}" opacity="0.9">${label}</text>`);

    out.push(controllerSVG(parts.Controller, body, x0, base));
    return `<svg viewBox="0 0 420 290" role="img" aria-label="Model of ${esc(name || "your console")}" xmlns="http://www.w3.org/2000/svg">${out.join("")}</svg>`;
  }

  function controllerSVG(tier, body, x0, base) {
    const cx = 150, cy = 252;
    const pad = shade(body, -0.15), edge = shade(body, 0.25);
    const out = [];
    if (tier <= 3) out.push(`<path d="M ${cx + 40} ${cy - 14} C ${cx + 70} ${cy - 40}, ${x0 + 130} ${base + 20}, ${x0 + 120} ${base - 4}" fill="none" stroke="#111" stroke-width="3" stroke-linecap="round"/>`);
    if (tier === 4) { // motion wand
      out.push(`<rect x="${cx - 70}" y="${cy - 9}" width="150" height="20" rx="10" fill="${pad}" stroke="${edge}" stroke-width="2" transform="rotate(-12 ${cx} ${cy})"/>`);
      out.push(`<circle cx="${cx - 52}" cy="${cy + 13}" r="6" fill="#7fd7ff" opacity="0.9"/><circle cx="${cx + 30}" cy="${cy - 6}" r="5" fill="#c8372a"/>`);
      return out.join("");
    }
    if (tier === 6) { // neural band
      out.push(`<ellipse cx="${cx}" cy="${cy}" rx="62" ry="18" fill="none" stroke="${pad}" stroke-width="10"/>`);
      out.push(`<ellipse cx="${cx}" cy="${cy}" rx="62" ry="18" fill="none" stroke="#7fd7ff" stroke-width="2" opacity="0.8"/>`);
      return out.join("");
    }
    const w = tier >= 2 ? 140 : 118, h = tier >= 2 ? 52 : 40;
    out.push(`<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${h / 2}" fill="${pad}" stroke="${edge}" stroke-width="2"/>`);
    // d-pad
    const dx = cx - w / 2 + 26, dy = cy - (tier >= 2 ? 6 : 0);
    out.push(`<rect x="${dx - 10}" y="${dy - 3.5}" width="20" height="7" rx="1.5" fill="#1b1c20"/><rect x="${dx - 3.5}" y="${dy - 10}" width="7" height="20" rx="1.5" fill="#1b1c20"/>`);
    // face buttons
    const bx = cx + w / 2 - 28, by = dy;
    const buttons = tier === 0 ? [[-8, 4], [8, -4]]
      : tier === 1 ? [[-12, 5], [0, 5], [12, 5], [-12, -7], [0, -7], [12, -7]]
        : [[0, -10], [-10, 0], [10, 0], [0, 10]];
    const colors = ["#c8372a", "#2c48c4", "#e0b04a", "#287048", "#c8372a", "#2c48c4"];
    buttons.forEach(([ox, oy], i) => out.push(`<circle cx="${bx + ox}" cy="${by + oy}" r="${tier === 1 ? 4.5 : 5.5}" fill="${tier === 0 ? "#c8372a" : colors[i]}"/>`));
    if (tier >= 2) { // analog sticks
      out.push(`<circle cx="${cx - 18}" cy="${cy + 12}" r="8" fill="#1b1c20"/><circle cx="${cx + 18}" cy="${cy + 12}" r="8" fill="#1b1c20"/>`);
    }
    if (tier === 3) { // rumble
      out.push(`<path d="M ${cx - w / 2 - 12} ${cy - 10} l -6 5 l 6 5 l -6 5" fill="none" stroke="${edge}" stroke-width="2"/><path d="M ${cx + w / 2 + 12} ${cy - 10} l 6 5 l -6 5 l 6 5" fill="none" stroke="${edge}" stroke-width="2"/>`);
    }
    if (tier === 5) out.push(`<rect x="${cx - 16}" y="${cy - 20}" width="32" height="16" rx="4" fill="#7fd7ff" opacity="0.55"/>`);
    else if (tier < 2) out.push(`<rect x="${cx - 12}" y="${cy - 2}" width="10" height="4" rx="2" fill="#1b1c20"/><rect x="${cx + 4}" y="${cy - 2}" width="10" height="4" rx="2" fill="#1b1c20"/>`);
    return out.join("");
  }

  // ------------------------------------------------------------ game
  const GENRE_HUES = { Action: 8, Adventure: 140, Platformer: 48, Puzzle: 280, Racing: 200, Rhythm: 320, RPG: 260, Shooter: 0, Simulation: 170, Sports: 110, Strategy: 30 };

  function wrap(text, max) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const w of words) {
      if ((line + " " + w).trim().length > max && line) { lines.push(line); line = w; } else line = (line + " " + w).trim();
    }
    if (line) lines.push(line);
    return lines.slice(0, 3).map((l) => (l.length > max ? l.slice(0, max - 1) + "…" : l));
  }

  // Cover art: shapes seeded by the title, coloured by the genre.
  function coverArt(id, x, y, w, h, g) {
    const hue = g.genre ? GENRE_HUES[g.genre] : 220;
    const sat = g.genre ? 62 : 8;
    const rnd = seeded(hash(`${g.title}|${g.topic}|${g.genre}`));
    const out = [`<defs><linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="hsl(${hue},${sat}%,52%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},${sat + 8}%,22%)"/></linearGradient>
        <clipPath id="${id}c"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/></clipPath></defs>`,
    `<g clip-path="url(#${id}c)"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id}a)"/>`];
    if (g.genre) {
      for (let i = 0; i < 7; i++) {
        const px = x + rnd() * w, py = y + rnd() * h, r = 10 + rnd() * w * 0.28;
        const fill = `hsla(${(hue + rnd() * 80 - 40 + 360) % 360},80%,${55 + rnd() * 30}%,${0.18 + rnd() * 0.3})`;
        const kind = Math.floor(rnd() * 3);
        if (kind === 0) out.push(`<circle cx="${px}" cy="${py}" r="${r}" fill="${fill}"/>`);
        else if (kind === 1) out.push(`<polygon points="${px},${py - r} ${px + r},${py + r * 0.8} ${px - r},${py + r * 0.8}" fill="${fill}"/>`);
        else out.push(`<rect x="${px - r}" y="${py - r / 4}" width="${r * 2}" height="${r / 2}" fill="${fill}" transform="rotate(${rnd() * 60 - 30} ${px} ${py})"/>`);
      }
    }
    if (g.topic) out.push(`<text x="${x + 10}" y="${y + 24}" font-family="Silkscreen, 'Courier New', monospace" font-size="17" fill="#fff" opacity="0.92">${esc(g.topic.toUpperCase())}</text>`);
    const lines = wrap(g.title || "Untitled", 13);
    const bandH = 20 + lines.length * 18;
    out.push(`<rect x="${x}" y="${y + h - bandH}" width="${w}" height="${bandH}" fill="#000" opacity="0.55"/>`);
    lines.forEach((l, i) => out.push(`<text x="${x + 10}" y="${y + h - bandH + 24 + i * 18}" font-family="'IBM Plex Sans', system-ui, sans-serif" font-weight="700" font-size="17" fill="#fff">${esc(l)}</text>`));
    if (g.size) out.push(`<rect x="${x + w - 52}" y="${y + 8}" width="44" height="16" rx="3" fill="#fff" opacity="0.9"/><text x="${x + w - 30}" y="${y + 20}" text-anchor="middle" font-family="'IBM Plex Mono', monospace" font-weight="600" font-size="10" fill="#1e2025">${esc(g.size.toUpperCase())}</text>`);
    out.push(`</g>`);
    return out.join("");
  }

  // g: {title, genre, topic, size}; cart: true for cartridge consoles, false for discs.
  function gameSVG(g, cart) {
    const id = `g${++uid}`;
    const out = [`<ellipse cx="210" cy="272" rx="120" ry="10" fill="#000" opacity="0.35"/>`];
    if (cart) {
      out.push(`<path d="M 120 30 h 180 a 8 8 0 0 1 8 8 v 214 a 8 8 0 0 1 -8 8 h -150 l -22 -18 h -8 a 8 8 0 0 1 -8 -8 v -196 a 8 8 0 0 1 8 -8 z" fill="#8d8f96"/>`);
      for (let i = 0; i < 4; i++) out.push(`<rect x="132" y="${40 + i * 7}" width="156" height="3" rx="1.5" fill="#6f7178"/>`);
      out.push(`<rect x="130" y="70" width="160" height="168" rx="4" fill="#e9e4d4"/>`);
      out.push(coverArt(id, 136, 76, 148, 156, g));
    } else {
      out.push(`<rect x="100" y="20" width="220" height="246" rx="6" fill="#1b1c20"/><rect x="100" y="20" width="16" height="246" rx="3" fill="#33353c"/>`);
      out.push(coverArt(id, 120, 26, 194, 234, g));
    }
    return `<svg viewBox="0 0 420 290" role="img" aria-label="Box art for ${esc(g.title || "your game")}" xmlns="http://www.w3.org/2000/svg">${out.join("")}</svg>`;
  }

  root.CT_MODELS = { consoleSVG, gameSVG };
})(typeof window !== "undefined" ? window : globalThis);
