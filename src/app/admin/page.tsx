import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { getAiSettings, getApiKey, maskKey } from '@/shared/settings/ai'
import { getMediaSettings, maskSecret } from '@/shared/settings/media'
import { getSearchSettings } from '@/shared/settings/search'
import { getOnlineUsers } from '@/features/sessions/queries'
import { Avatar } from '@/shared/ui/Avatar'
import Link from 'next/link'
import { fetchModels, type ModelOption } from '@/shared/ai/models'
import { setAiSettings } from '@/features/admin/actions'
import { SearchSettingsForm } from '@/features/admin/SearchSettingsForm'
import { ModelSelect, type Option } from '@/features/admin/ModelSelect'
import { AiKeyAndSwitch } from '@/features/admin/AiKeyAndSwitch'
import { CreditsWidget } from '@/features/admin/CreditsWidget'
import { MediaSettingsForm } from '@/features/admin/MediaSettingsForm'
import { ReindexPanel } from '@/features/admin/ReindexPanel'

const field = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] text-ink outline-none'
const lbl = 'mb-1.5 block text-[12.5px] font-semibold text-ink-2'

// OpenRouter возвращает отрицательную цену (-1/токен) у авто-роутеров — она «плавающая».
function isVariable(m: ModelOption): boolean {
  return m.promptPrice < 0 || m.completionPrice < 0
}
// Цена, по которой красим и сортируем: для эмбеддингов — prompt, для чата — completion (или prompt).
function priceMetric(m: ModelOption, embedding?: boolean): number {
  if (isVariable(m)) return Number.POSITIVE_INFINITY // «плавающие» — в конец списка
  return embedding ? m.promptPrice : m.completionPrice || m.promptPrice
}
function priceText(m: ModelOption, embedding: boolean, ru: boolean): string {
  if (isVariable(m)) return ru ? 'Плавающая' : 'Variable'
  if (!m.promptPrice && !m.completionPrice) return ru ? 'Бесплатно' : 'Free'
  return embedding ? `$${m.promptPrice.toFixed(2)}` : `$${m.promptPrice.toFixed(2)} / $${m.completionPrice.toFixed(2)}`
}
// Зелёный — дёшево, жёлтый — средне, красный — дорого, серый — плавающая.
function priceClass(metric: number): string {
  if (!Number.isFinite(metric)) return 'text-muted'
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
  const [settings, apiKey, media, search, online] = await Promise.all([
    getAiSettings(),
    getApiKey(),
    getMediaSettings(),
    getSearchSettings(),
    getOnlineUsers(),
  ])
  const hasKey = Boolean(apiKey)
  const maskedKey = maskKey(apiKey)
  const mediaValues = {
    s3Endpoint: media.s3Endpoint,
    s3Region: media.s3Region,
    s3Bucket: media.s3Bucket,
    s3Prefix: media.s3Prefix,
    s3AccessKey: media.s3AccessKey,
    imgproxyUrl: media.imgproxyUrl,
    cdnUrl: media.cdnUrl,
    useImgproxy: media.useImgproxy,
    s3SecretMask: maskSecret(media.s3SecretKey),
    imgproxyKeyMask: maskSecret(media.imgproxyKey),
    imgproxySaltMask: maskSecret(media.imgproxySalt),
  }
  const models = hasKey ? await fetchModels() : { chat: [], embedding: [] }

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
        <div className="mb-3 flex items-center gap-2 font-semibold text-ink">
          <span className="h-2 w-2 rounded-full bg-[var(--ok)]" />
          {ru ? 'Сейчас онлайн' : 'Online now'} <span className="font-mono text-[12px] text-muted">{online.length}</span>
        </div>
        {online.length === 0 ? (
          <p className="text-[13px] text-muted">{ru ? 'Никого онлайн.' : 'No one online.'}</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {online.map((u) => (
              <Link key={u.userId} href={`/${u.handle}`} className="flex items-center gap-2 rounded-full border border-border bg-surface-2 py-1 pl-1 pr-3 hover:border-border-strong">
                <Avatar handle={u.handle} avatarUrl={u.avatarUrl} size={24} />
                <span className="text-[13px] text-ink">{u.handle}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

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
          <AiKeyAndSwitch enabled={settings.enabled} hasKey={hasKey} maskedKey={maskedKey} ru={ru} />

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

          <div className="flex justify-end border-t border-border pt-4">
            <button className="rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-fg">
              {ru ? 'Сохранить' : 'Save'}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-1 font-semibold text-ink">{ru ? 'Хранилище и изображения' : 'Storage & images'}</div>
        <p className="mb-4 text-[13px] text-ink-2">
          {ru
            ? 'S3-совместимое хранилище, imgproxy и CDN. Значения перекрывают .env; пустое поле — берётся из .env.'
            : 'S3-compatible storage, imgproxy and CDN. Values override .env; an empty field falls back to .env.'}
        </p>
        <MediaSettingsForm ru={ru} v={mediaValues} />
      </section>

      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-1 font-semibold text-ink">{ru ? 'Поиск' : 'Search'}</div>
        <p className="mb-4 text-[13px] text-ink-2">
          {ru
            ? 'Режим строки поиска. Семантика и гибрид используют векторный индекс (нужен ключ и индексация); при недоступности — откат на ключевые слова.'
            : 'Search bar mode. Semantic and hybrid use the vector index (needs API key + indexing); falls back to keyword when unavailable.'}
        </p>
        <SearchSettingsForm current={search} ru={ru} />
      </section>

      <ReindexPanel ru={ru} />
    </div>
  )
}
