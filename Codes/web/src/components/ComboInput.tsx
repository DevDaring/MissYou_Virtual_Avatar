import { useMemo, useRef, useState, type KeyboardEvent } from 'react'

const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** A text box with a suggestion dropdown. Pick a suggestion or type anything.
 *  `multi` keeps a comma-separated list: picking toggles an item, typing filters by the last item. */
export default function ComboInput({ id, value, onChange, options, multi = false, long = false, placeholder }: {
  id: string; value: string; onChange: (v: string) => void; options: string[]; multi?: boolean; long?: boolean; placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)

  const chosen = multi ? split(value) : []
  const token = (multi ? value.split(',').pop() ?? '' : value).trim()
  const shown = useMemo(() => {
    const exact = options.some((o) => same(o, token))
    if (!token || exact) return options
    const hits = options.filter((o) => o.toLowerCase().includes(token.toLowerCase()))
    return hits.length ? hits : options  // nothing matches what they typed: still offer every suggestion
  }, [options, token])

  function pick(opt: string) {
    if (!multi) { onChange(opt); setOpen(false); return }
    let items = split(value)
    // Replace the half-typed last item with the picked one.
    if (token && !value.trimEnd().endsWith(',') && (same(token, opt) || !options.some((o) => same(o, token)))) items = items.slice(0, -1)
    items = items.some((x) => same(x, opt)) ? items.filter((x) => !same(x, opt)) : [...items, opt]
    onChange(items.length ? items.join(', ') + ', ' : '')
    ref.current?.focus()
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, shown.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && open && active >= 0 && shown[active]) { e.preventDefault(); pick(shown[active]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  const common = {
    id, ref, value, placeholder, role: 'combobox', 'aria-expanded': open, 'aria-controls': `${id}-list`, 'aria-autocomplete': 'list' as const,
    onChange: (e: { target: { value: string } }) => { onChange(e.target.value); setOpen(true); setActive(-1) },
    onFocus: () => setOpen(true),
    onBlur: () => { setOpen(false); setActive(-1); if (multi) onChange(split(value).join(', ')) },
    onKeyDown: onKey,
  }

  return (
    <div className="relative">
      {long ? <textarea {...common} className="input min-h-[90px] py-3 pr-11" /> : <input {...common} className="input pr-11" autoComplete="off" />}
      <button type="button" tabIndex={-1} aria-label="Show suggestions"
        className="absolute right-1 top-1 flex h-11 w-10 items-center justify-center text-cream-200/60 hover:text-cream-50"
        onMouseDown={(e) => { e.preventDefault(); if (open) setOpen(false); else { setOpen(true); ref.current?.focus() } }}>
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" className={`transition ${open ? 'rotate-180' : ''}`}><path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" /></svg>
      </button>
      {open && shown.length > 0 && (
        <ul id={`${id}-list`} role="listbox" aria-multiselectable={multi}
          className="absolute z-30 mt-2 max-h-64 w-full overflow-auto rounded-2xl bg-night-800 py-2 shadow-2xl ring-1 ring-white/15">
          {multi && <li className="px-4 pb-1 text-xs text-cream-200/50">Pick as many as you like, or type your own</li>}
          {shown.map((o, i) => {
            const on = chosen.some((x) => same(x, o)) || (!multi && same(value.trim(), o))
            return (
              <li key={o} role="option" aria-selected={on}
                className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm ${i === active ? 'bg-white/10' : 'hover:bg-white/5'} ${on ? 'text-ember-300' : 'text-cream-100'}`}
                onMouseDown={(e) => { e.preventDefault(); pick(o) }} onMouseEnter={() => setActive(i)}>
                <span className="w-4 shrink-0 text-center">{on ? '✓' : ''}</span><span>{o}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
