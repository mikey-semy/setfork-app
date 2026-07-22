import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { tr, type LocaleText } from '@/shared/i18n'
import { getRun } from '@/features/runs/queries'
import { RunView, type RunStepVM } from '@/features/runs/RunView'
import { productItems } from '@/features/library/blocks'
import { getCourseCompletion } from '@/features/quizzes/queries'
import { getMonetizationSettings } from '@/shared/settings/monetization'
import { getAiSettings } from '@/shared/settings/ai'
import { isAdminHandle } from '@/shared/auth/admin-handle'

export const metadata = { title: 'Run' }

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session, lang, mon, ai] = await Promise.all([params, getSession(), getLang(), getMonetizationSettings(), getAiSettings()])
  if (!session) redirect('/login')
  const data = await getRun(id, session.userId)
  if (!data) notFound()
  // Прохождение курса — постоянный факт: в новом прогоне сертификат уже доступен.
  const completion = await getCourseCompletion(data.run.templateId, session.userId)
  // «Помощь на шаге»: флаг + аудитория считаются здесь (сервером), клиент только рисует кнопку.
  const assistEnabled = ai.enabled && ai.assistEnabled && (ai.assistAudience === 'all' || isAdminHandle(session.handle))

  const steps: RunStepVM[] = data.steps.map((s) => ({
    id: s.id,
    n: s.n,
    type: s.type ?? 'step',
    text: s.type === 'text' && typeof s.content?.md === 'string' ? s.content.md : '',
    caption: s.type === 'image' && typeof s.content?.caption === 'string' ? s.content.caption : '',
    // Товары product-блока: href через /api/go/<step>/p<idx>, если клики включены.
    productTitle: s.type === 'product' && typeof s.content?.title === 'string' ? s.content.title : '',
    products:
      s.type === 'product'
        ? productItems(s.content).map((p) => ({ ...p, href: mon.linkTracking ? `/api/go/${s.id}/p${p.idx}` : undefined }))
        : [],
    title: tr(s.title, lang),
    desc: tr(s.desc, lang),
    command: s.command,
    level: s.level,
    why: tr(s.why, lang),
    subtasks: (s.subtasks as LocaleText[]).map((x) => tr(x, lang)).filter(Boolean),
    // Индекс для /api/go фиксируем ДО фильтра пустых меток — иначе резолв уедет.
    // Трекинг кликов выключен в админке → прямые url.
    refs: (s.refs as { label: LocaleText; url?: string }[])
      .map((r, ri) => ({ label: tr(r.label, lang), url: r.url, href: r.url && mon.linkTracking ? `/api/go/${s.id}/${ri}` : undefined }))
      .filter((r) => r.label),
    done: s.state?.status === 'done',
    blocked: s.state?.status === 'blocked',
    reason: s.state?.note ?? '',
    subtasksDone: s.state?.subtasksDone ?? [],
    assist: s.state?.assist ?? '',
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
      courseCompleted={!!completion}
      assistEnabled={assistEnabled}
    />
  )
}
