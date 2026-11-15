#!/usr/bin/env python3
"""Build the phone/browser version of Console Tycoon.

Writes:
  web/data.json   game data exported from console_tycoon/data.py
  web/index.html  one self-contained page (data, CSS and JS inlined)

Usage: python3 tools/build_web.py [--fragment PATH]
  --fragment also writes the page body without the <html>/<head> wrapper.
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from console_tycoon import data  # noqa: E402

WEB = os.path.join(ROOT, "web")


def export_data() -> dict:
    return {
        "START_YEAR": data.START_YEAR,
        "END_YEAR": data.END_YEAR,
        "COMPONENTS": data.COMPONENTS,
        "CATEGORIES": data.CATEGORIES,
        "POWER_CATEGORIES": list(data.POWER_CATEGORIES),
        "FOCUS_AREAS": list(data.FOCUS_AREAS),
        "FOCUS_POINTS": data.FOCUS_POINTS,
        "GENRES": data.GENRES,
        "TOPICS": {k: [list(good), list(bad)] for k, (good, bad) in data.TOPICS.items()},
        "GAME_SIZES": data.GAME_SIZES,
        "OFFICES": [list(o) for o in data.OFFICES],
        "RIVAL_COMPANIES": data.RIVAL_COMPANIES,
        "CONSOLE_PREFIXES": data.CONSOLE_PREFIXES,
        "CONSOLE_SUFFIXES": data.CONSOLE_SUFFIXES,
        "MONTH_NAMES": data.MONTH_NAMES,
    }


def read(name: str) -> str:
    with open(os.path.join(WEB, name), encoding="utf-8") as f:
        return f.read()


def script_safe(text: str) -> str:
    return text.replace("</script", "<\\/script")


def build_fragment(game_data: dict) -> str:
    shell = read("shell.html")
    return (shell
            .replace("/*STYLE*/", read("style.css"))
            .replace("/*DATA*/", "window.CT_DATA = " + json.dumps(game_data, separators=(",", ":")) + ";")
            .replace("/*SIM*/", script_safe(read("sim.js")))
            .replace("/*UI*/", script_safe(read("ui.js"))))


def main() -> None:
    game_data = export_data()
    with open(os.path.join(WEB, "data.json"), "w", encoding="utf-8") as f:
        json.dump(game_data, f, indent=1)
        f.write("\n")
    fragment = build_fragment(game_data)
    page = ("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
            "<meta name=\"theme-color\" content=\"#24262c\">\n"
            "</head>\n<body>\n" + fragment + "\n</body>\n</html>\n")
    with open(os.path.join(WEB, "index.html"), "w", encoding="utf-8") as f:
        f.write(page)
    print("wrote web/data.json and web/index.html")
    if "--fragment" in sys.argv:
        path = sys.argv[sys.argv.index("--fragment") + 1]
        with open(path, "w", encoding="utf-8") as f:
            f.write(fragment)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
