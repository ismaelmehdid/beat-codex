/**
 * Network load test: N real phone clients on the real Supabase project, all mashing.
 *   node scripts/loadtest.mjs [phones] [baseUrl]
 * Reports input latency under load and any channel drops.
 */
import { chromium } from 'playwright'
const N = Number(process.argv[2] ?? 8)
const base = process.argv[3] ?? 'http://localhost:5173'
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const room = Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] ?? 0

const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
const drops = []
const host = await browser.newPage({ viewport: { width: 1280, height: 720 } })
host.on('console', (m) => {
  const t = m.text()
  if (/channel (CHANNEL_ERROR|TIMED_OUT|CLOSED)|many messages|rate/i.test(t)) drops.push(`host: ${t.slice(0, 120)}`)
})
await host.addInitScript(() => {
  window.__fires = []
  window.__prev = {}
  const tick = () => {
    const w = window.__beatcodex && window.__beatcodex.world()
    if (w) for (const p of Object.values(w.players)) {
      if (window.__prev[p.id] !== undefined && p.shotsFired > window.__prev[p.id]) window.__fires.push(Date.now())
      window.__prev[p.id] = p.shotsFired
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  window.__ft = []; let last = performance.now()
  const ft = () => { const n = performance.now(); window.__ft.push(n - last); last = n; requestAnimationFrame(ft) }
  requestAnimationFrame(ft)
})
await host.goto(`${base}/host?room=${room}&nobloom=1`, { waitUntil: 'networkidle' })

const phones = []
for (let i = 0; i < N; i++) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await ctx.addInitScript(() => {
    window.__press = []
    window.addEventListener('pointerdown', () => window.__press.push(Date.now()), true)
  })
  const p = await ctx.newPage()
  p.on('console', (m) => { if (/CHANNEL_ERROR|TIMED_OUT|CLOSED|many messages/i.test(m.text())) drops.push(`phone${i}: ${m.text().slice(0, 100)}`) })
  await p.goto(`${base}/join?room=${room}`, { waitUntil: 'networkidle' })
  await p.getByRole('textbox').fill(`P${i}`)
  await p.getByRole('button', { name: /join/i }).click()
  phones.push(p)
}
await host.waitForFunction((n) => Object.keys(window.__beatcodex.world().players).length >= n, N, { timeout: 30000 })
await host.getByRole('button', { name: /^start$/i }).first().click()
await host.waitForFunction(() => window.__beatcodex.world().phase === 'PLAYING', null, { timeout: 15000 })
await host.evaluate(() => window.__beatcodex.setBossPaused(true))
await sleep(800)

const boxes = await Promise.all(phones.map((p) => p.getByRole('button', { name: /fire/i }).first().boundingBox()))
await Promise.all(phones.map((p) => p.evaluate(() => { window.__press = [] })))
await host.evaluate(() => { window.__fires = []; window.__ft.length = 0 })

// every phone mashes FIRE for 12s
const stop = Date.now() + 12000
await Promise.all(
  phones.map(async (p, i) => {
    const b = boxes[i]
    while (Date.now() < stop) {
      await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
      await p.mouse.down()
      await sleep(40)
      await p.mouse.up()
      await sleep(90 + Math.random() * 60)
    }
  }),
)
await sleep(1200)

const presses = (await Promise.all(phones.map((p) => p.evaluate(() => window.__press)))).flat().sort((a, b) => a - b)
const fires = await host.evaluate(() => window.__fires)
const ft = (await host.evaluate(() => window.__ft)).filter((x) => x > 0 && x < 2000)
const shots = await host.evaluate(() => Object.values(window.__beatcodex.world().players).reduce((s, p) => s + p.shotsFired, 0))
const lat = []
const pool = fires.slice()
for (const t of presses) {
  const i = pool.findIndex((f) => f >= t)
  if (i >= 0 && pool[i] - t < 2500) { lat.push(pool[i] - t); pool.splice(i, 1) }
}
console.log(`\n${N} phones mashing for 12s`)
console.log(`taps ${presses.length}   shots ${shots}   msgs/s in ≈ ${(presses.length / 12).toFixed(0)}`)
console.log(`input latency   median ${Math.round(pct(lat, 0.5))}ms   p90 ${Math.round(pct(lat, 0.9))}ms   p99 ${Math.round(pct(lat, 0.99))}ms   max ${Math.round(Math.max(...lat, 0))}ms`)
console.log(`host frames     p50 ${pct(ft, 0.5).toFixed(1)}ms  p99 ${pct(ft, 0.99).toFixed(1)}ms  >50ms ${ft.filter((x) => x > 50).length}`)
console.log(`channel drops   ${drops.length}`)
for (const d of [...new Set(drops)].slice(0, 8)) console.log('   ', d)
await browser.close()
