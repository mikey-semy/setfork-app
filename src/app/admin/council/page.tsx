import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t, type Lang } from '@/shared/i18n'
import { getAiSettings, getApiKey } from '@/shared/settings/ai'
import { fetchModels } from '@/shared/ai/models'
import { buildOpts } from '@/features/admin/model-options'
import { modelMeta } from '@/features/admin/model-enrich'
import { getRosterAll, rosterAvatars } from '@/shared/ai/roster'
import { CouncilList, type CouncilRow } from '@/features/admin/CouncilList'
import { gnomeReputation } from '@/shared/ai/gnome-reputation'
import { needsOwnName } from '@/shared/ai/gnome-names'
import { hireSignals } from '@/features/admin/hire'
import { builtinAvatars } from '@/shared/ai/avatar-gallery'
import { assignGnomeNames, createGnomeAccounts, hireGnome, selfGenerateNow } from '@/features/admin/actions'
import { Button } from '@/shared/ui/button'
import { Signature, Sparkles, UserPlus } from 'lucide-react'
import type { Option } from '@/features/admin/ModelSelect'
import { cardClass } from '@/shared/ui/card-style'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('councilHall', lang) }
}


/**
 * «Зал совета» — СОСТАВ специалистов: кто есть, в каком состоянии, куда нажать. Настройки
 * каждого — на его собственной странице (/admin/council/<id>), как у списка на странице списка.
 * Раньше здесь стояли двадцать полных форм сеткой: это была стена, в которой нельзя ни найти
 * нужного, ни увидеть состав целиком.
 *
 * Заголовка на странице нет: он живёт в шапке (TopNav, ключ councilHall) — как у остальных
 * разделов. Подзаголовков в проекте нет вовсе.
 */
