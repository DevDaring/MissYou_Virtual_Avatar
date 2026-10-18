// Playwright happy path against a running deployment: jury login → call Ma → type → reply → end → reflection.
// Usage: npm run e2e   (BASE=… to target another deployment; CHROME=… for a custom Chromium)
import { chromium } from 'playwright-core'
import os from 'os'
const exe = process.env.CHROME || `${os.homedir()}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`
const out = process.argv[2]
const b = await chromium.launch({ executablePath: exe, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['microphone', 'camera'] })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
const B = process.env.BASE || 'https://missyou.koushikdeb.com'
await page.goto(`${B}/login?jury=1`)
await page.getByRole('button', { name: 'Sign in', exact: true }).click()
await page.waitForURL('**/home')
await page.waitForTimeout(1500)
await page.screenshot({ path: `${out}/live-home.png` })
await page.getByRole('button', { name: /Call Ma/ }).first().click()
await page.waitForURL('**/call/**')
await page.waitForTimeout(1200)
await page.screenshot({ path: `${out}/live-ringing.png` })
await page.waitForTimeout(6500)
await page.screenshot({ path: `${out}/live-call.png` })
await page.getByRole('button', { name: 'Type' }).click()
await page.getByLabel('Message').fill('Ma, do you remember the payesh you made on my birthday?')
await page.getByRole('button', { name: 'Send' }).click()
await page.waitForTimeout(7000)
await page.screenshot({ path: `${out}/live-call-reply.png` })
await page.getByRole('button', { name: 'End call' }).dblclick()
await page.waitForURL('**/after', { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(1500)
await page.screenshot({ path: `${out}/live-after.png` })
console.log('errors:', JSON.stringify(errs.slice(0, 8)))
await b.close()
