import { chromium } from 'playwright-core'
import os from 'os'
const B = 'https://missyou.koushikdeb.com'
const b = await chromium.launch({ executablePath: `${os.homedir()}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
for (const [w, h, tag] of [[1865, 940, 'desktop'], [390, 844, 'phone']]) {
  const page = await (await b.newContext({ viewport: { width: w, height: h }, permissions: ['microphone'] })).newPage()
  await page.goto(`${B}/login?jury=1`); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL('**/home')
  await page.getByRole('button', { name: /Call/ }).first().click(); await page.waitForURL('**/call/**'); await page.waitForTimeout(9000)
  await page.screenshot({ path: `${process.argv[2]}/layout-${tag}.png` })
  await page.getByRole('button', { name: /End call|কল শেষ|कॉल खत्म/ }).dblclick(); await page.waitForTimeout(1500)
}
await b.close()
