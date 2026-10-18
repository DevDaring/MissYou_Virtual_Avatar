// Full user-journey button test against a live deployment (spends ~ $1 of provider credit: one scene).
// Usage: BASE=https://missyou.koushikdeb.com MIC_WAV=/path/speech.wav node e2e/journey.mjs ./e2e-shots
import { chromium } from 'playwright-core'
import fs from 'fs'
import os from 'os'

const B = process.env.BASE || 'https://missyou.koushikdeb.com'
const OUT = process.argv[2] || './e2e-shots'
fs.mkdirSync(OUT, { recursive: true })
const exe = process.env.CHROME || `${os.homedir()}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`
const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
if (process.env.MIC_WAV) args.push(`--use-file-for-fake-audio-capture=${process.env.MIC_WAV}`)
const browser = await chromium.launch({ executablePath: exe, args })
const results = []
let current = ''

function watch(page, who) {
  page.on('pageerror', (e) => results.push({ step: current, who, kind: 'pageerror', msg: String(e).slice(0, 200) }))
  page.on('response', (r) => {
    const u = r.url(); const s = r.status()
    if (!u.includes('/api/')) return
    if ((s >= 500 && !(s === 503 && u.includes('/otp/'))) || (s >= 400 && ![401, 402, 403, 404, 409, 429, 503].includes(s))) results.push({ step: current, who, kind: `HTTP ${s}`, msg: u.replace(B, '') })
  })
}
async function step(name, page, fn) {
  current = name
  const t = Date.now()
  try { await fn(); results.push({ step: name, ok: true, ms: Date.now() - t }); console.log(`PASS ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`) }
  catch (e) {
    results.push({ step: name, ok: false, msg: String(e).split('\n')[0].slice(0, 220) })
    console.log(`FAIL ${name}: ${String(e).split('\n')[0].slice(0, 220)}`)
    await page.screenshot({ path: `${OUT}/FAIL-${name.replace(/\W+/g, '_')}.png` }).catch(() => {})
  }
}
const ctxOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, permissions: ['microphone', 'camera'], acceptDownloads: true }
const ctx = await browser.newContext(ctxOpts)
const page = await ctx.newPage()
watch(page, 'A')
page.setDefaultTimeout(20000)
const email = `journey${Date.now().toString(36)}@example.com`
let personUrl = ''
let inviteLink = ''

