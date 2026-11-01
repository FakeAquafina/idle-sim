# Idle Village Sim — Implementation Plan

## Context

Build an always-on idle "window box" simulation: a plot of land where AI-driven villagers roam, chat about village life and real-world headlines, and shape the environment (houses, farms, structures). The world runs continuously on a server at home; the user and friends open a URL from anywhere and watch. Villagers get real autonomy from Claude within guardrails so the world stays coherent and API spend stays low. Villagers can petition the user for help, and the user can grant it.

Decisions made with the user:
- **Server-authoritative, always on.** Simulation runs on a Node server (Proxmox VM/LXC or Raspberry Pi, Linux, possibly ARM). Keeps running with nobody connected. Browsers are thin viewers.
- **Viewers:** shareable view-only link for the user and friends. Admin actions require a token.
- **The user's role:** an unseen provider/spirit. Villagers know someone watches and sometimes answers. Requests read like offerings or prayers; grants arrive as "gifts" (free, user decides, grant/deny/partial).
- **Client:** TypeScript + PixiJS in the browser, served by the same Node process. Top-down placeholders first, isometric later via an isolated projection.
- **AI style:** Hybrid. Claude picks goals, dialogue, and petitions every so often; deterministic code runs movement, building, farming tick by tick.
- **News:** in-world events plus real headlines from public RSS feeds.
- **Designed in from day one:** population dynamics (arrivals, births, aging, death), seasons and weather, phone notifications (ntfy or Discord webhook).
- **Time scale:** 1 sim day = 1 real hour. A season = 7 sim days (~7 real hours), a year = 28 real hours. Aging in sim-years.
- **Scale/cost:** 5–10 villagers, a few dollars per day max. Haiku 5.5 for routine decisions, Opus 5.5 for rare "big moments".
- **User is beginner-ish:** simplest working structure, small files named by purpose, explain as we go.

Project folder `/Users/murph/Documents/Idle-Sim` is empty and not a git repo yet (`git init` in Phase 1). Develop on the Mac; deploy to Linux.

---

## Architecture

```
Idle-Sim/
  package.json              # npm workspaces: shared, server, client
  shared/                   # types + Zod schemas used by both sides
    src/world.ts            # Tile, Structure, Villager, Resource, Season/Weather types
    src/actions.ts          # Goal enum + Petition schema + Zod schema for Claude's output
    src/protocol.ts         # WebSocket message types (snapshot, delta, event, petition, admin)
  server/                   # Node 22 + TypeScript (tsx dev, tsc build), Fastify + @fastify/websocket
    src/index.ts            # boots sim loop, HTTP routes, WS hub, static client
    src/sim/                # deterministic simulation (no network, no rendering)
      world.ts              # grid, tiles, resources, structures
      clock.ts              # sim time, day/night, season, weather state machine
      villager.ts           # needs, inventory, age, skills, goal, memory notes
      population.ts         # arrivals, pairing/births, aging, death, obituaries
      pathfind.ts           # A*
      goals/                # build, farm, gather, talk_to, rest, eat, wander, socialize_at, petition
      tick.ts               # advance one step; seeded RNG
      events.ts             # in-world event log
      autopilot.ts          # fallback goal picker when AI unavailable / over budget
    src/brain/
      scheduler.ts          # WHEN a villager needs a call (triggers, cooldowns, budget)
      claude.ts             # SDK calls, prompt assembly, caching, Zod validation
      persona.ts            # Claude-generated personas for newcomers and newborns
      prompts/              # stable system prompt + per-call templates
      budget.ts             # token/cost accounting per hour, hard cap
    src/petitions.ts        # petition inbox: open/granted/denied, gift delivery into the world
    src/notify.ts           # ntfy / Discord webhook on petition, big moment, death, arrival
    src/news.ts             # RSS fetch, hourly cache, keyword blocklist
    src/net/
      hub.ts                # WS connections, snapshot on join, deltas, events
      admin.ts              # token-checked admin commands (pause, speed, grant, deny, rumor, settings)
    src/persist.ts          # autosave world.json every 30s + on shutdown; events.jsonl append-only
    data/                   # world.json, events.jsonl, petitions.json, villagers.json (seed personas), catalog/*.json
    .env                    # ANTHROPIC_API_KEY, ADMIN_TOKEN, PORT, NTFY_URL or DISCORD_WEBHOOK (gitignored)
  client/                   # Vite + TypeScript + PixiJS 8
    src/net.ts              # WS connect, reconnect, apply snapshot/deltas to a local mirror
    src/render/
      projection.ts         # grid -> screen; top-down now, isometric later
      scene.ts              # tiles, structures, villagers, bubbles, weather overlay, depth sort
      camera.ts
    src/ui/                 # inspector, chronicle, petition inbox (admin), budget meter, season/clock widget, admin bar
    src/main.ts
  Dockerfile                # optional, node:22, multi-arch
  deploy/idle-sim.service   # systemd unit
```

