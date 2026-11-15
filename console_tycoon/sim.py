"""Core simulation for Console Tycoon. Contains no input/output code."""

from __future__ import annotations

import json
import math
import random
from dataclasses import asdict, dataclass, field

from . import data
from .data import COMPONENTS, GAME_SIZES, GENRES, OFFICES, TOPICS

PLAYER = "player"
STARTING_MONEY = 150_000
RETAIL_SHARE = 0.75          # share of a console's price that reaches the maker
OWN_GAME_SHARE = 0.70        # share of a game's price you keep on your own console
LICENSED_GAME_SHARE = 0.45   # share you keep on a rival's console
THIRD_PARTY_ROYALTY = 6      # $ per third-party game sold on your console
OUTSIDE_OPTION = 4.0         # weight of "buy nothing this month"
BANKRUPT_AFTER = 3           # consecutive months in debt before game over


class GameError(Exception):
    """Raised when the player asks for something the rules don't allow."""


@dataclass
class Console:
    name: str
    owner: str
    parts: dict
    price: int
    status: str = "dev"            # dev, active, retired
    dev_months_left: int = 0
    design_month: int = 0
    launch_month: int = -1
    installed_base: int = 0
    third_party_titles: int = 0
    revenue: int = 0
    profit: int = 0
    last_sales: int = 0
    hype_months: int = 0

    def part(self, category: str) -> dict:
        return COMPONENTS[category][self.parts[category]]

    @property
    def is_player(self) -> bool:
        return self.owner == PLAYER

    @property
    def power(self) -> int:
        return sum(self.part(c)["power"] for c in data.POWER_CATEGORIES)

    @property
    def appeal(self) -> int:
        return sum(self.part(c)["appeal"] for c in data.CATEGORIES)

    @property
    def capacity(self) -> int:
        return self.part("Storage")["capacity"]

    @property
    def generation(self) -> int:
        return max(self.parts.values())


@dataclass
class Game:
    title: str
    genre: str
    topic: str
    size: str
    platform: str
    focus: dict
    staff: int
    status: str = "dev"            # dev, released
    months_left: int = 0
    start_month: int = 0
    release_month: int = -1
    score: float = 0.0
    reviews: list = field(default_factory=list)
    feedback: list = field(default_factory=list)
    units_sold: int = 0
    revenue: int = 0
    last_sales: int = 0


