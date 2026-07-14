'use client'

import { useState } from 'react'
import { Switch } from '@/shared/ui/switch'

// Поля «Совета гномов» внутри формы AI-настроек (submit через setAiSettings).
// Тумблеры — controlled Switch с name (submit 'on'/выкл), как в AiKeyAndSwitch.
const field = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] text-ink outline-hidden'
const lbl = 'mb-1.5 block text-[12.5px] font-semibold text-ink-2'

export interface CouncilValues {
  enabled: boolean
  audience: 'admin' | 'all'
  maxGnomes: number
  models: string
  webSeek: boolean
  clarify: boolean
  maxPerMonth: number
}

export function CouncilFields({ v, ru }: { v: CouncilValues; ru: boolean }) {
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  const [enabled, setEnabled] = useState(v.enabled)
  const [webSeek, setWebSeek] = useState(v.webSeek)
  const [clarify, setClarify] = useState(v.clarify)

  return (
    <div className="space-y-4 rounded-md border border-border bg-surface-2 p-3">
      <div>
        <div className="text-[13px] font-medium text-ink">{say('Gnome council (multi-model)', 'Совет гномов (мультимодельно)')}</div>
        <p className="mt-0.5 text-[12px] text-muted">
          {say(
            'Steward → experts + innovator → devil’s advocate → elder. ~6-7× cost and ~50s latency — keep the audience limited.',
            'Распорядитель → эксперты + новатор → адвокат дьявола → старейшина. ~6-7× цена и ~50с — держи аудиторию узкой.',
          )}
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="text-[13.5px] text-ink">{say('Enable council', 'Включить совет')}</div>
        <Switch name="councilEnabled" checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>{say('Audience', 'Аудитория')}</label>
          <select name="councilAudience" defaultValue={v.audience} className={field}>
            <option value="admin">{say('Admins only', 'Только админам')}</option>
            <option value="all">{say('Everyone', 'Всем')}</option>
          </select>
        </div>
        <div>
          <label className={lbl}>{say('Max gnomes', 'Макс гномов')}</label>
          <input type="number" name="councilMaxGnomes" min="1" max="8" step="1" defaultValue={v.maxGnomes} className={field} />
        </div>
      </div>

      <div>
        <label className={lbl}>{say('Council models (comma-separated OpenRouter ids; empty = default)', 'Модели совета (id OpenRouter через запятую; пусто = дефолт)')}</label>
        <input name="councilModels" defaultValue={v.models} placeholder="openai/gpt-4o-mini, meta-llama/llama-3.3-70b-instruct, mistralai/mistral-nemo" className={`${field} font-mono text-[12.5px]`} />
      </div>

      <div>
        <label className={lbl}>{say('Free councils per user / month (0 = unlimited)', 'Бесплатных советов на пользователя в месяц (0 = безлимит)')}</label>
        <input type="number" name="councilMaxPerMonth" min="0" step="1" defaultValue={v.maxPerMonth} className={field} />
        <p className="mt-1.5 text-[12px] text-muted">
          {say('When audience is Everyone: after N council uses a user falls back to single generation. Admins unlimited.', 'Когда аудитория «Всем»: после N советов пользователь откатывается на одиночную генерацию. Админы — без лимита.')}
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[13.5px] text-ink">{say('Elder web search (advanced)', 'Веб-поиск старейшины (advanced)')}</div>
          <p className="text-[12px] text-muted">{say('Also search the web for precedents (:online). Pricier & slower.', 'Искать прецеденты ещё и в интернете (:online). Дороже и медленнее.')}</p>
        </div>
        <Switch name="councilWebSeek" checked={webSeek} onCheckedChange={setWebSeek} />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[13.5px] text-ink">{say('Clarifying questions', 'Уточняющие вопросы')}</div>
          <p className="text-[12px] text-muted">{say('Ask before generating when the request is too vague.', 'Спрашивать перед генерацией, если запрос слишком расплывчатый.')}</p>
        </div>
        <Switch name="councilClarify" checked={clarify} onCheckedChange={setClarify} />
      </div>
    </div>
  )
}
