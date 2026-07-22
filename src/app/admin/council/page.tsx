import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { getAiSettings, getApiKey } from '@/shared/settings/ai'
import { fetchModels, type ModelOption } from '@/shared/ai/models'
import { getRosterAll, rosterAvatars } from '@/shared/ai/roster'
import { CouncilRoster } from '@/features/admin/CouncilRoster'
import { hireSignals } from '@/features/admin/hire'
import { hireGnome } from '@/features/admin/actions'
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

/** Встроенные персонажи — читаем каталог, а не список руками: дорисовал картинку → она в выборе. */
async function builtinAvatars(): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  const { join } = await import('node:path')
  try {
    const files = await readdir(join(process.cwd(), 'public', 'gnomes'))
    return files.filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5)).sort()
  } catch {
    return []
  }
}

/**
 * «Зал совета» — отдельная страница вместо секции в настройках: экспертов много, у каждого
 * инструкция в несколько строк, и в узкой колонке они не помещались. Здесь вся ширина и сетка.
 *
 * Заголовка на странице нет: он живёт в шапке (TopNav, ключ councilHall) — как у остальных
 * разделов. Подзаголовков в проекте нет вовсе.
 */
export default async function CouncilPage({ searchParams }: { searchParams: Promise<{ hire?: string }> }) {
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

  const [rows, gallery, uploaded, signals] = await Promise.all([getRosterAll(), builtinAvatars(), rosterAvatars(), hireSignals()])
  // Загруженная картинка уходит готовым URL (imgproxy/диск) — клиенту незачем знать про S3-ключи.
  const roster = rows.map((e) => ({ ...e, uploadedUrl: e.avatarUploaded ? uploaded[e.id] : undefined }))

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
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
                  {say(`Hire a gnome for “${s.tag}”`, `Нанять гнома под «${s.tag}»`)}
                  <span className="font-mono text-[11px] text-muted">×{s.n}</span>
                </button>
              </form>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-ink-2">
            {say('The new gnome is created DISABLED — review the profile, tweak it and switch him on.', 'Новый гном рождается ВЫКЛЮЧЕННЫМ — прочитай профиль, поправь и включи сам.')}
          </p>
        </div>
      )}
      <CouncilRoster experts={roster} modelOptions={modelOptions} gallery={gallery} ru={ru} />
    </div>
  )
}
