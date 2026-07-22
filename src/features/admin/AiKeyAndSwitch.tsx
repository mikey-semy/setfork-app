'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Switch } from '@/shared/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

export type AiProviderChoice = 'openrouter' | 'selectel' | 'yandex' | 'gigachat'

/** Провайдер ИИ + его ключи (маскированные) + переключатель генерации.
 *  Поля показываются под выбранный провайдер; полный ключ на клиент не приходит —
 *  только маска и флаг «задан». Пустое поле при сохранении = «не менять». */
export function AiKeyAndSwitch({
  enabled,
  provider,
  hasKey,
  maskedKeys,
  yandexFolder,
  searchKeyMasked,
  ru,
}: {
  enabled: boolean
  provider: AiProviderChoice
  /** Есть ли сохранённый ключ у каждого провайдера (БД или env). */
  hasKey: Record<AiProviderChoice, boolean>
  /** Маска сохранённого ключа (пусто = не задан). */
  maskedKeys: Record<AiProviderChoice, string>
  /** Текущий folder_id Яндекса (БД или env) — он не секрет. */
  yandexFolder: string
  /** Маска ключа Yandex Search API (веб-гора); пусто = не задан. */
  searchKeyMasked: string
  ru: boolean
}) {
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  const [prov, setProv] = useState<AiProviderChoice>(provider)
  const [keyInput, setKeyInput] = useState('')
  const [reveal, setReveal] = useState(false)
  const [on, setOn] = useState(enabled)

  const canEnable = hasKey[prov] || keyInput.trim().length > 0
  const checked = on && canEnable

  const lbl = 'mb-1.5 block text-[12.5px] font-semibold text-ink-2'
  const inputCls =
    'w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[13px] text-ink outline-hidden focus:border-border-strong'

  const KEY_FIELD: Record<AiProviderChoice, { label: string; placeholder: string; name: string }> = {
    openrouter: { label: say('OpenRouter API key', 'API-ключ OpenRouter'), placeholder: 'sk-or-v1-…', name: 'apiKey' },
    selectel: { label: say('Selectel AI router API key', 'API-ключ Selectel (ИИ-роутер)'), placeholder: 'sk-sl-v1-…', name: 'selectelKey' },
    yandex: { label: say('Yandex AI Studio API key', 'API-ключ Yandex AI Studio'), placeholder: 'AQVN…', name: 'yandexKey' },
    gigachat: { label: say('GigaChat authorization key (Basic)', 'Ключ авторизации GigaChat (Basic)'), placeholder: 'base64(ClientID:Secret)', name: 'gigachatKey' },
  }
  const field = KEY_FIELD[prov]

  const PROVIDER_NOTE: Record<AiProviderChoice, string> = {
    openrouter: say(
      'Foreign aggregator: user text leaves the country. Use a RU provider for .ru.',
      'Зарубежный агрегатор: пользовательский текст уходит за рубеж. Для .ru использовать RU-провайдера.',
    ),
    selectel: say(
      'Traffic goes through Selectel (RU), prices in ₽. Foreign models are still called at their APIs — pick RU-hosted models for strict compliance.',
      'Данные идут через инфраструктуру Selectel (РФ), цены в ₽. Зарубежные модели роутер зовёт у их API — для строгой юр-чистоты выбирайте RU-hosted модели.',
    ),
    yandex: say(
      'Fully in RU (Yandex Cloud); prices — in the Yandex Cloud console. Model ids look like gpt://<folder>/…',
      'Полностью в РФ (Yandex Cloud); цены — в консоли Yandex Cloud. Модели вида gpt://<каталог>/…',
    ),
    gigachat: say(
      'Fully in RU (Sber). Needs the Russian Trusted CA cert (NODE_EXTRA_CA_CERTS, see certs/). Chat only: embeddings are a paid tier.',
      'Полностью в РФ (Сбер). Нужен серт НУЦ Минцифры (NODE_EXTRA_CA_CERTS, см. certs/). Только чат: эмбеддинги — платный тариф.',
    ),
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[14px] font-medium text-ink">{say('Drafting enabled', 'Черновики включены')}</div>
          <p className="text-[12px] text-muted">
            {canEnable
              ? say('Lists can be drafted automatically.', 'Списки можно придумывать автоматически.')
              : say('Enter an API key below first.', 'Сначала укажите API-ключ ниже.')}
          </p>
        </div>
        <Switch name="enabled" checked={checked} onCheckedChange={setOn} disabled={!canEnable} />
      </div>

      <div>
        <label className={lbl}>{say('Provider', 'Провайдер')}</label>
        <Select
          name="provider"
          value={prov}
          onValueChange={(v) => {
            setProv(v as AiProviderChoice)
            setKeyInput('')
          }}
        >
          <SelectTrigger className="text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openrouter">OpenRouter</SelectItem>
            <SelectItem value="selectel">{say('Selectel AI router (RU)', 'Selectel ИИ-роутер (РФ)')}</SelectItem>
            <SelectItem value="yandex">YandexGPT / AI Studio (РФ)</SelectItem>
            <SelectItem value="gigachat">{say('GigaChat / Sber (RU)', 'GigaChat / Сбер (РФ)')}</SelectItem>
          </SelectContent>
        </Select>
        <p className="mt-1.5 text-[12px] text-muted">{PROVIDER_NOTE[prov]}</p>
      </div>

      <div>
        <label className={lbl}>{field.label}</label>
        <div className="relative">
          <input
            key={prov} // смена провайдера сбрасывает поле, а не тащит чужой ключ
            name={field.name}
            type={reveal ? 'text' : 'password'}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={hasKey[prov] ? maskedKeys[prov] || '••••••••' : field.placeholder}
            autoComplete="off"
            spellCheck={false}
            className={`${inputCls} pr-10`}
          />
          <button
            type="button"
            aria-label={reveal ? 'hide' : 'show'}
            onClick={() => setReveal((v) => !v)}
            className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-muted hover:text-ink"
          >
            {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        <p className="mt-1.5 text-[12px] text-muted">
          {hasKey[prov]
            ? say('Key saved (shown masked). Leave blank to keep it.', 'Ключ сохранён (показан замаскированным). Оставьте поле пустым, чтобы не менять.')
            : say('Stored in the DB (or set via an env variable).', 'Ключ хранится в БД (или задаётся env-переменной).')}
        </p>
      </div>

      {prov === 'yandex' && (
        <div>
          <label className={lbl}>{say('Yandex Cloud folder_id', 'Каталог (folder_id) Yandex Cloud')}</label>
          <input
            name="yandexFolder"
            defaultValue={yandexFolder}
            placeholder="b1g…"
            autoComplete="off"
            spellCheck={false}
            className={inputCls}
          />
          <p className="mt-1.5 text-[12px] text-muted">
            {say(
              'From the console URL: aistudio.yandex.ru/platform/folders/<folder_id>.',
              'Из URL консоли: aistudio.yandex.ru/platform/folders/<folder_id>.',
            )}
          </p>
          {/* Веб-гора: ОТДЕЛЬНЫЙ ключ Yandex Search API (не чат-ключ). Пусто →
              веб-разведчик совета молча пропускается, а не выдумывает прецеденты. */}
          <label className={`${lbl} mt-4`}>{say('Yandex Search API key (web scout, optional)', 'Ключ Yandex Search API (веб-разведчик, опционально)')}</label>
          <input
            name="yandexSearchKey"
            defaultValue=""
            placeholder={searchKeyMasked || 'AQVN…'}
            autoComplete="off"
            spellCheck={false}
            className={inputCls}
          />
          <p className="mt-1.5 text-[12px] text-muted">
            {say(
              'Separate paid service — activate Search API in Yandex Cloud. Empty = council relies on our corpus only (no made-up web precedents). Leave blank to keep current.',
              'Отдельный платный сервис — активируй Search API в Yandex Cloud. Пусто = совет опирается только на наш корпус (без выдуманных веб-прецедентов). Оставь пустым, чтобы не менять.',
            )}
          </p>
        </div>
      )}
    </div>
  )
}
