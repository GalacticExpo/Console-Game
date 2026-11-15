// Console Tycoon game data. Edit freely, then run: node tools/build.js
"use strict";

(function (root) {
  // Each slot has tiers from cheapest to best. CPU, GPU and Memory tiers add
  // their rating to a console's power; Storage, Controller and Case add to its
  // appeal. Storage capacity limits how big a game the console can hold.
  const tiers = (names, costs, extra) => names.map((name, i) =>
    Object.assign({ name, rating: i + 1, unit_cost: costs[i] }, extra ? extra[i] : {}));

  const DATA = {
    START_YEAR: 1985,
    STARTING_MONEY: 150000,
    MONTH_NAMES: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],

    // Colours you can paint a console: [name, hex]. The first is the default.
    CONSOLE_COLORS: [["Charcoal", "#2b2d33"], ["Putty", "#d9d3c3"], ["Cobalt", "#2c48c4"], ["Cherry", "#c8372a"],
      ["Mint", "#7fc8a9"], ["Grape", "#6a4c9c"], ["Sunflower", "#e5b53a"]],

    POWER_SLOTS: ["CPU", "GPU", "Memory"],
    APPEAL_SLOTS: ["Storage", "Controller", "Case"],
    COMPONENTS: {
      CPU: tiers(["8-bit Pico", "16-bit Duo", "32-bit Tri", "64-bit Quad", "Multicore X", "Octa Fusion", "Neural Core"],
        [20, 28, 40, 55, 75, 100, 120]),
      GPU: tiers(["Tile Blitter", "Sprite Engine", "Polygon Pusher", "Texel Forge", "Shader Array", "Ray Weaver", "Photon Matrix"],
        [15, 22, 35, 50, 70, 95, 115]),
      Memory: tiers(["64 KB RAM", "512 KB RAM", "4 MB RAM", "32 MB RAM", "512 MB RAM", "8 GB RAM", "32 GB RAM"],
        [10, 13, 18, 25, 35, 45, 55]),
      Storage: tiers(["ROM Cartridge", "Mega Cartridge", "CD-ROM Drive", "DVD Drive", "Blu-ray Drive", "Solid State Drive", "Cloud Hybrid"],
        [8, 14, 20, 26, 35, 45, 50],
        [1, 2, 3, 3, 4, 4, 4].map((capacity) => ({ capacity }))),
      Controller: tiers(["Basic Pad", "Six-Button Pad", "Analog Stick Pad", "Rumble Pad", "Motion Wand", "Haptic Pad", "Neural Band"],
        [5, 7, 10, 12, 16, 18, 22]),
      Case: tiers(["Plastic Box", "Sleek Shell", "Translucent Shell", "Compact Slim", "Premium Alloy", "Designer Edition", "Morphing Shell"],
        [8, 9, 10, 12, 16, 20, 24]),
    },

    FOCUS_AREAS: ["Gameplay", "Graphics", "Story", "Audio"],
    FOCUS_POINTS: 10,
    // Hidden ideal focus split per genre (sums to FOCUS_POINTS).
    GENRES: {
      Action: { Gameplay: 4, Graphics: 3, Story: 1, Audio: 2 },
      Adventure: { Gameplay: 2, Graphics: 2, Story: 5, Audio: 1 },
      Platformer: { Gameplay: 5, Graphics: 3, Story: 1, Audio: 1 },
      Puzzle: { Gameplay: 6, Graphics: 1, Story: 1, Audio: 2 },
      Racing: { Gameplay: 4, Graphics: 4, Story: 0, Audio: 2 },
      Rhythm: { Gameplay: 4, Graphics: 1, Story: 0, Audio: 5 },
      RPG: { Gameplay: 3, Graphics: 2, Story: 4, Audio: 1 },
      Shooter: { Gameplay: 4, Graphics: 4, Story: 1, Audio: 1 },
      Simulation: { Gameplay: 5, Graphics: 2, Story: 1, Audio: 2 },
      Sports: { Gameplay: 4, Graphics: 3, Story: 0, Audio: 3 },
      Strategy: { Gameplay: 5, Graphics: 1, Story: 3, Audio: 1 },
    },
    // Topic: [genres that fit well, genres that clash]
    TOPICS: {
      Aliens: [["Shooter", "Strategy", "Adventure"], ["Sports"]],
      Animals: [["Platformer", "Simulation"], ["Shooter"]],
      Cars: [["Racing", "Simulation"], ["RPG", "Adventure"]],
      Cooking: [["Simulation", "Puzzle"], ["Shooter"]],
      Cyberpunk: [["RPG", "Shooter", "Adventure"], ["Sports"]],
      Detective: [["Adventure", "Puzzle"], ["Racing", "Sports"]],
      Dinosaurs: [["Action", "Adventure"], ["Puzzle"]],
      Fantasy: [["RPG", "Adventure", "Strategy"], ["Racing", "Sports"]],
      Farming: [["Simulation", "Strategy"], ["Shooter", "Racing"]],
      Horror: [["Adventure", "Shooter"], ["Sports", "Rhythm"]],
      Medieval: [["Strategy", "RPG", "Action"], ["Racing", "Rhythm"]],
      Music: [["Rhythm", "Simulation"], ["Shooter", "Strategy"]],
      Mythology: [["RPG", "Action", "Strategy"], ["Racing"]],
      Ninjas: [["Action", "Platformer"], ["Simulation"]],
      Pirates: [["Adventure", "Action", "Strategy"], ["Racing"]],
      Robots: [["Action", "Shooter", "Strategy"], ["Rhythm"]],
      Soccer: [["Sports", "Simulation"], ["RPG", "Adventure", "Shooter"]],
      Space: [["Shooter", "Strategy", "Simulation"], ["Sports", "Rhythm"]],
      Spies: [["Action", "Adventure"], ["Rhythm"]],
      Zombies: [["Shooter", "Action"], ["Puzzle", "Sports"]],
    },
    // months: dev time, cost: paid up front, capacity: storage needed,
    // price: retail price, reach: sales multiplier, polish: review multiplier
    GAME_SIZES: {
      Small: { months: 2, cost: 10000, capacity: 1, price: 20, reach: 0.6, polish: 0.95 },
      Medium: { months: 4, cost: 50000, capacity: 2, price: 35, reach: 1.0, polish: 1.0 },
      Large: { months: 7, cost: 250000, capacity: 3, price: 50, reach: 1.6, polish: 1.03 },
      AAA: { months: 11, cost: 1200000, capacity: 4, price: 60, reach: 2.4, polish: 1.06 },
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = DATA;
  else root.CT_DATA = DATA;
})(typeof window !== "undefined" ? window : globalThis);