@dataclass
class State:
    company: str
    seed: int = 0
    money: int = STARTING_MONEY
    month: int = 0
    staff: int = 3
    office: int = 0
    skill: float = 3.0
    reputation: float = 20.0
    fans: int = 0
    rp: float = 0.0
    unlocked: dict = field(default_factory=lambda: {c: 0 for c in data.CATEGORIES})
    consoles: list = field(default_factory=list)
    games: list = field(default_factory=list)
    effects: dict = field(default_factory=dict)   # name -> months remaining
    news: list = field(default_factory=list)
    debt_months: int = 0
    over: bool = False
    over_reason: str = ""
    history: list = field(default_factory=list)   # [month, money] snapshots

    def __post_init__(self):
        self.rng = random.Random(self.seed * 1000 + self.month)

    # ----------------------------------------------------------- calendar
    @property
    def year(self) -> int:
        return data.START_YEAR + self.month // 12

    @property
    def years_elapsed(self) -> float:
        return self.month / 12

    @property
    def date(self) -> str:
        return f"{data.MONTH_NAMES[self.month % 12]} {self.year}"

    @property
    def final_month(self) -> int:
        return (data.END_YEAR - data.START_YEAR) * 12

    # ----------------------------------------------------------- economy
    @property
    def salary(self) -> int:
        return int(2_000 * 1.035 ** self.years_elapsed)

    @property
    def office_info(self) -> tuple:
        return OFFICES[self.office]

    @property
    def max_staff(self) -> int:
        return self.office_info[1]

    @property
    def monthly_expenses(self) -> int:
        return self.staff * self.salary + self.office_info[2]

    @property
    def busy_staff(self) -> int:
        return sum(g.staff for g in self.games if g.status == "dev")

    @property
    def free_staff(self) -> int:
        return self.staff - self.busy_staff

    @property
    def rp_per_month(self) -> float:
        return self.staff * (0.5 + self.skill / 10)

    def expected_power(self, month: int | None = None) -> float:
        y = (self.month if month is None else month) / 12
        # Fast progress through the 80s and 90s, slowing down after 2007.
        return 9 * 1.27 ** min(y, 22) * 1.12 ** max(0.0, y - 22)

    def tech(self, console: Console, month: int | None = None) -> float:
        """Performance relative to what the market expects right now (1.0 = on par)."""
        return console.power / self.expected_power(month)

    def unit_cost(self, console: Console) -> int:
        total = 0.0
        for cat in data.CATEGORIES:
            part = console.part(cat)
            age = max(0.0, self.year - part["year"])
            total += part["unit_cost"] * max(0.4, 1 - 0.06 * age)
        if "shortage" in self.effects:
            total *= 1.15
        return round(total)

    def fair_price(self, console: Console) -> int:
        base = 150 + 10 * self.years_elapsed
        return round(base * min(self.tech(console), 2.5) ** 0.5)

    # ----------------------------------------------------------- helpers
    def say(self, text: str) -> None:
        self.news.append(f"[{self.date}] {text}")

    def console(self, name: str) -> Console:
        for c in self.consoles:
            if c.name.lower() == name.lower():
                return c
        raise GameError(f"No console named {name!r}.")

    def player_consoles(self) -> list:
        return [c for c in self.consoles if c.is_player]

    def active_consoles(self) -> list:
        return [c for c in self.consoles if c.status == "active"]

    def platforms_for_games(self) -> list:
        """Consoles a game can be made for: anything launched or being built by you."""
        out = []
        for c in self.consoles:
            if c.status == "active" or (c.is_player and c.status == "dev"):
                out.append(c)
            elif c.is_player and c.status == "retired" and c.installed_base > 0:
                out.append(c)
        return out

    def _name_taken(self, name: str) -> bool:
        names = {c.name.lower() for c in self.consoles} | {g.title.lower() for g in self.games}
        return name.lower() in names

    def _spend(self, amount: int) -> None:
        if amount > self.money:
            raise GameError(f"Not enough money: need ${amount:,}, have ${self.money:,}.")
        self.money -= amount

    # ----------------------------------------------------------- consoles
    def console_dev_cost(self, parts: dict) -> int:
        unit = sum(COMPONENTS[c][parts[c]]["unit_cost"] for c in data.CATEGORIES)
        return int(30_000 * 1.6 ** max(parts.values()) + unit * 500)

    @staticmethod
    def console_dev_months(parts: dict) -> int:
        return 3 + max(parts.values())

    def preview_console(self, parts: dict, name: str = "Prototype") -> Console:
        return Console(name=name, owner=PLAYER, parts=dict(parts), price=0)

    def design_console(self, name: str, parts: dict, price: int) -> Console:
        name = name.strip()
        if not name:
            raise GameError("Your console needs a name.")
        if self._name_taken(name):
            raise GameError(f"The name {name!r} is already in use.")
        for cat in data.CATEGORIES:
            if cat not in parts:
                raise GameError(f"Missing a {cat}.")
            if not 0 <= parts[cat] <= self.unlocked[cat]:
                raise GameError(f"You haven't researched that {cat} yet.")
        if price <= 0:
            raise GameError("Price must be positive.")
        if any(c.status == "dev" for c in self.player_consoles()):
            raise GameError("Your hardware team is already building a console.")
        cost = self.console_dev_cost(parts)
        self._spend(cost)
        c = Console(name=name, owner=PLAYER, parts=dict(parts), price=price,
                    dev_months_left=self.console_dev_months(parts),
                    design_month=self.month)
        self.consoles.append(c)
        self.say(f"Hardware team began building the {name} (${cost:,}).")
        return c

    def set_price(self, name: str, price: int) -> None:
        c = self.console(name)
        if not c.is_player:
            raise GameError("That's not your console.")
        if price <= 0:
            raise GameError("Price must be positive.")
        c.price = price

    def discontinue(self, name: str) -> None:
        c = self.console(name)
        if not c.is_player or c.status != "active":
            raise GameError("You can only discontinue your own consoles on sale.")
        c.status = "retired"
        self.say(f"{c.name} discontinued after selling {c.installed_base:,} units.")

    def marketing_cost(self) -> int:
        return int(20_000 * 1.08 ** self.years_elapsed)

    def run_marketing(self, name: str) -> None:
        c = self.console(name)
        if not c.is_player or c.status == "retired":
            raise GameError("You can only promote your own consoles.")
        self._spend(self.marketing_cost())
        c.hype_months += 3
        self.say(f"Ad campaign for the {c.name} is running for 3 months.")

    # ----------------------------------------------------------- games
    def start_game(self, title: str, genre: str, topic: str, size: str,
                   platform: str, focus: dict) -> Game:
        title = title.strip()
        if not title:
            raise GameError("Your game needs a title.")
        if self._name_taken(title):
            raise GameError(f"The name {title!r} is already in use.")
        if genre not in GENRES or topic not in TOPICS or size not in GAME_SIZES:
            raise GameError("Unknown genre, topic or size.")
        if sorted(focus) != sorted(data.FOCUS_AREAS) or sum(focus.values()) != data.FOCUS_POINTS \
                or min(focus.values()) < 0:
            raise GameError(f"Focus must split exactly {data.FOCUS_POINTS} points.")
        plat = self.console(platform)
        if plat not in self.platforms_for_games():
            raise GameError(f"You can't make games for the {plat.name}.")
        spec = GAME_SIZES[size]
        if plat.capacity < spec["capacity"]:
            raise GameError(f"A {size} game won't fit on the {plat.name}'s {plat.part('Storage')['name']}.")
        if spec["staff"] > self.free_staff:
            raise GameError(f"A {size} game needs {spec['staff']} free staff; you have {self.free_staff}.")
        self._spend(spec["cost"])
        g = Game(title=title, genre=genre, topic=topic, size=size, platform=plat.name,
                 focus=dict(focus), staff=spec["staff"], months_left=spec["months"],
                 start_month=self.month)
        self.games.append(g)
        self.say(f"Started work on {title} ({size} {topic} {genre}) for the {plat.name}.")
        return g

    def combo_rating(self, genre: str, topic: str) -> str:
        good, bad = TOPICS[topic]
        if genre in good:
            return "great"
        if genre in bad:
            return "poor"
        return "okay"

    def focus_match(self, genre: str, focus: dict) -> float:
        ideal = GENRES[genre]
        dist = sum(abs(focus[a] - ideal[a]) for a in data.FOCUS_AREAS)
        return 1 - dist / (2 * data.FOCUS_POINTS)

    def _review_game(self, g: Game) -> None:
        plat = self.console(g.platform)
        match = self.focus_match(g.genre, g.focus)
        q = 1.5 + 6.5 * match ** 1.5 + 2 * self.skill / 10
        q *= {"great": 1.12, "okay": 1.0, "poor": 0.75}[self.combo_rating(g.genre, g.topic)]
        tf = min(1.5, max(0.4, self.tech(plat)))
        q *= tf ** (0.05 * g.focus["Graphics"])
        q *= GAME_SIZES[g.size]["polish"]
        released = [x for x in self.games if x.status == "released"]
        if released:
            last = max(released, key=lambda x: x.release_month)
            if last.genre == g.genre and last.topic == g.topic:
                q *= 0.85
        q += self.rng.gauss(0, 0.5)
        g.reviews = [int(min(10, max(1, round(q + self.rng.gauss(0, 0.6))))) for _ in range(4)]
        g.score = sum(g.reviews) / len(g.reviews)
        g.feedback = self.critique(g, tf)

    def critique(self, g: Game, tech_factor: float) -> list:
        """What the critics said: hints about the hidden quality rules."""
        notes = []
        ideal = GENRES[g.genre]
        diffs = {a: g.focus[a] - ideal[a] for a in data.FOCUS_AREAS}
        worst = max(diffs, key=lambda a: abs(diffs[a]))
        if abs(diffs[worst]) <= 1 and all(abs(d) <= 1 for d in diffs.values()):
            notes.append(f"Critics felt the focus was just right for a {g.genre} game.")
        elif diffs[worst] < 0:
            notes.append(f"Critics wanted more {worst} from a {g.genre} game.")
        else:
            notes.append(f"Critics thought too much effort went into {worst} for a {g.genre} game.")
        rating = self.combo_rating(g.genre, g.topic)
        if rating == "great":
            notes.append(f"{g.topic} and {g.genre} are a fantastic match!")
        elif rating == "poor":
            notes.append(f"Players found {g.topic} a strange theme for a {g.genre} game.")
        if tech_factor < 0.7 and g.focus["Graphics"] >= 3:
            notes.append("The aging hardware held the graphics back.")
        return notes

    def _release_game(self, g: Game) -> None:
        plat = self.console(g.platform)
        if plat.status == "dev":
            g.months_left = 1   # hold until the console launches
            return
        self._review_game(g)
        g.status = "released"
        g.release_month = self.month
        # Experience comes quickly at first, then slowly.
        self.skill = min(10.0, self.skill + GAME_SIZES[g.size]["xp"] * (10.5 - self.skill) / 7)
        # Reputation drifts toward the quality of what you ship.
        weight = 0.08 + 0.04 * list(GAME_SIZES).index(g.size)
        self.reputation += (g.score * 10 - self.reputation) * weight
        self.say(f"{g.title} released on the {plat.name}! Reviews: "
                 f"{' / '.join(str(r) for r in g.reviews)} (avg {g.score:.1f})")
        for note in g.feedback:
            self.say(f"  - {note}")

    # ----------------------------------------------------------- research
    def next_tier(self, category: str) -> dict | None:
        idx = self.unlocked[category] + 1
        tiers = COMPONENTS[category]
        return tiers[idx] if idx < len(tiers) else None

    def research(self, category: str) -> dict:
        tier = self.next_tier(category)
        if tier is None:
            raise GameError(f"No more {category} upgrades exist.")
        if self.year < tier["year"]:
            raise GameError(f"{tier['name']} can't be researched until {tier['year']}.")
        if self.rp < tier["rp"]:
            raise GameError(f"Need {tier['rp']} research points; you have {self.rp:.0f}.")
        self.rp -= tier["rp"]
        self.unlocked[category] += 1
        self.say(f"Research complete: {tier['name']} ({category}).")
        return tier

    # ----------------------------------------------------------- staff
    def hire_cost(self) -> int:
        return self.salary * 2

    def hire(self, n: int) -> None:
        if n <= 0:
            raise GameError("Hire at least one person.")
        if self.staff + n > self.max_staff:
            raise GameError(f"Your {self.office_info[0]} only fits {self.max_staff} staff.")
        self._spend(self.hire_cost() * n)
        # New hires are a little less experienced than the existing team.
        self.skill = (self.skill * self.staff + max(2.0, self.skill - 1) * n) / (self.staff + n)
        self.staff += n

    def fire(self, n: int) -> None:
        if n <= 0:
            raise GameError("Let go of at least one person.")
        if n > self.free_staff:
            raise GameError(f"Only {self.free_staff} staff aren't working on a game.")
        if self.staff - n < 1:
            raise GameError("You need at least one employee (yourself!).")
        self.staff -= n

    def upgrade_office(self) -> None:
        if self.office + 1 >= len(OFFICES):
            raise GameError("You already have the biggest office.")
        cost = OFFICES[self.office + 1][3]
        self._spend(cost)
        self.office += 1
        self.say(f"Moved into a {self.office_info[0]}!")

    # ----------------------------------------------------------- market
    def attractiveness(self, c: Console) -> float:
        a = min(self.tech(c), 2.5) ** 0.9
        a *= 1 + c.appeal / 25
        price = c.price if c.is_player else self.fair_price(c) * 0.95
        a *= min(4.0, max(0.05, (self.fair_price(c) / max(1, price)) ** 2))
        age = self.month - c.launch_month
        if c.is_player:
            a *= self.library_factor(c)
            a *= 0.6 + self.reputation / 100
            a *= 1 + min(0.5, self.fans / 2_000_000)
            if c.hype_months > 0:
                a *= 1.5
            if "retail_push" in self.effects:
                a *= 1.3
        else:
            a *= 0.6 + min(1.4, age / 20)
        if age < 3:
            a *= 1.3
        return a

    def library_factor(self, c: Console) -> float:
        """How much a console's game library helps it sell. Hit exclusives matter most."""
        recent = [g for g in self.games if g.status == "released" and g.platform == c.name
                  and self.month - g.release_month <= 36]
        impact = sorted((max(0.0, g.score - 6) ** 1.5 * GAME_SIZES[g.size]["reach"]
                         for g in recent), reverse=True)
        hits = sum(impact[:5])          # only your best few titles move hardware
        return (0.5 + min(0.8, len(recent) * 0.1 + c.third_party_titles * 0.04)
                + min(2.5, hits / 12))

    def market_size(self) -> int:
        return int(8_000 * 1.13 ** self.years_elapsed)

    def market_shares(self) -> dict:
        active = self.active_consoles()
        weights = {c.name: self.attractiveness(c) for c in active}
        total = sum(weights.values()) + OUTSIDE_OPTION
        return {name: w / total for name, w in weights.items()}

    # ----------------------------------------------------------- rivals
    def _rival_name(self) -> str:
        for _ in range(100):
            name = f"{self.rng.choice(data.CONSOLE_PREFIXES)} {self.rng.choice(data.CONSOLE_SUFFIXES)}"
            if self.rng.random() < 0.3:
                name += f" {self.rng.randint(2, 9)}"
            if not self._name_taken(name):
                return name
        return f"Console {len(self.consoles) + 1}"

    def _spawn_rival(self, launch_age: int = 0) -> Console:
        parts = {}
        for cat in data.CATEGORIES:
            best = max(i for i, t in enumerate(COMPONENTS[cat]) if t["year"] <= self.year)
            parts[cat] = max(0, best - (1 if self.rng.random() < 0.3 else 0))
        owners_busy = {c.owner for c in self.active_consoles()}
        owners = [o for o in data.RIVAL_COMPANIES if o not in owners_busy] or data.RIVAL_COMPANIES
        c = Console(name=self._rival_name(), owner=self.rng.choice(owners), parts=parts, price=0,
                    status="active", launch_month=self.month - launch_age)
        c.price = round(self.fair_price(c) * 0.95)
        c.installed_base = launch_age * 1_500
        self.consoles.append(c)
        return c

    def _update_rivals(self) -> None:
        rivals = [c for c in self.active_consoles() if not c.is_player]
        for c in rivals:
            if self.tech(c) < 0.3 or self.month - c.launch_month > 96:
                c.status = "retired"
                self.say(f"{c.owner} discontinued the {c.name}.")
        rivals = [c for c in self.active_consoles() if not c.is_player]
        newest = max((c.launch_month for c in rivals), default=-999)
        want_new = len(rivals) < 2 or (len(rivals) < 4 and self.month - newest > 30
                                        and self.rng.random() < 0.08)
        if want_new:
            c = self._spawn_rival()
            self.say(f"{c.owner} launched the {c.name} at ${c.price}!")
        for c in self.active_consoles():
            if not c.is_player:
                c.price = round(self.fair_price(c) * 0.95)

    def game_weight(self, g: Game) -> float:
        """How much of its platform's game spending a released title captures."""
        age = self.month - g.release_month
        if age > 48:
            return 0.0
        return 2.0 ** (g.score - 5) * GAME_SIZES[g.size]["reach"] * 0.8 ** age

    def background_weight(self, c: Console) -> float:
        """Weight of all the games on a console that you didn't make."""
        if c.is_player:
            return 1 + min(15.0, c.third_party_titles * 0.3)
        return 4 + min(60, max(0, self.month - c.launch_month)) / 5

    def _software_sales(self) -> int:
        """Each console's owners spend on games; titles split that demand."""
        income = 0
        fan_boost = 1 + min(0.5, self.fans / 1_000_000)
        for g in self.games:
            g.last_sales = 0
        for c in self.consoles:
            if c.status == "dev" or c.installed_base == 0:
                continue
            mine = [g for g in self.games if g.status == "released" and g.platform == c.name]
            weights = [self.game_weight(g) * fan_boost for g in mine]
            bg = self.background_weight(c)
            total = sum(weights) + bg
            # Owners buy more when there's a lot worth buying.
            demand = c.installed_base * 0.08 * total / (total + 5)
            if c.status != "active":
                demand *= 0.4
            share = OWN_GAME_SHARE if c.is_player else LICENSED_GAME_SHARE
            for g, w in zip(mine, weights):
                copies = int(demand * w / total)
                if copies < 20:
                    continue
                rev = int(copies * GAME_SIZES[g.size]["price"] * share)
                g.last_sales = copies
                g.units_sold += copies
                g.revenue += rev
                income += rev
                if g.score >= 7:
                    self.fans += int(copies * 0.1)
            if c.is_player and c.third_party_titles:
                royalty = int(demand * bg / total) * THIRD_PARTY_ROYALTY
                c.revenue += royalty
                c.profit += royalty
                income += royalty
        return income

    # ----------------------------------------------------------- events
    def _random_event(self) -> None:
        if self.rng.random() > 0.08:
            return
        mine_active = [c for c in self.player_consoles() if c.status == "active"]
        roll = self.rng.randrange(6)
        if roll == 0 and mine_active:
            self.effects["retail_push"] = 1
            self.say("EVENT: A big retail chain is featuring your hardware this month! (+30% appeal)")
        elif roll == 1 and mine_active:
            self.effects["shortage"] = 3
            self.say("EVENT: Chip shortage! Manufacturing costs +15% for 3 months.")
        elif roll == 2:
            self.reputation = min(100.0, self.reputation + 5)
            self.say("EVENT: A gaming magazine profiles your company. Reputation +5.")
        elif roll == 3:
            gained = int(5_000 + self.fans * 0.05)
            self.fans += gained
            self.say(f"EVENT: A fan video goes viral. +{gained:,} fans.")
        elif roll == 4:
            amount = int(10_000 * 1.05 ** self.years_elapsed)
            self.money += amount
            self.say(f"EVENT: Government tech grant awarded: +${amount:,}.")
        elif roll == 5 and self.money > 50_000:
            amount = min(int(self.money * 0.05), 250_000)
            self.money -= amount
            self.say(f"EVENT: Patent troll lawsuit settled for ${amount:,}.")

    # ----------------------------------------------------------- the clock
    def advance(self) -> list:
        """Simulate one month. Returns the news generated this month."""
        if self.over:
            return []
        start = len(self.news)
        self.month += 1
        self.rng.seed(self.seed * 1000 + self.month)
        income = 0

        self.rp += self.rp_per_month

        # Hardware development
        for c in self.player_consoles():
            if c.status == "dev":
                c.dev_months_left -= 1
                if c.dev_months_left <= 0:
                    c.status = "active"
                    c.launch_month = self.month
                    self.say(f"The {c.name} is in stores! Launch price ${c.price}.")

        # Game development
        for g in self.games:
            if g.status == "dev":
                g.months_left -= 1
                if g.months_left <= 0:
                    self._release_game(g)

        self._update_rivals()

        # Console sales
        buyers = self.market_size()
        for name, share in self.market_shares().items():
            c = self.console(name)
            units = int(buyers * share * self.rng.uniform(0.9, 1.1))
            c.last_sales = units
            c.installed_base += units
            if c.is_player:
                rev = int(units * c.price * RETAIL_SHARE)
                profit = rev - units * self.unit_cost(c)
                c.revenue += rev
                c.profit += profit
                income += profit
        for c in self.consoles:
            if c.status != "active":
                c.last_sales = 0
            if c.hype_months > 0:
                c.hype_months -= 1

        # Third-party publishers support popular player consoles
        for c in self.player_consoles():
            if c.status == "active":
                expected = c.installed_base / 150_000
                c.third_party_titles += sum(1 for _ in range(int(expected) + 1)
                                            if self.rng.random() < min(1.0, expected))

        income += self._software_sales()

        # Bills
        self.money += income - self.monthly_expenses

        for k in list(self.effects):
            self.effects[k] -= 1
            if self.effects[k] <= 0:
                del self.effects[k]
        self._random_event()

        self.history.append([self.month, self.money])
        if self.money < 0:
            self.debt_months += 1
            if self.debt_months >= BANKRUPT_AFTER:
                self.over = True
                self.over_reason = "bankrupt"
                self.say("Your creditors have closed the company. GAME OVER.")
            else:
                self.say(f"WARNING: You are in debt! Bankruptcy in "
                         f"{BANKRUPT_AFTER - self.debt_months} month(s) if this continues.")
        else:
            self.debt_months = 0
        if not self.over and self.month >= self.final_month:
            self.over = True
            self.over_reason = "retired"
            self.say("Thirty years in the console business. Time to retire!")
        self.news = self.news[-200:]
        return self.news[start:] if start < len(self.news) else []

    # ----------------------------------------------------------- scoring
    def net_worth(self) -> int:
        return self.money

    def final_score(self) -> int:
        units = sum(c.installed_base for c in self.player_consoles())
        game_units = sum(g.units_sold for g in self.games)
        best = max((g.score for g in self.games if g.status == "released"), default=0)
        return int(max(0, self.money) / 1_000 + units / 1_000 + game_units / 2_000
                   + self.reputation * 10 + best * 50)

    # ----------------------------------------------------------- persistence
    def to_dict(self) -> dict:
        d = asdict(self)
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "State":
        d = dict(d)
        d["consoles"] = [Console(**c) for c in d.get("consoles", [])]
        d["games"] = [Game(**g) for g in d.get("games", [])]
        return cls(**d)

    def save(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=1)

    @classmethod
    def load(cls, path: str) -> "State":
        with open(path, encoding="utf-8") as f:
            return cls.from_dict(json.load(f))


def new_game(company: str, seed: int | None = None) -> State:
    if seed is None:
        seed = random.randrange(1, 1_000_000)
    s = State(company=company, seed=seed)
    s._spawn_rival(launch_age=14)
    s._spawn_rival(launch_age=5)
    s.say(f"{company} opens its doors in a garage. Design a console, then make games for it!")
    return s


def fmt_money(n: float) -> str:
    sign = "-" if n < 0 else ""
    n = abs(n)
    if n >= 1_000_000_000:
        return f"{sign}${n / 1_000_000_000:.2f}B"
    if n >= 1_000_000:
        return f"{sign}${n / 1_000_000:.2f}M"
    if n >= 10_000:
        return f"{sign}${n / 1_000:.0f}K"
    return f"{sign}${n:,.0f}"


def fmt_num(n: float) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.2f}M"
    if n >= 10_000:
        return f"{n / 1_000:.0f}K"
    return f"{int(n):,}"


def stars(score: float) -> str:
    full = int(math.floor(score / 2 + 0.25))
    return "*" * full + "." * (5 - full)
