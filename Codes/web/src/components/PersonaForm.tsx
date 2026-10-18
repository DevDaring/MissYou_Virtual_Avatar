import { useEffect, useState } from 'react'
import { Notice, Spinner, useToast } from './ui'
import ComboInput from './ComboInput'
import AddressPicker, { type AddressForm } from './AddressPicker'
import { del, errorText, get, patch, post } from '../lib/api'
import type { Person, Persona } from '../lib/types'

const LANG_CODES: Record<string, string> = { en: 'English', bn: 'Bengali', hi: 'Hindi' }
const asText = (v: unknown) => (Array.isArray(v) ? v.join(', ') : (v as string) || '')
const asList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
const fromStored = (key: keyof Persona, v: unknown) =>
  key === 'languages' && Array.isArray(v) ? v.map((x) => LANG_CODES[String(x)] ?? x).join(', ') : asText(v)

type Lang = 'bn' | 'hi' | 'en'
type Form = 'intimate' | 'familiar' | 'formal'
/** A suggestion, tagged with the language(s) it belongs to and, for Bengali/Hindi speech, its form of address. */
type Opt = string | { v: string; l: Lang[]; f?: Form }
const o = (v: string, l: Lang | Lang[], f?: Form): Opt => ({ v, l: Array.isArray(l) ? l : [l], f })

