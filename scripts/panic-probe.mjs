import { chromium } from 'playwright'
const base = 'http://localhost:5173'
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)
page.on('pageerror', (e) => log('PAGEERROR', e.message, '\n', (e.stack || '').split('\n').slice(0, 12).join('\n')))
page.on('console', (m) => { if (m.type() === 'error') log('console.error', m.text().slice(0, 300)) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const click = async (re) => { log('click', re); await page.getByRole('button', { name: re }).first().click() }
await page.goto(`${base}/host?debug=true`, { waitUntil: 'networkidle' })
await sleep(1000); log('lobby')
await click(/add 5 fakes/i)
await click(/^start$/i)
await sleep(5000); log('playing')
await click(/kill me/i); log('killed')
await sleep(1500)
await click(/force victory/i); log('victory')
for (let i = 0; i < 12; i++) { await sleep(1000); log('tick', i) }
await click(/skip/i).catch(() => {}); log('results')
await sleep(2000)
await click(/play again/i); log('lobby again')
await sleep(1000)
await browser.close()
