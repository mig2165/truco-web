# Truco Web — Workspace Rules

## 1. Repository Structure & Build Workflow
- **Two-package monorepo** (`client/` and `server/`), with no root `package.json`.
  - `server/`: Express 5 + Socket.IO 4 + TypeScript (`strict: true` in `server/tsconfig.json`), JSON persistence in `data/` via `JsonDatabase` (`server/src/database.ts`).
  - `client/`: React 19 + TypeScript + Vite (`client/eslint.config.js`).
- **Builds & Render parity (`render.yaml`):**
  - Always verify both builds after edits:
    - `npm --prefix server run build` (`tsc`)
    - `npm --prefix client run build` (`tsc -b && vite build`)
  - Express (`server/dist/index.js`) serves `client/dist/` on port `3001`. Whenever `client/src/` changes, rebuild `client` before testing on `localhost:3001` or pushing.
  - On Windows PowerShell, chain commands with `;` rather than `&&`.

## 2. Truco Game Logic & State Machine Invariants
When modifying `server/src/gameManager.ts`, `server/src/gameLogic.ts`, or `client/src/components/GameTable.tsx`:

- **Modes & Table Capacity:**
  - `duel` (1v1): 2 players, `duelCardCount` of `3` (first to 2 tricks) or `5` (first to 3 tricks).
  - `classic` (2v2): 4 players, 3 cards per hand (first to 2 tricks).
- **11-Point Cap & Endgame Flow (`ENDGAME_ENTRY_SCORE = 11`, `GAME_WIN_SCORE = 12`):**
  - Normal round scoring in **both** `duel` and `classic` must cap at `11` (`awardPoints`). Never let a non-endgame round jump directly to `12`.
  - One side at `11` triggers `MAO_DE_ONZE_DECISION`; both sides at `11-11` triggers `MAO_DE_FERRO`.
  - During `MAO_DE_ONZE_DECISION`, only `maoDeOnzeTeam` receives/sees their cards; the opposing side receives `hand: []` until `mao_de_onze_play` is accepted.
  - `mao_de_onze_play` sets `roundPoints = 3`, enables `maoDeOnzeActive = true` (blocking Truco/Double/Triple raises), and sets `startingPlayerIndex` / `currentTurnIndex` to the accepting player (unless a subsequent Mão Baixa/Real hand switch updates `currentTurnIndex`).
  - `mao_de_onze_run` (Reshuffle) awards `1` point to the opponent (still capped at `11`) and deals a fresh round.
- **Truco & Mão Calls:**
  - `truco` (3 pts) requires `totalTricks >= 1`; `double` (6 pts) and `triple` (9 pts) cannot be called consecutively by `lastCallTeam`.
  - Keep call response UIs in `GameTable.tsx` to a **single** prompt box (never duplicate top/bottom banners): **Call It / Let It Go** for Mão Baixa/Real, and **Accept / Fold** for Truco raises.
- **Trick History & Round-End Reveal:**
  - Record completed tricks in `state.trickHistory`, include it in `emitState`, and reset it in `startNewRound` and `resetRoomToWaiting`.
  - On `round_end` / `game_end` (including early ends via `forfeit_round` or Truco fold), reveal unplayed hands for `2000` ms before starting the next round.

## 3. Privacy, Security & Bucks Economy
- **Hand Masking (`emitState`):** During active play, only expose `player.hand` to the owning socket, `exposedHand` bluffers, `maoDeOnzeTeam` teammates, `secretDebugActive` (non-prod only), or at `round_end`/`game_end`. Never expose hands during `maoDeFerroActive`.
- **Server-Authoritative Economy (`server/src/economy.ts`, `server/src/auth.ts`):** Keep Bucks strictly virtual/closed-loop. Never trust client-side balance or payout math; validate and deduplicate match rewards server-side per `roomId`.

## 4. Pre-Push Verification
- Before committing or pushing to `main`:
  1. Run `npm --prefix server run build` and `npm --prefix client run build` (catch strict TS / unused variable errors before Render deploys).
  2. Run socket/mode smoke tests (`npm --prefix client run smoke:dev-room` or mode tests) whenever `gameManager.ts` or `gameLogic.ts` was touched.
