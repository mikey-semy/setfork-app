'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Switch } from '@/shared/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Field } from '@/shared/ui/Field'

export type AiProviderChoice = 'openrouter' | 'selectel' | 'yandex' | 'gigachat'
export type KeySource = 'db' | 'env' | 'none'

/** Radix Select не принимает пустую строку как значение — «нет запасного» несём явным словом,
 *  а серверный экшен превращает его обратно в пустоту. */
export const NO_FALLBACK = '__none__'

const PROVIDER_LABEL: Record<AiProviderChoice, string> = {
  openrouter: 'OpenRouter',
  selectel: 'Selectel',
  yandex: 'YandexGPT',
  gigachat: 'GigaChat',
}

/** Провайдер ИИ + его ключи (маскированные) + переключатель генерации.
 *  Поля показываются под выбранный провайдер; полный ключ на клиент не приходит —
 *  только маска и флаг «задан». Пустое поле при сохранении = «не менять». */
export function AiKeyAndSwitch({
  enabled,
  provider,
  hasKey,
  maskedKeys,
  keySources,
  fallbackProvider,
  yandexFolder,
  searchKeyMasked,
  ru,
  onProviderChange,
}: {
  enabled: boolean
  provider: AiProviderChoice
  /** Есть ли сохранённый ключ у каждого провайдера (БД или env). */
  hasKey: Record<AiProviderChoice, boolean>
  /** Маска сохранённого ключа (пусто = не задан). */
  maskedKeys: Record<AiProviderChoice, string>
  /** Откуда ключ у каждого провайдера: база, env стенда или его нет. */
  keySources: Record<AiProviderChoice, KeySource>
  /** Запасной провайдер ('' = выключен). */
  fallbackProvider: string
  /** Текущий folder_id Яндекса (БД или env) — он не секрет. */
  yandexFolder: string
  /** Маска ключа Yandex Search API (веб-гора); пусто = не задан. */
  searchKeyMasked: string
  ru: boolean
  /** Смена провайдера — родитель подтягивает каталог моделей ВЫБРАННОГО провайдера. */
  onProviderChange?: (provider: AiProviderChoice) => void
}) {
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  const [prov, setProv] = useState<AiProviderChoice>(provider)
  const [keyInput, setKeyInput] = useState('')
  const [reveal, setReveal] = useState(false)
  const [on, setOn] = useState(enabled)

  const canEnable = hasKey[prov] || keyInput.trim().length > 0
  const checked = on && canEnable

  const inputCls =
    'w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[0.8125rem] text-ink outline-hidden focus:border-border-strong'

  const KEY_FIELD: Record<AiProviderChoice, { label: string; placeholder: string; name: string }> = {
    openrouter: { label: say('OpenRouter API key', 'API-ключ OpenRouter'), placeholder: 'sk-or-v1-…', name: 'apiKey' },
    selectel: { label: say('Selectel AI router API key', 'API-ключ Selectel (ИИ-роутер)'), placeholder: 'sk-sl-v1-…', name: 'selectelKey' },
    yandex: { label: say('Yandex AI Studio API key', 'API-ключ Yandex AI Studio'), placeholder: 'AQVN…', name: 'yandexKey' },
    gigachat: { label: say('GigaChat authorization key (Basic)', 'Ключ авторизации GigaChat (Basic)'), placeholder: 'base64(ClientID:Secret)', name: 'gigachatKey' },
  }
  const field = KEY_FIELD[prov]

  // ОТКУДА ключ — прямым текстом. «Ключ есть» с маской выглядит одинаково для базы и для env,
  // а ведут себя они по-разному: после сброса базы остаётся env, после передеплоя без env —
  // база. Отсюда и брались вопросы «ключ исчез, вводить заново?».
  const KEY_HINT: Record<KeySource, string> = {
    db: say('Saved in the database (shown masked). Leave blank to keep it.', 'Сохранён в базе (показан замаскированным). Оставьте поле пустым, чтобы не менять.'),
    env: say(
      'Taken from the stand environment variable — there is no key in the database. Entering one here will save it to the database and it will win.',
      'Берётся из переменной окружения стенда — в базе ключа нет. Если ввести здесь, он сохранится в базу и станет главным.',
    ),
    none: say('Not set: neither in the database nor in the environment.', 'Не задан: ни в базе, ни в переменных окружения.'),
  }

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
          <div className="text-[0.875rem] font-medium text-ink">{say('Drafting enabled', 'Черновики включены')}</div>
          <p className="text-[0.78125rem] text-muted">
            {canEnable
              ? say('Lists can be drafted automatically.', 'Списки можно придумывать автоматически.')
              : say('Enter an API key below first.', 'Сначала укажите API-ключ ниже.')}
          </p>
        </div>
        <Switch name="enabled" checked={checked} onCheckedChange={setOn} disabled={!canEnable} />
      </div>

      <Field label={say('Provider', 'Провайдер')} hint={PROVIDER_NOTE[prov]}>
        <Select
          name="provider"
          value={prov}
          onValueChange={(v) => {
            const next = v as AiProviderChoice
            setProv(next)
            setKeyInput('')
            onProviderChange?.(next)
          }}
        >
          <SelectTrigger className="text-[0.8125rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openrouter">OpenRouter</SelectItem>
            <SelectItem value="selectel">{say('Selectel AI router (RU)', 'Selectel ИИ-роутер (РФ)')}</SelectItem>
            <SelectItem value="yandex">YandexGPT / AI Studio (РФ)</SelectItem>
            <SelectItem value="gigachat">{say('GigaChat / Sber (RU)', 'GigaChat / Сбер (РФ)')}</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {/* ЗАПАСНОЙ — на случай, когда основной недоступен (лёг egress-мост, гео-блок, авария у
          провайдера). Выключен по умолчанию и задаётся руками СОЗНАТЕЛЬНО: молча уронить
          генерацию с RU-провайдера на зарубежный значит отправить пользовательский текст за
          границу без ведома владельца. */}
      <Field
        label={say('Spare provider (used when the main one is unreachable)', 'Запасной провайдер (когда основной недоступен)')}
        hint={say(
          'Off by default. Generation switches to it only while the main provider does not answer; the switch is written to the log. Mind the jurisdiction: a foreign spare sends user text abroad.',
          'По умолчанию выключен. Генерация уходит на него, только пока основной не отвечает; подмена пишется в лог. Учитывай юрисдикцию: зарубежный запасной отправляет пользовательский текст за границу.',
        )}
      >
        <Select name="fallbackProvider" defaultValue={fallbackProvider || NO_FALLBACK}>
          <SelectTrigger className="text-[0.8125rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_FALLBACK}>{say('None', 'Нет')}</SelectItem>
            {(['openrouter', 'selectel', 'yandex', 'gigachat'] as AiProviderChoice[])
              .filter((p) => p !== prov && hasKey[p])
              .map((p) => (
                <SelectItem key={p} value={p}>
                  {PROVIDER_LABEL[p]}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Field>

      {/* htmlFor: рядом с полем кнопка «показать» — оборачивание в label ловило бы её клики. */}
      <Field
        label={field.label}
        htmlFor="ai-api-key"
        hint={KEY_HINT[keySources[prov]]}
      >
        <div className="relative">
          <input
            key={prov} // смена провайдера сбрасывает поле, а не тащит чужой ключ
            id="ai-api-key"
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
            className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted hover:text-ink"
          >
            {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </Field>

      {prov === 'yandex' && (
        <div>
          <Field
            label={say('Yandex Cloud folder_id', 'Каталог (folder_id) Yandex Cloud')}
            hint={say(
              'From the console URL: aistudio.yandex.ru/platform/folders/<folder_id>.',
              'Из URL консоли: aistudio.yandex.ru/platform/folders/<folder_id>.',
            )}
          >
            <input
              name="yandexFolder"
              defaultValue={yandexFolder}
              placeholder="b1g…"
              autoComplete="off"
              spellCheck={false}
              className={inputCls}
            />
          </Field>
          {/* Веб-гора: ОТДЕЛЬНЫЙ ключ Yandex Search API (не чат-ключ). Пусто →
              веб-разведчик совета молча пропускается, а не выдумывает прецеденты. */}
          <Field
            className="mt-4"
            label={say('Yandex Search API key (web scout, optional)', 'Ключ Yandex Search API (веб-разведчик, опционально)')}
            hint={say(
              'Separate paid service — activate Search API in Yandex Cloud. Empty = council relies on our corpus only (no made-up web precedents). Leave blank to keep current.',
              'Отдельный платный сервис — активируй Search API в Yandex Cloud. Пусто = совет опирается только на наш корпус (без выдуманных веб-прецедентов). Оставь пустым, чтобы не менять.',
            )}
          >
            <input
              name="yandexSearchKey"
              defaultValue=""
              placeholder={searchKeyMasked || 'AQVN…'}
              autoComplete="off"
              spellCheck={false}
              className={inputCls}
            />
          </Field>
        </div>
      )}
    </div>
  )
}
