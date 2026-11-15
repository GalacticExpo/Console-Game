"""Text interface for Console Tycoon."""

from __future__ import annotations

import os
import re

from . import data
from .data import COMPONENTS, GAME_SIZES, GENRES, OFFICES, TOPICS
from .sim import (GameError, LICENSED_GAME_SHARE, OWN_GAME_SHARE, State, fmt_money,
                  fmt_num, new_game, stars)

SAVE_DIR = os.path.join(os.getcwd(), "saves")
WIDTH = 72


class Quit(Exception):
    pass


# --------------------------------------------------------------------------- io
def ask(prompt: str) -> str:
    try:
        return input(prompt).strip()
    except EOFError:
        raise Quit()


def pause() -> None:
    ask("\n(press Enter) ")


def rule(char: str = "-") -> None:
    print(char * WIDTH)


def title(text: str) -> None:
    print()
    rule("=")
    print(f" {text}")
    rule("=")


def ask_int(prompt: str, lo: int, hi: int, default: int | None = None) -> int | None:
    """Ask for a number. Blank returns the default (or None to go back)."""
    hint = f" [{default}]" if default is not None else ""
    while True:
        raw = ask(f"{prompt}{hint}: ").replace(",", "").replace("$", "")
        if raw == "":
            return default
        if raw.lower() in ("b", "back", "q"):
            return None
        try:
            n = int(raw)
        except ValueError:
            print("  Please type a number.")
            continue
        if lo <= n <= hi:
            return n
        print(f"  Please pick between {lo} and {hi}.")


def choose(prompt: str, options: list[str], default: int | None = None) -> int | None:
    """Show a numbered menu; return the chosen index, or None to go back."""
    for i, opt in enumerate(options, 1):
        print(f"  {i:>2}) {opt}")
    print("   b) Back")
    d = default + 1 if default is not None else None
    n = ask_int(prompt, 1, len(options), d)
    return None if n is None else n - 1


def confirm(prompt: str) -> bool:
    return ask(f"{prompt} (y/n): ").lower().startswith("y")


def show_news(lines: list[str]) -> None:
    for line in lines:
        print(f"  {line}")


# ----------------------------------------------------------------------- status
def console_line(s: State, c) -> str:
    if c.status == "dev":
        return f"{c.name}: in development, {c.dev_months_left} month(s) to launch"
    status = "on sale" if c.status == "active" else "discontinued"
    return (f"{c.name}: {status}, ${c.price}, {fmt_num(c.installed_base)} owners, "
            f"{fmt_num(c.last_sales)}/mo, power {s.tech(c):.0%} of market")


def status_screen(s: State) -> None:
    title(f"{s.company.upper()}  -  {s.date}")
    print(f" Money {fmt_money(s.money):>9}   Bills {fmt_money(s.monthly_expenses)}/mo   "
          f"Research points {s.rp:.0f} (+{s.rp_per_month:.1f}/mo)")
    print(f" Staff {s.staff}/{s.max_staff} ({s.free_staff} free)   Skill {s.skill:.1f}/10   "
          f"Reputation {s.reputation:.0f}/100   Fans {fmt_num(s.fans)}")
    mine = s.player_consoles()
    if mine:
        rule()
        for c in mine:
            if c.status != "retired":
                print(f" [HW] {console_line(s, c)}")
    dev = [g for g in s.games if g.status == "dev"]
    for g in dev:
        print(f" [SW] {g.title}: {g.size} {g.genre} for {g.platform}, "
              f"{g.months_left} month(s) left")
    selling = [g for g in s.games if g.status == "released" and g.last_sales]
    for g in sorted(selling, key=lambda g: -g.last_sales)[:3]:
        print(f" [$$] {g.title} ({g.score:.1f}) sold {fmt_num(g.last_sales)} last month")
    if s.news:
        rule()
        for line in s.news[-6:]:
            print(f" {line}")
    rule()


# ------------------------------------------------------------------------ time
def advance(s: State, months: int) -> None:
    print()
    for _ in range(months):
        money_before = s.money
        news = s.advance()
        delta = s.money - money_before
        sign = "+" if delta >= 0 else ""
        print(f"--- {s.date}: {fmt_money(s.money)} ({sign}{fmt_money(delta)}) ---")
        show_news(news)
        if s.over:
            break