const FIELDS: { key: keyof Persona; label: string; ph: string; list?: boolean; long?: boolean; options: Opt[] }[] = [
  { key: 'greeting', label: 'How did they greet you?', ph: 'Ki re, kemon achish? / Beta, khana khaya?',
    options: [o('Ki re, kemon achish?', 'bn', 'intimate'), o('Kheyechhish?', 'bn', 'intimate'), o('Kemon acho?', 'bn', 'familiar'),
      o('Kheyecho?', 'bn', 'familiar'), o('Kemon achhen?', 'bn', 'formal'), o('Ki khobor?', 'bn'),
      o('Arre, aa gaya?', 'hi', 'intimate'), o('Kaise ho beta?', 'hi', 'familiar'), o('Beta, khana khaya?', 'hi'), o('Aap kaise hain?', 'hi', 'formal'),
      o('Hello sweetheart!', 'en'), o('There you are!', 'en'), o('How was your day?', 'en')] },
  { key: 'nicknames', label: 'What did they call you?', ph: 'Shona, Babu, Guddu', list: true,
    options: [o('Shona', 'bn'), o('Babu', ['bn', 'hi']), o('Mamoni', 'bn'), o('Khuku', 'bn'), o('Tuktuki', 'bn'), o('Borda', 'bn'), o('Chhotu', ['bn', 'hi']),
      o('Raja', ['bn', 'hi']), o('Rani', ['bn', 'hi']), o('Guddu', 'hi'), o('Beta', 'hi'), o('Bachcha', 'hi'), o('Munna', 'hi'), o('Gudiya', 'hi'),
      o('Sweetheart', 'en'), o('Champ', 'en'), o('Kiddo', 'en')] },
  { key: 'phrases', label: 'Favourite phrases or sayings', ph: 'Thakur bhalo korbe, Sab theek ho jayega', list: true,
    options: [o('Thakur bhalo korbe', 'bn'), o('Durga Durga', 'bn'), o('Sob thik hoye jabe', 'bn'), o('Chinta korish na', 'bn', 'intimate'),
      o('Chinta koro na', 'bn', 'familiar'), o('Sab theek ho jayega', 'hi'), o('Bhagwan bhala kare', 'hi'), o('Chinta mat kar', 'hi', 'intimate'),
      o('Chinta mat karo', 'hi', 'familiar'), o('This too shall pass', 'en'), o("Don't worry, be happy", 'en'), o('I am always proud of you', 'en'), o('Eat properly', 'en')] },
  { key: 'speech_style', label: 'How did they talk?', ph: 'Slow and soft, teasing, asked lots of questions…', long: true, list: true,
    options: ['Slow and soft', 'Fast and excited', 'Loud and cheerful', 'Calm and wise', 'Teasing', 'Asked lots of questions', 'Short and to the point', 'Told long stories', 'Very affectionate', 'Strict but caring', 'Laughed a lot', 'Worried about my health'] },
  { key: 'humour', label: 'Their sense of humour', ph: 'Gentle teasing about my messy room',
    options: ['Gentle teasing', 'Teasing about my messy room', 'Silly puns and wordplay', 'Dry and witty', 'Loved telling old jokes', 'Funny mimicry of relatives', 'Rarely joked, warm smiles', 'Laughed at their own jokes'] },
  { key: 'goodbye', label: 'How did they end calls?', ph: 'Bhalo theko, time-e kheye nish',
    options: [o('Bhalo thakish', 'bn', 'intimate'), o('Time-e kheye nish', 'bn', 'intimate'), o('Sabdhane thakish', 'bn', 'intimate'),
      o('Bhalo theko', 'bn', 'familiar'), o('Sabdhane theko', 'bn', 'familiar'), o('Bhalo thakben', 'bn', 'formal'), o('Thakur tomay bhalo rakhun', 'bn', 'familiar'),
      o('Khayal rakhna', 'hi', 'familiar'), o('Apna khayal rakhiye', 'hi', 'formal'), o('Khush raho', 'hi'), o('Jaldi milte hain', 'hi'),
      o('Take care of yourself', 'en'), o('Love you, bye', 'en'), o('Call me tomorrow', 'en')] },
  { key: 'topics_loved', label: 'Things they loved talking about', ph: 'Cricket, her garden, old Hindi songs', list: true,
    options: ['Cricket', 'Football', 'Their garden', 'Cooking and recipes', 'Old Hindi songs', o('Rabindra Sangeet', 'bn'), o('Durga Pujo', 'bn'),
      o('Diwali and Holi', 'hi'), 'Family gossip', 'My studies and work', 'Their childhood', 'Politics and news', 'Travel', 'Movies', 'Books', 'Religion and prayers'] },
  { key: 'topics_avoid', label: 'Topics to avoid', ph: 'The hospital, money worries', list: true,
    options: ['The hospital', 'Their illness', 'How they passed', 'Money worries', 'Family fights', 'Politics', 'Religion', 'My marriage', 'My job'] },
  { key: 'languages', label: 'Languages they spoke', ph: 'Bengali, English, a little Hindi', list: true,
    options: ['Bengali', 'English', 'Hindi', 'A little English', 'A little Hindi', 'Assamese', 'Odia', 'Marathi', 'Gujarati', 'Punjabi', 'Tamil', 'Telugu', 'Urdu', 'Nepali'] },
  { key: 'code_mix', label: 'Did they mix languages?', ph: 'Bengali with English words',
    options: ['No, one language only', o('Bengali with English words', ['bn']), o('Hindi with English words', ['hi']), o('Bengali with Hindi words', ['bn']),
      o('English with Bengali endearments', ['en']), o('English with Hindi endearments', ['en']), 'Switched freely between languages'] },
]

/** Languages named in "Languages they spoke" (falls back to the call language). */
function spokenLangs(text: string, callLang: string): Set<Lang> {
  const t = text.toLowerCase()
  const found = new Set<Lang>()
  if (/bengali|bangla|বাংলা/.test(t)) found.add('bn')
  if (/hindi|हिन्दी|हिंदी/.test(t)) found.add('hi')
  if (/english/.test(t)) found.add('en')
  if (!found.size && ['bn', 'hi', 'en'].includes(callLang)) found.add(callLang as Lang)
  return found
}

/** Only suggestions in a language they spoke, and (for Bengali/Hindi) in the form of address chosen above. */
function visible(opts: Opt[], langs: Set<Lang>, form: string): string[] {
  return opts.flatMap((x) => {
    if (typeof x === 'string') return [x]
    if (langs.size && !x.l.some((l) => langs.has(l))) return []
    if (form && x.f && x.f !== form) return []
    return [x.v]
  })
}

