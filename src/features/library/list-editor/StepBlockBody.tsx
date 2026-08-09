'use client'

import { useState } from 'react'
import { Asterisk, CircleDashed, Loader2, Sparkles, ThumbsUp, X } from 'lucide-react'
import { BubbleTextEditor } from '@/shared/ui/BubbleTextEditor'
import { Button } from '@/shared/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { CodeEditor } from '@/shared/ui/CodeEditor'
import { TEXT, TOUCH_MIN_H, iconSizeFor } from '@/shared/ui/control'
import { IconButton } from '@/shared/ui/IconButton'
import { Input } from '@/shared/ui/input'
import { Switch } from '@/shared/ui/switch'
import { Tooltip } from '@/shared/ui/Tooltip'
import { t, type Lang, type TKey } from '@/shared/i18n'
import { isRiskyCommand } from '@/core/domain/destructive-command'
import { fetchLinkTitleAction } from '../actions/ai'
import type { EditorItem } from '../editor'
import { AddLink, LineField, RemoveBtn, SettingRow } from './block-fields'
import { LinkChips } from './LinkChips'
import { FileDrop } from './FileDrop'

const LEVELS: EditorItem['level'][] = ['required', 'recommended', 'optional']
/**
 * Знак уровня. Формы РАЗНЫЕ, не только цвет: иконки, отличающиеся одним цветом, не
 * различает никто — на это прямо жалуются пользователи Jira, где приоритеты рисуют
 * одинаковыми стрелками разных оттенков. Цвет здесь — второй признак, не первый.
 */
const LEVEL_ICON: Record<EditorItem['level'], typeof Asterisk> = {
  required: Asterisk,
  recommended: ThumbsUp,
  optional: CircleDashed,
}

const LEVEL_TONE: Record<EditorItem['level'], string> = {
  required: 'text-danger',
  recommended: 'text-accent',
  optional: 'text-muted',
}

const LEVEL_LABEL: Record<EditorItem['level'], TKey> = {
  required: 'editor.levelRequired',
  recommended: 'editor.levelRecommended',
  optional: 'editor.levelOptional',
}

/**
 * Step-блок — единственный исполняемый вид: заголовок, описание, команда, уровень,
 * «зачем», подпункты, ссылки и скриншот. Здесь же две пометки, которые меняют смысл
 * пункта для читателя: «нужен человек» и «разрушительная команда».
 */