# --------------------------------------------------------------------- console
def part_label(s: State, cat: str, tier: dict) -> str:
    bits = []
    if tier["power"]:
        bits.append(f"power {tier['power']}")
    if tier["appeal"]:
        bits.append(f"appeal +{tier['appeal']}")
    if "capacity" in tier:
        biggest = [k for k, v in GAME_SIZES.items() if v["capacity"] <= tier["capacity"]][-1]
        bits.append(f"fits {biggest} games")
    bits.append(f"${tier['unit_cost']}/unit")
    return f"{tier['name']:<18} ({', '.join(bits)}, from {tier['year']})"


def design_console(s: State) -> None:
    title("DESIGN A CONSOLE")
    if any(c.status == "dev" for c in s.player_consoles()):
        print(" Your hardware team is already building a console. Wait for it to launch.")
        return pause()
    print(" Pick a part for each slot. Research unlocks better parts.")
    print(f" Today's market expects about {s.expected_power():.0f} power.\n")
    parts = {}
    for cat in data.CATEGORIES:
        tiers = COMPONENTS[cat][: s.unlocked[cat] + 1]
        print(f" {cat}:")
        idx = choose(f" Choose {cat}", [part_label(s, cat, t) for t in tiers], default=len(tiers) - 1)
        if idx is None:
            return
        parts[cat] = idx
        print()
    proto = s.preview_console(parts)
    cost = s.console_dev_cost(parts)
    months = s.console_dev_months(parts)
    launch = s.month + months
    tech_now = s.tech(proto)
    tech_launch = s.tech(proto, launch)
    rule()
    print(f" Power {proto.power}  ({tech_now:.0%} of today's expectations, "
          f"~{tech_launch:.0%} at launch)")
    print(f" Appeal {proto.appeal}   Max game size: "
          f"{[k for k, v in GAME_SIZES.items() if v['capacity'] <= proto.capacity][-1]}")
    print(f" Build cost per unit ~${s.unit_cost(proto)} (falls as parts age)")
    print(f" Development: {fmt_money(cost)} and {months} months  (you have {fmt_money(s.money)})")
    fair = s.fair_price(proto)
    print(f" Buyers think a fair price is around ${fair}. You keep 75% of the price "
          "after retailers.")
    rule()
    if cost > s.money:
        print(" You can't afford this design yet.")
        return pause()
    name = ask(" Console name (blank to cancel): ")
    if not name:
        return
    price = ask_int(" Launch price in $", 1, 100_000, default=fair)
    if price is None:
        return
    if not confirm(f" Spend {fmt_money(cost)} to build the {name} at ${price}?"):
        return
    try:
        s.design_console(name, parts, price)
        print(f" Engineers are on it! The {name} launches in {months} months.")
    except GameError as e:
        print(f" {e}")
    pause()


def manage_consoles(s: State) -> None:
    while True:
        title("YOUR CONSOLES")
        mine = s.player_consoles()
        if not mine:
            print(" You haven't designed a console yet.")
            return pause()
        for c in mine:
            print(f" {console_line(s, c)}")
            parts = ", ".join(c.part(cat)["name"] for cat in data.CATEGORIES)
            print(f"     {parts}")
            if c.status != "dev":
                own = [g for g in s.games if g.platform == c.name and g.status == "released"]
                print(f"     Unit cost ${s.unit_cost(c)}  Fair price ${s.fair_price(c)}  "
                      f"Revenue {fmt_money(c.revenue)}  Profit {fmt_money(c.profit)}")
                print(f"     Your games: {len(own)}   Third-party games: {c.third_party_titles}")
        rule()
        act = choose(" Action", ["Change a price",
                                 f"Run an ad campaign ({fmt_money(s.marketing_cost())}, 3 months)",
                                 "Discontinue a console"])
        if act is None:
            return
        live = [c for c in mine if c.status != "retired"]
        if act == 2:
            live = [c for c in mine if c.status == "active"]
        if not live:
            print(" No consoles qualify.")
            continue
        idx = choose(" Which console", [c.name for c in live])
        if idx is None:
            continue
        c = live[idx]
        try:
            if act == 0:
                price = ask_int(f" New price for {c.name} (fair ${s.fair_price(c)})", 1, 100_000, c.price)
                if price is not None:
                    s.set_price(c.name, price)
            elif act == 1:
                s.run_marketing(c.name)
                print(" Billboards are going up!")
            elif act == 2 and confirm(f" Stop selling the {c.name} for good?"):
                s.discontinue(c.name)
        except GameError as e:
            print(f" {e}")
            pause()