export default async function CouncilPage({ searchParams }: { searchParams: Promise<{ hire?: string; selfgen?: string }> }) {
  await requireAdmin()
  const [lang, settings, apiKey, sp] = await Promise.all([getLang(), getAiSettings(), getApiKey(), searchParams])
  const ru = lang === 'ru'

  // Третий потребитель формата цен появился (эта страница, /admin и серверный экшен смены
  // провайдера) — формула переехала в model-options, локальные копии убраны. Заодно строки
  // получили наш рейтинг и занятость: выбор модели везде объясняется одинаково.
  const models = apiKey ? await fetchModels() : null
  const modelOptions: Option[] = models
    ? buildOpts(models.chat, false, lang, models.currency, models.pricesKnown, await modelMeta(models.currency, lang === 'ru'))
    : []

  const [rows, gallery, uploaded, signals, reps] = await Promise.all([
    getRosterAll(),
    builtinAvatars(),
    rosterAvatars(),
    hireSignals(),
    gnomeReputation(),
  ])
  // Хэндлы аккаунтов: у ростера их нет, а состав должен вести на публичный профиль
  // специалиста — «через их аккаунты» это и означает. Нет аккаунта — так и покажем.
  const { agentHandles } = await import('@/shared/ai/gnome-account')
  const handles = await agentHandles(rows.map((e) => e.userId).filter((x): x is string => !!x))
  // Загруженная картинка уходит готовым URL (imgproxy/диск) — клиенту незачем знать про S3-ключи.
  const roster = rows.map((e) => ({ ...e, uploadedUrl: e.avatarUploaded ? uploaded[e.id] : undefined }))
  // Строки состава: только то, что нужно для обзора. Настройки — на странице специалиста.
  const listRows: CouncilRow[] = rows.map((e) => ({
    id: e.id,
    name: ru ? e.nameRu : e.nameEn,
    profession: ru ? e.professionRu : e.professionEn,
    guild: ru ? e.guildRu : e.guildEn,
    role: e.orgRole,
    lifecycle: e.lifecycle,
    enabled: e.enabled,
    handle: (e.userId && handles[e.userId]) || null,
    // Карта уже отрезолвлена по реальным файлам (rosterAvatars) — прямой путь давал 404 у специализаций.
    avatarUrl: uploaded[e.id] ?? '',
    domains: e.domains,
    gens: reps[e.id]?.gens ?? 0,
    accepted: reps[e.id]?.accepted ?? 0,
  }))
  // Сколько действующих специалистов ещё без аккаунта — только они и мешают.
  const noAccounts = rows.filter((e) => e.enabled && e.lifecycle === 'active' && !e.userId).length
  // Сколько ещё носит роль вместо имени. Правило одно на страницу и на раздачу —
  // иначе кнопка обещала бы одно число, а переименовывалось бы другое.
  const unnamed = rows.filter((e) => needsOwnName(e.nameEn, e.professionEn)).length

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      {settings.councilEnabled ? null : (
        <p className="mb-4 rounded-md border border-warn/50 bg-surface px-3 py-2 text-body-sm text-warn">
          {t('admin.theCouncilOffThese', lang)}
        </p>
      )}
      {sp.hire === 'failed' && (
        <p className="mb-4 rounded-md border border-warn/50 bg-surface px-3 py-2 text-body-sm text-warn">
          {t('admin.hiringFailedModelDid', lang)}
        </p>
      )}
      {/* Найм (HQ §4в): темы, по которым 30 дней подряд отдувается универсал. Кнопка рождает
          гнома ВЫКЛЮЧЕННЫМ (LLM-черновик по признанному профстандарту) — включаешь после ревью. */}
      {signals.length > 0 && (
        <div className={cardClass({ tone: 'accent', className: 'mb-4' })}>
          <div className="mb-2 text-body-sm font-semibold text-accent">
            {t('admin.hiringSignalGeneralistKeeps', lang)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {signals.map((s) => (
              <form key={s.tag} action={hireGnome}>
                <input type="hidden" name="tag" value={s.tag} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-body-sm text-ink hover:border-border-strong"
                >
                  {t('admin.hireMasterFor', lang).replace('{tag}', s.tag)}
                  <span className="font-mono text-caption text-muted">×{s.n}</span>
                </button>
              </form>
            ))}
          </div>
          <p className="mt-2 text-caption text-ink-2">
            {t('admin.theNewMasterCreated', lang)}
          </p>
        </div>
      )}
      {/* Аккаунты уровня пользователя: специалист ведёт свои списки, комментирует и
          предлагает правки наравне с людьми (ADR-0004 — помечен как служебный). Кнопка
          ЯВНАЯ: аккаунт публичен (профиль, авторство), побочным эффектом его не заводят. */}
      {noAccounts > 0 && (
        <div className={cardClass({ className: 'mb-4 flex flex-wrap items-center justify-between gap-3' })}>
          <div className="min-w-0">
            <div className="text-body-sm font-semibold text-ink">
              {t('admin.accountsMissing', lang)}
            </div>
            <p className="mt-0.5 text-caption text-ink-2">
              {t('admin.noAccountsAttribution', lang).replace('{a}', String(noAccounts)).replace('{b}', String(roster.length))}
            </p>
          </div>
          <form action={createGnomeAccounts}>
            <Button type="submit" variant="primary" size="md">
              <UserPlus size={14} /> {t('admin.createAccounts', lang)}
            </Button>
          </form>
        </div>
      )}
      {/* Имена: и у исходного состава, и у нанятых в поле имени лежит РОЛЬ («Chef»,
          «Web Designer»). Кнопка раздаёт собственные имена двергов, а роль переносит в
          профессию — обе колонки живут на странице специалиста. */}
      {unnamed > 0 && (
        <div className={cardClass({ className: 'mb-4 flex flex-wrap items-center justify-between gap-3' })}>
          <div className="min-w-0">
            <div className="text-body-sm font-semibold text-ink">
              {t('admin.namesMissing', lang)}
            </div>
            <p className="mt-0.5 text-caption text-ink-2">
              {t('admin.namesMissingWhy', lang).replace('{a}', String(unnamed)).replace('{b}', String(roster.length))}
            </p>
          </div>
          <form action={assignGnomeNames}>
            <Button type="submit" variant="primary" size="md">
              <Signature size={14} /> {t('admin.giveNames', lang)}
            </Button>
          </form>
        </div>
      )}
      {sp.selfgen && (
        <p className="mb-4 rounded-md border border-warn/50 bg-surface px-3 py-2 text-body-sm text-warn">
          {t('admin.selfgenNoDraft', lang).replace('{e}', sp.selfgen)}
        </p>
      )}
      <CouncilList rows={listRows} lang={lang} canAssign={settings.selfGenMode !== 'off'} />
    </div>
  )
}
