# Idle Village Sim

An always-on village that runs on a server and can be watched from any browser.
Villagers roam, gather, farm, build, and (from Phase 2) are driven by Claude, with
guardrails. You are the unseen provider: villagers can ask you for things, and you
can grant them.

## Layout

- `shared/` — types, structure catalog, WebSocket protocol (used by both sides)
- `server/` — Node + Fastify: the simulation loop, viewer hub, persistence
- `client/` — Vite + PixiJS viewer (thin: it only mirrors and draws server state)
- `deploy/` — systemd unit for the Linux host; `Dockerfile` for containers

## Run locally

```bash
npm install
cp .env.example server/.env   # set ADMIN_TOKEN to a long random string
npm run dev                   # server on :3000, viewer on http://localhost:5173
```

Open `http://localhost:5173/?token=YOUR_ADMIN_TOKEN` once to unlock the admin bar
(pause, speed, reset). The token is remembered in that browser.

## Claude-driven villagers

With `ANTHROPIC_API_KEY` set in `server/.env`, each villager asks Claude
(`claude-haiku-5-5`) what to do roughly every two real minutes, or sooner when
idle. Claude returns a structured decision (action, something to say, a memory
note, optionally a petition) which the server validates against the world before
it becomes a goal. Anything invalid, any API error, or an exhausted budget drops
the villager back to the rule-based autopilot, so the village never stalls.

Spend is capped per rolling hour (default $0.15, about $3.60/day flat out).
The 🧠 meter in the top bar shows spend vs cap; admins can change the cap or
switch AI off entirely from the admin bar.

## Petitions, gifts, rumors

You are the unseen provider. When the village genuinely lacks something a
villager may walk to the shrine and ask for it (wood, stone, food, seeds, a
newcomer, or a blessing). Requests appear in the **Shrine petitions** panel.
Admins can grant, half-grant, grant with a whispered message, or deny. Gifts
appear as a crate by the storehouse; villagers remember both answers and
silence. Admins can also drop unprompted gifts and whisper rumors that villagers
will gossip about for a couple of days.

Optional notifications: set `NTFY_URL` (e.g. `https://ntfy.sh/your-topic`) or
`DISCORD_WEBHOOK` in `server/.env` to get a message when a petition is made, a
newcomer arrives, a season turns, or the hourly budget is hit (batched, at most
one message per minute).

## Time

1 sim day = 1 real hour at speed 1x. A season is 7 days, a year 28 days.
The server saves `server/data/world.json` every 30 seconds and on shutdown, and
appends every event to `server/data/events.jsonl`.

## Tests

```bash
npm test
```

## Deploy (Linux VM / Raspberry Pi)

```bash
npm ci && npm run build        # builds client/dist, which the server serves
npm run start                  # or install deploy/idle-sim.service
```

Expose it with Tailscale, a Cloudflare Tunnel, or an HTTPS reverse proxy.
Viewers are read-only; only requests carrying `ADMIN_TOKEN` can change anything.
