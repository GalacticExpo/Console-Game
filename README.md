# Console Tycoon

A phone-friendly game about designing games consoles and making games for them. It runs in any browser; there's nothing to install.

## Play

Open `index.html` in a browser. On a phone, host it somewhere (for example GitHub Pages for this repo) and open the link. The game saves on the device after every move. **Save & help → Export save** gives you a code to move your game to another device.

## How it plays

- **Design a console** from six parts. For now every slot is locked to its earliest part. CPU, GPU and memory add *power*; storage, controller and case add *appeal*. Storage also sets the biggest game that fits (cartridges hold Small games, disc drives hold bigger ones). Better parts cost more to develop and to build.
- **Set a price.** Buyers compare it with a fair price based on the console's power and appeal. You keep 75% of the price, minus the cost of building each unit.
- **Make games** for your consoles. Pick a size, genre and topic, then split 10 points between Gameplay, Graphics, Story and Audio. Each genre has a hidden ideal split, and some topics suit some genres. Four critics review each game and tell you what to change. Powerful consoles make graphics look better.
- **Sales:** good games sell more consoles, and more console owners buy more games. Console sales fade over time, so design new ones to keep growing.
- One console and one game can be in development at a time.

## Code

| File | Purpose |
| --- | --- |
| `web/data.js` | Parts, genres, topics and game sizes. Edit this to tweak the game. |
| `web/sim.js` | The rules: designing, reviewing, sales. No UI code. |
| `web/ui.js` | Screens and taps |
| `web/style.css`, `web/shell.html` | Look and page skeleton |
| `tools/build.js` | Builds `index.html` from the files in `web/` |
| `tests/sim.test.js` | Tests for the rules |

After changing anything in `web/`, rebuild and test (needs Node.js 18+):

```bash
node tools/build.js
node --test
```
