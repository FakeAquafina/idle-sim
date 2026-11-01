# Idle Village Sim

An always-on village that runs on a server and can be watched from any browser.
Villagers roam, gather, farm, build, and (from Phase 2) are driven by Claude, with
guardrails. You are the unseen provider: villagers can ask you for things, and you
can grant them.

## Layout

- `shared/` — types, structure catalog, WebSocket protocol (used by both sides)
- `server/` — Node + Fastify: the simulation loop, viewer hub, persistence
- `client/` — Vite + PixiJS viewer (thin: it only mirrors and draws server state)
- `deploy/` — push, install and systemd files for the home Linux box

## Run locally

```bash
npm install
cp .env.example server/.env   # set ADMIN_TOKEN to a long random string
npm run dev                   # server on :3000, viewer on http://localhost:5173
```

Open `http://localhost:5173/?token=YOUR_ADMIN_TOKEN` once to unlock the admin bar
(pause, speed, reset, gifts, whispers, settings). The token is remembered in
that browser. Admin only works from private addresses: the home LAN, Tailscale
and the box itself (see "Admin access" below); in development the Vite proxy
counts as local.

## Watching

The view is isometric: drag (or swipe) to pan, scroll or pinch to zoom, and the
⌖ button jumps back to the storehouse. Hover anything for a tooltip; click a
villager or a building to open the inspector (needs, bonds, memories, or who
lives where and how a crop is doing). Clicking an entry in the event feed swings
the camera to where it happened. Night darkens the map and fires and windows
glow; rain, storms (with lightning) and snow fall over the scene. All of the
art is drawn in code (`client/src/render/sprites.ts`), so there are no image
files to manage; swap it for real sprites later without touching the sim.

**TV mode.** Open the viewer with `?tv=1` (or press T) for an ambient picture
suited to a living-room screen: the panels disappear, the pointer hides, a
caption strip along the bottom reads out what just happened and subtitles
whoever the camera is with, and the camera drifts on its own, following a
villager or a building for half a minute at a time and cutting slowly to
births, arrivals, deaths, finished buildings and the like. Touching the screen
pauses the drift for twenty seconds so you can look around; Escape or T goes
back to the normal viewer. The page asks the browser for a screen wake lock so
the TV does not doze off.

## The land provides

The world is meant to hold everything the village needs, if people work for it:

- **Forests** give wood; **rock** gives stone by hand. A **mine** dug beside rock
  strikes a vein of stone and sometimes **ore** (and runs dry eventually).
- The **coast** (one edge of every map) gives fish from the beach, much faster
  from a **dock**.
- **Deer and goats** roam the wilds and flee from people. They can be hunted for
  food, and goats can be led into a **pen**, where they give food over time and
  breed.
- The **woods** also give food to anyone who forages, and now and then a seed.
- A **workshop** costs ore and makes everyone work a quarter faster.
- Trees grow back: standing forest thickens, and in spring and summer seeds the
  grass beside it. Saplings are left alone.

## Who owns what

A new village starts with nothing but the clothes on eight backs: no storehouse,
no fire, no stock. Everyone **owns what they gather**, kept at their house or in
a bundle at the camp; people sharing a house share theirs, and everyone eats
their own food first. Buildings are communal projects: laying one out costs
nothing but makes a blueprint, and whoever helps brings the materials from their
own stock (or the common store) before the work can start, so a house really is
built from wood people cut. A **storehouse**, once someone decides to build one,
is a common store: villagers donate surplus to it and anyone whose own has run
out may draw on it. A **market stall** buys surplus for coin and sells goods to
anyone with coin, and a **travelling merchant** comes down the north road every
few days to restock it (seeds, ore, sometimes food) and buy what has piled up.
Coin enters the village through him and nowhere else.

The **shrine** is not built. An old one stands somewhere out in the land from
the start, faint in the viewer so you can see it and the villagers cannot, and
it is found by whoever first wanders close. Until then nobody can petition.

## Claude-driven villagers

With `ANTHROPIC_API_KEY` set in the env file (`server/.env` in development,
`/etc/idle-sim/env` on a deployed box), each villager asks Claude
(`claude-haiku-5-5`) what to do roughly every two real minutes, or sooner when
idle. Claude returns a structured decision (action, something to say, a memory
note, optionally a petition) which the server validates against the world before
it becomes a goal. Anything invalid, any API error, or an exhausted budget drops
the villager back to the rule-based autopilot, so the village never stalls.

Spend is capped per rolling hour (default $0.15, about $3.60/day flat out).
The 🧠 meter in the top bar shows spend vs cap; admins can change the cap or
switch AI off entirely from the admin bar.

## Petitions, gifts, rumors

You are the unseen provider, and you listen to the village rather than to one
voice. Petitions are rare by design: a shortage must have lasted half a sim day,
the land must offer no way to fix it (no trees left, no rock and no working mine,
no seeds and nothing growing; food is never askable while there is a coast or
game), and at most one petition every two sim days. When all that holds, a
villager may walk to the shrine and call a gathering.
The request only reaches you once at least half the village (minimum two) has
walked there to stand with them; a gathering nobody joins within a sim day
breaks up. Open requests appear in the **Shrine petitions** panel, with
gatherings still collecting voices shown underneath.
Admins can grant, half-grant, grant with a whispered message, or deny. Gifts
appear as a crate by the storehouse, or are shared out among the bundles at the
camp while there is none; villagers remember both answers and silence.

