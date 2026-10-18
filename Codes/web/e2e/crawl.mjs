// Click-every-button crawler (non-destructive) as the jury account.
// Usage: BASE=https://missyou.koushikdeb.com node e2e/crawl.mjs ./e2e-shots
import { chromium } from 'playwright-core'
import fs from 'fs'
import os from 'os'

const B = process.env.BASE || 'https://missyou.koushikdeb.com'
const OUT = process.argv[2] || './e2e-shots'
fs.mkdirSync(OUT, { recursive: true })
const exe = process.env.CHROME || `${os.homedir()}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`
const SKIP = /delete|remove|revoke|end call|sign out|retry|cancel job|suspend|adjust credits|^buy|regenerate|create this moment|start an interview|begin the journey|session \d|last call|archive|build their voice|use sample|find the people|send|call ma|call dadu|📞|enable|disable|pin|save|refresh health|search|create invite|approve|decline|resolve|dismiss|reviewed|mark as read|tap to|i understand|create my account|continue|this is them|use these photos|download|diwali|durga|puja|eid|holi|christmas|new year|bhai|poila|baishakh/i
const PAGES = ['/', '/home', '/history', '/memories', '/letters', '/settings', '/admin', '/faq', '/terms', '/privacy', '/support']
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const issues = []
let where = ''
page.on('pageerror', (e) => issues.push(`${where}: pageerror ${String(e).slice(0, 160)}`))
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) issues.push(`${where}: HTTP ${r.status()} ${r.url().replace(B, '')}`) })
page.setDefaultTimeout(8000)

await page.goto(`${B}/login?jury=1`)
await page.getByRole('button', { name: 'Sign in', exact: true }).click()
await page.waitForURL('**/home')
const people = await page.evaluate(async () => (await (await fetch('/api/people')).json()).people.map((p) => p.id))
PAGES.push(...people.map((id) => `/people/${id}`))

let clicked = 0
for (const path of PAGES) {
  where = path
  await page.goto(`${B}${path}`); await page.waitForTimeout(1500)
  const tabs = await page.getByRole('tab').allInnerTexts()
  const targets = new Set()
  for (const sel of ['button', 'link', 'tab']) {
    for (const el of await page.getByRole(sel).all()) {
      if (!(await el.isVisible().catch(() => false))) continue
      const name = ((await el.getAttribute('aria-label')) || (await el.innerText().catch(() => '')) || '').trim().split('\n')[0]
      if (name && !SKIP.test(name)) targets.add(`${sel}::${name}`)
    }
  }
  for (const t of targets) {
    const [role, name] = t.split('::')
    where = `${path} → [${role}] ${name}`
    try {
      if (page.url() !== `${B}${path}`) { await page.goto(`${B}${path}`); await page.waitForTimeout(900) }
      // tabs stay on the same page; re-open the tab that holds the control when needed
      let el = page.getByRole(role, { name, exact: true }).first()
      if (!(await el.isVisible().catch(() => false))) for (const tb of tabs) { await page.getByRole('tab', { name: tb }).click().catch(() => {}); if (await el.isVisible().catch(() => false)) break }
      if (!(await el.isVisible().catch(() => false))) continue
      const href = role === 'link' ? await el.getAttribute('href') : null
      if (href && (href.startsWith('tel:') || href.startsWith('http') && !href.startsWith(B))) { clicked++; continue }
      await el.click({ timeout: 5000 }); clicked++
      await page.waitForTimeout(700)
      const dlg = page.getByRole('dialog')
      if (await dlg.isVisible().catch(() => false)) await page.keyboard.press('Escape')
    } catch (e) { issues.push(`${where}: click failed ${String(e).split('\n')[0].slice(0, 120)}`) }
  }
  await page.screenshot({ path: `${OUT}/crawl${path.replace(/\W+/g, '_') || '_root'}.png` })
}
console.log(`clicked ${clicked} controls on ${PAGES.length} pages; ${issues.length} issue(s)`)
for (const i of issues) console.log('  ' + i)
await browser.close()
