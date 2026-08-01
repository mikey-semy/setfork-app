import Link from 'next/link'
import { AlertTriangle, Braces, Cpu } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { tr } from '@/shared/i18n'
import { Alert } from '@/shared/ui/Alert'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { GnomeAvatar } from '@/shared/ui/GnomeAvatar'
import { Tooltip } from '@/shared/ui/Tooltip'
import { TEXT } from '@/shared/ui/control'
import { fetchModels, prettyModelName } from '@/shared/ai/models'
import { STATS_WINDOW_DAYS } from '@/shared/ai/model-stats'
import { modelMeta } from '@/features/admin/model-enrich'
import { contextText } from '@/features/admin/model-options'
import type { OptionHolder, OptionMeta } from '@/features/admin/ModelSelect'

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
  return { title: tr({ en: 'Models', ru: 'Модели' }, lang) }
}

const ROLE_ORDER: Record<OptionHolder['kind'], number> = { chat: 0, fallback: 1, embedding: 2, council: 3, gnome: 4 }

export default async function AdminModelsPage() {
  await requireAdmin()
  const lang = await getLang()
  const ru = lang === 'ru'
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)

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
  const card = 'rounded-lg border border-border bg-surface p-4'
  const capt = `${TEXT.caption} font-semibold uppercase tracking-wide text-muted`

  return (
    <div className="flex w-full min-w-0 flex-col px-5 py-6 md:px-8">
      <PageHeader
        icon={<Cpu size={17} />}
        title={say('Models', 'Модели')}
        subtitle={say(
          'Who works on what, how each model behaves for us and what it costs. Assignments are changed in the AI settings, the council pool and on an expert’s page.',
          'Кто на чём работает, как каждая модель ведёт себя у нас и во что обходится. Назначения меняются в настройках ИИ, в пуле совета и на странице специалиста.',
        )}
      />

      {/* Мёртвая модель — первое, что должно броситься в глаза: при ней генерация молча пуста. */}
      {dead.length > 0 && (
        <Alert variant="warn" className="mb-5">
          <div className="min-w-0">
            <div className="font-medium">{say('Assigned model is not in the provider catalog', 'Назначенная модель отсутствует в каталоге провайдера')}</div>
            <p className="mt-1 [overflow-wrap:anywhere]">
              {dead.map((d) => `${d.holder.label} → ${d.model}`).join(' · ')}
            </p>
            <p className="mt-1">
              {say(
                'Such a call returns 404 and the draft comes back empty, whatever the API key is. Pick a live model.',
                'Такой вызов возвращает 404, и черновик приходит пустым — при любом API-ключе. Выбери живую модель.',
              )}
            </p>
          </div>
        </Alert>
      )}

      {models.error && (
        <Alert variant="warn" className="mb-5">
          {models.error === 'no-key'
            ? say('No key for the active provider — the catalog is unavailable.', 'У активного провайдера нет ключа — каталог недоступен.')
            : say(`The model catalog failed to load (${models.error}).`, `Каталог моделей не загрузился (${models.error}).`)}
        </Alert>
      )}

      <h2 className={`${capt} mb-2`}>{say('Assignments', 'Назначения')}</h2>
      {assignments.length === 0 ? (
        <EmptyState title={say('Nothing is assigned yet', 'Пока ничего не назначено')} />
      ) : (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {assignments.map((a) => {
            const alive = !a.model || catalog.has(a.model)
            const opt = catalog.get(a.model)
            return (
              <div key={`${a.holder.kind}-${a.holder.label}-${a.model}`} className={card}>
                <div className="flex min-w-0 items-center gap-2">
                  {a.holder.avatarUrl && (
                    <GnomeAvatar src={a.holder.avatarUrl} size={20} alt="" className="size-5 shrink-0 rounded-full" />
                  )}
                  <span className={`min-w-0 truncate ${TEXT.bodySm} font-medium text-ink`}>{a.holder.label}</span>
                  {!alive && (
                    <Tooltip label={say('Not in the catalog', 'Нет в каталоге')}>
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
                  {a.meta.ourCost && <span className="tabular-nums">{say(`${a.meta.ourCost} / call`, `${a.meta.ourCost} за вызов`)}</span>}
                  {a.meta.p95 && <span className="tabular-nums">p95 {a.meta.p95}</span>}
                  {opt?.structured && (
                    <Tooltip label={say('Supports strict JSON schema', 'Умеет строгий JSON по схеме')}>
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
                    {say('Expert page', 'Страница специалиста')}
                  </Link>
                )}
              </div>
            )
          })}
        </div>
      )}

      <h2 className={`${capt} mb-2`}>
        {say(`Our rating · ${STATS_WINDOW_DAYS} days`, `Наш рейтинг · ${STATS_WINDOW_DAYS} дней`)}
      </h2>
      {rated.length === 0 ? (
        <EmptyState
          icon={<Cpu size={20} />}
          title={say('No calls in the journal yet', 'В журнале ещё нет вызовов')}
          hint={say('The rating builds itself from real calls.', 'Рейтинг набирается сам из реальных вызовов.')}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {rated.map(([id, m]) => {
            const opt = catalog.get(id)
            return (
              <div key={id} className={card}>
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className={`min-w-0 ${TEXT.body} font-medium text-ink [overflow-wrap:anywhere]`}>{prettyModelName(id)}</span>
                  {opt?.family && (
                    <span className={`shrink-0 rounded-full border border-border bg-surface-2 px-1.5 py-px ${TEXT.caption} text-muted`}>{opt.family}</span>
                  )}
                  {m.quarantined && (
                    <span className={`shrink-0 rounded-full border border-danger px-1.5 py-px ${TEXT.caption} text-danger`}>
                      {say('quarantined', 'карантин')}
                    </span>
                  )}
                  {!opt && (
                    <span className={`shrink-0 rounded-full border border-border px-1.5 py-px ${TEXT.caption} text-warn`}>
                      {say('not in catalog', 'нет в каталоге')}
                    </span>
                  )}
                </div>
                <div className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 ${TEXT.caption} text-muted`}>
                  <span className={`tabular-nums ${m.quarantined ? 'text-danger' : 'text-ok'}`}>
                    {m.okPct}% {say('ok', 'успеха')}
                  </span>
                  <span className="tabular-nums">{say(`${m.calls} calls`, `${m.calls} вызовов`)}</span>
                  {m.p95 && <span className="tabular-nums">p95 {m.p95}</span>}
                  {m.ourCost && <span className="tabular-nums">{say(`${m.ourCost} / call`, `${m.ourCost} за вызов`)}</span>}
                  {m.spent && <span className="tabular-nums text-ink-2">{say(`${m.spent} total`, `${m.spent} всего`)}</span>}
                  {(m.holders?.length ?? 0) > 0 && (
                    <span className="flex flex-wrap items-center gap-1">
                      {m.holders?.map((h) => (
                        <Tooltip key={`${h.kind}-${h.label}`} label={`${h.label} — ${h.what}`}>
                          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-1.5 py-px text-ink-2">
                            {h.avatarUrl && <GnomeAvatar src={h.avatarUrl} size={12} alt="" className="size-3 rounded-full" />}
                            {h.label}
                          </span>
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
        {say('Spend per user and the balance are on the ', 'Расход по пользователям и остаток — на странице ')}
        <Link href="/admin/usage" className="text-ink-2 underline hover:text-accent">
          {say('usage page', 'расхода')}
        </Link>
        .
      </p>
    </div>
  )
}
