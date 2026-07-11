'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { CircleDot, MessagesSquare } from 'lucide-react'
import { Switch } from '@/shared/ui/switch'
import { t, type Lang } from '@/shared/i18n'
import { setListFeatures } from './actions'

const card = 'rounded-lg border border-border bg-surface p-5'

/** Настройки списка → «Разделы» (Features): владелец включает/выключает Issues и
 *  Discussions. Suggestions не отключается — это ядро fork-модели. Выключенный
 *  раздел прячется из шапки, его роуты отдают notFound. */
export function FeaturesSection({
  templateId,
  issuesEnabled,
  discussionsEnabled,
  lang,
}: {
  templateId: string
  issuesEnabled: boolean
  discussionsEnabled: boolean
  lang: Lang
}) {
  return (
    <section className={card}>
      <div className="mb-4 font-semibold text-ink">{t('featuresTitle', lang)}</div>
      <div className="flex flex-col divide-y divide-border">
        <FeatureRow
          templateId={templateId}
          feature="issues"
          initial={issuesEnabled}
          icon={<CircleDot size={16} className="text-muted" />}
          label={t('featIssues', lang)}
          hint={t('featIssuesHint', lang)}
        />
        <FeatureRow
          templateId={templateId}
          feature="discussions"
          initial={discussionsEnabled}
          icon={<MessagesSquare size={16} className="text-muted" />}
          label={t('featDiscussions', lang)}
          hint={t('featDiscussionsHint', lang)}
        />
      </div>
    </section>
  )
}

function FeatureRow({
  templateId,
  feature,
  initial,
  icon,
  label,
  hint,
}: {
  templateId: string
  feature: 'issues' | 'discussions'
  initial: boolean
  icon: ReactNode
  label: string
  hint: string
}) {
  const [on, setOn] = useState(initial)
  const [, start] = useTransition()
  return (
    <div className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5">{icon}</span>
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium text-ink">{label}</div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{hint}</p>
        </div>
      </div>
      <Switch
        checked={on}
        onCheckedChange={(v) => {
          setOn(v)
          start(() => setListFeatures(templateId, feature, v))
        }}
      />
    </div>
  )
}
