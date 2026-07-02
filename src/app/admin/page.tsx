import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { getAiSettings, hasOpenRouterKey } from '@/shared/settings/ai'
import { fetchModels, type ModelOption } from '@/shared/ai/models'
import { getOpenRouterCredits } from '@/shared/ai/credits'
import { setAiSettings } from '@/features/admin/actions'
import { ModelSelect, type Option } from '@/features/admin/ModelSelect'

const field = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] text-ink outline-none'

function chatLabel(m: ModelOption): string {
  return `${m.id}  ·  $${m.promptPrice.toFixed(2)} / $${m.completionPrice.toFixed(2)} за 1M`
}
function embLabel(m: ModelOption): string {
  return `${m.id}  ·  $${m.promptPrice.toFixed(3)} за 1M`
}
function ensure(opts: Option[], current: string): Option[] {
  return current && !opts.some((o) => o.value === current) ? [{ value: current, label: current }, ...opts] : opts
}

export default async function AdminPage() {
  await requireAdmin()
  const lang = await getLang()
  const ru = lang === 'ru'
  const hasKey = hasOpenRouterKey()
  const [settings, models, credits] = await Promise.all([
    getAiSettings(),
    hasKey ? fetchModels() : Promise.resolve({ chat: [], embedding: [] }),
    hasKey ? getOpenRouterCredits() : Promise.resolve(null),
  ])

  const chatOpts = ensure(models.chat.map((m) => ({ value: m.id, label: chatLabel(m) })), settings.chatModel)
  const fallbackOpts = ensure(models.chat.map((m) => ({ value: m.id, label: chatLabel(m) })), settings.fallbackModel)
  const embOpts = ensure(models.embedding.map((m) => ({ value: m.id, label: embLabel(m) })), settings.embeddingModel)

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-8">
      <h1 className="mb-1 text-[18px] font-bold text-ink">{ru ? 'Настройки ИИ' : 'AI settings'}</h1>
      <p className="mb-6 text-[13px] text-ink-2">
        {ru ? 'Модель и параметры генерации. Хранится в БД, меняется на лету.' : 'Model & generation params. Stored in DB, changeable on the fly.'}
      </p>

      {!hasKey && (
        <div className="mb-5 rounded-md border border-border bg-surface px-3 py-2.5 text-[13px] text-[var(--warn)]">
          {ru ? 'Нет OPENROUTER_API_KEY в .env — генерация выключена.' : 'No OPENROUTER_API_KEY in .env — generation is off.'}
        </div>
      )}
      {credits && (
        <div className="mb-5 flex items-center gap-2 text-[12.5px]">
          <span className="text-muted">{ru ? 'Баланс OpenRouter:' : 'OpenRouter balance:'}</span>
          <span className="font-mono font-semibold text-ink">${credits.remaining.toFixed(2)}</span>
          <span className="font-mono text-muted">/ ${credits.total.toFixed(2)}</span>
          <span className="text-muted">({ru ? 'только показ' : 'read-only'})</span>
        </div>
      )}

      <form action={setAiSettings} className="flex flex-col gap-5">
        <label className="flex items-center gap-2.5 text-[14px] text-ink">
          <input type="checkbox" name="enabled" defaultChecked={settings.enabled} />
          {ru ? 'Генерация включена' : 'Generation enabled'}
        </label>

        <div>
          <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">
            {ru ? 'Модель генерации' : 'Chat model'}
          </label>
          {chatOpts.length > 0 ? (
            <ModelSelect name="chatModel" defaultValue={settings.chatModel} options={chatOpts} placeholder={ru ? 'Выбери модель' : 'Pick a model'} />
          ) : (
            <input name="chatModel" defaultValue={settings.chatModel} className={`${field} font-mono`} />
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">
            {ru ? 'Запасная модель (для дешёвого режима)' : 'Fallback model (cheap mode)'}
          </label>
          {fallbackOpts.length > 0 ? (
            <ModelSelect name="fallbackModel" defaultValue={settings.fallbackModel} options={fallbackOpts} allowEmpty placeholder="—" />
          ) : (
            <input name="fallbackModel" defaultValue={settings.fallbackModel} className={`${field} font-mono`} />
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">Temperature</label>
            <input type="number" name="temperature" step="any" min="0" max="2" defaultValue={settings.temperature} className={field} />
          </div>
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">Max tokens</label>
            <input type="number" name="maxTokens" step="1" min="64" max="4000" defaultValue={settings.maxTokens} className={field} />
          </div>
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">{ru ? 'Порог $ (fallback)' : 'Cheap $ threshold'}</label>
            <input type="number" name="cheapModeThreshold" step="any" min="0" defaultValue={settings.cheapModeThreshold} className={field} />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">
            {ru ? 'Модель эмбеддингов (RAG)' : 'Embedding model (RAG)'}
          </label>
          {embOpts.length > 0 ? (
            <ModelSelect name="embeddingModel" defaultValue={settings.embeddingModel} options={embOpts} placeholder={ru ? 'Выбери модель' : 'Pick a model'} />
          ) : (
            <input name="embeddingModel" defaultValue={settings.embeddingModel} className={`${field} font-mono`} />
          )}
        </div>

        <button className="w-fit rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-fg">
          {ru ? 'Сохранить' : 'Save'}
        </button>
      </form>
    </div>
  )
}
