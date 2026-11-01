# Handoff — state of the village as of 2026-10-31

This file lets a fresh machine, or a fresh Claude Code session, pick the project
up without the original chat. The original plan is in `docs/PLAN.md`.

## What exists

All five phases of the plan are built and on GitHub (`FakeAquafina/idle-sim`, public):

1. Deterministic server sim (48×48 map, seasons, weather, needs, A*, autopilot goals),
   WebSocket hub, autosave, event log.
2. Claude-driven villagers (Haiku picks goals; server validates), collective petitions
   at the shrine, gifts, rumors, ntfy/Discord notifications, hourly spend cap.
3. Conversations written by Claude, relationships, partners, births, arrivals, aging,
   deaths, memory condensing, real-world RSS headlines retold as travellers' gossip,
   Opus-written chronicle (daily page, obituaries, welcomes, building names).
4. Isometric viewer with code-drawn pixel art, seasons (snowy winter), weather
   particles, night lights, tooltips, click-to-inspect, event-feed camera jumps,
   pinch zoom, phone layout, admin settings panel, live view angle (`?angle=N`).
5. Deployment: `deploy/install.sh` (Node 22, build, `/etc/idle-sim/env`, systemd),
   `deploy/push.sh` (rsync over SSH, alternative to git pull), `deploy/Caddyfile`.

## Decisions already made (don't re-ask)

- The owner is the unseen provider; grants are free (no favor economy in v1).
- Petitions are collective and rare: half the village must gather at the shrine;
  only after a persistent shortage the land can't fix; 2-day cooldown.
- The land provides: coast/fishing, mines/ore, deer and goats, farms, workshop.
- 1 sim day = 1 real hour; 7-day seasons; aging in sim-years.
- Haiku 5.5 for routine, Opus 5.5 (with server-side refusal fallback) for big moments.
  Budget target a few dollars a day; population cap setting bounds spend.
- Outside news comes from public RSS, summarized server-side; blocklist in `server/src/news.ts`.
- No Docker. Plain Node + systemd in an unprivileged Debian 12 LXC on the owner's Proxmox.
- Admin is loopback-only: the server ignores the admin token from any other address,
  and the viewer never sends a token unless opened on localhost. Admin happens via
  `scripts/admin.ts` on the box or an SSH tunnel (`ssh -L 3000:localhost:3000 murph@box`).
  `ADMIN_REMOTE=1` is a dev-only escape hatch.
- Behind a reverse proxy, `TRUST_PROXY` names the proxy address so forwarded client
  addresses are believed (loopback by default).
- View angle: classic 16 (TILE_H). The owner tried 20 and 14; what looked "weird" was
  the tiled-floor ground and black void around the map, both fixed. `?angle=N` tunes it live.
- Graphics direction (discussed, not started): polish the code-drawn style first
  (double pixel density, integer zoom, water shimmer, swaying trees, hats and tools
  by trade, worn paths), then decide about an asset pack. 3D is parked.
- TV: the owner has a Samsung smart TV and Rokus. Plan: Samsung's browser first, then a
  `?tv=1` ambient mode in the viewer (panels hidden, caption strip, bigger text, slow
  camera drift to events, cursor hidden, wake lock), then optionally a Tizen hosted web
  app. A Proxmox video streamer for the Rokus was judged too heavy.

## The deployed box

- Proxmox LXC `ai-sim`, user `murph`, LAN IP 192.168.0.118, code at `~/idle-sim`,
  service `idle-sim`, config `/etc/idle-sim/env` (root:murph, 640).
- Update: `cd ~/idle-sim && git pull && bash deploy/install.sh` (safe to rerun; never
  touches `server/data`).
- The box started a fresh world on 2026-10-30; the Mac's dev world was not copied.
- Remote access is via an existing Tailscale subnet router (nothing installed in the LXC).
- Caddy runs on a separate machine at 192.168.0.107. Pending: add the site block from
  `deploy/Caddyfile` there with `reverse_proxy 192.168.0.118:3000`, forward router
  ports 80/443 to .107, point a DNS name at the public IP, and set
  `TRUST_PROXY=192.168.0.107` in `/etc/idle-sim/env` on the village box
  (`SIM_HOST` stays `0.0.0.0` since the proxy is remote).
- Unverified at handoff: whether `ANTHROPIC_API_KEY` was added on the box and the first
  Claude calls succeeded. Check `journalctl -u idle-sim -n 30` for
  `[brain] Claude enabled` and `[brain] <name>: <action>` lines.
- Oddity: the dev Mac (192.168.0.122/.133) could never reach 192.168.0.118 (no ARP
  reply) even though the box worked from its console. Possibly a different VLAN/bridge.

## Pending and ideas

- Networking steps above (Caddy, DNS, port forward, TRUST_PROXY).
- TV mode (`?tv=1`), then a Tizen hosted web app.
- Graphics polish list above.
- Speech bubbles overlap when several villagers chat at the campfire; stagger or fade.
- Children get adult goals and wander alone to the map edge days after birth; a rule
  keeping children near home would read better.
- Budget tracking is in-memory and resets on server restart.
- Notifications are built but `NTFY_URL`/`DISCORD_WEBHOOK` were never set.

## Moving to another machine

Clone the repo, install Node 22, `npm ci`, `npm run dev`. Then copy by hand what git
does not carry: `server/.env` (API key, admin token), `server/data/world.json`,
`settings.json` and `events.jsonl` if you want the dev village, the GitHub sign-in
(`gh auth login`), and the deploy SSH key `~/.ssh/idle-sim` if you push over SSH
(or make a new one and add it to the box). Claude Code's memory for this project lives
outside the repo, so this file is the memory.
