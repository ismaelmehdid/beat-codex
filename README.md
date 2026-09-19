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
cp .env.example .env
# fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (Project Settings -> API, anon key only)
npm run dev        # serves on your LAN (--host) so phones can reach it
```

Supabase: any project works, no tables needed. Realtime must be enabled (it is by default). Broadcast/presence use a public channel `raid:<ROOM>`.

## Run the demo

1. Open `http://<laptop-ip>:5173/host` on the projector (full screen).
2. Audience scans the QR (`/join?room=XXXX`), enters a name, appears in the lobby instantly.
3. Press **START**. Phones switch to controller mode: LEFT / RIGHT / FIRE.
4. Beat CODEX (or lose all team lives), watch the podium, then **PLAY AGAIN** keeps everyone connected.

Phones must be able to reach the laptop's URL (same Wi‑Fi) or deploy the static build (`npm run build` → `dist/`) to any static host; the QR always uses `window.location.origin`.

## Debug mode

`/host?debug=true` adds a local keyboard fighter (A/D move, Space fire) and a panel: add fake players, damage CODEX, kill me, force victory/defeat, skip. Works without Supabase.

`?nobloom=1` disables the bloom post-process on weak GPUs.

## Smoke test

```bash
npm run dev &
node scripts/smoke.mjs   # drives the whole host flow headlessly, screenshots into test-results/
```

## Tuning

`src/game/constants.ts`: boss HP scaling (`BOSS_BASE_HP + players * BOSS_HP_PER_PLAYER`), team lives (`max(5, players*3)`), damage, cooldowns, attack interval, phase durations.

## Networking notes

- Presence: join/leave + name only. Broadcast: `INPUT` (phone → host, full state, coalesced, heartbeat while held), `PHASE`/`SNAPSHOT`/`PLAYER_STATE`/`GAME_OVER`/`RESET`/`WELCOME` (host → phones). Positions and physics are never sent.
- The host clears a player's movement if no input update arrives for 1.2s, and on presence leave.
- Free-tier Supabase allows ~100 realtime messages/s per project; phones coalesce inputs to stay well below that with ~20 players.
