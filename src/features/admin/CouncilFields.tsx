'use client'

import { useState } from 'react'
import { Switch } from '@/shared/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Input } from '@/shared/ui/input'
import { Field } from '@/shared/ui/Field'
import { ModelSelect, type Option } from './ModelSelect'
import { t, type Lang } from '@/shared/i18n'

// Поля «Совета гномов» внутри формы AI-настроек (submit через setAiSettings).
// Тумблеры — controlled Switch с name (submit 'on'/выкл), как в AiKeyAndSwitch.

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

export function CouncilFields({ v, lang, modelOptions }: { v: CouncilValues; lang: Lang; modelOptions: Option[] }) {
  const say = (en: string, rus: string) => (lang === 'ru' ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  const [enabled, setEnabled] = useState(v.enabled)
  const [webSeek, setWebSeek] = useState(v.webSeek)
  const [clarify, setClarify] = useState(v.clarify)

  return (
    <div className="space-y-4 rounded-md border border-border bg-surface-2 p-3">
      <div>
        <div className="text-[0.8125rem] font-medium text-ink">{t('admin.expertCouncilMultiModel', lang)}</div>
        <p className="mt-0.5 text-[0.78125rem] text-muted">
          {say(
            'Steward → experts + innovator → devil’s advocate → elder. ~6-7× cost and ~50s latency — keep the audience limited.',
            'Распорядитель → эксперты + новатор → адвокат дьявола → старейшина. ~6-7× цена и ~50с — держи аудиторию узкой.',
          )}
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="text-[0.8125rem] text-ink">{t('admin.enableCouncil', lang)}</div>
        <Switch name="councilEnabled" checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('admin.audience', lang)}>
          <Select name="councilAudience" defaultValue={v.audience}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">{t('admin.adminsOnly', lang)}</SelectItem>
              <SelectItem value="all">{t('admin.everyone', lang)}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('admin.maxExperts', lang)}>
          <Input type="number" name="councilMaxGnomes" min="1" max="8" step="1" defaultValue={v.maxGnomes} />
        </Field>
      </div>

      <Field
        label={t('admin.councilModelsEmptyDefault', lang)}
        htmlFor="councilModels"
        hint={say(
          'Order matters: the 1st model runs the intermediate steps (planner, critic) — pick a fast one; the rest go to experts in turn. Different vendors = more diverse opinions.',
          'Порядок важен: 1-я модель ведёт промежуточные шаги (планировщик, критик) — ставь быструю; остальные раздаются экспертам по кругу. Разные вендоры = разные мнения.',
        )}
      >
        {/* allowCustom — каталог провайдера может не приехать (сеть/ключ), и без ручного
            ввода совет тогда невозможно настроить вообще. */}
        <ModelSelect
          id="councilModels"
          name="councilModels"
          defaultValue={v.models}
          options={modelOptions}
          multiple
          placeholder={t('admin.pickModels', lang)}
          allowCustom
          customHint={t('admin.use2', lang)}
        />
      </Field>

      <Field
        label={t('admin.freeCouncilsPerUser', lang)}
        hint={t('admin.whenAudienceEveryoneAfter', lang)}
      >
        <Input type="number" name="councilMaxPerMonth" min="0" step="1" defaultValue={v.maxPerMonth} />
      </Field>

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[0.8125rem] text-ink">{t('admin.elderWebSearchAdvanced', lang)}</div>
          <p className="text-[0.78125rem] text-muted">{t('admin.alsoSearchWebPrecedents', lang)}</p>
        </div>
        <Switch name="councilWebSeek" checked={webSeek} onCheckedChange={setWebSeek} />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[0.8125rem] text-ink">{t('admin.clarifyingQuestions', lang)}</div>
          <p className="text-[0.78125rem] text-muted">{t('admin.askBeforeGeneratingWhen', lang)}</p>
        </div>
        <Switch name="councilClarify" checked={clarify} onCheckedChange={setClarify} />
      </div>

      {/* САМОГЕНЕРАЦИЯ: инициатива компании, а не ответ на запрос пользователя.
          off — дефолт (автономная трата не включается сама), manual — только кнопкой
          в зале совета, auto — петля раз в сутки. Результат в любом режиме — черновик. */}
      <div className="border-t border-border pt-4">
        <Field
          label={t('admin.selfGenerationSpecialistsWrite', lang)}
          hint={say(
            'The result is always a DRAFT — a machine-written list is never published without a human. Auto mode also respects the daily AI spend ceiling.',
            'Результат всегда ЧЕРНОВИК — машинный список не публикуется без человека. Авто-режим вдобавок уважает дневной потолок расхода ИИ.',
          )}
        >
          <Select name="selfGenMode" defaultValue={v.selfGenMode}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">{t('admin.off3', lang)}</SelectItem>
              <SelectItem value="manual">{t('admin.manualByButtonOnly', lang)}</SelectItem>
              <SelectItem value="auto">{t('admin.autoOnceDay', lang)}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {/* Оба числа обязаны быть В ФОРМЕ: экшен пишет ai.selfgen_* из formData, и поле,
            которого в форме нет, при сохранении настроек уедет в минимум клампа. Так
            «за проход» молча схлопнулось бы в 1 и партия перестала бы работать. */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t('admin.draftsPerDay0', lang)}>
            <Input type="number" name="selfGenPerDay" min="0" max="200" step="1" defaultValue={v.selfGenPerDay} />
          </Field>
          <Field label={t('admin.draftsPerSweep', lang)}>
            <Input type="number" name="selfGenPerSweep" min="1" max="20" step="1" defaultValue={v.selfGenPerSweep} />
          </Field>
        </div>
      </div>

      {/* ПЛАНКА ГОТОВНОСТИ: при каких условиях черновик уходит в паблик без человека.
          Утверждается планка, а не каждый список — иначе автономности нет. Дефолт off. */}
      <div className="border-t border-border pt-4">
        <Field
          label={t('admin.readinessBarPublishWithout', lang)}
          hint={say(
            'Three independent checks — can it be followed, are specifics invented, is it a usable starting point. The quorum is counted in code and fails closed: a check that says “unsure” or does not answer keeps the list a draft. Costs 3 calls per list checked; “Off” spends nothing.',
            'Три независимые проверки — можно ли выполнить, не выдуманы ли детали, годится ли как основа. Кворум считает код и по умолчанию НЕ пропускает: «не уверен» или отсутствие ответа оставляют список черновиком. Стоит 3 вызова на проверенный список; «Выключено» не тратит ничего.',
          )}
        >
          <Select name="readinessMode" defaultValue={v.readinessMode}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">{t('admin.offEverythingWaitsYou', lang)}</SelectItem>
              <SelectItem value="shadow">{t('admin.observeDecideLogDo', lang)}</SelectItem>
              <SelectItem value="on">{t('admin.onPublishWhatPasses', lang)}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t('admin.minimumStepsPublish', lang)}>
            <Input type="number" name="readinessMinSteps" min="1" max="50" step="1" defaultValue={v.readinessMinSteps} />
          </Field>
          {/* Класс полноты — осмысленная планка вместо одного числа: он учитывает описания,
              «зачем», источники и мёртвые ссылки разом и сам говорит, чего не хватает. */}
          <Field label={t('admin.minimumCompletenessClass', lang)}>
            <Select name="readinessMinGrade" defaultValue={v.readinessMinGrade}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="start">{t('admin.start4StepsHalf', lang)}</SelectItem>
                <SelectItem value="solid">{t('admin.solid6Steps70', lang)}</SelectItem>
                <SelectItem value="full">{t('admin.full8StepsWhy', lang)}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        {/* КАНАРЕЙКА: ошибка в планке не должна за ночь залить каталог. */}
        <Field
          className="mt-3"
          label={t('admin.autonomousPublicationsPerDay', lang)}
          hint={say(
            'A safety quota: beyond it lists stay drafts even if they pass the bar. 0 = never publish автоматически.',
            'Предохранитель: сверх квоты списки остаются черновиками, даже если планку прошли. 0 = не публиковать автоматически.',
          )}
        >
          <Input type="number" name="readinessPerDay" min="0" max="50" step="1" defaultValue={v.readinessPerDay} />
        </Field>
      </div>
    </div>
  )
}