# ------------------------------------------------------------------------ games
def focus_input(genre: str) -> dict | None:
    print(f"\n Split {data.FOCUS_POINTS} points of effort across the game "
          "(the last area gets what's left).")
    print(" Different genres reward different splits; read the reviews to learn them.")
    focus = {}
    left = data.FOCUS_POINTS
    areas = data.FOCUS_AREAS
    for i, area in enumerate(areas):
        if i == len(areas) - 1:
            focus[area] = left
            print(f"  {area}: {left}")
            break
        n = ask_int(f"  {area} (0-{left})", 0, left, default=min(left, 2 if i else 4))
        if n is None:
            return None
        focus[area] = n
        left -= n
    return focus


def make_game(s: State) -> None:
    title("MAKE A GAME")
    plats = s.platforms_for_games()
    if not plats:
        print(" There are no consoles to make games for.")
        return pause()
    print(f" Free staff: {s.free_staff}   Money: {fmt_money(s.money)}\n")
    print(" Platform:")
    labels = []
    for c in plats:
        owner = "YOURS" if c.is_player else c.owner
        cut = OWN_GAME_SHARE if c.is_player else LICENSED_GAME_SHARE
        state = "in dev" if c.status == "dev" else f"{fmt_num(c.installed_base)} owners"
        biggest = [k for k, v in GAME_SIZES.items() if v["capacity"] <= c.capacity][-1]
        labels.append(f"{c.name:<18} {owner:<20} {state:<15} max {biggest:<6} you keep {cut:.0%}")
    p = choose(" Make it for", labels)
    if p is None:
        return
    plat = plats[p]

    print("\n Size:")
    sizes = list(GAME_SIZES)
    labels = []
    for name in sizes:
        spec = GAME_SIZES[name]
        problems = []
        if spec["capacity"] > plat.capacity:
            problems.append("won't fit")
        if spec["staff"] > s.free_staff:
            problems.append("not enough staff")
        if spec["cost"] > s.money:
            problems.append("too expensive")
        note = f"  <- {', '.join(problems)}" if problems else ""
        labels.append(f"{name:<7} {fmt_money(spec['cost']):>7}, {spec['months']:>2} months, "
                      f"{spec['staff']:>2} staff, sells for ${spec['price']}{note}")
    sz = choose(" Size", labels)
    if sz is None:
        return
    size = sizes[sz]

    print("\n Genre:")
    genres = sorted(GENRES)
    gi = choose(" Genre", genres)
    if gi is None:
        return
    genre = genres[gi]

    print("\n Topic:")
    topics = sorted(TOPICS)
    for i in range(0, len(topics), 4):
        print("  " + "".join(f"{j + 1:>2}) {t:<14}" for j, t in enumerate(topics[i:i + 4], i)))
    ti = ask_int(" Topic", 1, len(topics))
    if ti is None:
        return
    topic = topics[ti - 1]

    focus = focus_input(genre)
    if focus is None:
        return
    name = ask(f"\n Title for your {size} {topic} {genre} game (blank to cancel): ")
    if not name:
        return
    try:
        g = s.start_game(name, genre, topic, size, plat.name, focus)
        print(f" Development started! {g.title} ships in about {g.months_left} months.")
    except GameError as e:
        print(f" {e}")
    pause()


def list_games(s: State) -> None:
    title("YOUR GAMES")
    if not s.games:
        print(" No games yet.")
        return pause()
    print(f" {'Title':<22}{'Type':<22}{'Platform':<16}{'Score':>9}{'Sold':>9}")
    rule()
    for g in sorted(s.games, key=lambda g: (g.status != "dev", -g.release_month)):
        kind = f"{g.size} {g.genre}"
        if g.status == "dev":
            score, sold = f"{g.months_left}mo", "-"
        else:
            score, sold = f"{g.score:.1f} {stars(g.score)}", fmt_num(g.units_sold)
        print(f" {g.title[:21]:<22}{kind[:21]:<22}{g.platform[:15]:<16}{score:>9}{sold:>9}")
    rule()
    released = [g for g in s.games if g.status == "released"]
    if released and confirm(" See the reviews for a game?"):
        idx = choose(" Which game", [g.title for g in released])
        if idx is not None:
            g = released[idx]
            print(f"\n {g.title}: {g.topic} {g.genre}, focus "
                  + ", ".join(f"{a} {g.focus[a]}" for a in data.FOCUS_AREAS))
            print(f" Reviews {' / '.join(map(str, g.reviews))}, revenue {fmt_money(g.revenue)}")
            for note in g.feedback:
                print(f"  - {note}")
            pause()


