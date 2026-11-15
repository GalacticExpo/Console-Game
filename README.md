# Console Tycoon

A text-based business sim for the terminal: start a games company in a garage in 1985, **design your own consoles** from parts, then **make games for them**, competing against rival hardware makers until 2015.

## Play

Requires Python 3.10+ and nothing else.

```bash
python3 play.py
# or
python3 -m console_tycoon
```

Saves go to `saves/` in the current directory. Quitting with `q` saves automatically.

## How it works

**Consoles**
- Pick a CPU, GPU, Memory, Storage, Controller and Case. CPU/GPU/Memory set *power*, the rest add *appeal*, and Storage limits how big a game can be (cartridges hold Small games; optical drives hold Large/AAA).
- Power is judged against what the market expects right now, and that rises every year, so hardware gets old fast.
- Set a price. Buyers compare it with what they think is fair. You keep 75% after retailers, minus build cost per unit (parts get cheaper as they age).
- Successful consoles attract third-party games, which pay you royalties.
- Run ad campaigns, change prices, or discontinue old hardware.

**Games**
- Make a game for your own console (you keep 70%) or license one for a rival's console (you keep 45%), which is handy before your hardware ships.
- Choose size, genre and topic, then split 10 effort points between Gameplay, Graphics, Story and Audio. Every genre has a hidden ideal split, and some topics suit some genres. Critics' notes after each release hint at what you got wrong.
- Every title on a console competes for its owners' spending. Great first-party games sell far more *and* help your console sell.

**Company**
- Research new parts with research points (more staff = faster). Each part has a year before which it can't be invented.
- Hire staff for bigger games, move offices to grow, and keep an eye on monthly bills.
- Three months in a row in debt means bankruptcy. Reach 2015 for your final score.

## Code layout

| File | Purpose |
| --- | --- |
| `console_tycoon/data.py` | Parts, genres, topics, offices, names |
| `console_tycoon/sim.py` | The simulation (no I/O); deterministic per seed |
| `console_tycoon/ui.py` | Menus and screens |
| `tests/test_sim.py` | Unit tests plus a scripted UI playthrough |

Run the tests with `python3 -m unittest discover -s tests`.
