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
