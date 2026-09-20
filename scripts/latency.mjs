/**
 * Measures where phone input latency actually goes.
 *   node scripts/latency.mjs [baseUrl]
 * Both pages run on this machine, so Date.now() is a shared clock and the three stages
 * (phone scheduling -> Supabase relay -> host apply) can be separated.
 */
import { chromium } from 'playwright'
const base = process.argv[2] ?? 'http://localhost:5173'
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const room = Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]
const stat = (name, a) =>
  console.log(`${name.padEnd(34)} median ${String(Math.round(pct(a, 0.5))).padStart(4)} ms   p90 ${String(Math.round(pct(a, 0.9))).padStart(4)} ms   n=${a.length}`)

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })

// Host: record Date.now() the moment shotsFired increments.
const host = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await host.addInitScript(() => {
  window.__fires = []
  window.__moveOn = []
  const tick = () => {
    const w = window.__beatcodex && window.__beatcodex.world()
    if (w) {
      window.__prev = window.__prev || {}
      window.__prevR = window.__prevR || {}
      for (const p of Object.values(w.players)) {
        if (window.__prev[p.id] !== undefined && p.shotsFired > window.__prev[p.id]) window.__fires.push(Date.now())
        window.__prev[p.id] = p.shotsFired
        const r = !!p.input.right
        if (window.__prevR[p.id] === false && r) window.__moveOn.push(Date.now())
        window.__prevR[p.id] = r
      }
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
await host.goto(`${base}/host?room=${room}&nobloom=1`, { waitUntil: 'networkidle' })

// Phone: record pointerdown time and the moment the INPUT frame leaves the socket.
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await ctx.addInitScript(() => {
  window.__press = []
  window.addEventListener('pointerdown', () => window.__press.push(Date.now()), true)
})
const phone = await ctx.newPage()
await phone.goto(`${base}/join?room=${room}`, { waitUntil: 'networkidle' })
await phone.getByRole('textbox').fill('LAT')
await phone.getByRole('button', { name: /join/i }).click()
await host.waitForFunction(() => Object.values(window.__beatcodex.world().players).some((p) => p.name === 'LAT'), null, { timeout: 15000 })
await host.getByRole('button', { name: /^start$/i }).first().click()
await host.waitForFunction(() => window.__beatcodex.world().phase === 'PLAYING', null, { timeout: 15000 })
await host.evaluate(() => window.__beatcodex.setBossPaused(true))
await sleep(600)

// Round-trip probe: a broadcast echoed back to the same client measures one hop out and one back.
const rtt = await phone.evaluate(async (roomId) => {
  const mod = await import('/src/lib/supabase.ts')
  const ch = mod.supabase.channel(`probe:${roomId}`, { config: { broadcast: { self: true, ack: false } } })
  const times = []
  let resolveOne
  ch.on('broadcast', { event: 'PING' }, (m) => resolveOne && resolveOne(Date.now() - m.payload.t))
  await new Promise((res) => ch.subscribe((s) => s === 'SUBSCRIBED' && res()))
  for (let i = 0; i < 15; i++) {
    const p = new Promise((res) => (resolveOne = res))
    ch.send({ type: 'broadcast', event: 'PING', payload: { t: Date.now() } })
    times.push(await Promise.race([p, new Promise((r) => setTimeout(() => r(-1), 3000))]))
    await new Promise((r) => setTimeout(r, 150))
  }
  await mod.supabase.removeChannel(ch)
  return times.filter((t) => t >= 0)
}, room)

// Tap FIRE well apart so the 450 ms cooldown never masks a shot.
const btn = phone.getByRole('button', { name: /fire/i }).first()
const box = await btn.boundingBox()
await phone.evaluate(() => { window.__press = [] })
await host.evaluate(() => { window.__fires = [] })
for (let i = 0; i < 12; i++) {
  await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await phone.mouse.down()
  await sleep(70)
  await phone.mouse.up()
  await sleep(700)
}
await sleep(800)

// --- mashed taps: the case a real player produces ---
const mashBtn = phone.getByRole('button', { name: /fire/i }).first()
await phone.evaluate(() => { window.__pressMash = []; window.addEventListener('pointerdown', () => window.__pressMash.push(Date.now()), true) })
await host.evaluate(() => { window.__fires = [] })
const mashStart = Date.now()
for (let i = 0; i < 14; i++) {
  await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await phone.mouse.down()
  await sleep(45)
  await phone.mouse.up()
  await sleep(110)
}
await sleep(900)
const mashPress = (await phone.evaluate(() => window.__pressMash)).filter((t) => t >= mashStart)
const mashFires = await host.evaluate(() => window.__fires)

// --- movement: press RIGHT, time until the host actually moves the fighter ---
const rb = await phone.getByRole('button', { name: /right/i }).first().boundingBox()
const moveLat = []
for (let i = 0; i < 10; i++) {
  await host.evaluate(() => { window.__moveOn = [] })
  await phone.evaluate(() => { window.__mv = [] ; window.__mvOnce = window.__mvOnce || window.addEventListener('pointerdown', () => window.__mv.push(Date.now()), true) })
  await phone.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2)
  await phone.mouse.down()
  await sleep(320)
  await phone.mouse.up()
  const t0 = (await phone.evaluate(() => window.__mv)).pop()
  const t1 = (await host.evaluate(() => window.__moveOn))[0]
  if (t0 && t1) moveLat.push(t1 - t0)
  await sleep(350)
}

const press = await phone.evaluate(() => window.__press)
const fires = await host.evaluate(() => window.__fires)
const tps = await host.evaluate(() => new Promise((res) => {
  const t0 = window.__beatcodex.world().tick, s = performance.now()
  setTimeout(() => res(Math.round((window.__beatcodex.world().tick - t0) / ((performance.now() - s) / 1000))), 1000)
}))

// Pair each press with the first send/fire after it.
const after = (arr, t) => arr.find((x) => x >= t)
const total = []
for (const t of press) {
  const f = after(fires, t)
  if (f !== undefined && f - t < 3000) total.push(f - t)
}
console.log(`\nhost loop: ${tps} ticks/s\n`)
stat('supabase round trip (out+back)', rtt)
stat('END TO END press -> shot fired', total)
const mAfter = (arr, t) => arr.find((x) => x >= t)
const mashTotal = []
for (const t of mashPress) { const f = mAfter(mashFires, t); if (f !== undefined && f - t < 3000) mashTotal.push(f - t) }
stat('MASHED taps -> shot fired', mashTotal)
stat('MOVEMENT press -> host moves', moveLat)
console.log(`mashed: ${mashPress.length} taps produced ${mashFires.length} shots in ${((mashPress.at(-1) - mashPress[0]) / 1000).toFixed(1)}s`)
console.log(`\none-way relay estimate: ~${Math.round(pct(rtt, 0.5) / 2)} ms`)
await browser.close()
