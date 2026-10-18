import { Chip } from './ui'

export type AddressForm = '' | 'intimate' | 'familiar' | 'formal'

const WORDS: Record<Exclude<AddressForm, ''>, { bn: string; hi: string; latin: string; hint: string }> = {
  intimate: { bn: 'তুই', hi: 'तू', latin: 'Tui / Tu', hint: 'very close — a child, a sibling, a best friend' },
  familiar: { bn: 'তুমি', hi: 'तुम', latin: 'Tumi / Tum', hint: 'loving but a little gentler — e.g. a child to a parent' },
  formal: { bn: 'আপনি', hi: 'आप', latin: 'Apni / Aap', hint: 'respectful — an elder or an in-law' },
}

/** তুই / তুমি / আপনি (तू / तुम / आप): the recreation keeps to the chosen one and never mixes them. */
export default function AddressPicker({ value, onChange, lang, who = 'you' }: {
  value: string; onChange: (v: AddressForm) => void; lang: string; who?: string
}) {
  const word = (k: keyof typeof WORDS) => (lang === 'hi' ? WORDS[k].hi : lang === 'bn' ? WORDS[k].bn : `${WORDS[k].bn} / ${WORDS[k].hi}`)
  const picked = WORDS[value as keyof typeof WORDS]
  return (
    <div role="radiogroup" aria-label={`How did they address ${who}?`}>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(WORDS) as (keyof typeof WORDS)[]).map((k) => (
          <Chip key={k} active={value === k} onClick={() => onChange(k)}>
            <span className="text-base">{word(k)}</span> <span className="text-xs opacity-70">({WORDS[k].latin})</span>
          </Chip>
        ))}
        <Chip active={!value} onClick={() => onChange('')}>Not sure</Chip>
      </div>
      <p className="mt-2 text-xs text-cream-200/60">
        {picked ? `${picked.hint}. They will always say ${word(value as keyof typeof WORDS)} — never mixing in the other forms.`
          : 'They will pick one form from the relationship and keep to it for the whole call.'}
      </p>
    </div>
  )
}
