# Brass: Birmingham

An online multiplayer adaptation of the board game Brass: Birmingham, written in TypeScript with a server-authoritative rules engine.

> **Note:** This is an unofficial fan project. [Brass: Birmingham](https://roxley.com/products/brass-birmingham) is designed by Gavan Brown, Matt Tolman, and Martin Wallace, published by Roxley Games. Please support the original by purchasing the physical game.

**2-4 Players** · **Canal Era + Rail Era** · **Online Rooms + Saved Sessions**

## Features

- Full turn flow: Build, Network, Develop, Sell, Loan, Scout and Pass, with era-end scoring and the Canal-to-Rail transition
- Automatic coal, iron and beer sourcing, market pricing, income and turn order, with manual source selection when you want it
- Online rooms over Socket.IO, with reconnects through saved player sessions and JSON-backed game persistence
- Rule reasons shown on every action that can't be submitted
- Optional introductory Canal-only variant

## Status

The rules are implemented. Still pending: a final audit of the rules data against the physical components (see [docs/Brass_Birmingham_rules_data_model_cn.md](docs/Brass_Birmingham_rules_data_model_cn.md)) and UI polish beyond the current plain form controls.

## Quick Start

Requires Node.js 22+.

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. The API and Socket.IO server run on <http://127.0.0.1:3001>. Set `VITE_BRASS_SERVER_URL` if the server is on a different origin.

```bash
npm test         # unit tests
npm run verify   # build + tests + rules-data checks (the CI gate)
```

## Project Structure

| Path | Purpose |
| --- | --- |
| `src/common` | Shared rules engine: static data, setup, command validation and execution |
| `src/server` | Express + Socket.IO game room server |
| `src/client` | React client |
| `tests` | Vitest unit tests, organized by rules area |
| `js`, `css` | Legacy static prototype, kept as a migration reference |

## Credits

- **Brass: Birmingham** designed by Gavan Brown, Matt Tolman, and Martin Wallace, published by [Roxley Games](https://roxley.com)
- Tile data verified against the [Tabletop Simulator](https://github.com/ikegami/tts_brass) implementation by Kini/ikegami
- Online architecture inspired by [terraforming-mars/terraforming-mars](https://github.com/terraforming-mars/terraforming-mars)

*Fan-made digital adaptation for personal and educational use. All game design credit belongs to the original designers and publisher.*
