# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PokerGTO is a poker GTO (Game Theory Optimal) training web app (vanilla JavaScript, zero external dependencies). It teaches players optimal preflop and postflop strategy through interactive practice with real-time CFR+ solver feedback. UI strings are in Chinese; code comments are in English.

Note: The CLAUDE.md references an iOS app historically, but all iOS/Swift code is gitignored and not present in this repo. Only the web app, serverless API, and C++ solver are active.

## Build & Run Commands

- **Dev server**: `npm run dev` (serves `web/` on port 8080)
- **Syntax check JS**: `node -c web/js/<file>.js`
- **Tests**: `npm test` (runs `node lib/test-solver.js` — validates CFR+ output against PIO reference values)
- **C++ solver build**: `cd solver && cmake -B build && cmake --build build`
- **C++ solver run**: `./solver/build/solver_api --resources ./solver/resources`

No linter, formatter, or CI pipeline is configured.

## Testing

`lib/test-solver.js` is the sole test suite. It validates solver strategies against known PIO reference frequencies:
- Premium hands (AA, KK) must raise ~100% (±5% tolerance)
- Trash hands (72o, 32o) must fold ~100% (±5-10% tolerance)
- Mixed strategies (suited connectors, 3bet/4bet responses) use ±15% tolerance
- Postflop tests validate bet/check frequencies against known spots (±20% tolerance)

Tests are standalone — no test framework. Output is pass/fail counts with emoji indicators.

## Architecture

### Web App (`web/`)

Single-page app served from `index.html` (157KB, contains all HTML). No build step, no bundler.

**Script load order matters** (globals depend on prior scripts):
`poker-core → cfr-solver → solver-cache → hand-abstraction → preflop-solver → precomputed-lookup → postflop-solver → profiles → preflop-practice → practice`

Core modules:
- **poker-core.js**: Card/hand evaluation primitives, Monte Carlo equity calculation
- **cfr-solver.js**: CFR+ engine — `InfoSet`, `GameNode`, `CFRSolver` classes
- **preflop-solver.js**: Builds 6-max preflop game trees, singleton via `PreflopSolver.getInstance()`. Solves RFI, vs-raise, vs-3bet, vs-4bet scenarios (~800ms with Monte Carlo)
- **postflop-solver.js**: Per-street CFR+ with equity bucketing (default 25 buckets). Takes hero/villain ranges + board, solves in ~1-2s
- **practice.js** (2,800 lines, largest file): Postflop training UI. `getRecommendation()` tries C++ solver → JS CFR → heuristic fallback
- **preflop-practice.js**: Preflop training. `_getCorrectAction()` tries CFR solver → static ranges fallback

Precomputed data: `web/data/precomputed/flop/` contains 103 pre-solved flop JSON files (~300 hand combos each) for near-instant flop lookups.

### Dual Solver Architecture

The app uses two solver tiers:

1. **C++ solver (primary)** — PIO-level accuracy, 5-15s solve time. Deployed on Railway. Forked from [TexasSolver](https://github.com/bupticybee/TexasSolver) with Qt stripped. Uses discounted CFR with OpenMP parallelization.
2. **JS solver (fallback)** — ~80% accuracy, instant in-browser. Used when C++ solver times out or is unavailable.

Frontend flow: `getRemoteRecommendation()` → C++ API → fallback to `getCFRRecommendation()` (JS)

### Serverless API (`api/`)

Vercel Functions with **10-second maxDuration** (configured in `vercel.json`):
- **solve-cpp.js**: Proxy to C++ solver on Railway (9s safety timeout to stay within Vercel limit)
- **solve-preflop.js**: JS CFR fallback, caches `PreflopSolver` instance across warm invocations
- **solve-postflop.js**: JS CFR fallback with LRU cache (30-entry limit)

### Shared Lib (`lib/`)

CommonJS modules extracted from `web/js/` for Node.js serverless use:
- `cfr-engine.js`, `hand-utils.js`, `preflop-engine.js`, `postflop-engine.js`

### C++ Solver (`solver/`)

- C++17, optional OpenMP
- API server: `src/api_server.cpp` using embedded cpp-httplib, `POST /api/solve`
- Hand evaluation via pre-computed 7462-rank lookup table (`resources/compairer/card5_dic_zipped.bin`)
- Dockerfile provided for Railway deployment (Ubuntu 22.04, exposes port 8080)

## Key Design Decisions

- **Zero dependencies** on web frontend — no npm packages, no build step, everything self-contained
- **GTO positions**: UTG, HJ, CO, BTN, SB, BB (6-max)
- **Preflop bet sizing**: 2.5BB RFI; 3bet/4bet scaling varies by position
- **Postflop bet sizing**: 33%/66%/100% pot + all-in options
- **Seeded RNG** in CFR engine ensures undo/replay produces consistent results
- **Precomputed flops**: 103 boards pre-solved for instant lookup; board matching uses rank/suit/connectedness scoring
- **Pot invariant**: `pot + stack*2 ≈ 200BB` must hold at every street (a historically bug-prone area — see DEBUG-CHECKLIST.md §2.2)

## Deployment

- **Web frontend**: Vercel (output directory: `web/`)
- **Serverless API**: Vercel Functions (`api/*.js`)
- **C++ solver**: Railway container (`personalizedgtoteacher-production.up.railway.app`)
- CORS is configured in `vercel.json` for cross-origin POST to `/api/*`

## Common Pitfalls

- `practice.js` is the most complex file (~2,800 lines). Changes here often cause regressions in scoring, pot calculation, or reasoning text.
- Pot/stack math bugs are common — always verify the pot invariant (pot + 2*stack ≈ 200BB).
- Reasoning text must avoid technical jargon ("CFR solver", "Nash equilibrium") — write like a poker coach, not a computer scientist.
- C++ solver proxy has a 9s timeout; if solver takes longer, the request fails and JS fallback activates.
- Score display can "flash" if async results overwrite stale state — guard against race conditions in scoring callbacks.
- `DEBUG-CHECKLIST.md` contains 50+ manual QA items for systematic verification after changes.