# --------------------------------------------------------------------- research
def research(s: State) -> None:
    while True:
        title("RESEARCH LAB")
        print(f" Research points: {s.rp:.0f}  (+{s.rp_per_month:.1f}/month; more staff = faster)\n")
        options, cats = [], []
        for cat in data.CATEGORIES:
            have = COMPONENTS[cat][s.unlocked[cat]]["name"]
            nxt = s.next_tier(cat)
            if nxt is None:
                label = f"{cat:<11} have {have:<18} (fully researched)"
            else:
                when = "" if s.year >= nxt["year"] else f", not until {nxt['year']}"
                label = f"{cat:<11} have {have:<18} next: {nxt['name']} ({nxt['rp']} RP{when})"
            options.append(label)
            cats.append(cat)
        idx = choose(" Research", options)
        if idx is None:
            return
        try:
            tier = s.research(cats[idx])
            print(f" Unlocked {tier['name']}!")
        except GameError as e:
            print(f" {e}")
        pause()


# ------------------------------------------------------------------------ staff
def staff(s: State) -> None:
    while True:
        title("STAFF & OFFICE")
        name, cap, rent, _ = s.office_info
        print(f" Office: {name} (room for {cap}, rent {fmt_money(rent)}/mo)")
        print(f" Staff: {s.staff} ({s.free_staff} free)  salary {fmt_money(s.salary)}/mo each")
        print(f" Team skill: {s.skill:.1f}/10 (grows as you ship games)")
        opts = [f"Hire staff ({fmt_money(s.hire_cost())} each to recruit)", "Let staff go"]
        if s.office + 1 < len(OFFICES):
            nname, ncap, nrent, ncost = OFFICES[s.office + 1]
            opts.append(f"Move to a {nname} (room for {ncap}, rent {fmt_money(nrent)}/mo) "
                        f"for {fmt_money(ncost)}")
        idx = choose(" Action", opts)
        if idx is None:
            return
        try:
            if idx == 0:
                n = ask_int(" How many", 1, max(1, s.max_staff - s.staff), 1)
                if n:
                    s.hire(n)
            elif idx == 1:
                n = ask_int(" How many", 1, max(1, s.staff), 1)
                if n:
                    s.fire(n)
            elif idx == 2 and confirm(" Move offices?"):
                s.upgrade_office()
        except GameError as e:
            print(f" {e}")
            pause()


# ----------------------------------------------------------------------- market
def market(s: State) -> None:
    title(f"MARKET REPORT - {s.date}")
    print(f" About {fmt_num(s.market_size())} people shop for a console each month.")
    print(f" Today's games expect about {s.expected_power():.0f} power.\n")
    shares = s.market_shares()
    print(f" {'Console':<18}{'Maker':<20}{'Power':>7}{'Price':>7}{'Last mo':>9}{'Share':>7}{'Owners':>9}")
    rule()
    for c in sorted(s.active_consoles(), key=lambda c: -shares.get(c.name, 0)):
        maker = "YOU" if c.is_player else c.owner
        print(f" {c.name[:17]:<18}{maker[:19]:<20}{s.tech(c):>7.0%}{'$' + str(c.price):>7}"
              f"{fmt_num(c.last_sales):>9}{shares[c.name]:>7.0%}{fmt_num(c.installed_base):>9}")
    rule()
    print(" Share is of shoppers; the rest decide not to buy anything.")
    pause()


# ------------------------------------------------------------------------- save
def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "save"


def save(s: State) -> None:
    os.makedirs(SAVE_DIR, exist_ok=True)
    path = os.path.join(SAVE_DIR, slug(s.company) + ".json")
    s.save(path)
    print(f" Saved to {path}")