**The moderator.** An open petition also has a *Moderate* button. That sets an
Opus moderator on it: it reads the village's situation and writes a proposal
for how the world itself might grow in answer (a new building, a new rule, a
new kind of event), with a line for the chronicle, risks, and notes for the
developer. The proposal appears in the petitions panel for you to approve or
set aside, and you get a phone notification if those are on. Approving writes
it to `docs/proposals/` in the checkout on the box; nothing in the running
world changes until you start a Claude Code session and ask it to implement
that file. Each proposal is one Opus call (a few cents), only when you ask. Admins can also drop unprompted gifts and whisper rumors that villagers
will gossip about for a couple of days.

Optional notifications: set `NTFY_URL` (e.g. `https://ntfy.sh/your-topic`) or
`DISCORD_WEBHOOK` in the env file to get a message when a petition is made, a
newcomer arrives, someone is born or dies, a couple forms, a building is named,
a season turns, or the hourly budget is hit (batched, at most one message per
minute).

## A living village

- **Conversations.** When a villager goes to talk to someone, Claude writes both
  sides of a short exchange (2-4 lines) that plays out as speech bubbles. The
  tone (warm, neutral, tense) moves their affinity; each may keep a memory of it.
  Without Claude, canned small talk is used instead. At most two conversations
  run at once, so the screen never fills with bubbles.
- **Bonds and families.** Affinity grows out of talk and time by the fire. Two
  close adults sharing a house become partners and may have a child; children
  grow up on sim-years, elders die of old age, and going hungry or cold for a
  day and a half is fatal. Deaths send everyone to the shrine to mourn.
- **Arrivals.** When there is a spare bed and food to spare, strangers walk in
  from the north road (more eagerly while the village is under 5 people). New
  people are invented by Claude (name, traits, quirk, trade), with a spare
  persona from `server/data/newcomers.json` as the fallback. A **population cap**
  (default 20) bounds both growth and API spend.
- **Journeys.** Now and then a grown villager (the curious ones most) shoulders
  a pack and leaves by the north road for a few days; Claude can send someone
  too. Most come back with coin, a little to trade and something the village
  did not have: a better axe, knotted nets, iron wedges, seed lore, wool
  cloaks, salt curing, road songs. Each is found once and changes how the
  village works from then on; the chronicle lists what has been learned. One
  in five never comes back, and after five days the village stops setting a
  place. Only one person is away at a time, never while a blueprint waits.
- **Memory.** Each villager keeps about twenty notes; when they pile up, Claude
  condenses the oldest dozen into a line or two.
- **News.** About once an hour, headlines from public RSS feeds (BBC World, NPR,
  ScienceDaily by default; see `NEWS_FEEDS`) are filtered through a blocklist and
  retold by Claude as a traveller's garbled gossip, which villagers then talk
  about. Switch off, or point at your own feeds, in **Settings**.
- **The chronicle.** `claude-sonnet-5-5` writes a page at the end of each village
  day (when enough happened), plus obituaries, welcomes for newcomers and
  newborns, and names for the dock, mine, workshop, well, shrine and storehouse.
  Open it with the 📜 button. Sonnet calls are gated by the same hourly budget and
  opt into the API's server-side refusal fallback. Switch off in **Settings**.

## Admin settings

The ⚙ **Settings** panel in the admin bar holds everything that can change at
runtime, saved to `server/data/settings.json`: Claude on/off, the hourly spend
cap, the population cap, the chronicle, outside news and its feed URLs, and
phone notifications (which also need `NTFY_URL` or `DISCORD_WEBHOOK` on the
server). The same switches are available as admin commands for the dev script
below (`setAi`, `setBudget`, `setPopulationMax`, `setBigMoments`, `setNews`,
`setNewsFeeds`, `setNotify`).

## Time

1 sim day = 1 real hour at speed 1x. A season is 7 days, a year 28 days.
The server saves `server/data/world.json` every 30 seconds and on shutdown, and
appends every event to `server/data/events.jsonl`.

## Dev scripts

```bash
cd server
npx tsx scripts/smoke-plan.ts 2            # one real Claude call per villager, printed
npx tsx scripts/make-world.ts --seeds 0    # fresh world.json with chosen stock (stop the server first)
npx tsx scripts/admin.ts '{"cmd":"speed","value":20}'   # any admin command, token read from the env file
```

## Tests

```bash
npm test
```

## Deploy (home Linux box)

The village is one Node process plus the `server/data` folder, so it runs
anywhere Node 22 does. On Proxmox, an **unprivileged Debian 12 LXC** is the
right size: 1 CPU, 1 GB RAM, 8 GB disk is plenty, it boots in a second and uses
a few hundred MB at rest. A VM works too and avoids one tweak below, at the
cost of RAM. A Raspberry Pi 4 or 5 is fine as well.

