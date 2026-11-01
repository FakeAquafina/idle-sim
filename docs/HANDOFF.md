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
3b. Ownership economy, fresh start with a hidden shrine, market and merchant, journeys
   with discoveries, and the Opus moderator (see decisions below).
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
- Graphics: the owner rejected Kenney's smooth isometric sets (wrong vibe) and chose the
  pixel-art **Cozy Isometric Exterior** by Choco Ted (itch.io). The free version is in use:
  grass (flat tiles + a cliff cell for the map's near edges), the 47-tile path autotile
  (used for dirt), two green and two dry trees, two cottages. Its licence forbids
  redistribution, so `client/public/pack/` is gitignored; `client/scripts/pack.mjs`
  unpacks a dropped zip into named PNGs + `manifest.json` (runs on `npm run build`), and
  `client/src/render/pack.ts` loads them. Without the pack the viewer draws everything in
  code exactly as before. With it: villagers/animals draw at 2×, code-drawn buildings at
  1.8× height (`setBuildScale`), houses are 2×4 tiles with a 2-tile margin, several
  footprints grew (storehouse 4×3, mine/workshop 3×3, pen 4×3, market 3×2), and zoom
  snaps to whole numbers. Credit shown in the hint bar. The pack's grid is 32×16 like ours,
  so the view angle stays 16. Buying the full pack would let the remaining buildings move
  over; the mapping lives in `pack.mjs` (WANT) and `scene.ts` (`drawStructureView`).
- Fresh worlds (built): villagers start with the clothes on their backs, no buildings at
  all; a wood and a rocky outcrop lie within a short walk of the camp (`w.camp`). The
  shrine is placed hidden at generation 10-22 tiles out (`Structure.hidden`), drawn faint
  in the viewer, and discovered when anyone comes within `DISCOVERY_RADIUS`; petitions
  need it found first. Old saves load fine: `persist.ts` fills in the new fields.
- Economy (built; `server/src/sim/stock.ts` is the heart of it): each villager has
  `stock` (owned, kept at home or at the camp) and `coins`; households share; the
  worker keeps the yield (gather/fish/hunt/mine/harvest; pen milk goes to the keeper).
  Blueprints cost nothing to lay out (needs village-wide `canAfford`) and carry
  `delivered`; helpers fetch materials from home or the common store and bring them
  over, then work. The storehouse is the common store (`w.storehouse`): `donate` goal
  for surplus, `eat`/build fall back to it. Market stall (`goods`, `till`) with fixed
  `PRICES`; `trade` goal sells for coin from the till or buys with coin. A merchant
  (`merchant.ts`) comes every 3 sim days to buy from the stall and leave seeds/ore/food,
  or hints to build a stall if there is none. Grants from the owner stay free and go to
  the storehouse, or are shared out among bundles while there is none.
- Claude actions grew: forage, donate, trade ("sell wood"/"buy seeds"), explore. The
  system prompt explains ownership; the villager prompt lists own/household/common stock,
  the stall, the merchant and blueprint needs.
- Journeys (built; `server/src/sim/journey.ts`): a grown villager may leave by the north
  road (`journey` goal, autopilot urge is rare and trait-weighted; Claude action `journey`;
  `cannotJourney` holds the rules: one away at a time, adults, not hungry, 3-day gap, not
  while a blueprint waits). Away villagers have `v.away`, sit off-map, skip needs and
  goals, and are not drawn. 80% return after 1-3 days with coin, seeds or ore, and a
  discovery from `DISCOVERIES` (each found once; `discoveryBonus()` in world.ts and the
  needs code apply them). 20% never return: after 5 days `departed = true`, `alive =
  false`, no obituary but a "journey_lost" event and a chronicle page.
- Moderator (built; `server/src/brain/moderator.ts`, Opus 5.5, owner-triggered only):
  admin command `moderate` on a petition → Opus writes a structured proposal
  (`ProposalOutputSchema`) → stored in `server/data/proposals.json` and shown in the
  petitions panel (admin only) with Approve / Set aside → approving writes
  `docs/proposals/<id>-<slug>.md` in the checkout and pings the phone. Nothing in the
  running world changes; the owner then asks a Claude Code session to implement the file.
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

- Art pack follow-ups: more of the pack (full version) for storehouse, well, market,
  workshop; a pack sprite for saplings; the cliff edge only shows on two sides (fine).
- The moderator has not been exercised against the real API yet (no key in the cloud
  session): the first real proposal is worth reading closely, and the system prompt in
  `moderator.ts` is where to tune its taste.
- Untested on the box: a long run with Claude on under the new economy. Watch for
  villagers hoarding (KEEP levels in `autopilot.ts`), blueprints stalling for want of a
  contributor, and the merchant's till running dry.
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