**Flow:** `tick.ts` advances the world ~10 ticks/sec. `hub.ts` sends new viewers a full snapshot, then batched deltas (~5/sec) and discrete events. The client mirrors and renders. `scheduler.ts` calls Claude independently of viewers.

**Data-driven content:** structures, resources, and goal parameters live in `data/catalog/*.json` so new buildings or gift types don't need code changes. The catalog is also what the system prompt lists, so prompt and sim never drift apart.

**Persistence:** JSON snapshot every 30s and on SIGTERM; `events.jsonl` append-only for chronicle and obituaries; `petitions.json` for the inbox. No database for v1. SQLite later if logs grow.

**Security:** viewers are read-only by protocol. Admin commands carry `ADMIN_TOKEN`. Expose via Tailscale, Cloudflare Tunnel, or HTTPS reverse proxy. Cap viewers (default 25), rate-limit connections.

---

## Petitions and gifts (the user-facing loop)

- **Raising one:** a `petition` is an optional field in Claude's plan output: `{ ask: "wood"|"stone"|"food"|"seeds"|"tool"|"newcomer"|"blessing"|"other", amount?, reason }`. Only allowed when the village genuinely lacks it (server checks stock and open petitions; max 1 open petition per villager, max 3 village-wide). The villager walks to the shrine/campfire and speaks it as a bubble; it lands in the admin inbox and triggers a notification.
- **Granting:** admin inbox lists open petitions with context. Grant, partial grant, or deny (optional one-line message). Gifts spawn as a glowing crate at the storehouse or a "stranger arrives" event for newcomers. The petitioner (and nearby villagers) get a memory note and react in their next conversation. Denials are remembered too, gently ("the spirit was silent").
- **Unprompted gifts and rumors:** admin can also drop a gift or whisper a rumor without a petition. These are the only outside text that reaches villagers.
- Favor/scarcity economy is explicitly out of scope for v1 but the petition record keeps fields (`cost`, `granted_amount`) so it can be added later.

## Population, seasons, weather

- **Population:** starts with 6 seeded personas. Newcomers arrive when housing and food allow (or when granted). Two villagers with high affinity and a home may have a child; children grow through stages (child → adult → elder) on sim-years. Elders eventually die; a funeral event fires, the chronicle records an obituary, friends get a memory note. Target population band 5–12, enforced by arrival/birth rates so cost stays bounded. New personas are generated by a Haiku call from parents/traits (`persona.ts`).
- **Seasons/weather:** `clock.ts` tracks season (spring/summer/autumn/winter, 7 sim-days each) and weather (clear/rain/storm/snow) as a small Markov chain. Farms yield by season, winter raises food need and favors indoor rest, storms pause outdoor building. Both feed Claude's input and the renderer (tint + simple particle overlay).

## Notifications

`notify.ts` posts to ntfy (default, no account needed) or a Discord webhook on: new petition, big moment, birth, death, arrival, budget cap hit. Debounced to at most one message per minute; configurable per event type.

---

## The villager "brain" (hybrid design)

### When Claude is asked
Triggers: no goal, goal finished, nearby notable event, periodic timer (~2 real minutes per villager), season change, gift received. Per-villager cooldown (min 30s) and a global hourly token cap. Over budget or on error → `autopilot.ts` picks from needs. Viewers never notice a seam.

### Input
Stable cached system prompt: world rules, the catalog, who the unseen provider is and how petitions work, tone/content guardrails, output format. Volatile user message: persona, age/stage, needs, inventory, memory notes, nearby villagers/structures, village needs, season/weather, last ~5 events, 2–3 headlines (if enabled), any pending rumor, outcome of their last petition.

### Output — structured, enum-constrained
Zod schema in `shared/src/actions.ts`, enforced with `client.messages.parse` + `zodOutputFormat`:
```
{ thought: string
  say?: string                 // <= 120 chars
  goal: { type: "build"|"farm"|"gather"|"talk_to"|"rest"|"eat"|"wander"|"socialize_at"|"petition", ...params }
  petition?: { ask, amount?, reason }
  memoryNote?: string }
```
Server validates every goal and petition against the world. Invalid → autopilot plus a logged reason.

### Conversations
Two villagers meeting with `talk_to` → one converse call producing a 2–4 line exchange for both. Topics: events, relationship, season, headlines, rumors, recent gifts/denials. A `tone` field nudges affinity.

### Memory
~20 short notes per villager; overflow summarized by Haiku into 2 lines. Village chronicle daily (big moment) written to `events.jsonl`.

### Big moments (Opus 5.5, rare)
Daily chronicle, naming a finished building, village council for shared decisions, obituaries, newcomer welcome. Few calls/day. Server-side refusal fallback enabled per current API guidance; on refusal, skip and log.

