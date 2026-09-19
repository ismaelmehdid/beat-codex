# BEAT CODEX

Live-audience multiplayer boss fight. The host laptop renders the game; every phone that scans the QR code becomes a gamepad.

**Anthropic hackers vs CODEX.**

## Stack

Vite · React · TypeScript · React Router · Three.js · @react-three/fiber · drei · rapier · Supabase Realtime (presence + broadcast) · qrcode.react

No server. The host browser is the authoritative game server; Supabase Realtime is only the transport.

## Setup

```bash
nvm use            # Node 22 (.nvmrc)
npm install
cp .env.example .env.local
# fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (Project Settings -> API, anon key only)
npm run dev        # serves on your LAN (--host) so phones can reach it
```

Supabase: any project works, no tables needed. Realtime must be enabled (it is by default). Broadcast/presence use a public channel `raid:<ROOM>`.

### Required before a big demo

Raise **Max events per second** in Project Settings -> Realtime. Every broadcast counts once per subscriber, so one phone input in a room of 20 costs 21 events. The free default of 100/s is exceeded from roughly 6 active phones, and the server then closes the channel mid-fight. The host prints a clear console error if that happens. The phones already throttle themselves: the host advertises a minimum input interval that grows with the room size.

## Run the demo

1. Open `http://<laptop-ip>:5173/host` on the projector (full screen).
2. Audience scans the QR (`/join?room=XXXX`), enters a name, appears in the lobby instantly.
3. Press **START**. Phones switch to controller mode: LEFT / RIGHT / FIRE.
4. Beat CODEX (or lose all team lives), watch the podium, then **PLAY AGAIN** keeps everyone connected.

Phones must be able to reach the laptop's URL (same Wi‑Fi) or deploy the static build (`npm run build` → `dist/`) to any static host; the QR always uses `window.location.origin`.

## Debug mode

`/host?debug=true` adds a local keyboard fighter (A/D move, Space fire) and a panel: add fake players, damage CODEX, kill me, force victory/defeat, skip. Works without Supabase.

`?nobloom=1` disables the bloom post-process on weak GPUs.

## Tests (headless Chromium via Playwright)

```bash
npm run dev &
node scripts/smoke.mjs          # host flow offline: lobby -> fight -> death -> victory -> podium -> results -> play again -> defeat
node scripts/e2e-network.mjs    # real Supabase: host + 2 phones join, move, fire, die, respawn, results, play again, leave
```

Both write screenshots to `test-results/` and exit non-zero on page errors or failed checks. The e2e test needs the Supabase env vars.

## Demo-day checklist

- Laptop and phones on the same network, or deploy `dist/` (static) and open the deployed `/host`.
- Open `/host` once and keep the tab: the room code is kept in `sessionStorage`, so an accidental reload keeps the same room and phones re-handshake automatically.
- Full-screen the browser (F11) and hide the cursor. Bloom on; if the GPU struggles, reload with `?nobloom=1`.
- Fight length is tuned around 45 to 60 s for a 10-player crowd; adjust `BOSS_HP_PER_PLAYER` in `src/game/constants.ts` if the crowd is much bigger or smaller.

## Arena axes

The camera sits behind the squad looking down the lane at CODEX, so:

- **X is the lane axis.** The squad holds a line near `PLAYER_LINE_X`, CODEX looms at `BOSS_X`, and every projectile travels along it. Players never control X; each fighter gets a fixed row offset so a crowd has depth.
- **Z is the strafe axis.** The only axis players move on, and it reads across the screen. CODEX locks onto a player's Z at the moment it fires and sends the orb straight down that lane with no lead, so the only way out is to move sideways. Stand still and you get hit.

## Tuning

`src/game/constants.ts`: boss HP scaling (`BOSS_BASE_HP + players * BOSS_HP_PER_PLAYER`), team lives (`max(8, players*3)`), damage, cooldowns, phase durations. CODEX's attack cadence scales with the crowd via `bossAttackIntervalFor` (2.4s for a tiny squad down to 0.9s at 17+), because the boss targets one living player at a time and a small group would otherwise be focused down.

Brand colors live in `src/lib/colors.ts`: fighters wear Claude orange with a per-player accent, CODEX and everything it owns use the Codex blues. Logos are in `public/logos/`.

## Networking notes

- Presence: join/leave + name only, bound to `sync` only (the `join`/`leave` callbacks fire before the state is committed). Broadcast: `INPUT` (phone → host, full state, coalesced, heartbeat while held), `PHASE`/`SNAPSHOT`/`PLAYER_STATE`/`GAME_OVER`/`RESET`/`WELCOME` (host → phones). Positions and physics are never sent.
- The host clears a player's movement if no input update arrives for 2.4s, and on presence leave.
- A movement release is sent immediately plus a duplicate; a fire release is coalesced, since the worst case is one extra shot bounded by the cooldown.
- Socket heartbeat is 5s and the phone flags the connection when the host goes silent for 4s, so a dead Wi-Fi path surfaces in ~10s rather than ~50s.