**Reaching it from anywhere:** the box only needs to be on your home network.
If you already run a Tailscale subnet router (or exit node) at home, every
device on your tailnet reaches the box by its LAN address, so nothing extra is
installed in the container. Without one, install Tailscale on the box itself
(`curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`); in
an unprivileged LXC that also needs the TUN device passed through, by adding
these two lines to `/etc/pve/lxc/<id>.conf` on the Proxmox host and restarting
the container:

```
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
```

### First deploy

On the box, once, as root: create your user, let it sudo, and install git.

```bash
apt update && apt install -y sudo git curl
adduser murph && usermod -aG sudo murph
```

Then as that user, clone the repo and run the installer:

```bash
git clone https://github.com/FakeAquafina/idle-sim.git ~/idle-sim
bash ~/idle-sim/deploy/install.sh
```

The installer puts Node 22 on the box, builds the viewer, writes
`/etc/idle-sim/env` with a random admin token (root-owned, readable only by
root and your user, outside the checkout so updates can never touch it), and
installs and starts the `idle-sim` systemd service. Then add your Claude key:

```bash
sudo nano /etc/idle-sim/env        # ANTHROPIC_API_KEY=..., and NTFY_URL if you want phone pings
sudo systemctl restart idle-sim
```

(If the repo is private, clone over SSH or use a fine-grained token with
read access as the password; `gh auth login` on the box also works.)

### Updates

```bash
cd ~/idle-sim && git pull && bash deploy/install.sh
```

The installer is safe to rerun; saved worlds, settings and the event log in
`server/data` are never touched. `deploy/push.sh user@host` still exists for
pushing a working copy straight from a machine that can SSH to the box, without
going through GitHub.

### Sharing the link

On your tailnet the village is simply `http://<box-lan-ip>:3000` (traffic
between tailnet devices is already encrypted). Friends need to be on your
tailnet: invite them from the Tailscale admin console and make sure they are
allowed the subnet route.

### Admin access

The village is reached over Tailscale rather than a public port, so admin is
allowed from any private address: the home LAN (10/8, 172.16/12, 192.168/16),
Tailscale (100.64/10 and its fd7a: IPv6 range) and loopback. Open
`http://<box>:3000/?token=YOUR_ADMIN_TOKEN` once from your phone or laptop on
the tailnet and the admin bar appears and stays unlocked in that browser.

Even if the box were ever exposed, the public side stays read-only:

- **Admin commands are never honoured from a public address.** The WebSocket
  hub checks the connection's address; from the internet the admin token is
  ignored, even if it leaks. The viewer also never sends or stores a token
  unless the page was opened on a private or Tailscale host. (Set
  `ADMIN_REMOTE=1` in the env file to turn the address check off; don't on a
  public box.)
- Viewers can't change anything; they receive world state and events only.
  The API key, admin token and notification URLs never leave the server.
- Connections are capped at 25 total and 5 per address, and messages at 64 KB.

Admin also works from the box's console (Proxmox or SSH):

```bash
cd ~/idle-sim/server && npx tsx scripts/admin.ts '{"cmd":"grant","petitionId":"p3"}'
```

or open the full admin UI through an SSH tunnel, which makes it local:

```bash
ssh -L 3000:localhost:3000 murph@<box>      # then open http://localhost:3000/?token=...
```

Petition ids are in the event feed and `/api/state`.

### Port forwarding with Caddy (optional)

Not needed when you reach the box over Tailscale, which is the current setup;
kept for anyone who wants a public address. Caddy gives you automatic HTTPS and passes WebSockets through untouched. You
need a DNS name pointing at your home's public IP (your own domain, or a free
dynamic-DNS name such as DuckDNS), and router ports 80 and 443 forwarded to the
box. Port 80 is only used to obtain the certificate.

On the box:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
sudo cp ~/idle-sim/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile              # put your real hostname in place of village.example.com
sudo systemctl reload caddy
```

Then make Node listen only on loopback, so the only ways in are Caddy and an
SSH tunnel:

```bash
sudo nano /etc/idle-sim/env                 # SIM_HOST=127.0.0.1
sudo systemctl restart idle-sim
```

Caddy reports each visitor's real address to the server (`X-Forwarded-For`),
and the server believes that header only from loopback (`TRUST_PROXY`), so
visitors arriving through the proxy are still treated as remote: no admin for
them, and the per-address cap counts them properly. The admin path is
unchanged: the SSH tunnel or `scripts/admin.ts` on the box.

If you'd rather not open router ports at all, a **Cloudflare Tunnel** or
`tailscale funnel` on your subnet-router box gets HTTPS with no forwarding.

### Day to day on the box

```bash
systemctl status idle-sim          # is it up
journalctl -u idle-sim -f          # live log: Claude calls, chats, news, chronicle
sudo systemctl restart idle-sim    # after editing /etc/idle-sim/env
cp -r ~/idle-sim/server/data ~/village-backup-$(date +%F)   # back up the world
```
