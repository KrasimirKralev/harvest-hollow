# Contributing to Harvest Hollow

Thanks for wanting to help. Bug reports, ideas and pull requests are all welcome.

## Report a bug or suggest an idea

- **Bugs:** open a [bug report](https://github.com/KrasimirKralev/harvest-hollow/issues/new?template=bug_report.yml).
  Say whether it happened on the hosted game or on your own server, which browser and device, and what you did just
  before. A screenshot helps a lot.
- **Ideas:** open an [idea](https://github.com/KrasimirKralev/harvest-hollow/issues/new?template=idea.yml). The hosted
  game also has an ideas box on its landing page.
- **Security problems** (anything that lets one player read or change another farm): please do not open a public
  issue. Contact the maintainer, [@KrasimirKralev](https://github.com/KrasimirKralev), privately first.

## Run it locally

You need [Node.js 24](https://nodejs.org/) (`.nvmrc` pins it).

```sh
git clone https://github.com/KrasimirKralev/harvest-hollow.git
cd harvest-hollow
npm install
npm run dev      # http://localhost:3300, a separate ./data-dev save, dev routes on (time warp)
```

`npm run dev` sets `HH_DEV=1`, which turns on the developer routes (the time warp the tests use). Never set it on a
server other people play on. `PORT=3310 npm run dev` picks another port.

## Before you open a pull request

```sh
npm test                          # unit and integration tests (node:test); all must pass
node tools/econ-sim.mjs --checks  # run it when you touch prices, timers, rewards or content tables
npm run test:e2e -- --port 3310   # two headless browsers end to end (needs Chrome; CHROME=<path>), for gameplay changes
```

A few rules keep the game working for two players at once:

- **`shared/` is the game.** The rules engine runs in the browser (to predict an action) and on the server (to decide
  it), so code there must stay pure and deterministic: no `Date.now()`, no `Math.random()`, no DOM, no Node APIs.
  `test/purity.test.js` checks this.
- **Content comes from the economy model.** Prices and timers are generated (`tools/economy-model.mjs`,
  `tools/gen-content.mjs`); change the model, not a single number, and run the simulator checks.
- **Every word a player reads exists in English and Bulgarian.** New UI text goes into `public/js/i18n/en/` and
  `public/js/i18n/bg/`; `test/i18n.scan.test.js` fails on a new hard-coded English string.
- **Keep pull requests small**: one fix or feature, with a test that fails without it. For a visual change, add a
  before/after screenshot.

Commit messages follow `type: description` in lowercase (`fix: …`, `feat: …`, `docs: …`, `test: …`).

## Where things are

- `shared/`: content tables and the rules engine
- `server/`: Express + `ws`, the save, the journal and backups
- `public/`: the Three.js client and the HTML/CSS interface
- `tools/`: the economy model and simulators, asset scripts, end-to-end tests
- `docs/GDD.md`: the game design document, the source of truth for how every system works

## Code of Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

By contributing, you agree that your contribution is released under the project's [MIT licence](LICENSE).
