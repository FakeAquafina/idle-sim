# Idle Village Sim — notes for Claude Code

Read `docs/HANDOFF.md` first: it holds the project's state, the decisions already
made, and what is pending. Don't re-ask settled decisions.

## Who you're working with
The owner is a beginner-ish, learn-as-I-go coder. Explain non-obvious choices in a
sentence when you introduce them. Prefer the simplest structure that works: small
files named by purpose, plain Node + systemd over heavier infrastructure, ARM-friendly.

## Layout
npm workspaces: `shared/` (types, Zod schemas, catalog), `server/` (Fastify + WS,
deterministic sim, Claude "brains"), `client/` (Vite + PixiJS viewer).
Art is drawn in code in `client/src/render/sprites.ts`; the view angle is `TILE_H`
in `client/src/render/projection.ts`.

## Working here
- Node 22. On macOS with Homebrew: `export PATH=/opt/homebrew/bin:$PATH`.
- `npm run dev` runs server (:3000) and client (:5173). The server reads `SIM_PORT`,
  not `PORT`. Vite proxies `/ws` and `/api`, so the dev viewer counts as local for admin.
- `npm test` (Vitest, server) and `npm run typecheck` (both packages) before committing.
- Secrets: `server/.env` in development, `/etc/idle-sim/env` on the deployed box.
  Never print the admin token or API key. Send admin commands with
  `cd server && npx tsx scripts/admin.ts '{"cmd":"speed","value":20}'`.
- To preview later seasons locally: `setAi false`, `speed 200` (≈18 s per sim day),
  then restore `speed 1` and `setAi true`. Don't edit a running world's stock by hand.
- Claude calls: `claude-haiku-5-5` for routine decisions, `claude-sonnet-5-5` for the
  chronicle and other big moments, `claude-opus-5-5` only for the moderator (owner-triggered),
  via `client.beta.messages.parse` + Zod. Prompt
  cache is keyed per output schema, so rare calls showing `cached 0` is expected.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
