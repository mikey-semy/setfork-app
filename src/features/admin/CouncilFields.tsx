'use client'

import { useState } from 'react'
import { Switch } from '@/shared/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Input } from '@/shared/ui/input'
import { ModelSelect, type Option } from './ModelSelect'

// Поля «Совета гномов» внутри формы AI-настроек (submit через setAiSettings).
// Тумблеры — controlled Switch с name (submit 'on'/выкл), как в AiKeyAndSwitch.
const lbl = 'mb-1.5 block text-[12.5px] font-semibold text-ink-2'

export interface CouncilValues {
  enabled: boolean
  audience: 'admin' | 'all'
  maxGnomes: number
  models: string
  webSeek: boolean
  clarify: boolean
  maxPerMonth: number
  /** Режим самогенерации: off (дефолт) | manual (кнопкой) | auto (петля). */
  selfGenMode: 'off' | 'manual' | 'auto'
  selfGenPerDay: number
  /** Сколько черновиков за один проход петли (темп = это число × число пробуждений). */
  selfGenPerSweep: number
  /** Планка готовности: off (дефолт) | shadow (считаем, не публикуем) | on (публикуем). */
  readinessMode: 'off' | 'shadow' | 'on'
  readinessMinSteps: number
  /** Минимальный класс полноты для автопубликации. */
  readinessMinGrade: 'start' | 'solid' | 'full'
  /** Канарейка: сколько списков петля вправе опубликовать без человека за сутки. */
  readinessPerDay: number
}

