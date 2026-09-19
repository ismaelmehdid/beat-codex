/**
 * Headless smoke test for the host flow. Requires the dev server (npm run dev) to be running.
 *   node scripts/smoke.mjs [baseUrl]
 * Drives /host?debug=true through LOBBY -> COUNTDOWN -> PLAYING -> VICTORY -> PODIUM -> RESULTS -> LOBBY,
 * screenshots every phase into test-results/, and fails on uncaught page errors.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5173'
mkdirSync('test-results', { recursive: true })

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
})
const errors = []
const warnings = []
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  const text = m.text()
  if (m.type() === 'error') errors.push(`console.error: ${text}`)
  else if (m.type() === 'warning') warnings.push(`console.warn: ${text}`)
})

const shot = (name) => page.screenshot({ path: `test-results/${name}.png` })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clickText = async (re, timeout = 5000) => {
  const loc = page.getByRole('button', { name: re }).first()
  await loc.waitFor({ state: 'visible', timeout })
  await loc.click()
}
const phaseText = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400)

let step = 'open'
try {
  await page.goto(`${base}/host?debug=true`, { waitUntil: 'networkidle' })
  await sleep(1500)
  await shot('01-lobby')
  console.log('[lobby]', await phaseText())

  step = 'add fakes'
  await clickText(/add 5 fakes/i)
  await sleep(300)
  await shot('02-lobby-players')

  step = 'start'
  await clickText(/^start$/i)
  await sleep(1200)
  await shot('03-countdown')
  console.log('[countdown]', await phaseText())

  step = 'playing'
  await sleep(3500)
  await shot('04-playing')
  // local player controls
  await page.keyboard.down('d')
  await sleep(600)
  await page.keyboard.up('d')
  for (let i = 0; i < 6; i++) {
    await page.keyboard.down(' ')
    await sleep(60)
    await page.keyboard.up(' ')
    await sleep(200)
  }
  await page.keyboard.down('a')
  await sleep(500)
  await page.keyboard.up('a')
  await sleep(2500)
  await shot('05-fight')
  console.log('[fight]', await phaseText())

  step = 'damage'
  await clickText(/damage codex/i)
  await clickText(/kill me/i)
  await sleep(1200)
  await shot('06-dead')
  await sleep(3000)

  step = 'victory'
  await clickText(/force victory/i)
  await sleep(2500)
  await shot('07-victory')
  console.log('[victory]', await phaseText())
  await sleep(4000)
  await shot('08-podium-start')
  await sleep(5000)
  await shot('09-podium-winner')
  await sleep(6000)
  await shot('10-results')
  console.log('[results]', await phaseText())

  step = 'play again'
  await clickText(/play again/i)
  await sleep(800)
  await shot('11-lobby-again')
  console.log('[lobby again]', await phaseText())

  step = 'defeat'
  await clickText(/^start$/i)
  await sleep(4500)
  await clickText(/force defeat/i)
  await sleep(2000)
  await shot('12-defeat')
  console.log('[defeat]', await phaseText())
  await clickText(/skip/i, 8000).catch(() => {})
  await sleep(800)
  await shot('13-results-defeat')

  // Phone screens (no Supabase locally: expect the not-configured message; still must not crash)
  step = 'phone'
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  phone.on('pageerror', (e) => errors.push(`phone pageerror: ${e.message}`))
  phone.on('console', (m) => m.type() === 'error' && errors.push(`phone console.error: ${m.text()}`))
  await phone.goto(`${base}/join?room=A7KQ`, { waitUntil: 'networkidle' })
  await sleep(800)
  await phone.screenshot({ path: 'test-results/20-phone-join.png' })
  console.log('[phone]', (await phone.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200))
  await phone.goto(`${base}/join`, { waitUntil: 'networkidle' })
  await sleep(500)
  await phone.screenshot({ path: 'test-results/21-phone-noroom.png' })
} catch (e) {
  errors.push(`step "${step}" failed: ${e.message}`)
  await shot('99-failure').catch(() => {})
}

await browser.close()
const realErrors = errors.filter((e) => !/favicon|THREE\.WebGLRenderer: Context Lost|SwiftShader|GPU stall/i.test(e))
console.log(`\nwarnings: ${warnings.length}`)
for (const w of [...new Set(warnings)].slice(0, 10)) console.log('  ', w.slice(0, 300))
console.log(`errors: ${realErrors.length}`)
for (const e of [...new Set(realErrors)].slice(0, 30)) console.log('  ', e.slice(0, 500))
process.exit(realErrors.length ? 1 : 0)