### Models and settings
| Use | Model | Notes |
|---|---|---|
| Plan, converse, memory summary, persona gen | `claude-haiku-5-5` | `output_config.effort: "low"`, `max_tokens` ~600, cached system prompt |
| Big moments | `claude-opus-5-5` | adaptive thinking (default), effort `medium`, refusal fallback on |

Prompt caching: system prompt and catalog first and frozen at runtime; volatile content in the user message. Verify `usage.cache_read_input_tokens > 0`.

Cost at 8 villagers, one Haiku plan call each per 2 minutes (~3k mostly-cached input + 200 output): about $0.10/hour, ~$2.50/day nonstop. Conversations, personas, and big moments add a fraction. Budget meter visible to viewers; hourly cap enforced; admin can lower it or pause AI.

### Guardrails
- Enum actions; params validated against world state; petitions gated by real need and caps.
- System prompt content rules: in character, light touch on news, no attacks on real people, no slurs; headlines pass a configurable blocklist.
- Rate and budget caps with autopilot fallback; population band caps call volume.
- Memory and speech length limits.
- Only admin rumors/gifts reach villagers from outside.

---

## Environment model

- Grid 48×48, seeded. Tiles: grass, dirt, water, forest, rock, farmland.
- Resources: wood, stone, food, seeds; shared storehouse plus small personal inventories.
- Structures (catalog JSON): house, farm plot, storehouse, well, campfire/plaza, shrine (petition spot), workshop (later). Placement: buildable tiles, no overlap, 1-tile gap. Incremental construction, multiple helpers.
- Needs: hunger, energy, social, warmth (winter).

---

## Phases

### Phase 1 — Scaffold + deterministic server sim + thin viewer
- `git init`, workspaces, Fastify + WS, Vite client, shared package, Vitest, `.gitignore`, `.env.example`, systemd unit, Dockerfile.
- Server sim: map gen, catalog loading, clock with day/night + seasons + weather, villagers with needs and age, A*, goals via `autopilot.ts`, autosave/load.
- WS hub: snapshot, deltas, events. Client mirror, top-down renderer, weather tint, camera, clock/season widget, reconnect.
- Admin: token-gated pause/speed/reset; admin bar with `?token=`.
- Tests: pathfinding, placement, deterministic ticks, snapshot/delta round-trip, season transitions.

### Phase 2 — Claude brain + petitions
- `claude.ts` plan call, cached system prompt, Zod output, typed errors, budget cap. `scheduler.ts` triggers; autopilot fallback.
- Petition pipeline: Claude raises → server gates → inbox → admin grant/deny → gift delivery → memory notes. Notifications via ntfy/Discord.
- Seed personas (6) in `data/villagers.json`. Inspector panel, budget meter, petition inbox UI.

### Phase 3 — Social layer, population, news
- Converse calls, memory summarization, relationships, chronicle panel.
- `population.ts`: arrivals, births, aging, death, funerals; `persona.ts` generation.
- `news.ts`: RSS, cache, blocklist, admin toggle. Rumor injection.
- Big moments: chronicle, naming, obituaries, welcomes (Opus 5.5).

### Phase 4 — Isometric + polish
- Isometric projection, depth sort, placeholder pixel sprites, structure graphics, weather particles.
- UI: tooltips, click-to-inspect, event feed, viewer count, admin settings (feeds, budget cap, population band, notifications).

### Phase 5 — Deploy to the home server
- Build client, `npm ci --omit=dev` on Linux (or Docker), systemd, `.env`, Tailscale or Cloudflare Tunnel. Verify from a phone off the home network.

---

## Verification

- **Phase 1:** `npm run dev`; villagers wander, gather, build with no network; seasons roll over at the right real-time pace (use a speed multiplier to test); second tab sees the same world; restart resumes from `world.json`. `npm test` passes.
- **Phase 2:** Plan calls logged with cache reads; inspector shows thoughts; a villager raises a petition when stock is low, phone gets a notification, granting spawns the crate and the villager reacts; killing outbound network → autopilot, no errors; budget caps.
- **Phase 3:** Conversations happen; a newcomer arrives with a generated persona; an elder dies and the chronicle records it; headlines filtered; rumor shows up in talk.
- **Phase 4:** Isometric depth order correct; usable at phone width.
- **Phase 5:** Service survives reboot; remote viewing works; viewers can't run admin commands without the token.
- Each phase ends with a browser-pane demo and a commit.

## Deferred ideas (noted, not building now)
- Favor/scarcity economy for gifts (petition schema already leaves room).
- Time-lapse / history scrubbing (would need periodic snapshot store).
- Viewers posting rumors (needs moderation).
- Trade, currency, multiple villages, map expansion.

## Open items to settle during build (not blocking)
- Default RSS feeds and blocklist words.
- Summarize headlines into "village gossip" server-side vs. pass raw. Leaning summarized.
- Pi vs. VM decides Docker vs. plain Node + systemd (both supported).
