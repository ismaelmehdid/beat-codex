/**
 * Frame-time profiler for the host. Runs the fight under load and reports where time goes.
 *   node scripts/profile.mjs [baseUrl]
 */
import { chromium } from 'playwright'
const base = process.argv[2] ?? 'http://localhost:5173'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] ?? 0

async function run(label, { players, bloom, seconds = 12 }) {
  const browser = await chromium.launch({
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.addInitScript(() => {
    window.__ft = []
    let last = performance.now()
    const tick = () => {
      const now = performance.now()
      window.__ft.push(now - last)
      last = now
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.goto(`${base}/host?debug=true${bloom ? '' : '&nobloom=1'}`, { waitUntil: 'networkidle' })
  await sleep(1000)
  const rounds = Math.ceil((players - 1) / 5)
  for (let i = 0; i < rounds; i++) await page.getByRole('button', { name: /add 5 fakes/i }).click()
  await page.getByRole('button', { name: /^start$/i }).first().click()
  await sleep(5500) // countdown + settle
  await page.evaluate(() => { window.__ft.length = 0 })
  const heap0 = (await page.evaluate(() => performance.memory && performance.memory.usedJSHeapSize)) ?? 0
  await sleep(seconds * 1000)
  const heap1 = (await page.evaluate(() => performance.memory && performance.memory.usedJSHeapSize)) ?? 0
  const ft = (await page.evaluate(() => window.__ft)).filter((x) => x > 0 && x < 2000)
  const world = await page.evaluate(() => {
    const w = window.__beatcodex.world()
    return { proj: w.projectiles.length, fx: w.fx.length, players: Object.keys(w.players).length, phase: w.phase }
  })
  await browser.close()
  const slow = ft.filter((x) => x > 20).length
  const stall = ft.filter((x) => x > 50).length
  console.log(
    `${label.padEnd(22)} fps ${String(Math.round(1000 / pct(ft, 0.5))).padStart(3)}` +
      `  p50 ${pct(ft, 0.5).toFixed(1).padStart(5)}ms  p95 ${pct(ft, 0.95).toFixed(1).padStart(6)}ms  p99 ${pct(ft, 0.99).toFixed(1).padStart(6)}ms` +
      `  >20ms ${String(((slow / ft.length) * 100).toFixed(1)).padStart(5)}%  >50ms ${String(stall).padStart(3)}` +
      `  heap +${(((heap1 - heap0) / 1048576) || 0).toFixed(1)}MB  proj ${world.proj} fx ${world.fx}`,
  )
  return { ft, world }
}

console.log('host frame times under load (1920x1080, real GPU)\n')
await run('6 players, bloom', { players: 6, bloom: true })
await run('20 players, bloom', { players: 20, bloom: true })
await run('20 players, NO bloom', { players: 20, bloom: false })
