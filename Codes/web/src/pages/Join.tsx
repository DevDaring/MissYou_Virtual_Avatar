import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { errorText, post } from '../lib/api'
import { useAuth } from '../store/auth'
import { AIBadge, Notice, PageHeader, Spinner } from '../components/ui'

export default function Join() {
  const { code = '' } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const refresh = useAuth((s) => s.refresh)
  const join = useMutation({
    mutationFn: () => post<{ person_id: string; name: string }>(`/api/family/join/${encodeURIComponent(code)}`),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['people'] })
      void refresh()
      nav(`/people/${r.person_id}`, { replace: true })
    },
  })

  return (
    <div className="mx-auto max-w-xl pb-8">
      <PageHeader title="You've been invited" />
      <div className="card space-y-4">
        <p className="text-lg text-cream-50">Someone in your family would like to share a loved one with you on Miss You.</p>
        <p className="text-cream-100/85">
          Together you can visit the same gentle AI-made recreation <AIBadge className="align-middle" />, made from the memories, photos and voice they've shared.
          It isn't really them — it's a way to feel close, and to remember.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-cream-200/80">
          <li>You'll be able to have calls and see what they've set up.</li>
          <li>Changes you suggest are sent to the person who invited you to approve.</li>
          <li>Your own calls, letters and memories stay private to you.</li>
        </ul>
        {join.isError && <Notice tone="error">{errorText(join.error)}</Notice>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <button className="btn-primary" disabled={!code || join.isPending} onClick={() => join.mutate()}>
            {join.isPending && <Spinner size={18} />} Accept invitation
          </button>
          <Link className="btn-ghost" to="/home">Not now</Link>
        </div>
        <p className="text-xs text-cream-200/60">Take your time. You can come back to this link whenever you feel ready.</p>
      </div>
    </div>
  )
}
