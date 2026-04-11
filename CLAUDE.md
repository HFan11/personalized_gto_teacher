# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PokerGTO is a dual-platform poker GTO (Game Theory Optimal) training application with an iOS app (Swift/SwiftUI) and a web app (vanilla JavaScript). Both platforms implement core poker logic independently — they share concepts but not code.

## Build & Run Commands

### Web App
- **Dev server**: `python3 -m http.server 8080 --bind 0.0.0.0 --directory /Users/bytedance/gto/web` (or use preview_start with "poker-gto")
- **Syntax check JS**: `node -c web/js/<file>.js`

### iOS App
- **Build**: `xcodebuild -project PokerGTO.xcodeproj -scheme PokerGTO -destination 'platform=iOS Simulator,name=iPhone 16,OS=latest' -configuration Debug build`

### Tests
- **Swift tests**: `swift test_core.swift` (standalone test file, no test framework)

## Architecture

### iOS (`PokerGTO/`)
- **Models/**: Core data types — `Card`, `Hand`, `Position`, `Action`, `GameState` (ObservableObject for SwiftUI state)
- **Strategy/**: GTO engine — `PreflopRanges` (position-based ranges), `PreflopStrategy`, `PostflopStrategy`, `HandEvaluator`, `EquityCalculator`, `GTOAdvisor` (orchestrator)
- **Views/**: SwiftUI views organized by feature (Preflop/, Postflop/, Calculator/, Components/)

### Web (`web/`)

#### Core Engine
- **js/poker-core.js**: Card evaluation, hand ranking, Monte Carlo equity calculation
- **js/cfr-solver.js**: CFR+ (Counterfactual Regret Minimization Plus) core engine — `InfoSet`, `GameNode`, `CFRSolver` classes. Supports Monte Carlo sampling via `samplesPerIter` option. Includes `LocalSolverBackend`/`RemoteSolverBackend` interface for future server deployment.
- **js/hand-abstraction.js**: Equity bucketing for hand abstraction — `computeEquityBuckets()`, `handToCanonical()`, range expansion utilities
- **js/preflop-solver.js**: Preflop game tree builder + CFR+ solver. Singleton `PreflopSolver.getInstance()`. Solves RFI, vs-raise, vs-3bet, vs-4bet scenarios. ~800ms for full solve with Monte Carlo sampling.
- **js/postflop-solver.js**: Postflop per-street CFR+ solver. Takes hero/villain ranges + board, computes equity buckets, builds bet/check/raise tree, solves in ~1-2s.

#### Application Logic
- **js/practice.js**: Postflop practice mode. `getRecommendation()` tries CFR solver first (`getCFRRecommendation()`), falls back to heuristic method (`_getHeuristicRecommendation()`).
- **js/preflop-practice.js**: Preflop training. `_getCorrectAction()` tries CFR solver (`_getCFRAction()`), falls back to static ranges (`_getStaticAction()`).
- **js/profiles.js**: Player profile management with betting tendencies
- **index.html**: Single-page app entry point (script load order matters: poker-core → cfr-solver → hand-abstraction → preflop-solver → postflop-solver → profiles → preflop-practice → practice)

### C++ Solver (`solver/`)
- **Forked from**: [TexasSolver](https://github.com/bupticybee/TexasSolver) — Qt dependencies stripped
- **Algorithm**: Discounted CFR with OpenMP parallelization, suit isomorphism
- **Hand evaluation**: Pre-computed 7462-rank lookup table (resources/compairer/card5_dic_zipped.bin)
- **API server**: `src/api_server.cpp` using cpp-httplib, POST `/api/solve`
- **Deployed**: Railway at `personalizedgtoteacher-production.up.railway.app`
- **Build**: `cmake -B build && cmake --build build` (Dockerfile provided)

### Server-Side API (`api/`)
- **api/solve-preflop.js**: Vercel Serverless — JS-based preflop solver (fallback)
- **api/solve-postflop.js**: Vercel Serverless — JS-based postflop solver (fallback)
- **C++ API (primary)**: Railway `POST /api/solve` — PIO-level accuracy

### Shared Solver Lib (`lib/`)
- CommonJS modules extracted from web/js/ for Node.js Serverless Functions
- `test-solver.js`: Automated quality tests (`node lib/test-solver.js`)

### Key Design Decisions
- Zero external dependencies on web frontend — everything is self-contained
- UI strings are in Chinese; code comments are in English
- GTO strategy uses 6 positions: UTG, HJ, CO, BTN, SB, BB
- **Dual solver architecture**: JS solver (browser, instant, ~80% accuracy) + C++ solver (server, 5-15s, PIO-level accuracy)
- Preflop: JS CFR with real equity table, Monte Carlo sampling, ~800ms solve
- Postflop: C++ TexasSolver API for PIO-level precision, JS solver as fallback
- Frontend calls `getRemoteRecommendation()` → C++ API, falls back to local `getCFRRecommendation()`
