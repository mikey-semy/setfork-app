import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { getAiSettings, hasOpenRouterKey } from '@/shared/settings/ai'
import { fetchModels, type ModelOption } from '@/shared/ai/models'
import { setAiSettings } from '@/features/admin/actions'
import { ModelSelect, type Option } from '@/features/admin/ModelSelect'
import { CreditsWidget } from '@/features/admin/CreditsWidget'
import { ReindexPanel } from '@/features/admin/ReindexPanel'

const field = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] text-ink outline-none'
const lbl = 'mb-1.5 block text-[12.5px] font-semibold text-ink-2'

// Цена, по которой красим: для эмбеддингов — prompt, для чата — completion (или prompt).
function priceMetric(m: ModelOption, embedding?: boolean): number {
  return embedding ? m.promptPrice : m.completionPrice || m.promptPrice
}
function priceText(m: ModelOption, embedding: boolean, ru: boolean): string {
  if (!m.promptPrice && !m.completionPrice) return ru ? 'Бесплатно' : 'Free'
  return embedding ? `$${m.promptPrice.toFixed(2)}` : `$${m.promptPrice.toFixed(2)} / $${m.completionPrice.toFixed(2)}`
}
// Зелёный — дёшево, жёлтый — средне, красный — дорого.
function priceClass(metric: number): string {
  if (metric <= 1) return 'text-[var(--ok)]'
  if (metric <= 10) return 'text-[var(--warn)]'
  return 'text-[var(--danger)]'
}
function buildOpts(models: ModelOption[], embedding: boolean, ru: boolean): Option[] {
  return [...models]
    .sort((a, b) => priceMetric(a, embedding) - priceMetric(b, embedding))
    .map((m) => ({ value: m.id, id: m.id, price: priceText(m, embedding, ru), priceClass: priceClass(priceMetric(m, embedding)) }))
}
function ensure(opts: Option[], current: string): Option[] {
  return current && !opts.some((o) => o.value === current) ? [{ value: current, id: current }, ...opts] : opts
}

export default async function AdminPage() {
  await requireAdmin()
  const lang = await getLang()
  const ru = lang === 'ru'
  const hasKey = hasOpenRouterKey()
  const [settings, models] = await Promise.all([
    getAiSettings(),
    hasKey ? fetchModels() : Promise.resolve({ chat: [], embedding: [] }),
  ])

  const chatOpts = ensure(buildOpts(models.chat, false, ru), settings.chatModel)
  const fallbackOpts = ensure(buildOpts(models.chat, false, ru), settings.fallbackModel)
  const embOpts = ensure(buildOpts(models.embedding, true, ru), settings.embeddingModel)

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 py-8">
      <div>
        <h1 className="mb-1 text-[18px] font-bold text-ink">{ru ? 'Настройки ИИ' : 'AI settings'}</h1>
        <p className="text-[13px] text-ink-2">
          {ru ? 'Модель и параметры генерации. Хранится в БД, меняется на лету.' : 'Model & generation params. Stored in DB, changeable on the fly.'}
        </p>
      </div>

      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-4 font-semibold text-ink">{ru ? 'Генерация и модели' : 'Generation & models'}</div>

        {!hasKey && (
          <div className="mb-5 rounded-md border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-3 py-2.5 text-[13px] text-[var(--warn)]">
            {ru
              ? 'Нет OPENROUTER_API_KEY в .env — генерация и списки моделей недоступны (id можно ввести вручную).'
              : 'No OPENROUTER_API_KEY in .env — generation and model lists are unavailable (id can be typed manually).'}
          </div>
        )}

        <form action={setAiSettings} className="flex flex-col gap-5">
          <label className="flex items-center gap-2.5 text-[14px] text-ink">
            <input type="checkbox" name="enabled" defaultChecked={settings.enabled} />
            {ru ? 'Генерация включена' : 'Generation enabled'}
          </label>

          <div>
            <label className={lbl}>{ru ? 'Модель генерации' : 'Chat model'}</label>
            {chatOpts.length > 0 ? (
              <ModelSelect name="chatModel" defaultValue={settings.chatModel} options={chatOpts} placeholder={ru ? 'Выбери модель' : 'Pick a model'} />
            ) : (
              <input name="chatModel" defaultValue={settings.chatModel} className={`${field} font-mono`} />
            )}
          </div>

          <div>
            <label className={lbl}>{ru ? 'Запасная модель (для дешёвого режима)' : 'Fallback model (cheap mode)'}</label>
            {fallbackOpts.length > 0 ? (
              <ModelSelect name="fallbackModel" defaultValue={settings.fallbackModel} options={fallbackOpts} allowEmpty placeholder="—" />
            ) : (
              <input name="fallbackModel" defaultValue={settings.fallbackModel} className={`${field} font-mono`} />
            )}
          </div>

          <div>
            <label className={lbl}>{ru ? 'Модель эмбеддингов (RAG, 1536-мерная)' : 'Embedding model (RAG, 1536-dim)'}</label>
            {embOpts.length > 0 ? (
              <ModelSelect name="embeddingModel" defaultValue={settings.embeddingModel} options={embOpts} placeholder={ru ? 'Выбери модель' : 'Pick a model'} />
            ) : (
              <input name="embeddingModel" defaultValue={settings.embeddingModel} className={`${field} font-mono`} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Temperature</label>
              <input type="number" name="temperature" step="any" min="0" max="2" defaultValue={settings.temperature} className={field} />
            </div>
            <div>
              <label className={lbl}>Max tokens</label>
              <input type="number" name="maxTokens" step="1" min="64" max="4000" defaultValue={settings.maxTokens} className={field} />
            </div>
          </div>

          <p className="text-[12px] text-muted">
            {ru
              ? 'Цены в списках — за 1М токенов (prompt/completion). Зелёные дешевле, жёлтые средние, красные дорогие.'
              : 'Prices are per 1M tokens (prompt/completion). Green = cheap, yellow = mid, red = expensive.'}
          </p>

          <div className="space-y-3 rounded-md border border-border bg-surface-2 p-3">
            <div className="text-[13px] font-medium text-ink">{ru ? 'Контроль расходов OpenRouter' : 'OpenRouter cost control'}</div>
            <CreditsWidget ru={ru} />
            <div>
              <label className={lbl}>{ru ? 'Порог авто-fallback ($)' : 'Auto-fallback threshold ($)'}</label>
              <input type="number" name="cheapModeThreshold" step="any" min="0" defaultValue={settings.cheapModeThreshold} className={field} />
              <p className="mt-1.5 text-[12px] text-muted">
                {ru
                  ? 'Когда остаток упадёт ниже этой суммы — генерация переключится на запасную модель. 0 — выключено.'
                  : 'When the balance drops below this, generation switches to the fallback model. 0 = off.'}
              </p>
            </div>
          </div>

          <button className="w-fit rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-fg">
            {ru ? 'Сохранить' : 'Save'}
          </button>
        </form>
      </section>

      <ReindexPanel ru={ru} />
    </div>
  )
}
