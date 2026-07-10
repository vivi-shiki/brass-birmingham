# Brass: Birmingham

[![Docs](https://img.shields.io/badge/docs-mintlify-18a34a?style=flat-square)](https://mintlify.com/npow/brass-birmingham)

A digital adaptation of the award-winning board game by Roxley Games. Build your industrial empire across the English Midlands during the height of the Industrial Revolution (1770-1870).

> **Note:** This is an unofficial fan project. [Brass: Birmingham](https://roxley.com/products/brass-birmingham) is designed by Gavan Brown, Matt Tolman, and Martin Wallace, published by Roxley Games. Please support the original by purchasing the physical game.

![Title Screen](screenshots/title.png)

---

## The Game

Compete as rival entrepreneurs in Birmingham and its surrounding towns. Establish canals and railways, develop industries, and outmaneuver your opponents across two distinct eras.

**2-4 Players** · **Canal Era + Rail Era** · **Online Rooms + Saved Sessions**

### Two Eras of Industry

**Canal Era (1770-1830)** — Build canals and establish your first industries. Only one tile per location. At the end, all canals and Level I tiles are removed — but Level II+ tiles carry over and score again.

**Rail Era (1830-1870)** — Build railways (requiring coal), expand aggressively with multiple tiles per location, and push for the highest score.

![Canal Era — early board with industries and canal links](screenshots/canal_era.png)

<p align="center"><em>Canal Era — industries built across the Midlands, canal links connecting the network</em></p>

![Rail Era — dense network of rail links and high-level industries](screenshots/rail_era.png)

<p align="center"><em>Rail Era — railways criss-cross the map as players race toward final scoring</em></p>

---

### Build Your Empire

Choose from six industry types, each with a unique strategic role:

| Industry | Role | Key Trait |
|----------|------|-----------|
| **Cotton Mills** | Sell goods for VP | Expensive but high-scoring |
| **Coal Mines** | Fuel rail links and industries | Cheap, strong income |
| **Iron Works** | Supply iron for building and development | Efficient, denies opponents |
| **Manufacturers** | 8 unique levels with varied rewards | Versatile and complex |
| **Potteries** | Massive VP potential (up to 20 VP) | High cost, requires planning |
| **Breweries** | Supply beer for selling goods | The most important industry |

Select what to build, where, and for how much — all costs including coal and iron sourcing are calculated automatically.

![Build action controls — choose an industry and location](screenshots/build_modal.png)

<p align="center"><em>Build action — choose from available industries at locations matching your cards</em></p>

---

### Clear Action Workflow

A plain **Action Forms** panel drives each turn in the current online implementation:

1. **Choose Action** — Use the form for Build, Network, Develop, Sell, Loan, Scout, or Pass
2. **Select Target** — Choose locations, slots, link lines, industries, merchants, and resource sources
3. **Submit Command** — The server validates the command, updates state, and broadcasts the result

Each form shows rule reasons when a command cannot currently be submitted, so you can see whether the blocker is a card, resource, network, pending decision, or turn-order rule.

---

### Game Log & Turn Transitions

A **game event log** records every action: builds, network links, sales, loans, scoring, and pending-decision resolutions.

Turn, era, round, current-player, and pending-decision state are shown in the main game summary.

![Players panel and game log](screenshots/player_markets.png)

<p align="center"><em>Player stats, markets, and game event history</em></p>

---

### Develop to Unlock Higher Tiers

Spend iron to remove low-level tiles from your player mat and access the powerful high-level industries underneath. Optionally develop two tiles at once.

![Develop action controls — remove tiles from your mat to unlock stronger ones](screenshots/develop_modal.png)

<p align="center"><em>Develop action — skip past weak tiles to access Level III+ industries</em></p>

---

### Your Hand, Your Strategy

Play location cards to build anywhere on the map, or industry cards to build within your network. Manage your hand carefully — every action costs a card.

Cards show **inline SVG icons** matching each industry type, with colored top borders indicating card type (green for location, red for industry, gold gradient for wild).

![Hand, actions, and industry mat](screenshots/hand_actions.png)

<p align="center"><em>Bottom panel — your hand of cards, the seven available actions, and your remaining industry tiles</em></p>

---

### Atmospheric Board

The game board features:
- **Parchment texture** via SVG noise filters and a radial vignette
- **Double-line canal** connections (translucent blue water effect)
- **Rail connections** with track-tie patterns
- **Geometric SVG icons** on industry slots and built tiles (factory, diamond, gear, crate, vase, barrel)
- **City nodes** with dark label backdrops, inner shadow depth, and increased region color opacity
- **VP badges** on flipped tiles, player color strips on built tiles

---

### Era Scoring

At the end of each era, score VP from your flipped industry tiles and the links connecting them. Higher-level tiles placed in the Canal Era score in *both* eras.

![Scoring screen at end of Canal Era](screenshots/scoring.png)

<p align="center"><em>Canal Era scoring — link VP and industry VP tallied for each player</em></p>

---

## Development Status

This repository is being migrated from a static hotseat prototype into an online
multiplayer implementation inspired by
[terraforming-mars/terraforming-mars](https://github.com/terraforming-mars/terraforming-mars):

- `src/common`: shared TypeScript rules, static config, selectors, setup, and command engine
- `src/server`: authoritative Express + Socket.IO game room service
- `src/client`: React client using plain native form controls while rules are still being completed
- `tests`: Vitest unit tests organized by rules area
- `js` and `css`: legacy static implementation retained as migration reference

Implemented so far: setup, deck dealing, player boards, income track, markets,
player network, connected components, Pass, Loan, Scout, Develop, Build, Network,
Sell, merchant beer, merchant bonuses, era-end scoring, Canal-to-Rail cleanup,
Rail final scoring, rail double-link beer payment, round income, negative-income
manual liquidation choices and shortfall handling, deterministic randomized setup
turn order, command-level manual resource-source selection, Socket.IO
create/join/command flow, JSON-backed game persistence, static rules-data
integrity tests, saved player-session tokens for reconnects, Build/Develop/Network
context-filtered resource-source controls, Sell context-filtered beer-source
controls, negative-income decision controls, automatic active-player session
switching, manual saved-session view switching, existing-game room list with
saved-session join controls, a plain leave-room control backed by Socket.IO,
browser CORS support for the REST API, audited
city-slot/farm brewery/merchant/link/card/industry/market/core-rules/
income-track data manifests, legacy static-prototype parity tests,
official physical-component manifest,
player-count link availability and merchant-tile setup manifests,
client-side disabled-action rule reasons, and
audited setup/dealing/board-occupancy invariants, link-anchored rail coal
sourcing, the first rule test suite, and the optional introductory Canal-only
variant, plus a public rules-data face-audit checklist endpoint and plain
client checklist view with fingerprinted local reviewed-item progress import/export,
plus a public fillable review-template export and validation flow for the final
face-by-face audit, including a ready-gated audit-status lock preview, compact
lock-evidence artifact, lock-evidence verification command, and release gate
for evidence-backed audit-status locking, plus public room summaries that show
which player seats are currently online without exposing session tokens.

Still pending for a full Brass implementation: final face-by-face human
rules-data audit against the official card, board, industry tile, and merchant
tile faces using the checklist in
`docs/Brass_Birmingham_rules_data_model_cn.md`, plus later UI/UX polish beyond
the current plain native command forms.

---

## How to Play

### Quick Start

```powershell
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) in your browser.
The API and Socket.IO server run on [http://127.0.0.1:3001](http://127.0.0.1:3001).
In Vite dev mode, the client talks to `http(s)://<current-browser-host>:3001`
by default, so a LAN browser pointed at `http://<lan-ip>:5173` will use
`http://<lan-ip>:3001`. Set `VITE_BRASS_SERVER_URL` when the API is on a
different origin.

For LAN testing from another device, run the two dev processes with externally
reachable hosts, for example in two PowerShell windows:

```powershell
$env:HOST = '0.0.0.0'
npm run dev:server

npm run dev:client -- --host 0.0.0.0
```

Useful HTTP endpoints:

- `GET /api/health` - server health check
- `GET /api/static-config` - public rules/static-data config and audit metadata
- `GET /api/face-audit-checklist` - public versioned, fingerprinted machine-readable checklist for the remaining face-by-face rules-data audit
- `GET /api/face-audit-review-template` - public fillable JSON template for recording official face-audit evidence
- `GET /api/face-audit-review-template/status` - public aggregate baseline review status without submitted artifacts
- `GET /api/face-audit-review-template/todo` - public compact baseline unfinished-area handoff without submitted artifacts
- `GET /api/face-audit-review-template/todo-summary` - public counts-only baseline for the current unfinished face-audit checklist
- `GET /api/face-audit-review-template/:area/todo-summary` - public counts-only baseline for one face-audit area
- `GET /api/face-audit-review-template/review-sheet` - public baseline TSV sheet for spreadsheet assignment or offline tracking
- `GET /api/face-audit-review-template/:area/review-sheet` - public baseline TSV sheet for one face-audit area
- `GET /api/face-audit-review-template/review-plan` - public baseline item-level review plan for reviewer assignment
- `GET /api/face-audit-review-template/reviewer-instructions` - public baseline reviewer handoff instructions markdown
- `GET /api/face-audit-review-template/:area/reviewer-instructions` - public baseline reviewer instructions markdown for one face-audit area
- `GET /api/face-audit-review-template/handoff` - public baseline reviewer handoff bundle with per-area artifacts
- `GET /api/face-audit-review-template/:area` - public fillable JSON template for one face-audit area
- `POST /api/face-audit-evidence-ref-template` - emit area-level or item-specific official-component evidence refs
- `POST /api/face-audit-source-ids-by-area-template` - emit a complete area-to-source-id JSON map for area-specific matching review artifacts
- `POST /api/face-audit-review-template/match` - generate a full matching review artifact from declared official evidence
- `POST /api/face-audit-review-template/:area/match` - generate one matching area review artifact from declared official evidence
- `POST /api/face-audit-review-template/merge` - merge full or area face-audit review artifacts into one full review artifact
- `POST /api/face-audit-review-template/status` - summarize per-area review progress from full or area face-audit review artifacts
- `POST /api/face-audit-review-template/todo` - emit a compact unfinished-area handoff for face-audit reviewers
- `POST /api/face-audit-review-template/todo-summary` - emit submitted review-artifact progress as counts-only JSON for quick dashboard/status checks
- `POST /api/face-audit-review-template/:area/todo-summary` - emit submitted review-artifact progress for one face-audit area as counts-only JSON
- `POST /api/face-audit-review-template/review-plan` - emit every unfinished face-audit item grouped by area for reviewer assignment
- `POST /api/face-audit-review-template/review-sheet` - download the same review progress as a TSV sheet for spreadsheet assignment or offline tracking
- `POST /api/face-audit-review-template/:area/review-sheet` - download one face-audit area as a TSV sheet
- `POST /api/face-audit-review-template/apply-review-sheet` - apply an edited TSV review sheet back onto review artifacts and return a full review JSON artifact
- `POST /api/face-audit-review-template/reviewer-instructions` - download the reviewer handoff instructions markdown derived from the same review artifacts
- `POST /api/face-audit-review-template/:area/reviewer-instructions` - download one area-specific reviewer instructions markdown file
- `POST /api/face-audit-review-template/handoff` - emit compact todo plus current per-area artifacts for unfinished face-audit reviewers
- `POST /api/face-audit-reviewer-handoff/verify` - verify a reviewer handoff package still matches the current checklist and embedded area artifacts
- `POST /api/face-audit-reviewer-handoff/response` - summarize returned area artifacts for a reviewer handoff
- `POST /api/face-audit-review-template/validate` - validate a filled face-audit review artifact against the current checklist fingerprint
- `POST /api/face-audit-review-template/ready` - stricter face-audit release gate requiring every review item to match official faces
- `POST /api/face-audit-review-template/lock-preview` - ready-gated preview of the audit-area status changes needed to lock face-audited data
- `POST /api/face-audit-review-template/lock-artifact` - emit compact lock-evidence JSON after the same ready gate passes
- `POST /api/face-audit-lock-artifact/verify` - verify compact lock evidence against the current or just-locked checklist
- `POST /api/face-audit-release-gate` - run the release gate with optional compact lock evidence
- `GET /api/games` - public game room summaries with `createdAt` / `updatedAt`, ordered by latest game activity; the lobby shows connected clients, online player seats, ended-game winners, and victory points
- `POST /api/games` - create a game
- `GET /api/games/:id` - observer or player-specific game state
- `POST /api/games/:id/commands` - submit an authoritative command

Socket.IO also supports `games:list:get` for the same public room-summary payload, emits `games:list` after game creation and successful commands, and accepts `game:leave` so a client can unbind from the current room before returning to the lobby. Room summaries include `connectedPlayerIds` only for authenticated player-seat sockets, so observers contribute to `connectedClientCount` but do not appear as player seats.
Manual player joins switch the local view only after the Socket.IO ACK returns a matching `session.playerId`; observer joins switch to observer view only when the ACK has no player session.
All `/api/games` HTTP responses use `Cache-Control: no-store` so player-specific game-state views, hands, and command responses are not cached by browsers or proxies.

Useful commands:

GitHub Actions runs `npm run verify` on pull requests and pushes to `main`, so
the hosted gate uses the same build, test, face-audit release check, temporary
CI artifact self-check, and temporary review-kit self-check as a local pre-merge run. After the gate
passes, Actions also uploads
the `face-audit-ci-artifacts` artifact directory with
`face-audit-ci-manifest.json`, `face-audit-review-status.json`,
`face-audit-review.json`, `face-audit-review-todo.json`,
`face-audit-review-plan.json`, `face-audit-review-sheet.tsv`,
`face-audit-reviewer-handoff.json`, `source-ids-by-area.json`, and
`face-audit-reviewer-instructions.md`,
plus one `face-audit-area-<area>-review.json` file, one
`face-audit-area-<area>-review-sheet.tsv` file, one
`face-audit-area-<area>-todo-summary.json` file, and one
`face-audit-area-<area>-area-evidence-refs.json` file plus one
`face-audit-area-<area>-items-evidence-refs.json` file, and one
`face-audit-area-<area>-reviewer-instructions.md` file for each unfinished area, so
reviewers can download the current official-component audit status, unfinished
list, merged full review artifact, item-level review plan, spreadsheet
assignment sheet, self-describing artifact manifest, human-readable reviewer
steps, ready-to-fill area artifacts, area-specific spreadsheet sheets,
counts-only per-area summaries, replaceable source-id maps, placeholder evidence
ref templates, and area-specific reviewer instructions from the run.
The `face-audit:ci-artifacts` stdout manifest also includes a compact summary
with the review fingerprint, reviewed/unreviewed item counts, pending/ready area
counts, each unfinished area's remaining item count, and sha256 content hashes
for every archived file for quick CI-log triage and download verification.
Actions runs the same artifact self-check before upload, so a malformed or
internally inconsistent audit handoff package fails CI instead of being archived.
After downloading an artifact directory, run `face-audit:verify-ci-artifacts`
against it to check the manifest, core JSON files, TSV review sheet, reviewer
instructions, handoff package, and every unfinished-area review artifact,
per-area TSV sheet, per-area summary, source-id map, evidence-ref templates, and per-area instructions file are present and
internally consistent. The self-check also cross-checks the status, todo,
review-plan, per-area todo-summary artifacts, source-id map, evidence-ref templates,
per-area TSV sheets, and per-area instructions against the reviewer handoff, and rebuilds the TSV sheet
from `face-audit-review.json`, then applies that TSV back to the same review JSON,
so edited summaries and spreadsheet exports cannot drift from the area files
reviewers actually fill in.

```powershell
npm run verify
npm test
npm run build
npm start
npm run face-audit:checklist
npm run face-audit:template
npm run face-audit:area-template -- regularCards
npm run face-audit:template-with-sources -- .\path\to\evidence-sources.json
npm run face-audit:area-template-with-sources -- regularCards .\path\to\evidence-sources.json
npm run face-audit:merge -- .\path\to\regular-cards-review.json .\path\to\industry-tiles-review.json
npm run face-audit:status
npm run face-audit:status -- .\path\to\regular-cards-review.json .\path\to\industry-tiles-review.json
npm run face-audit:todo
npm run face-audit:todo -- --summary
npm run face-audit:todo -- --summary --area wildCards
npm run face-audit:todo -- .\path\to\regular-cards-review.json .\path\to\industry-tiles-review.json
npm run face-audit:review-plan
npm run face-audit:review-plan -- .\path\to\regular-cards-review.json .\path\to\industry-tiles-review.json
npm run face-audit:review-sheet
npm run face-audit:review-sheet -- .\path\to\regular-cards-review.json .\path\to\industry-tiles-review.json
npm run face-audit:area-review-sheet -- wildCards
npm run face-audit:area-review-sheet -- wildCards .\path\to\regular-cards-review.json
npm run face-audit:apply-review-sheet -- .\path\to\face-audit-review-sheet.tsv .\path\to\face-audit-review.json
npm run face-audit:reviewer-instructions
npm run face-audit:reviewer-instructions -- .\path\to\regular-cards-review.json .\path\to\industry-tiles-review.json
npm run face-audit:area-reviewer-instructions -- wildCards
npm run face-audit:area-reviewer-instructions -- wildCards .\path\to\regular-cards-review.json
npm run face-audit:ci-artifacts -- .\face-audit-artifacts
npm run face-audit:ci-artifacts -- .\face-audit-artifacts .\path\to\regular-cards-review.json .\path\to\industry-tiles-review.json
npm run face-audit:verify-ci-artifacts -- .\face-audit-artifacts
npm run face-audit:ci-artifacts-self-check
npm run face-audit:handoff
npm run face-audit:handoff -- .\path\to\regular-cards-review.json .\path\to\industry-tiles-review.json
npm run face-audit:verify-handoff -- .\path\to\face-audit-reviewer-handoff.json
npm run face-audit:handoff-response -- .\path\to\face-audit-reviewer-handoff.json .\path\to\returned-area-review.json
npm run face-audit:validate -- .\path\to\face-audit-review.json
npm run face-audit:ready -- .\path\to\face-audit-review.json
npm run face-audit:lock-preview -- .\path\to\face-audit-review.json
npm run face-audit:lock-artifact -- .\path\to\face-audit-review.json
npm run face-audit:verify-lock-artifact -- .\path\to\face-audit-lock-artifact.json
npm run face-audit:release-gate -- .\path\to\face-audit-lock-artifact.json
npm run face-audit:hash-source -- .\path\to\official-component-photos.zip .\path\to\board.png
npm run face-audit:source-template -- official_high_res_component_image .\path\to\official-component-photos.zip .\path\to\board.png
npm run face-audit:review-kit -- .\face-audit-review-kit official_high_res_component_image .\path\to\official-component-photos.zip .\path\to\board.png
npm run face-audit:verify-review-kit -- .\face-audit-review-kit
npm run face-audit:review-kit-self-check
npm run face-audit:evidence-ref-template -- photo-set regularCards
npm run face-audit:evidence-ref-template -- photo-set regularCards items
npm run face-audit:area-match-template -- regularCards .\path\to\evidence-sources.json photo-set Ada 2026-07-10T00:00:00.000Z
npm run face-audit:area-match-template -- regularCards .\path\to\evidence-sources.json photo-set Ada 2026-07-10T00:00:00.000Z items
npm run face-audit:review-match-template -- .\path\to\evidence-sources.json photo-set Ada 2026-07-10T00:00:00.000Z
npm run face-audit:review-match-template -- .\path\to\evidence-sources.json photo-set Ada 2026-07-10T00:00:00.000Z items
npm run face-audit:source-ids-by-area-template -- .\path\to\evidence-sources.json cards-source industryTiles=tiles-source linkLines=board-source locationsAndSlots=board-source
npm run face-audit:review-match-template-by-area -- .\path\to\evidence-sources.json .\path\to\source-ids-by-area.json Ada 2026-07-10T00:00:00.000Z items
```

Filled face-audit artifacts must declare every official component source in `evidenceSources` before items can reference it. Each source can include `locator` for the exact reviewer file, URL, page, or archive path and `contentHash` as `sha256:<64 hex>`, `sha1:<40 hex>`, or `md5:<32 hex>` so later reviewers can bind evidence to a specific captured asset; draft validation accepts these as optional, but ready/lock checks require every used source to include at least one of them. Each `evidenceRef` must use `official-component:<source>#<area>` for an area-level source, or `official-component:<source>#<area>:<item-id>` for item-specific evidence. The source id, area, and optional item id must match the declared source and checklist item being reviewed. Items left as `unreviewed` must keep reviewer, timestamp, evidence, and notes fields blank so stale metadata is not counted as review evidence. Ready/lock checks reject unused declared sources, and the compact lock-evidence artifact keeps only source records that are cited by at least one area evidence reference. Lock previews and compact lock evidence also carry per-area area-level and item-specific evidence coverage counts.
Use `face-audit:hash-source` on local official-component photo, PDF, or archive files to print a `face_audit_evidence_source_hashes` artifact; its `locator` and `contentHash` entries can be copied into review `evidenceSources`. Use `face-audit:source-template` when you want the CLI to generate complete `evidenceSources` entries, including stable source ids, labels, source type, citations, locators, hashes, and blank notes. Use `face-audit:review-kit` when a reviewer has the local official evidence files and wants one output directory containing `evidence-sources.json`, `source-ids-by-area.json`, `face-audit-review-kit-manifest.json`, full and per-area blank review artifacts, status/todo/plan/handoff JSON, TSV sheets, reviewer instructions, per-area todo summaries, and area/item evidence-ref templates without marking any item reviewed. Run `face-audit:verify-review-kit` on that directory before review starts to confirm the evidence source registry, source-id map, manifest, blank artifacts, derived progress files, TSVs, instructions, and evidence refs are internally consistent; `face-audit:review-kit-self-check` generates and verifies a temporary sample kit for local/CI gate coverage. Use `face-audit:template-with-sources` or `face-audit:area-template-with-sources` when the review is still in progress or may record differences; these commands copy `evidenceSources` into blank unreviewed templates without marking any item reviewed. Use `face-audit:evidence-ref-template` after choosing a source id to generate either one area-level `evidenceRef` or an item-specific `evidenceRef` list for every checklist item in that area. After a human reviewer has confirmed every item in an area matches the official component evidence, `face-audit:area-match-template` can turn a source-template or review artifact containing `evidenceSources` into a filled area artifact with reviewer, timestamp, `matches_official_face`, and area-level or item-specific refs applied consistently. After the same human review has covered the full checklist, `face-audit:review-match-template` can generate the full review artifact directly so `ready`, `lock-preview`, and `lock-artifact` can run without merging area files. When different checklist areas were reviewed against different official evidence files, use `face-audit:source-ids-by-area-template` to generate the full area-to-source-id JSON object, then pass that file to `face-audit:review-match-template-by-area`, for example `{"industryTiles":"tiles-source","linkLines":"board-source","locationsAndSlots":"board-source","merchantTiles":"merchant-source","regularCards":"cards-source","wildCards":"cards-source"}`.
For split human review, `face-audit:area-template` exports one area-level artifact and `face-audit:merge` combines multiple full or area artifacts back into the standard full review artifact before `ready`, `lock-preview`, and `lock-artifact`.
`face-audit:status` can run with no review files to emit the current all-unreviewed baseline, or with one or more full/area artifacts. It emits a versioned `face_audit_review_status` artifact with review/checklist fingerprints, top-level area completion counts, and per-area reviewed, matching, difference, missing-reference, and unreviewed counts, plus reviewer/time-window handoff metadata, used and unused evidence source ids, area-level vs item-specific evidence ref coverage, and the item keys still unreviewed, different, or needing better reference, without requiring the audit to be ready to lock.
`face-audit:todo` uses the same inputs as `status` but emits a shorter `face_audit_review_todo` artifact with only unfinished areas, remaining counts, the next item keys to inspect, and the area-template / area-match-template commands needed for a human audit handoff. Add `--summary` to emit a counts-only `face_audit_review_todo_summary` artifact without command templates or item-key lists; add `--area <area>` with `--summary` to emit a `face_audit_area_review_todo_summary` for one area, including whether that area is ready, still unreviewed, has differences, or needs better reference evidence.
`face-audit:review-plan` expands that todo into a `face_audit_review_plan` artifact with every unfinished item grouped by area, including item labels, expected fields, current review status, evidence refs, and the per-item next step, so reviewers can divide work without opening the full editable handoff JSON.
`face-audit:review-sheet` uses the same optional review-artifact inputs and prints a TSV sheet with every checklist item, expected fields, current status, next step, reviewer metadata, evidence ref, and notes for spreadsheet-based assignment or offline review tracking. `face-audit:area-review-sheet -- <area>` prints the same columns for one area only, so a split reviewer can edit a compact TSV and still return it through `face-audit:apply-review-sheet`. `face-audit:apply-review-sheet` applies an edited TSV back onto the same baseline artifacts and prints a full review JSON artifact for `validate`, `ready`, `lock-preview`, or `lock-artifact`. `face-audit:reviewer-instructions` prints the same reviewer handoff instructions markdown that CI archives. `face-audit:area-reviewer-instructions -- <area>` prints the same per-area markdown that CI writes as `face-audit-area-<area>-reviewer-instructions.md`, or a no-op note when that area is already ready. The server exposes baseline downloads through `GET /api/face-audit-review-template/status`, `GET /api/face-audit-review-template/todo`, `GET /api/face-audit-review-template/review-plan`, `GET /api/face-audit-review-template/review-sheet`, `GET /api/face-audit-review-template/:area/review-sheet`, `GET /api/face-audit-review-template/reviewer-instructions`, `GET /api/face-audit-review-template/:area/reviewer-instructions`, and `GET /api/face-audit-review-template/handoff`, plus submitted-artifact downloads through `POST /api/face-audit-review-template/status`, `POST /api/face-audit-review-template/todo`, `POST /api/face-audit-review-template/review-plan`, `POST /api/face-audit-review-template/review-sheet`, `POST /api/face-audit-review-template/:area/review-sheet`, `POST /api/face-audit-review-template/reviewer-instructions`, `POST /api/face-audit-review-template/:area/reviewer-instructions`, and `POST /api/face-audit-review-template/handoff` for browser-driven exports. `POST /api/face-audit-review-template/apply-review-sheet` applies an edited TSV back onto the same baseline artifacts to rebuild a full review JSON artifact.
`face-audit:handoff` uses the same inputs as `todo` and emits a `face_audit_reviewer_handoff` artifact that includes the compact todo plus current per-area review artifacts for every unfinished area, preserving any declared `evidenceSources` and already reviewed items so another reviewer can continue without re-running each area-template command. `face-audit:verify-handoff` verifies a received handoff package against the current checklist, its embedded todo, and every included area artifact before a reviewer resumes from it. `face-audit:handoff-response` checks returned area artifacts against the original handoff and reports how many handoff areas are ready, unfinished, or still missing.
The browser Face Audit panel can also load or download full and selected-area blank review templates, hash selected official evidence files into a source artifact, download the resulting `evidence-sources.json`, reuse the first source from a pasted source artifact, generate or download area-level or item-specific evidence refs, generate, download, or reload a reusable `source-ids-by-area.json` map, generate full or selected-area matching review artifacts from declared official evidence, fill a loaded area artifact with reviewer/evidence metadata using area-level or item-specific evidence refs, import reviewed checklist progress back from any full or area review artifact, merge completed area artifacts back into the full review JSON, show area-level versus item-specific evidence coverage in status results, request or download the compact todo handoff, view or download full or selected-area todo summary JSON for unfinished audit areas, build or download the item-level review plan, download the full or selected-area TSV review sheet, apply an edited TSV review sheet back into a full review JSON artifact, download reviewer instructions markdown, download one area-specific reviewer instructions markdown file, build and download reviewer handoff packages whose unfinished area artifacts can be loaded back into the review editor or downloaded as separate JSON files, verify reviewer handoff packages, summarize returned area artifacts against a handoff package, and run the release gate with optional compact lock evidence. Status, todo, full/selected-area todo-summary, review-plan, TSV, instructions, and handoff buttons use the public baseline GET exports when the merge-artifact input is blank, and switch to submitted-artifact POST mode when review JSON is pasted.

1. Choose 2-4 players and enter names
2. Create a game room
3. Share the game ID or URL hash with another browser tab
4. Submit actions through the plain forms

![Setup screen](screenshots/board_start.png)

### On Your Turn

1. **Use the Action Forms** for Build, Network, Develop, Sell, Loan, Scout, or Pass
2. **Choose the card and targets** from the native form controls
3. **Select explicit resource sources** when you want to override automatic coal, iron, or beer sourcing
4. **Submit the action**; the authoritative server validates it and advances the game

Disabled action buttons show the rule reason in the form and as a tooltip (e.g. "No iron available", "Need at least 3 cards").

The game handles all resource sourcing (coal, iron, beer), market pricing, turn order, and scoring automatically.

### Tips for New Players

- **Build breweries early** — Beer is the most contested resource in the game
- **Watch the turn order** — Spending less money means going first next round
- **Develop to skip weak tiles** — Accessing Level III+ tiles is worth the iron cost
- **Build in the Canal Era for double scoring** — Level II+ tiles persist into the Rail Era
- **Don't ignore income** — It compounds every round and breaks final VP ties

---

## Rules Reference

This implementation follows the official Brass: Birmingham rulebook:

- **Coal** requires a connected source (mine or market via merchant link)
- **Iron** can be taken from any iron works on the board — no connection needed
- **Beer** for selling comes from your own breweries (anywhere), connected opponent breweries, or merchant barrels
- **Overbuilding** your own tiles requires same type + higher level; opponent coal/iron tiles can only be overbuilt when that resource is globally depleted
- **Pottery I and III** have the lightbulb icon and cannot be developed — they must be built
- **Turn order** each round goes to whoever spent the least money

---

## Architecture

Modern TypeScript web app with a server-authoritative rules engine.

| File | Purpose |
|------|---------|
| `index.html` | Vite entry for the React client |
| `src/common/staticData.ts` | Static rules data: locations, links, cards, industries, markets |
| `src/common/gameSetup.ts` | Deterministic game setup and initial state creation |
| `src/common/gameEngine.ts` | Command validation/execution for server-authoritative rules |
| `src/common/selectors.ts` | Network and connected-component helpers |
| `src/server/index.ts` | Express + Socket.IO server |
| `src/server/gameStore.ts` | In-memory multiplayer game room store |
| `src/client/main.tsx` | Plain React client and native action forms |
| `tests/**/*.spec.ts` | Unit tests for rules, setup, network, actions, and server store |
| `js/*.js`, `css/style.css` | Legacy prototype retained as migration reference |

---

## Credits

- **Brass: Birmingham** designed by Gavan Brown, Matt Tolman, and Martin Wallace
- Published by [Roxley Games](https://roxley.com)
- Tile data verified against the [Tabletop Simulator](https://github.com/ikegami/tts_brass) implementation by Kini/ikegami
- Board geography and card data referenced from community implementations

---

*Fan-made digital adaptation for personal and educational use. All game design credit belongs to the original designers and publisher.*
