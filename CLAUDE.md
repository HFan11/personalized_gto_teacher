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

### Key Design Decisions
- Zero external dependencies on both platforms — everything is self-contained
- UI strings are in Chinese; code comments are in English
- GTO strategy uses 6 positions: UTG, HJ, CO, BTN, SB, BB
- All computation runs client-side (no backend API)
- CFR solver uses Monte Carlo sampling (`samplesPerIter: 300`) to keep preflop solve under 1s
- Postflop uses equity-based hand abstraction (30 buckets) + action abstraction (3 bet sizes: 33%/66%/100% pot)
- `SolverBackend` interface allows future migration to server-side C++/Rust solver for higher precision
