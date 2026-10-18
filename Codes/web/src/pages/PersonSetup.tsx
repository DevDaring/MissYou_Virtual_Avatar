import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import PersonaForm from '../components/PersonaForm'
import SceneBuilder from '../components/SceneBuilder'
import { AIBadge, Spinner } from '../components/ui'
import { get } from '../lib/api'
import type { Person } from '../lib/types'
import StepAnchors from '../setup/StepAnchors'
import StepDetails from '../setup/StepDetails'
import StepFaces from '../setup/StepFaces'
import StepUpload from '../setup/StepUpload'
import StepVoice from '../setup/StepVoice'

const STEPS = [
  { key: 'details', label: 'About them' }, { key: 'upload', label: 'Memories' }, { key: 'faces', label: 'Their face' },
  { key: 'anchors', label: 'Best photos' }, { key: 'voice', label: 'Their voice' }, { key: 'persona', label: 'How they talked' },
  { key: 'scene', label: 'A place' },
]

export default function PersonSetup() {
  const { personId } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['person', personId], queryFn: () => get<{ person: Person }>(`/api/people/${personId}`).then((r) => r.person), enabled: !!personId })
  const person = q.data || null
  const params = new URLSearchParams(location.search)
  const forced = params.get('step')
  const stepKey = !personId ? 'details' : forced || (person ? (person.setup_step === 'done' ? 'scene' : person.setup_step === 'upload' ? 'upload' : person.setup_step) : 'details')
  const idx = Math.max(0, STEPS.findIndex((s) => s.key === stepKey))
  const go = (k: string) => { void qc.invalidateQueries({ queryKey: ['person', personId] }); nav(`/people/${personId}/setup?step=${k}`) }

  if (personId && q.isLoading) return <div className="flex justify-center py-16 text-ember-300"><Spinner size={30} /></div>
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-3xl">{person ? `${person.called_name || person.name}` : 'Someone you miss'}</h1>
        <AIBadge />
      </div>
      <ol className="mb-6 flex gap-1.5 overflow-x-auto pb-1" aria-label="Setup steps">
        {STEPS.map((s, i) => (
          <li key={s.key} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${i === idx ? 'bg-ember-500/20 text-ember-300 ring-1 ring-ember-400/50' : i < idx ? 'bg-white/10 text-cream-100' : 'bg-white/5 text-cream-200/50'}`} aria-current={i === idx ? 'step' : undefined}>{i + 1}. {s.label}</li>
        ))}
      </ol>
      {stepKey === 'details' && <StepDetails person={person} onSaved={(p) => { qc.setQueryData(['person', p.id], p); nav(`/people/${p.id}/setup?step=upload`) }} />}
      {person && stepKey === 'upload' && <StepUpload person={person} onNext={() => go('faces')} />}
      {person && stepKey === 'faces' && <StepFaces person={person} onNext={() => go('anchors')} onBack={() => go('upload')} />}
      {person && stepKey === 'anchors' && <StepAnchors person={person} onNext={() => go('voice')} onBack={() => go('faces')} />}
      {person && stepKey === 'voice' && <StepVoice person={person} onNext={() => go('persona')} onBack={() => go('anchors')} />}
      {person && stepKey === 'persona' && (
        <div className="space-y-4"><PersonaForm person={person} /><div className="flex gap-3"><button className="btn-ghost" onClick={() => go('voice')}>Back</button><button className="btn-primary flex-1 sm:flex-none" onClick={() => go('scene')}>Continue</button></div></div>
      )}
      {person && stepKey === 'scene' && (
        <div className="space-y-4">
          <SceneBuilder person={person} onReady={() => void qc.invalidateQueries({ queryKey: ['person', personId] })} />
          <button className="btn-primary w-full" onClick={() => nav(`/people/${person.id}`)}>Done — go to {person.called_name || person.name}</button>
        </div>
      )}
    </div>
  )
}