def load_menu() -> State | None:
    if not os.path.isdir(SAVE_DIR):
        print(" No saves found.")
        return None
    files = sorted(f for f in os.listdir(SAVE_DIR) if f.endswith(".json"))
    if not files:
        print(" No saves found.")
        return None
    idx = choose(" Load which save", files)
    if idx is None:
        return None
    try:
        return State.load(os.path.join(SAVE_DIR, files[idx]))
    except (OSError, ValueError, TypeError, KeyError) as e:
        print(f" Couldn't load that save: {e}")
        return None


# ------------------------------------------------------------------------- main
def game_over(s: State) -> None:
    title("GAME OVER" if s.over_reason == "bankrupt" else "THE END")
    mine = s.player_consoles()
    released = [g for g in s.games if g.status == "released"]
    print(f" {s.company}, {s.date}")
    print(f" Final bank balance: {fmt_money(s.money)}")
    print(f" Consoles built: {len([c for c in mine if c.status != 'dev'])}, "
          f"total sold: {fmt_num(sum(c.installed_base for c in mine))}")
    print(f" Games released: {len(released)}, copies sold: "
          f"{fmt_num(sum(g.units_sold for g in released))}")
    if mine:
        best = max(mine, key=lambda c: c.installed_base)
        print(f" Best-selling console: {best.name} ({fmt_num(best.installed_base)})")
    if released:
        best = max(released, key=lambda g: (g.score, g.units_sold))
        print(f" Best-reviewed game: {best.title} ({best.score:.1f})")
    print(f"\n SCORE: {s.final_score():,}")
    rule("=")


def intro() -> State | None:
    title("CONSOLE TYCOON")
    print(" It's 1985. You have a garage, three friends and $150K.")
    print(" Design a games console, make games for it, and outlast the giants")
    print(f" until {data.END_YEAR}. Don't run out of money!\n")
    while True:
        idx = choose(" Start", ["New company", "Load a saved game", "How to play"])
        if idx is None:
            return None
        if idx == 0:
            name = ask(" Company name: ") or "Garage Games"
            return new_game(name)
        if idx == 1:
            s = load_menu()
            if s:
                return s
        if idx == 2:
            help_screen()


def help_screen() -> None:
    title("HOW TO PLAY")
    print("""\
 * Design a console from parts. More power and appeal sell more units, but
   cost more to build. Price it near what buyers think is fair.
 * Consoles take months to build. You can start a game for it while it's in
   development; the game ships when the console launches.
 * Make games for your own console (you keep 70% of sales) or license games
   for a rival's console (you keep 45%), which helps before your own
   hardware exists. Your games make your console more attractive.
 * Pick a genre and topic, then split 10 points between Gameplay, Graphics,
   Story and Audio. Each genre has a hidden ideal split; the critics' notes
   tell you how close you got. Some topics suit some genres much better.
 * Popular consoles attract third-party games, which pay you royalties.
 * Hardware gets old fast! Research new parts and launch successors.
 * Hire staff to make bigger games and research faster. Move offices to grow.
 * Three months in a row in debt and the company goes bankrupt.""")
    pause()


def main_loop(s: State) -> None:
    while not s.over:
        status_screen(s)
        opts = ["Next month", "Skip ahead several months", "Design a console", "Make a game",
                "Your consoles", "Your games", "Research", "Staff & office",
                "Market report", "Save game", "How to play"]
        for i, opt in enumerate(opts, 1):
            end = "\n" if i % 2 == 0 else ""
            print(f"  {i:>2}) {opt:<32}", end=end)
        print("\n   q) Save & quit")
        raw = ask(" > ").lower()
        if raw in ("q", "quit", "exit"):
            save(s)
            raise Quit()
        actions = {
            "1": lambda: advance(s, 1),
            "": lambda: advance(s, 1),
            "2": lambda: (lambda n: n and advance(s, n))(ask_int(" How many months", 1, 24, 3)),
            "3": lambda: design_console(s),
            "4": lambda: make_game(s),
            "5": lambda: manage_consoles(s),
            "6": lambda: list_games(s),
            "7": lambda: research(s),
            "8": lambda: staff(s),
            "9": lambda: market(s),
            "10": lambda: save(s),
            "11": help_screen,
        }
        action = actions.get(raw)
        if action is None:
            print(" Pick a number from the menu.")
            continue
        action()
    game_over(s)


def run() -> None:
    try:
        s = intro()
        if s is None:
            return
        main_loop(s)
    except (Quit, KeyboardInterrupt):
        print("\n Thanks for playing!")
