import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { getAiSettings, hasOpenRouterKey } from '@/shared/settings/ai'
import { fetchChatModels } from '@/shared/ai/models'
import { getOpenRouterCredits } from '@/shared/ai/credits'
import { setAiSettings } from '@/features/admin/actions'

const field = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] text-ink outline-none'

export default async function AdminPage() {
  await requireAdmin()
  const lang = await getLang()
  const ru = lang === 'ru'
  const hasKey = hasOpenRouterKey()
  const [settings, models, credits] = await Promise.all([
    getAiSettings(),
    hasKey ? fetchChatModels() : Promise.resolve([]),
    hasKey ? getOpenRouterCredits() : Promise.resolve(null),
  ])

  const ids = models.map((m) => m.id)
  const chatIds = ids.includes(settings.chatModel) ? ids : [settings.chatModel, ...ids].filter(Boolean)

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
        <div className="mb-5 rounded-md border border-border bg-surface px-3 py-2.5 font-mono text-[12.5px] text-ink-2">
          OpenRouter: ${credits.remaining.toFixed(2)} {ru ? 'осталось' : 'left'} / ${credits.total.toFixed(2)}
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
          {chatIds.length > 0 ? (
            <select name="chatModel" defaultValue={settings.chatModel} className={field}>
              {chatIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          ) : (
            <input name="chatModel" defaultValue={settings.chatModel} className={`${field} font-mono`} />
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">
            {ru ? 'Запасная модель (для дешёвого режима)' : 'Fallback model (cheap mode)'}
          </label>
          {ids.length > 0 ? (
            <select name="fallbackModel" defaultValue={settings.fallbackModel} className={field}>
              <option value="">—</option>
              {ids.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
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
          <input name="embeddingModel" defaultValue={settings.embeddingModel} className={`${field} font-mono`} />
        </div>

        <button className="w-fit rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-fg">
          {ru ? 'Сохранить' : 'Save'}
        </button>
      </form>
    </div>
  )
}