export default function PersonaForm({ person, onSaved }: { person: Person; onSaved?: (p: Person) => void }) {
  const toast = useToast((s) => s.show)
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((x) => [x.key, fromStored(x.key, person.persona?.[x.key])])))
  const [address, setAddress] = useState<AddressForm>(person.persona?.address_form || '')
  const [heaven, setHeaven] = useState(!!person.persona?.heaven_framing)
  const [useTx, setUseTx] = useState(person.persona?.use_transcripts !== false)
  const [notes, setNotes] = useState<{ id: string; text: string; source: string }[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { get<{ notes: typeof notes }>(`/api/people/${person.id}/notes`).then((r) => setNotes(r.notes)).catch(() => {}) }, [person.id])

  const langs = spokenLangs(f.languages || '', person.call_language)

  async function save() {
    setBusy(true); setErr(null)
    const persona: Record<string, unknown> = { heaven_framing: heaven, use_transcripts: useTx, address_form: address }
    for (const x of FIELDS) persona[x.key] = x.long ? asList(f[x.key]).join(', ') : x.list ? asList(f[x.key]) : f[x.key]
    try {
      const r = await patch<{ person?: Person; pending_approval?: boolean }>(`/api/people/${person.id}`, { persona })
      if (r.pending_approval) toast('Sent to the creator for approval.')
      else if (r.person) { toast('Saved.'); onSaved?.(r.person) }
    } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  async function addNote() {
    if (!note.trim()) return
    const r = await post<{ id?: string; pending_approval?: boolean }>(`/api/people/${person.id}/notes`, { text: note })
    if (r.id) setNotes((n) => [{ id: r.id!, text: note, source: 'user' }, ...n]); else toast('Sent to the creator for approval.')
    setNote('')
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-4">
        <div><h2 className="text-2xl">How did {person.called_name || person.name} talk?</h2><p className="mt-1 text-cream-200/75">Everything here is optional and you can change it any time. Pick from the suggestions or type your own; separate several items with commas.</p></div>
        <div>
          <div className="label">How did {person.called_name || person.name} address you?</div>
          <AddressPicker value={address} onChange={setAddress} lang={person.call_language} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((x) => (
            <div key={x.key} className={x.long ? 'sm:col-span-2' : ''}>
              <label className="label" htmlFor={`pf-${x.key}`}>{x.label}</label>
              <ComboInput id={`pf-${x.key}`} value={f[x.key]} onChange={(v) => setF((p) => ({ ...p, [x.key]: v }))} options={x.key === 'languages' ? visible(x.options, new Set(), '') : visible(x.options, langs, address)} multi={x.list} long={x.long} placeholder={x.ph} />
            </div>
          ))}
        </div>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 accent-ember-500" checked={useTx} onChange={(e) => setUseTx(e.target.checked)} /><span>Use the words from my uploaded videos and voice notes as examples of how they spoke.</span></label>
        {person.life_status === 'passed' && <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 accent-ember-500" checked={heaven} onChange={(e) => setHeaven(e.target.checked)} /><span>Allow gentle, respectful spiritual language ("you carry me with you"). By default it never speaks about heaven or the afterlife, and it never claims real contact.</span></label>}
        {err && <Notice tone="error">{err}</Notice>}
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : 'Save'}</button>
      </div>
      <div className="card space-y-3">
        <h3 className="text-xl">Memories to remember</h3>
        <p className="text-sm text-cream-200/70">Short notes the recreation may gently refer to. It will never invent memories you didn't share.</p>
        <div className="flex flex-col gap-2 sm:flex-row"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="She made payesh on every birthday" onKeyDown={(e) => e.key === 'Enter' && addNote()} /><button className="btn-ghost shrink-0" onClick={addNote}>Add</button></div>
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-3 rounded-2xl bg-night-950/40 px-4 py-3 ring-1 ring-white/10">
              <span>{n.text}{n.source === 'interview' && <span className="ml-2 text-xs text-dusk-300">from interview</span>}</span>
              <button className="-m-2 p-2 text-cream-200/50 hover:text-cream-50" aria-label="Delete memory" onClick={async () => { await del(`/api/people/${person.id}/notes/${n.id}`); setNotes((x) => x.filter((y) => y.id !== n.id)) }}>✕</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
