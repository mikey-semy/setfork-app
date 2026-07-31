import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { getAiSettings, getApiKey } from '@/shared/settings/ai'
import { fetchModels, type ModelOption } from '@/shared/ai/models'
import { getRosterAll, rosterAvatars } from '@/shared/ai/roster'
import { CouncilList, type CouncilRow } from '@/features/admin/CouncilList'
import { gnomeReputation } from '@/shared/ai/gnome-reputation'
import { hireSignals } from '@/features/admin/hire'
import { builtinAvatars } from '@/features/admin/avatar-gallery'
import { createGnomeAccounts, hireGnome, selfGenerateNow } from '@/features/admin/actions'
import { Button } from '@/shared/ui/button'
import { Sparkles, UserPlus } from 'lucide-react'
import type { Option } from '@/features/admin/ModelSelect'

export const metadata = { title: 'Council' }

// Те же цены, что и в общей админке. Дублировать формулу не хочется, но и тащить её в shared ради
// двух страниц рано — вынесем, когда появится третий потребитель.
type Currency = 'USD' | 'RUB'
function priceText(m: ModelOption, ru: boolean, cur: Currency): string {
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  if (!m.priceKnown) return '—' // провайдер не прислал цену: неизвестно ≠ бесплатно
  if (m.promptPrice < 0 || m.completionPrice < 0) return say('Variable', 'Плавающая')
  if (!m.promptPrice && !m.completionPrice) return say('Free', 'Бесплатно')
  const s = cur === 'RUB' ? '₽' : '$'
  return `${s}${m.promptPrice.toFixed(2)} / ${s}${m.completionPrice.toFixed(2)}`
}
function priceClass(m: ModelOption, cur: Currency): string {
  const v = m.completionPrice || m.promptPrice
  const [ok, warn] = cur === 'RUB' ? [100, 1000] : [1, 10]
  if (v < 0) return 'text-muted'
  if (v <= ok) return 'text-ok'
  if (v <= warn) return 'text-warn'
  return 'text-danger'
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
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)

  const models = apiKey ? await fetchModels() : null
  const modelOptions: Option[] = [...(models?.chat ?? [])]
    .sort((a, b) => (a.completionPrice || a.promptPrice) - (b.completionPrice || b.promptPrice))
    .map((m) =>
      models?.pricesKnown
        ? { value: m.id, id: m.id, label: m.label, family: m.family, price: priceText(m, ru, models.currency), priceClass: priceClass(m, models.currency) }
        : { value: m.id, id: m.id, label: m.label, family: m.family },
    )

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
    avatarUrl: e.avatarUploaded ? (uploaded[e.id] ?? '') : `/gnomes/${e.avatar || e.id}.webp`,
    domains: e.domains,
    gens: reps[e.id]?.gens ?? 0,
    accepted: reps[e.id]?.accepted ?? 0,
  }))
  // Сколько действующих специалистов ещё без аккаунта — только они и мешают.
  const noAccounts = rows.filter((e) => e.enabled && e.lifecycle === 'active' && !e.userId).length

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 px-5 py-6 md:px-8">
      {settings.councilEnabled ? null : (
        <p className="mb-4 rounded-md border border-warn/50 bg-surface px-3 py-2 text-[12.5px] text-warn">
          {say(
            'The council is off — these experts are not summoned. Turn it on in Admin → Generation & models.',
            'Совет выключен — этих экспертов никто не зовёт. Включается в Админке → Генерация и модели.',
          )}
        </p>
      )}
      {sp.hire === 'failed' && (
        <p className="mb-4 rounded-md border border-warn/50 bg-surface px-3 py-2 text-[12.5px] text-warn">
          {say('Hiring failed — the model did not return a valid profile. Try again.', 'Найм не удался — модель не вернула валидный профиль. Попробуй ещё раз.')}
        </p>
      )}
      {/* Найм (HQ §4в): темы, по которым 30 дней подряд отдувается универсал. Кнопка рождает
          гнома ВЫКЛЮЧЕННЫМ (LLM-черновик по признанному профстандарту) — включаешь после ревью. */}
      {signals.length > 0 && (
        <div className="mb-4 rounded-lg border border-(--accent)/40 bg-(--accent-soft) p-3.5">
          <div className="mb-2 text-[12.5px] font-semibold text-accent">
            {say('Hiring signal: the generalist keeps covering these topics', 'Сигнал найма: универсал раз за разом отдувается по этим темам')}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {signals.map((s) => (
              <form key={s.tag} action={hireGnome}>
                <input type="hidden" name="tag" value={s.tag} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] text-ink hover:border-border-strong"
                >
                  {say(`Hire a master for “${s.tag}”`, `Нанять мастера под «${s.tag}»`)}
                  <span className="font-mono text-[11px] text-muted">×{s.n}</span>
                </button>
              </form>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-ink-2">
            {say('The new master is created DISABLED — review the profile, tweak it and switch him on.', 'Новый мастер рождается ВЫКЛЮЧЕННЫМ — прочитай профиль, поправь и включи сам.')}
          </p>
        </div>
      )}
      {/* Аккаунты уровня пользователя: специалист ведёт свои списки, комментирует и
          предлагает правки наравне с людьми (ADR-0004 — помечен как служебный). Кнопка
          ЯВНАЯ: аккаунт публичен (профиль, авторство), побочным эффектом его не заводят. */}
      {noAccounts > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3.5">
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold text-ink">
              {say('Accounts are missing', 'Не у всех есть аккаунт')}
            </div>
            <p className="mt-0.5 text-[11.5px] text-ink-2">
              {say(
                `${noAccounts} of ${roster.length} have no user-level account — without it their edits are nobody’s and cannot be attributed.`,
                `${noAccounts} из ${roster.length} без аккаунта уровня пользователя — без него их правки ничьи и их некому приписать.`,
              )}
            </p>
          </div>
          <form action={createGnomeAccounts}>
            <Button type="submit" variant="primary" size="md">
              <UserPlus size={14} /> {say('Create accounts', 'Завести аккаунты')}
            </Button>
          </form>
        </div>
      )}
      {sp.selfgen && (
        <p className="mb-4 rounded-md border border-warn/50 bg-surface px-3 py-2 text-[12.5px] text-warn">
          {say(`Self-generation did not produce a draft: ${sp.selfgen}`, `Самогенерация не дала черновик: ${sp.selfgen}`)}
        </p>
      )}
      <CouncilList rows={listRows} lang={lang} canAssign={settings.selfGenMode !== 'off'} />
    </div>
  )
}
