/**
 * Real-network end-to-end test: one host page + two phone contexts over the configured Supabase project.
 *   node scripts/e2e-network.mjs [baseUrl]
 * Checks: join -> names on host, START -> controllers, RIGHT moves the right fighter, FIRE tap + hold shoot,
 * death -> "YOU DIED" -> respawn, victory -> personal rank screens, PLAY AGAIN -> waiting, phone leave -> host drops it.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5173'
mkdirSync('test-results/e2e', { recursive: true })
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const room = Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`)
}
const errors = []
const wire = (page, tag) => {
  page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|WebGL|GPU stall/i.test(m.text())) errors.push(`${tag} console.error: ${m.text().slice(0, 300)}`)
  })
}
const textHas = async (page, re, timeout = 15000) => {
  try {
    await page.waitForFunction((src) => new RegExp(src, 'i').test(document.body.innerText), re.source, { timeout })
    return true
  } catch {
    return false
  }
}
const world = (host) => host.evaluate(() => JSON.parse(JSON.stringify(window.__beatcodex.world())))
const playerByName = async (host, name) => Object.values((await world(host)).players).find((p) => p.name === name)
const hold = async (page, re, ms) => {
  const loc = page.getByRole('button', { name: re }).first()
  const box = await loc.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await sleep(ms)
  await page.mouse.up()
}
const tap = async (page, re) => hold(page, re, 60)

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const hostCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } })
const host = await hostCtx.newPage()
wire(host, 'host')
const phoneCtx = async () => browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const c1 = await phoneCtx()
const c2 = await phoneCtx()
const p1 = await c1.newPage()
const p2 = await c2.newPage()
wire(p1, 'p1')
wire(p2, 'p2')

try {
  await host.goto(`${base}/host?room=${room}`, { waitUntil: 'networkidle' })
  check('host lobby shows room', await textHas(host, new RegExp(`ROOM\\s*${room}`), 10000))
  check('host connected to supabase', await textHas(host, /SCAN TO JOIN/, 5000))

  for (const [p, name] of [[p1, 'ALICE'], [p2, 'BOB']]) {
    await p.goto(`${base}/join?room=${room}`, { waitUntil: 'networkidle' })
    await p.getByRole('textbox').fill(name)
    await p.getByRole('button', { name: /join/i }).click()
    check(`${name} phone shows YOU'RE IN`, await textHas(p, /YOU.RE IN/, 15000))
  }
  await p1.screenshot({ path: 'test-results/e2e/p1-waiting.png' })
  check('host lobby lists ALICE', await textHas(host, /ALICE/, 15000))
  check('host lobby lists BOB', await textHas(host, /BOB/, 15000))
  check('host lobby says 2 PLAYERS READY', await textHas(host, /2 PLAYERS READY/, 5000))
  await host.screenshot({ path: 'test-results/e2e/host-lobby.png' })

  await host.getByRole('button', { name: /^start$/i }).first().click()
  check('ALICE phone becomes controller', await textHas(p1, /FIRE/, 10000))
  check('BOB phone becomes controller', await textHas(p2, /FIRE/, 10000))
  await p1.screenshot({ path: 'test-results/e2e/p1-controller.png' })

  // wait for PLAYING
  await host.waitForFunction(() => window.__beatcodex.world().phase === 'PLAYING', null, { timeout: 10000 })
  await sleep(300)
  const before = await playerByName(host, 'ALICE')
  await hold(p1, /→|right/i, 900)
  await sleep(600)
  const after = await playerByName(host, 'ALICE')
  // headless SwiftShader runs a few fps and the engine clamps dt, so simulated time is slow: only require clear movement
  check('RIGHT moves ALICE right', after.x > before.x + 0.5, `x ${before.x.toFixed(1)} -> ${after.x.toFixed(1)}`)
  check('release stops ALICE', after.vx === 0 && !after.input.right, `vx=${after.vx}`)
  const bobBefore = await playerByName(host, 'BOB')
  check('BOB did not move', Math.abs(bobBefore.x - (await playerByName(host, 'BOB')).x) < 0.01)

  for (let i = 0; i < 3; i++) {
    await tap(p1, /fire/i)
    await sleep(500)
  }
  await sleep(800)
  const aliceShots = (await playerByName(host, 'ALICE')).shotsFired
  check('3 FIRE taps -> ALICE fired 3 shots', aliceShots === 3, `shotsFired=${aliceShots}`)

  await hold(p2, /fire/i, 2000)
  await sleep(600)
  const bobShots = (await playerByName(host, 'BOB')).shotsFired
  check('FIRE held 2s -> BOB auto-fired 3..6 shots', bobShots >= 3 && bobShots <= 6, `shotsFired=${bobShots}`)
  await sleep(2500)
  const w1 = await world(host)
  const alice = Object.values(w1.players).find((p) => p.name === 'ALICE')
  check('ALICE damage attributed', alice.damageDealt > 0, `damageDealt=${alice.damageDealt}`)
  check('boss HP dropped by total damage', Math.abs(w1.boss.maxHp - w1.boss.hp - Object.values(w1.players).reduce((s, p) => s + p.damageDealt, 0)) < 0.01)

  // death & respawn
  await host.evaluate((id) => window.__beatcodex.kill(id), alice.id)
  check('ALICE phone shows YOU DIED', await textHas(p1, /YOU DIED/, 5000))
  await p1.screenshot({ path: 'test-results/e2e/p1-dead.png' })
  const dead = await playerByName(host, 'ALICE')
  check('team lives decremented', w1.teamLives - (await world(host)).teamLives === 1)
  check('ALICE deaths=1', dead.deaths === 1)
  await sleep(3800)
  const respawned = await playerByName(host, 'ALICE')
  check('ALICE respawned with full hp', respawned.alive && respawned.hp === 100)
  check('ALICE phone back to controller', !(await p1.locator('body').innerText()).includes('YOU DIED') && (await textHas(p1, /FIRE/, 3000)))

  // victory -> results on phones
  await host.evaluate(() => window.__beatcodex.forceVictory())
  check('ALICE phone shows result rank', await textHas(p1, /#\s*[12]|YOU FINISHED #[12]/, 8000))
  check('BOB phone shows DAMAGE stat', await textHas(p2, /DAMAGE/, 8000))
  await p1.screenshot({ path: 'test-results/e2e/p1-result.png' })
  await p2.screenshot({ path: 'test-results/e2e/p2-result.png' })
  const ranking = (await world(host)).ranking
  check('ranking has 2 entries sorted by damage', ranking.length === 2 && ranking[0].damageDealt >= ranking[1].damageDealt)

  // play again
  await host.getByRole('button', { name: /skip/i }).first().click().catch(() => {})
  await host.waitForFunction(() => window.__beatcodex.world().phase === 'RESULTS', null, { timeout: 20000 })
  await host.getByRole('button', { name: /play again/i }).first().click()
  check('ALICE phone back to waiting', await textHas(p1, /Waiting for the host/i, 8000))
  check('host lobby still lists both', (await textHas(host, /ALICE/, 5000)) && (await textHas(host, /BOB/, 2000)))
  const reset = await world(host)
  check('stats reset', Object.values(reset.players).every((p) => p.damageDealt === 0 && p.deaths === 0 && p.shotsFired === 0 && p.hp === 100))
  check('boss reset', reset.boss.hp === reset.boss.maxHp && reset.projectiles.length === 0)

  // leave
  await c2.close()
  const gone = await host.waitForFunction(() => !Object.values(window.__beatcodex.world().players).some((p) => p.name === 'BOB'), null, { timeout: 20000 }).then(() => true).catch(() => false)
  check('BOB removed from lobby after leaving', gone)
  await host.screenshot({ path: 'test-results/e2e/host-lobby-after-leave.png' })
} catch (e) {
  check('script completed', false, e.message)
  await host.screenshot({ path: 'test-results/e2e/failure-host.png' }).catch(() => {})
  await p1.screenshot({ path: 'test-results/e2e/failure-p1.png' }).catch(() => {})
}

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed; page errors: ${errors.length}`)
for (const e of [...new Set(errors)].slice(0, 20)) console.log('  ', e)
process.exit(failed.length || errors.length ? 1 : 0)
