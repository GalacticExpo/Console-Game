#!/usr/bin/env node
// Builds index.html: one self-contained page with the CSS and JS from web/ inlined.
// Usage: node tools/build.js [--fragment PATH]
//   --fragment also writes the page without the <html>/<head> wrapper.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, "web", name), "utf8");
const scriptSafe = (text) => text.replace(/<\/script/gi, "<\\/script");

const fragment = read("shell.html")
  .replace("/*STYLE*/", () => read("style.css"))
  .replace("/*DATA*/", () => scriptSafe(read("data.js")))
  .replace("/*SIM*/", () => scriptSafe(read("sim.js")))
  .replace("/*MODELS*/", () => scriptSafe(read("models.js")))
  .replace("/*UI*/", () => scriptSafe(read("ui.js")));

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#24262c">
</head>
<body>
${fragment}
</body>
</html>
`;
fs.writeFileSync(path.join(root, "index.html"), page);
console.log("wrote index.html");

const i = process.argv.indexOf("--fragment");
if (i > 0) {
  fs.writeFileSync(process.argv[i + 1], fragment);
  console.log(`wrote ${process.argv[i + 1]}`);
}
