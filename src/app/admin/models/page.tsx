import Link from 'next/link'
import { AlertTriangle, Braces, Cpu } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Alert } from '@/shared/ui/Alert'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { GnomeAvatar } from '@/shared/ui/GnomeAvatar'
import { Tooltip } from '@/shared/ui/Tooltip'
import { TEXT } from '@/shared/ui/control'
import { Badge } from '@/shared/ui/badge'
import { fetchModels, prettyModelName } from '@/shared/ai/models'
import { STATS_WINDOW_DAYS } from '@/shared/ai/model-stats'
import { modelMeta } from '@/features/admin/model-enrich'
import { contextText } from '@/features/admin/model-options'
import type { OptionHolder, OptionMeta } from '@/features/admin/ModelSelect'
import { cardClass } from '@/shared/ui/card-style'

/**
 * СТРАНИЦА МОДЕЛЕЙ — единственное место, где видно ЦЕЛИКОМ: какая модель на какой роли, кто из
 * специалистов чем думает, как каждая ведёт себя У НАС и во что обходится.
 *
 * Зачем отдельная страница: выбор модели был размазан по трём формам (общие настройки, пул
 * совета, карточка специалиста), и ни в одной не было видно ни соседей, ни последствий. Вопрос
 * «а эта — она вообще для чего?» не имел места, где на него отвечают.
 *
 * Здесь же ловится причина тихой поломки генерации: назначенная модель, которой БОЛЬШЕ НЕТ в
 * каталоге провайдера (модели снимают с обслуживания — у OpenRouter это штатное событие).
 * Раньше это выяснялось только по пустым черновикам.
 */

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('models.title', lang) }
}

const ROLE_ORDER: Record<OptionHolder['kind'], number> = { chat: 0, fallback: 1, embedding: 2, council: 3, gnome: 4 }

