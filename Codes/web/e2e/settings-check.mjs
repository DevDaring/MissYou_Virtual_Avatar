import { chromium } from 'playwright-core'
import os from 'os'
const B = 'https://missyou.koushikdeb.com'
const b = await chromium.launch({ executablePath: `${os.homedir()}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome` })
const page = await (await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true })).newPage()
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && r.status() !== 401) errs.push(`${r.status()} ${r.request().method()} ${r.url().replace(B, '')}`) })
page.setDefaultTimeout(8000)
await page.goto(`${B}/login?jury=1`); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL('**/home')
await page.goto(`${B}/settings`); await page.waitForTimeout(1500)
const log = async (n, f) => { try { await f(); console.log('ok  ', n) } catch (e) { console.log('FAIL', n, String(e).split('\n')[0].slice(0, 150)) } }
const sw = page.getByRole('switch')
console.log('switches:', await sw.count(), 'checkboxes:', await page.getByRole('checkbox').count())
await log('toggle each switch twice', async () => { for (const s of await sw.all()) { await s.click(); await s.click() } })
await log('display name + save', async () => { await page.getByLabel('What should we call you?').fill('Jury'); await page.getByRole('button', { name: 'Save', exact: true }).first().click(); await page.waitForTimeout(800) })
await log('selects', async () => { for (const s of await page.locator('select').all()) { const v = await s.inputValue(); const opts = await s.locator('option').allInnerTexts(); if (opts.length > 1) { await s.selectOption({ index: 1 }); await s.selectOption(v) } } })
await log('sliders/number inputs', async () => { for (const r of await page.locator('input[type=range], input[type=number]').all()) { const v = await r.inputValue(); await r.fill(v) } })
await log('save calls prefs', async () => { const btns = await page.getByRole('button', { name: /^Save/ }).all(); for (const x of btns) if (await x.isEnabled()) await x.click(); await page.waitForTimeout(800) })
await log('festival chip add', async () => { await page.getByRole('button', { name: /Diwali/ }).first().click(); await page.getByRole('button', { name: /^Remove Diwali/ }).first().waitFor() })
await log('remove special day', async () => { await page.getByRole('button', { name: /^Remove Diwali/ }).first().click(); await page.waitForTimeout(800) })
await log('buy pack (payments not configured)', async () => { await page.getByRole('button', { name: /^Buy / }).first().click(); await page.waitForTimeout(1500) })
await log('export download', async () => { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('link', { name: 'Download my data' }).click()]); console.log('     zip bytes', (await import('fs')).statSync(await d.path()).size) })
await log('delete account blocked for demo', async () => { await page.getByRole('button', { name: 'Delete my account' }).click(); await page.getByRole('textbox').last().fill('DELETE'); await page.getByRole('button', { name: /Delete/ }).last().click(); await page.waitForTimeout(1200); await page.getByRole('button', { name: 'Keep my account' }).click() })
console.log('errors:', errs)
await page.screenshot({ path: process.argv[2] || '/tmp/settings.png', fullPage: true })
await b.close()
