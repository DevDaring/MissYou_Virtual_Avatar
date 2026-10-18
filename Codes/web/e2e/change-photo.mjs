// Change-photo flow on a throwaway account: API setup (person + scene), then the browser modal.
// Usage: NEW_PHOTO=/path/face.jpg node e2e/change-photo.mjs ./e2e-shots   (spends ~ $1.6: two scenes)
import { chromium } from 'playwright-core'
import fs from 'fs'
import os from 'os'
const B = process.env.BASE || 'https://missyou.koushikdeb.com'
const OUT = process.argv[2] || './e2e-shots'
const b = await chromium.launch({ executablePath: process.env.CHROME || `${os.homedir()}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome` })
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errs.push(`${r.status()} ${r.url()}`) })
const email = `photo${Date.now().toString(36)}@example.com`
await page.goto(B)
const api = (path, method = 'GET', body) => page.evaluate(async ([path, method, body]) => {
  const csrf = (document.cookie.match(/my_csrf=([^;]+)/) || [])[1] || ''
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, json: await r.json().catch(() => null) }
}, [path, method, body])
const wait = async (jid) => { for (let i = 0; i < 200; i++) { const j = (await api(`/api/jobs/${jid}`)).json; if (['done', 'failed'].includes(j.status)) return j; await page.waitForTimeout(3000) } }
console.log('signup', (await api('/api/auth/signup', 'POST', { email, display_name: 'Photo Test', password: 'testpass123', dob: '1990-01-01', accept_terms: true })).status)
await api('/api/onboarding', 'POST', { understood: (await api('/api/onboarding')).json.statements })
const pid = (await api('/api/people', 'POST', { name: 'Arun Ghosh', called_name: 'Dadu', relationship: 'grandfather' })).json.person.id
await api(`/api/people/${pid}/consent`, 'POST', { statements: (await api('/api/consent/media')).json.statements })
await api(`/api/people/${pid}/sample-kit`, 'POST')
console.log('faces', (await wait((await api(`/api/people/${pid}/process`, 'POST')).json.job_id)).status)
const cl = (await api(`/api/people/${pid}/clusters`)).json.clusters
console.log('choose', JSON.stringify((await api(`/api/people/${pid}/choose`, 'POST', { cluster_id: cl[0].id })).json))
await api(`/api/people/${pid}/voices/preset`, 'POST', { preset_id: 'sarvam-rehan' })
await api(`/api/people/${pid}`, 'PATCH', { persona: {} })
const sc = (await api(`/api/people/${pid}/scenes`, 'POST', { location_key: 'garden_lawn', activity: 'sitting', time_of_day: 'morning', weather: 'clear' })).json
console.log('scene 1', (await wait(sc.job_id)).status)
// --- the browser flow the user asked for ---
await page.goto(`${B}/people/${pid}`)
await page.getByRole('button', { name: '📷 Change photo' }).click()
await page.locator('input[type=file][accept^="image"]').last().setInputFiles(process.env.NEW_PHOTO)
await page.screenshot({ path: `${OUT}/photo-1-pick.png` })
await page.getByRole('button', { name: 'Use these photos' }).click()
await page.getByRole('button', { name: 'This is them' }).waitFor({ timeout: 120000 })
await page.screenshot({ path: `${OUT}/photo-2-choose.png` })
await page.getByRole('button', { name: 'This is them' }).click()
await page.getByRole('button', { name: /Recreate the scene/ }).click({ timeout: 60000 })
console.log('recreating…')
for (let i = 0; i < 100; i++) { const x = (await api(`/api/people/${pid}/scenes`)).json.scenes[0]; if (x && x.status !== 'queued' && x.status !== 'generating' && (x.generations >= 2 || x.status === 'failed')) break; await page.waitForTimeout(5000) }
await page.reload(); await page.waitForTimeout(4000)
await page.screenshot({ path: `${OUT}/photo-3-after.png` })
const s = (await api(`/api/people/${pid}/scenes`)).json.scenes[0]
console.log('scene after', s.status, 'identity', s.identity_score, 'generations', s.generations, 'notes', JSON.stringify(s.notes))
console.log('delete account', (await api('/api/me?confirm=DELETE', 'DELETE')).status)
console.log('errors', JSON.stringify(errs))
await b.close()