export default async function AdminModelsPage() {
  await requireAdmin()
  const lang = await getLang()
  const ru = lang === 'ru'
  const models = await fetchModels()
  const meta = await modelMeta(models.currency, ru)

  // Каталог провайдера: по нему видно, жива ли назначенная модель.
  const catalog = new Map([...models.chat, ...models.embedding].map((m) => [m.id, m]))

  // Назначения = развёрнутая карта занятости: одна строка на роль, а не на модель.
  const assignments: { holder: OptionHolder; model: string; meta: OptionMeta }[] = []
  for (const [model, m] of meta) for (const holder of m.holders ?? []) assignments.push({ holder, model, meta: m })
  assignments.sort((a, b) => ROLE_ORDER[a.holder.kind] - ROLE_ORDER[b.holder.kind] || (a.holder.order ?? 0) - (b.holder.order ?? 0))

  // Рейтинг: только то, что мы реально звали, по числу вызовов вниз. Пары [id, мета] держим
  // ВМЕСТЕ: два параллельных массива с разной сортировкой перепутали бы имена и цифры.
  const rated = [...meta.entries()]
    .filter(([, m]) => (m.calls ?? 0) > 0)
    .sort((a, b) => (b[1].calls ?? 0) - (a[1].calls ?? 0))

  const dead = assignments.filter((a) => a.model && !catalog.has(a.model))
  const capt = `${TEXT.caption} font-semibold uppercase tracking-wide text-muted`

  return (
    <div className="flex w-full min-w-0 flex-col px-5 py-6 md:px-8">
      <PageHeader
        icon={<Cpu size={17} />}
        title={t('models.title', lang)}
        subtitle={t('models.subtitle', lang)}
      />

      {/* Мёртвая модель — первое, что должно броситься в глаза: при ней генерация молча пуста. */}
      {dead.length > 0 && (
        <Alert variant="warn" className="mb-5">
          <div className="min-w-0">
            <div className="font-medium">{t('models.deadTitle', lang)}</div>
            <p className="mt-1 [overflow-wrap:anywhere]">
              {dead.map((d) => `${d.holder.label} → ${d.model}`).join(' · ')}
            </p>
            <p className="mt-1">
              {t('models.deadHint', lang)}
            </p>
          </div>
        </Alert>
      )}

      {models.error && (
        <Alert variant="warn" className="mb-5">
          {models.error === 'no-key'
            ? t('models.noKey', lang)
            : t('models.catalogFailed', lang).replace('{e}', models.error)}
        </Alert>
      )}

      <h2 className={`${capt} mb-2`}>{t('models.assignments', lang)}</h2>
      {assignments.length === 0 ? (
        <EmptyState title={t('models.nothingAssigned', lang)} />
      ) : (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {assignments.map((a) => {
            const alive = !a.model || catalog.has(a.model)
            const opt = catalog.get(a.model)
            return (
              <div key={`${a.holder.kind}-${a.holder.label}-${a.model}`} className={cardClass()}>
                <div className="flex min-w-0 items-center gap-2">
                  {a.holder.avatarUrl && (
                    <GnomeAvatar src={a.holder.avatarUrl} size={20} alt="" className="size-5 shrink-0 rounded-full" />
                  )}
                  <span className={`min-w-0 truncate ${TEXT.bodySm} font-medium text-ink`}>{a.holder.label}</span>
                  {!alive && (
                    <Tooltip label={t('models.notInCatalog', lang)}>
                      <span className="ml-auto shrink-0 text-danger">
                        <AlertTriangle size={14} />
                      </span>
                    </Tooltip>
                  )}
                </div>
                <div className={`mt-1 ${TEXT.body} font-semibold text-ink [overflow-wrap:anywhere]`}>{prettyModelName(a.model)}</div>
                <div className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 ${TEXT.caption} text-muted`}>
                  {a.meta.okPct != null && (
                    <span className={`tabular-nums ${a.meta.quarantined ? 'text-danger' : 'text-ok'}`}>
                      {a.meta.okPct}% · {a.meta.calls}
                    </span>
                  )}
                  {a.meta.ourCost && <span className="tabular-nums">{t('models.perCall', lang).replace('{c}', a.meta.ourCost)}</span>}
                  {a.meta.p95 && <span className="tabular-nums">p95 {a.meta.p95}</span>}
                  {opt?.structured && (
                    <Tooltip label={t('models.strictJson', lang)}>
                      <span className="inline-flex">
                        <Braces size={12} />
                      </span>
                    </Tooltip>
                  )}
                  {opt?.contextLength ? <span className="tabular-nums">{contextText(opt.contextLength)}</span> : null}
                </div>
                <p className={`mt-1.5 ${TEXT.caption} leading-[1.5] text-ink-2`}>{a.holder.what}</p>
                {a.holder.gnomeId && (
                  <Link
                    href={`/admin/council/${a.holder.gnomeId}`}
                    className={`mt-1 inline-flex min-h-11 items-center ${TEXT.caption} text-ink-2 hover:text-accent`}
                  >
                    {t('models.expertPage', lang)}
                  </Link>
                )}
              </div>
            )
          })}
        </div>
      )}

      <h2 className={`${capt} mb-2`}>
        {t('models.ourRating', lang).replace('{n}', String(STATS_WINDOW_DAYS))}
      </h2>
      {rated.length === 0 ? (
        <EmptyState
          icon={<Cpu size={20} />}
          title={t('models.noCalls', lang)}
          hint={t('models.noCallsHint', lang)}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {rated.map(([id, m]) => {
            const opt = catalog.get(id)
            return (
              <div key={id} className={cardClass()}>
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className={`min-w-0 ${TEXT.body} font-medium text-ink [overflow-wrap:anywhere]`}>{prettyModelName(id)}</span>
                  {opt?.family && (
                    <Badge variant="chip" className="shrink-0 px-1.5 py-px text-muted">
                      {opt.family}
                    </Badge>
                  )}
                  {m.quarantined && (
                    <Badge variant="danger" className="shrink-0 px-1.5 py-px">
                      {t('models.quarantined', lang)}
                    </Badge>
                  )}
                  {!opt && (
                    <Badge variant="warn" className="shrink-0 px-1.5 py-px">
                      {t('models.notInCatalogShort', lang)}
                    </Badge>
                  )}
                </div>
                <div className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 ${TEXT.caption} text-muted`}>
                  <span className={`tabular-nums ${m.quarantined ? 'text-danger' : 'text-ok'}`}>
                    {m.okPct}% {t('models.okShare', lang)}
                  </span>
                  <span className="tabular-nums">{t('models.calls', lang).replace('{n}', String(m.calls))}</span>
                  {m.p95 && <span className="tabular-nums">p95 {m.p95}</span>}
                  {m.ourCost && <span className="tabular-nums">{t('models.perCall', lang).replace('{c}', m.ourCost)}</span>}
                  {m.spent && <span className="tabular-nums text-ink-2">{t('models.spentTotal', lang).replace('{c}', m.spent)}</span>}
                  {(m.holders?.length ?? 0) > 0 && (
                    <span className="flex flex-wrap items-center gap-1">
                      {m.holders?.map((h) => (
                        <Tooltip key={`${h.kind}-${h.label}`} label={`${h.label} — ${h.what}`}>
                          <Badge variant="chip">
                            {h.avatarUrl && <GnomeAvatar src={h.avatarUrl} size={12} alt="" className="size-3 rounded-full" />}
                            {h.label}
                          </Badge>
                        </Tooltip>
                      ))}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className={`mt-4 ${TEXT.bodySm} text-muted`}>
        {t('models.usageTail', lang)}
        <Link href="/admin/usage" className="text-ink-2 underline hover:text-accent">
          {t('models.usageLink', lang)}
        </Link>
        .
      </p>
    </div>
  )
}
