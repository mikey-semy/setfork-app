import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { tr, type LocaleText } from '@/shared/i18n'
import { getRun } from '@/features/runs/queries'
import { RunView, type RunStepVM } from '@/features/runs/RunView'

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session, lang] = await Promise.all([params, getSession(), getLang()])
  if (!session) redirect('/login')
  const data = await getRun(id, session.userId)
  if (!data) notFound()

  const steps: RunStepVM[] = data.steps.map((s) => ({
    id: s.id,
    n: s.n,
    type: s.type ?? 'step',
    text: s.type === 'text' && typeof s.content?.md === 'string' ? s.content.md : '',
    caption: s.type === 'image' && typeof s.content?.caption === 'string' ? s.content.caption : '',
    title: tr(s.title, lang),
    desc: tr(s.desc, lang),
    command: s.command,
    level: s.level,
    why: tr(s.why, lang),
    subtasks: (s.subtasks as LocaleText[]).map((x) => tr(x, lang)).filter(Boolean),
    refs: (s.refs as { label: LocaleText; url?: string }[]).map((r) => ({ label: tr(r.label, lang), url: r.url })).filter((r) => r.label),
    done: s.state?.status === 'done',
    blocked: s.state?.status === 'blocked',
    reason: s.state?.note ?? '',
    subtasksDone: s.state?.subtasksDone ?? [],
  }))

  return (
    <RunView
      runId={data.run.id}
      status={data.run.status}
      ordered={data.template.ordered}
      title={tr(data.template.title, lang)}
      backHref={`/${data.template.handle}/${data.template.slug}`}
      steps={steps}
      lang={lang}
      certificateHref={`/${data.template.handle}/${data.template.slug}/certificate`}
    />
  )
}