export function StepBlockBody({
  item,
  index,
  onPatch,
  uploading,
  onFile,
  lang,
}: {
  item: EditorItem
  index: number
  onPatch: (p: Partial<EditorItem>) => void
  uploading: boolean
  onFile: (f: File) => void
  lang: Lang
}) {
  const nth = (key: TKey) => t(key, lang).replace('{n}', String(index + 1))
  return (
    <div className="flex flex-col gap-2">
      <LineField value={item.title} onChange={(title) => onPatch({ title })} lang={lang} className="" label={nth('editor.itemTitleN')} placeholder={t('editor.itemTitlePh', lang)} />
      {/* Описание — Markdown со всплывающей панелью форматирования (выдели текст →
          мини-тулбар). Картинки и файлы кладутся отдельными блоками, не сюда. */}
      <BubbleTextEditor value={item.desc} onChange={(desc) => onPatch({ desc })} rows={3} lang={lang} ariaLabel={nth('editor.itemDescN')} placeholder={t('editor.itemDescPh', lang)} />
      <CodeEditor value={item.command || ''} onChange={(command) => onPatch({ command })} ariaLabel={nth('editor.itemCommandN')} placeholder={t('editor.itemCommandPh', lang)} />

      {/* Уровень — ОДИН контрол с текущим значением, а не три кнопки в ряд: так это
          устроено у Linear и Jira, и так оно занимает одну цель вместо трёх. Ряд из
          трёх подписей съедал половину ширины телефона и переносился на вторую
          строку, а три одинаковых значка без подписей не различались вовсе. */}
      <SettingRow label={t('editor.level', lang)}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="xs" variant="ghost" className={`gap-1.5 bg-surface-2 ${TOUCH_MIN_H}`}>
              {(() => {
                const Icon = LEVEL_ICON[item.level]
                return <Icon size={iconSizeFor('sm')} className={LEVEL_TONE[item.level]} />
              })()}
              {t(LEVEL_LABEL[item.level], lang)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {LEVELS.map((level) => {
              const Icon = LEVEL_ICON[level]
              return (
                <DropdownMenuItem key={level} onClick={() => onPatch({ level })}>
                  <Icon size={iconSizeFor('sm')} className={LEVEL_TONE[level]} /> {t(LEVEL_LABEL[level], lang)}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </SettingRow>
      <LineField value={item.why} onChange={(why) => onPatch({ why })} lang={lang} className="" label={t('editor.why', lang)} placeholder={t('editor.whyPh', lang)} />

      {/* «ЗДЕСЬ НУЖЕН ЧЕЛОВЕК»: пункт зависит от того, чего не знает никакая модель —
          местные цены, вкус, время на вашем оборудовании. Снятая пометка = «человек
          ответил», это единственный способ её закрыть. */}
      <SettingRow label={t('needsHumanLabel', lang)}>
        <Switch
          checked={item.needsHuman}
          onCheckedChange={(on) => onPatch({ needsHuman: on, ...(on ? {} : { needsHumanAsk: '' }) })}
          aria-label={`${index + 1}: ${t('needsHumanLabel', lang)}`}
        />
      </SettingRow>
      {item.needsHuman && (
        <LineField
          value={item.needsHumanAsk}
          onChange={(needsHumanAsk) => onPatch({ needsHumanAsk })}
          lang={lang}
          className=""
          label={t('needsHumanAskLabel', lang)}
          placeholder={t('needsHumanAskPlaceholder', lang)}
        />
      )}

      {/* РАЗРУШИТЕЛЬНЫЙ ПУНКТ. Виден только у пункта с командой: пометка про неё.
          Тумблер стартует со значения детектора (`docker … prune --volumes` поднимет
          его сам), но последнее слово за автором. Снятая пометка НЕ делает скрипт
          исполняемым, если команда всё равно попадает под шаблон, — об этом говорим
          прямо, а не делаем вид, что переключатель всесилен. */}
      {item.command.trim() && (
        <>
          <SettingRow label={t('dangerLabel', lang)}>
            <Switch checked={item.danger ?? isRiskyCommand(item.command)} onCheckedChange={(danger) => onPatch({ danger })} aria-label={`${index + 1}: ${t('dangerLabel', lang)}`} />
          </SettingRow>
          {item.danger === false && isRiskyCommand(item.command) && <p className={`${TEXT.caption} text-muted`}>{t('dangerStillCommented', lang)}</p>}
        </>
      )}

      {item.subtasks.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {item.subtasks.map((s, si) => (
            <div key={si} className="flex items-center gap-2">
              <span className="text-muted">–</span>
              <LineField
                value={s}
                onChange={(v) => onPatch({ subtasks: item.subtasks.map((x, xi) => (xi === si ? v : x)) })}
                lang={lang}
                label={t('editor.subitemN', lang).replace('{n}', String(si + 1))}
                placeholder={t('editor.subitemPh', lang)}
              />
              <RemoveBtn onClick={() => onPatch({ subtasks: item.subtasks.filter((_, xi) => xi !== si) })} label={t('editor.removeSubitem', lang)} />
            </div>
          ))}
        </div>
      )}

      {/* Скриншот шага: пока его нет — область загрузки, потом сам снимок со
          снятием в правом верхнем углу картинки. */}
      {item.imagePreview ? (
        <div className="relative w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.imagePreview} alt="" className="max-h-[10rem] rounded-md border border-border" />
          <IconButton
            size="sm"
            onClick={() => onPatch({ imageKey: '', imagePreview: '' })}
            label={t('editor.remove', lang)}
            className="absolute top-1.5 right-1.5 border-0 bg-black/60 text-white hover:bg-black/80 hover:text-white"
          >
            <X size={iconSizeFor('sm')} />
          </IconButton>
        </div>
      ) : (
        <FileDrop kind="image" uploading={uploading} onFile={onFile} lang={lang} />
      )}

      {/* Ссылки — чипами, ввод и правка в отдельном окне (решение владельца
          09.08.2026, как в Telegram и текстовых редакторах): адрес нужен один раз,
          а место в карточке занимал всегда. Кнопка добавления стоит В ОДНОМ РЯДУ с
          «+ подпункт» — это соседние действия одного вида. */}
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 pt-1 ${TEXT.bodySm}`}>
        <AddLink onClick={() => onPatch({ subtasks: [...item.subtasks, ''] })}>{t('editor.addSubitem', lang)}</AddLink>
        <LinkChips refs={item.refs} onChange={(refs) => onPatch({ refs })} lang={lang} />
      </div>
    </div>
  )
}