export function CouncilFields({ v, ru, modelOptions }: { v: CouncilValues; ru: boolean; modelOptions: Option[] }) {
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  const [enabled, setEnabled] = useState(v.enabled)
  const [webSeek, setWebSeek] = useState(v.webSeek)
  const [clarify, setClarify] = useState(v.clarify)

  return (
    <div className="space-y-4 rounded-md border border-border bg-surface-2 p-3">
      <div>
        <div className="text-[13px] font-medium text-ink">{say('Expert council (multi-model)', 'Совет экспертов (мультимодельно)')}</div>
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
          <Select name="councilAudience" defaultValue={v.audience}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">{say('Admins only', 'Только админам')}</SelectItem>
              <SelectItem value="all">{say('Everyone', 'Всем')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className={lbl} htmlFor="councilMaxGnomes">{say('Max experts', 'Макс экспертов')}</label>
          <Input type="number" name="councilMaxGnomes" id="councilMaxGnomes" min="1" max="8" step="1" defaultValue={v.maxGnomes} />
        </div>
      </div>

      <div>
        <label className={lbl}>{say('Council models (empty = default)', 'Модели совета (пусто = дефолт)')}</label>
        {/* allowCustom — каталог провайдера может не приехать (сеть/ключ), и без ручного
            ввода совет тогда невозможно настроить вообще. */}
        <ModelSelect
          name="councilModels"
          defaultValue={v.models}
          options={modelOptions}
          multiple
          placeholder={say('Pick models', 'Выбери модели')}
          allowCustom
          customHint={say('Use', 'Использовать')}
        />
        <p className="mt-1.5 text-[12px] text-muted">
          {say(
            'Order matters: the 1st model runs the intermediate steps (planner, critic) — pick a fast one; the rest go to experts in turn. Different vendors = more diverse opinions.',
            'Порядок важен: 1-я модель ведёт промежуточные шаги (планировщик, критик) — ставь быструю; остальные раздаются экспертам по кругу. Разные вендоры = разные мнения.',
          )}
        </p>
      </div>

      <div>
        <label className={lbl} htmlFor="councilMaxPerMonth">{say('Free councils per user / month (0 = unlimited)', 'Бесплатных советов на пользователя в месяц (0 = безлимит)')}</label>
        <Input type="number" name="councilMaxPerMonth" id="councilMaxPerMonth" min="0" step="1" defaultValue={v.maxPerMonth} />
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

      {/* САМОГЕНЕРАЦИЯ: инициатива компании, а не ответ на запрос пользователя.
          off — дефолт (автономная трата не включается сама), manual — только кнопкой
          в зале совета, auto — петля раз в сутки. Результат в любом режиме — черновик. */}
      <div className="border-t border-border pt-4">
        <label className={lbl}>{say('Self-generation (specialists write their own lists)', 'Самогенерация (специалисты сами пишут списки)')}</label>
        <Select name="selfGenMode" defaultValue={v.selfGenMode}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">{say('Off', 'Выключено')}</SelectItem>
            <SelectItem value="manual">{say('Manual — by button only', 'Вручную — только по кнопке')}</SelectItem>
            <SelectItem value="auto">{say('Auto — once a day', 'Автоматически — раз в сутки')}</SelectItem>
          </SelectContent>
        </Select>
        <p className="mt-1.5 text-[12px] text-muted">
          {say(
            'The result is always a DRAFT — a machine-written list is never published without a human. Auto mode also respects the daily AI spend ceiling.',
            'Результат всегда ЧЕРНОВИК — машинный список не публикуется без человека. Авто-режим вдобавок уважает дневной потолок расхода ИИ.',
          )}
        </p>
        {/* Оба числа обязаны быть В ФОРМЕ: экшен пишет ai.selfgen_* из formData, и поле,
            которого в форме нет, при сохранении настроек уедет в минимум клампа. Так
            «за проход» молча схлопнулось бы в 1 и партия перестала бы работать. */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={lbl} htmlFor="selfGenPerDay">{say('Drafts per day (0 = no cap)', 'Черновиков в сутки (0 = без капа)')}</label>
            <Input type="number" name="selfGenPerDay" id="selfGenPerDay" min="0" max="200" step="1" defaultValue={v.selfGenPerDay} />
          </div>
          <div>
            <label className={lbl} htmlFor="selfGenPerSweep">{say('Drafts per sweep', 'Черновиков за проход')}</label>
            <Input type="number" name="selfGenPerSweep" id="selfGenPerSweep" min="1" max="20" step="1" defaultValue={v.selfGenPerSweep} />
          </div>
        </div>
      </div>

      {/* ПЛАНКА ГОТОВНОСТИ: при каких условиях черновик уходит в паблик без человека.
          Утверждается планка, а не каждый список — иначе автономности нет. Дефолт off. */}
      <div className="border-t border-border pt-4">
        <label className={lbl}>{say('Readiness bar (publish without a human)', 'Планка готовности (публикация без человека)')}</label>
        <Select name="readinessMode" defaultValue={v.readinessMode}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">{say('Off — everything waits for you', 'Выключено — всё ждёт вас')}</SelectItem>
            <SelectItem value="shadow">{say('Observe — decide and log, do not publish', 'Наблюдение — решать и писать в журнал, не публиковать')}</SelectItem>
            <SelectItem value="on">{say('On — publish what passes the bar', 'Включено — публиковать прошедшее планку')}</SelectItem>
          </SelectContent>
        </Select>
        <p className="mt-1.5 text-[12px] text-muted">
          {say(
            'Three independent checks — can it be followed, are specifics invented, is it a usable starting point. The quorum is counted in code and fails closed: a check that says “unsure” or does not answer keeps the list a draft. Costs 3 calls per list checked; “Off” spends nothing.',
            'Три независимые проверки — можно ли выполнить, не выдуманы ли детали, годится ли как основа. Кворум считает код и по умолчанию НЕ пропускает: «не уверен» или отсутствие ответа оставляют список черновиком. Стоит 3 вызова на проверенный список; «Выключено» не тратит ничего.',
          )}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={lbl} htmlFor="readinessMinSteps">{say('Minimum steps to publish', 'Минимум шагов для публикации')}</label>
            <Input type="number" name="readinessMinSteps" id="readinessMinSteps" min="1" max="50" step="1" defaultValue={v.readinessMinSteps} />
          </div>
          <div>
            {/* Класс полноты — осмысленная планка вместо одного числа: он учитывает описания,
                «зачем», источники и мёртвые ссылки разом и сам говорит, чего не хватает. */}
            <label className={lbl}>{say('Minimum completeness class', 'Минимальный класс полноты')}</label>
            <Select name="readinessMinGrade" defaultValue={v.readinessMinGrade}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="start">{say('start — 4+ steps, half described', 'start — 4+ шага, половина с описанием')}</SelectItem>
                <SelectItem value="solid">{say('solid — 6+ steps, 70% described, a source', 'solid — 6+ шагов, 70% с описанием, источник')}</SelectItem>
                <SelectItem value="full">{say('full — 8+ steps, «why», two sources', 'full — 8+ шагов, «зачем», два источника')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-3">
          {/* КАНАРЕЙКА: ошибка в планке не должна за ночь залить каталог. */}
          <label className={lbl} htmlFor="readinessPerDay">{say('Autonomous publications per day', 'Автопубликаций в сутки')}</label>
          <Input type="number" name="readinessPerDay" id="readinessPerDay" min="0" max="50" step="1" defaultValue={v.readinessPerDay} />
          <p className="mt-1.5 text-[12px] text-muted">
            {say(
              'A safety quota: beyond it lists stay drafts even if they pass the bar. 0 = never publish автоматически.',
              'Предохранитель: сверх квоты списки остаются черновиками, даже если планку прошли. 0 = не публиковать автоматически.',
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
