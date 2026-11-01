# Handoff — state of the village as of 2026-11-01

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
   pinch zoom, phone layout, admin settings panel, live view angle (`?angle=N`),
   TV mode (`?tv=1` or the T key: panels hidden, caption strip, self-driving
   camera, wake lock; `client/src/ui/tv.ts`).
5. Deployment: `deploy/install.sh` (Node 22, build, `/etc/idle-sim/env`, systemd),
   `deploy/push.sh` (rsync over SSH, alternative to git pull), `deploy/Caddyfile`.

## Decisions already made (don't re-ask)

- The owner is the unseen provider; grants are free (no favor economy in v1).
- Petitions are collective and rare: half the village must gather at the shrine;
  only after a persistent shortage the land can't fix; 2-day cooldown.
- The land provides: coast/fishing, mines/ore, deer and goats, farms, workshop.
- 1 sim day = 1 real hour; 7-day seasons; aging in sim-years.
- Haiku 5.5 for routine, Sonnet 5.5 (with server-side refusal fallback) for big moments
  (the chronicle, obituaries, welcomes, building names). Opus was judged too much for this.
  Budget target a few dollars a day; population cap setting bounds spend.
- Scale: 8 starting villagers, population cap 20 (default), 64×64 map. Feature counts in
  world gen scale with map area.
- Trees regrow: standing forest thickens, and in spring/summer seeds the grass beside it;
  saplings (amount ≤ 2) are never cut. Nothing regrows within 5 tiles of a building.
- Conversations: at most two at once; a third pair just nods and moves on. Lines ≤ 90
  chars, 4 s each; a chat waiting on Claude gets canned lines after 20 s.
- Animals are not fenced by the map: they graze across the edge, vanish once well beyond
  it, and new ones walk in from the edge twice a day while the herd is thin. Hunters and
  tamers give up on an animal that has left the map.
- Outside news comes from public RSS, summarized server-side; blocklist in `server/src/news.ts`.
- No Docker. Plain Node + systemd in an unprivileged Debian 12 LXC on the owner's Proxmox.
- No port forwarding: the owner reaches the box over Tailscale. Admin is allowed from
  private addresses only (LAN, Tailscale 100.64/10 and fd7a:, loopback); the server ignores
  the token from any public address, and the viewer only sends a stored token when the
  page was opened on a private/Tailscale/localhost host (`isPrivateHost` in `main.ts`,
  `isPrivateAddress` in `hub.ts`). `ADMIN_REMOTE=1` is a dev-only escape hatch.
- Behind a reverse proxy, `TRUST_PROXY` names the proxy address so forwarded client
  addresses are believed (loopback by default). Not used in the Tailscale setup.
- View angle: classic 16 (TILE_H). The owner tried 20 and 14; what looked "weird" was
  the tiled-floor ground and black void around the map, both fixed. `?angle=N` tunes it live.
- Graphics: move to an asset pack now. A CC0 Kenney isometric set (owner has no
  preference), committed into the repo, tiles and buildings from the pack with code-drawn
  villagers kept until a matching character set turns up. The view angle becomes fixed at
  the pack's 2:1 (TILE_H 16) and the live `?angle` tuning goes. 3D is parked.
- Fresh worlds (decided, being built): villagers start with the clothes on their backs,
  no buildings at all; the starting area is rich enough to survive and build. The shrine
  exists on the map from generation, away from the start, and is *discovered* when
  someone walks near it; petitions need it found first.
- Economy (decided, being built): villagers own what they gather, share within a
  household, and trade surplus with each other for coin at a market stall; travellers
  sell what the land lacks. Grants from the owner stay free.
- Journeys (decided, not built): a villager may leave the map on a journey; some never
  come back. Those who return bring discoveries: quality-of-life items and inventions
  that let the village evolve.
- Moderator (decided, not built): an Opus "moderator" can be activated on a petition to
  write up a world-building proposal; it goes to the owner for approval, and only then is
  a Claude Code session asked to make the changes.
- TV: the owner has a Samsung smart TV and Rokus. `?tv=1` ambient mode is built (see
  above); next is trying it in Samsung's browser, then optionally a Tizen hosted web
  app. A Proxmox video streamer for the Rokus was judged too heavy.
- Children wander within 4 tiles of their house (`CHILD_ROAM` in `autopilot.ts`), so a
  string of wanders no longer walks a toddler to the map edge.
- Speech bubbles stack upward when they would overlap (frontmost speaker keeps theirs
  by their head) and fade in and out; see `layoutBubbles` in `scene.ts`.
- Claude spend for the rolling hour is mirrored to `server/data/budget.json` so a restart
  no longer resets the cap.

## The deployed box

- Proxmox LXC `ai-sim`, user `murph`, LAN IP 192.168.0.118, code at `~/idle-sim`,
  service `idle-sim`, config `/etc/idle-sim/env` (root:murph, 640).
- Update: `cd ~/idle-sim && git pull && bash deploy/install.sh` (safe to rerun; never
  touches `server/data`).
- The box started a fresh world on 2026-10-30; the Mac's dev world was not copied.
- Remote access is via an existing Tailscale subnet router (nothing installed in the LXC).
- Caddy/port forwarding was dropped in favour of Tailscale. `deploy/Caddyfile` stays in
  the repo as an optional extra.
- Unverified at handoff: whether `ANTHROPIC_API_KEY` was added on the box and the first
  Claude calls succeeded. Check `journalctl -u idle-sim -n 30` for
  `[brain] Claude enabled` and `[brain] <name>: <action>` lines.
- Oddity: the dev Mac (192.168.0.122/.133) could never reach 192.168.0.118 (no ARP
  reply) even though the box worked from its console. Possibly a different VLAN/bridge.

## Pending and ideas

- Resource pack: blocked in the cloud session because kenney.nl, itch.io and
  opengameart.org are denied by the environment's network policy. Allow `kenney.nl` under
  the environment's network settings (or drop a pack zip into the repo) and the swap can
  proceed.
- Economy and fresh start, then journeys and discoveries, then the moderator (see decisions).
- Try TV mode on the Samsung TV's browser (`http://<box>:3000/?tv=1`); check the wake
  lock holds and the caption size reads from the sofa (`#tv` font-size in `style.css`).
  Then optionally a Tizen hosted web app. Untested on a real TV as of this handoff.
- Graphics polish list above.
- A lifted speech bubble loses its little tail to the speaker; a thin stem would help.
- Notifications are built but `NTFY_URL`/`DISCORD_WEBHOOK` were never set.

## Moving to another machine

Clone the repo, install Node 22, `npm ci`, `npm run dev`. Then copy by hand what git
does not carry: `server/.env` (API key, admin token), `server/data/world.json`,
`settings.json` and `events.jsonl` if you want the dev village, the GitHub sign-in
(`gh auth login`), and the deploy SSH key `~/.ssh/idle-sim` if you push over SSH
(or make a new one and add it to the box). Claude Code's memory for this project lives
outside the repo, so this file is the memory.