// ---------------------------------------------------------------- public
await step('landing: buttons & jury card', page, async () => {
  await page.goto(B)
  await page.getByRole('link', { name: /Begin gently/ }).first().waitFor()
  for (const b of await page.getByRole('button', { name: /^Copy/ }).all()) await b.click()
  await page.getByRole('link', { name: /Sign in as jury/ }).click()
  await page.waitForURL('**/login?jury=1')
  if ((await page.getByLabel('Username or email').inputValue()) !== 'TestUser') throw new Error('jury prefill missing')
})
await step('legal pages + links', page, async () => {
  for (const p of ['terms', 'privacy', 'faq', 'support']) { await page.goto(`${B}/${p}`); await page.locator('h1').first().waitFor() }
  await page.goto(`${B}/support`); await page.getByText('14416').first().waitFor()
})
await step('login: email-code tab', page, async () => {
  await page.goto(`${B}/login`)
  await page.getByRole('tab', { name: 'Email code' }).click()
  await page.getByLabel('Email').fill('nobody@example.com')
  await page.getByRole('button', { name: 'Send me a code' }).click()
  await page.getByRole('alert').or(page.getByRole('status')).first().waitFor()
})
await step('login: wrong password shows error', page, async () => {
  await page.goto(`${B}/login`)
  await page.getByLabel('Username or email').fill('TestUser')
  await page.getByLabel('Password').fill('wrong-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByText(/doesn't match/).waitFor()
})
await step('signup: under-18 blocked', page, async () => {
  await page.goto(`${B}/signup`)
  await page.getByLabel('Your name').fill('Kid'); await page.getByLabel('Email').fill(`kid${Date.now()}@example.com`)
  await page.getByLabel('Date of birth').fill('2013-04-04'); await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Create my account' }).click()
  await page.getByText(/only for adults/).waitFor()
})
await step('signup: adult account', page, async () => {
  await page.goto(`${B}/signup`)
  await page.getByLabel('Your name').fill('Riya'); await page.getByLabel('Email').fill(email)
  await page.getByLabel(/^Password/).fill('journeypass123'); await page.getByLabel('Date of birth').fill('1992-07-07')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Create my account' }).click()
  await page.waitForURL('**/onboarding')
})
await step('onboarding: slides, back, consent', page, async () => {
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Back' }).click()
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Continue' }).click()
  const btn = page.getByRole('button', { name: 'I understand' })
  await page.getByRole('checkbox').nth(2).waitFor()
  for (const c of await page.getByRole('checkbox').all()) await c.check()
  await btn.click(); await page.waitForURL('**/home')
})
// ---------------------------------------------------------------- setup
await step('home: empty state → add person', page, async () => {
  await page.getByText('Who do you miss?').waitFor()
  await page.getByRole('link', { name: /Someone you miss/ }).click()
  await page.getByLabel('Their name').fill('Arun Ghosh'); await page.getByLabel('What you called them').fill('Dadu')
  await page.getByLabel('They are my…').fill('grandfather'); await page.getByLabel('Call language').selectOption('en')
  await page.getByLabel('Gender (optional)').selectOption('male')
  await page.getByText('Living, but far away').click(); await page.getByText('Passed away').click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForURL('**/setup?step=upload')
  personUrl = page.url().split('/setup')[0]
})
await step('consent gate', page, async () => {
  const confirm = page.getByRole('button', { name: 'I confirm' })
  await page.getByRole('checkbox').nth(3).waitFor()
  for (const c of await page.getByRole('checkbox').all()) await c.check()
  await confirm.click()
  await page.getByRole('button', { name: 'Use sample memories' }).waitFor()
})
await step('upload: own photo + sample kit + remove one', page, async () => {
  await page.locator('input[type=file]').setInputFiles(process.env.EXTRA_PHOTO || [])
  await page.getByRole('button', { name: 'Use sample memories' }).click()
  await page.getByText(/4 files|5 files/).waitFor({ timeout: 60000 })
  if (process.env.EXTRA_PHOTO) { await page.getByRole('button', { name: /Remove/ }).first().click(); await page.waitForTimeout(800) }
})
await step('find faces (job progress)', page, async () => {
  await page.getByRole('button', { name: /Find the people/ }).click()
  await page.waitForURL(/step=faces/, { timeout: 120000 })
  await page.getByText(/We found 3 people|We found \d+ people/).waitFor({ timeout: 30000 })
})
await step('faces: merge & split modes', page, async () => {
  await page.getByRole('button', { name: 'Merge groups' }).click()
  await page.getByRole('button', { name: 'Split a group' }).click()
  await page.getByRole('button', { name: /Person 2/ }).click()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Choose' }).click()
})
await step('faces: choose grandfather (largest group)', page, async () => {
  await page.getByRole('button', { name: /Person 1/ }).click()
  await page.getByRole('button', { name: 'This is them' }).click()
  await page.waitForURL(/step=anchors/, { timeout: 60000 })
})
await step('anchors: restore modal both choices', page, async () => {
  await page.getByRole('button', { name: 'Restore' }).first().click()
  await page.getByRole('button', { name: 'Use restored' }).click({ timeout: 40000 })
  await page.getByRole('button', { name: 'Restore' }).first().click()
  await page.getByRole('button', { name: 'Keep the original' }).click({ timeout: 40000 })
  await page.getByRole('button', { name: 'Use these photos' }).click()
  await page.waitForURL(/step=voice/)
})
await step('voice: clips detected, build clone', page, async () => {
  await page.getByText('Is this their voice?').waitFor({ timeout: 120000 })
  await page.getByRole('button', { name: 'Select all' }).first().click()
  await page.getByRole('button', { name: /Build their voice/ }).click()
  await page.getByText('Listen and choose').waitFor({ timeout: 180000 })
})
await step('voice: rate, presets listen/use, design, select clone', page, async () => {
  await page.getByRole('button', { name: '4 stars' }).first().click()
  await page.getByRole('button', { name: 'Male', exact: true }).click(); await page.getByRole('button', { name: 'Older', exact: true }).click()
  await page.getByRole('button', { name: '▶ Listen' }).first().click(); await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Use', exact: true }).first().click(); await page.waitForTimeout(3000)
  const d = page.getByLabel('Or describe their voice')
  if (await d.count()) { await d.fill('Deep, slow, gentle, with a soft laugh'); await page.getByRole('button', { name: 'Create' }).click(); await page.waitForTimeout(6000) }
  const clone = page.locator('div', { hasText: 'Their own voice (cloned)' }).getByRole('button', { name: /Use this voice|Selected/ }).last()
  await clone.click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForURL(/step=persona/)
})
await step('persona: fill, save, memory add/delete', page, async () => {
  await page.getByLabel('How did they greet you?').fill('Ki khobor, dadubhai?')
  await page.getByLabel('What did they call you?').fill('Dadubhai, Riya-ma')
  await page.getByLabel('Favourite phrases or sayings').fill('Sab thik hoye jabe')
  await page.getByRole('button', { name: 'Save' }).click(); await page.getByText('Saved.').waitFor()
  await page.getByPlaceholder('She made payesh on every birthday').fill('Dadu took me to the Maidan every Sunday to watch cricket.')
  await page.getByRole('button', { name: 'Add' }).click(); await page.getByText(/Maidan every Sunday/).waitFor()
  await page.getByPlaceholder('She made payesh on every birthday').fill('temporary note'); await page.getByRole('button', { name: 'Add' }).click()
  await page.getByRole('button', { name: 'Delete memory' }).first().click()
  await page.getByRole('button', { name: 'Continue' }).click(); await page.waitForURL(/step=scene/)
})
await step('scene: options + generate (real)', page, async () => {
  await page.getByRole('button', { name: /Riverside ghat/ }).click()
  await page.getByRole('button', { name: /Their old home/ }).click(); await page.getByRole('button', { name: /Riverside ghat/ }).click()
  await page.getByRole('button', { name: 'Walking' }).click(); await page.getByRole('button', { name: 'Sitting' }).click()
  await page.getByRole('button', { name: 'Morning' }).click(); await page.getByRole('button', { name: 'Light Rain' }).first().click()
  await page.getByRole('button', { name: 'kurta', exact: true }).click()
  await page.getByRole('button', { name: /Create this moment/ }).click()
  await page.locator('video').first().waitFor({ timeout: 420000 })
  await page.screenshot({ path: `${OUT}/journey-scene.png` })
})
// ---------------------------------------------------------------- call
await step('person page → call', page, async () => {
  await page.getByRole('button', { name: /Done — go to/ }).click()
  await page.getByRole('button', { name: /Call Dadu/ }).click()
  await page.waitForURL('**/call/**'); await page.locator('[aria-live="polite"] div').first().waitFor({ timeout: 45000 })
})
await step('call: controls (more panel, toggles, volume, mute, hands-free)', page, async () => {
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('button', { name: 'Captions' }).click(); await page.getByRole('button', { name: 'Captions' }).click()
  await page.getByRole('button', { name: 'Ambient sound' }).click(); await page.getByRole('button', { name: 'Ambient sound' }).click()
  await page.getByRole('button', { name: 'My camera (local only)' }).click(); await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'My camera (local only)' }).click()
  await page.getByRole('slider').fill('0.6')
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('button', { name: 'Mute' }).click(); await page.getByRole('button', { name: 'Unmute' }).click()
  await page.getByRole('button', { name: 'Hands-free' }).click(); await page.getByRole('button', { name: 'Push-to-talk' }).click()
})
await step('call: hold-to-talk (real speech → STT → reply)', page, async () => {
  await page.waitForTimeout(6000)
  const ptt = page.getByRole('button', { name: 'Hold to talk' })
  const box = await ptt.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
  await page.waitForTimeout(7000); await page.mouse.up()
  await page.getByText(/^You/).first().waitFor({ timeout: 40000 })
  await page.waitForTimeout(9000)
})
await step('call: type a message', page, async () => {
  await page.getByRole('button', { name: 'Type' }).click()
  await page.getByLabel('Message').fill('Dadu, do you remember the Sunday cricket at the Maidan?')
  await page.getByRole('button', { name: 'Send' }).click()
  await page.getByText(/do you remember the Sunday cricket/).waitFor({ timeout: 30000 })
  await page.waitForFunction(() => document.querySelectorAll('[aria-live="polite"] div').length >= 2, null, { timeout: 30000 })
  await page.waitForTimeout(6000)
  await page.screenshot({ path: `${OUT}/journey-call.png` })
})
await step('call: report modal', page, async () => {
  await page.waitForTimeout(6000)
  await page.getByRole('button', { name: 'Something felt wrong' }).click()
  await page.getByPlaceholder('What felt wrong?').fill('Test report from automated journey')
  await page.getByRole('button', { name: 'Send report' }).click(); await page.getByText('Thank you for telling us.').waitFor()
})
await step('call: end (goodbye) → after-call', page, async () => {
  await page.getByRole('button', { name: 'End call' }).click()
  await page.waitForURL('**/after', { timeout: 60000 })
  await page.getByText('Take a breath.').waitFor()
})
await step('after-call: mood + reflection + support', page, async () => {
  await page.getByRole('button', { name: 'Mood 4 of 5' }).click()
  await page.getByRole('textbox').fill('It was good to hear him.')
  await page.getByRole('button', { name: 'Keep this' }).click(); await page.getByText(/Kept, privately/).waitFor()
  await page.getByText('If today feels heavy').click(); await page.getByText('14416').first().waitFor()
  await page.getByRole('link', { name: /Save a moment/ }).click(); await page.waitForURL('**/history/**')
})
await step('call detail: replay + save to memory box', page, async () => {
  await page.waitForTimeout(1500)
  const save = page.getByRole('button', { name: /memory box/i }).first()
  if (await save.count()) { await save.click(); await page.waitForTimeout(1200) }
  await page.goto(`${B}/history`); await page.getByText(/Dadu/).first().waitFor()
})
await step('memory box: play, download, remove', page, async () => {
  await page.goto(`${B}/memories`)
  await page.getByRole('button', { name: /Remove this memory/ }).first().waitFor({ timeout: 20000 })
  const dl = page.getByRole('link', { name: /Download/i }).or(page.getByRole('button', { name: /Download/i })).first()
  if (await dl.count()) { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), dl.click()]); if (!(await d.path())) throw new Error('download empty') }
  else throw new Error('no memory saved')
  await page.getByRole('button', { name: /Remove this memory/ }).first().click()
  await page.getByRole('button', { name: /^Remove$/ }).last().click().catch(() => {})
})
// ---------------------------------------------------------------- person tabs
await step('person tabs: persona, interview call, closure', page, async () => {
  await page.goto(personUrl)
  for (const t of ['How they talked', 'Memory interview']) await page.getByRole('tab', { name: t }).click()
  await page.getByRole('button', { name: 'Start an interview' }).click()
  await page.waitForURL('**/call/**'); await page.waitForTimeout(9000)
  await page.getByRole('button', { name: 'End call' }).dblclick(); await page.waitForURL('**/after', { timeout: 40000 })
  await page.goto(personUrl); await page.getByRole('tab', { name: 'Closure journey' }).click()
  await page.getByRole('button', { name: 'Begin the journey' }).click()
  await page.getByRole('button', { name: 'Pause the journey' }).click()
})
await step('person tabs: family invite + places', page, async () => {
  await page.getByRole('tab', { name: 'Family' }).click()
  await page.getByPlaceholder('Their email (optional)').fill('cousin@example.com')
  await page.getByRole('button', { name: 'Create invite' }).click()
  inviteLink = (await page.locator('.font-mono').first().innerText()).trim()
  await page.getByRole('tab', { name: 'Places' }).click()
  await page.getByRole('button', { name: '+ Another place' }).click(); await page.getByText('Where would you like to find them?').waitFor()
})
await step('family: second user joins via link', page, async () => {
  const ctx2 = await browser.newContext(ctxOpts); const p2 = await ctx2.newPage(); watch(p2, 'B')
  await p2.goto(`${B}/signup`)
  await p2.getByLabel('Your name').fill('Cousin'); await p2.getByLabel('Email').fill(`b${email}`)
  await p2.getByLabel(/^Password/).fill('journeypass123'); await p2.getByLabel('Date of birth').fill('1990-01-01')
  await p2.getByRole('checkbox').check(); await p2.getByRole('button', { name: 'Create my account' }).click(); await p2.waitForURL('**/onboarding')
  for (let i = 0; i < 3; i++) await p2.getByRole('button', { name: 'Continue' }).click()
  await p2.getByRole('checkbox').nth(2).waitFor()
  for (const c of await p2.getByRole('checkbox').all()) await c.check()
  await p2.getByRole('button', { name: 'I understand' }).click(); await p2.waitForURL('**/home')
  await p2.goto(inviteLink.replace(/^https?:\/\/[^/]+/, B))
  await p2.getByRole('button', { name: /Accept|Join|Yes/ }).first().click()
  await p2.waitForURL('**/people/**'); await p2.getByRole('button', { name: /Call Dadu/ }).waitFor()
  await p2.goto(`${B}/settings`); await p2.getByRole('button', { name: 'Delete my account' }).click()
  await p2.getByRole('textbox').last().fill('DELETE'); await p2.getByRole('button', { name: /Delete (my account )?permanently|Delete everything|Yes, delete/ }).last().click()
  await p2.waitForTimeout(2000); await ctx2.close()
})
// ---------------------------------------------------------------- letters & settings
await step('letters: write, receive, mark read, delete', page, async () => {
  await page.goto(`${B}/letters`)
  await page.getByRole('textbox').first().fill('Dadu, I passed my exams. I wish I could tell you in person.')
  await page.getByRole('button', { name: /Send|Write/ }).first().click()
  await page.locator('video, audio').first().waitFor({ timeout: 480000 })
  const mark = page.getByRole('button', { name: 'Mark as read' }); if (await mark.count()) await mark.first().click()
  await page.getByRole('button', { name: /Delete letter/ }).first().click(); await page.getByRole('button', { name: /^Delete$/ }).last().click()
})
await step('settings: save prefs, special days, credits, export', page, async () => {
  await page.goto(`${B}/settings`)
  for (const c of (await page.getByRole('switch').all()).slice(0, 3)) { await c.click(); await c.click() }
  await page.getByLabel('What should we call you?').fill('Riya D'); await page.getByRole('button', { name: 'Save', exact: true }).first().click()
  const chip = page.getByRole('button', { name: /Diwali|Durga/ }).first(); if (await chip.count()) await chip.click()
  await page.waitForTimeout(1000)
  const rm = page.getByRole('button', { name: /^Remove / }).first(); if (await rm.count()) await rm.click({ force: true })
  // Buy buttons are disabled by design while payments aren't configured
  if (await page.getByRole('button', { name: /^Buy / }).first().isEnabled()) throw new Error('buy enabled without payments')
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('link', { name: 'Download my data' }).click()])
  if (!(await d.path())) throw new Error('export empty')
})
await step('privacy: delete loved one with report', page, async () => {
  await page.goto(personUrl); await page.getByRole('tab', { name: 'Privacy' }).click()
  await page.getByRole('button', { name: /and all their data/ }).click()
  await page.getByLabel(/Type/).fill('Arun Ghosh'); await page.getByRole('button', { name: 'Delete permanently' }).click()
  await page.getByText(/exactly what was removed/).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: 'Close' }).last().click(); await page.waitForURL('**/home')
})
await step('settings: delete account', page, async () => {
  await page.goto(`${B}/settings`); await page.getByRole('button', { name: 'Delete my account' }).click()
  await page.getByRole('textbox').last().fill('DELETE')
  await page.getByRole('button', { name: /Delete (my account )?permanently|Delete everything|Yes, delete/ }).last().click()
  await page.waitForTimeout(2500)
})

const fails = results.filter((r) => r.ok === false)
const errs = results.filter((r) => r.kind)
console.log(`\n${results.filter((r) => r.ok).length} passed, ${fails.length} failed, ${errs.length} runtime/HTTP errors`)
for (const e of errs) console.log(`  [${e.who}] ${e.step}: ${e.kind} ${e.msg}`)
fs.writeFileSync(`${OUT}/journey-results.json`, JSON.stringify(results, null, 2))
await browser.close()
