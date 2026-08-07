'use client'

import { useState } from 'react'
import { Loader2, Sparkles, X } from 'lucide-react'
import { BubbleTextEditor } from '@/shared/ui/BubbleTextEditor'
import { Button } from '@/shared/ui/button'
import { CodeEditor } from '@/shared/ui/CodeEditor'
import { iconSizeFor, TOUCH_MIN_H } from '@/shared/ui/control'
import { IconButton } from '@/shared/ui/IconButton'
import { Input } from '@/shared/ui/input'
import { Switch } from '@/shared/ui/switch'
import { Tooltip } from '@/shared/ui/Tooltip'
import { t, type Lang, type TKey } from '@/shared/i18n'
import { isRiskyCommand } from '@/core/domain/destructive-command'
import { fetchLinkTitleAction } from '../actions'
import type { EditorItem } from '../editor'
import { AddLink, LineField, RemoveBtn } from './block-fields'
import { FileDrop } from './FileDrop'

const LEVELS: EditorItem['level'][] = ['required', 'recommended', 'optional']
const LEVEL_LABEL: Record<EditorItem['level'], TKey> = {
  required: 'editor.levelRequired',
  recommended: 'editor.levelRecommended',
  optional: 'editor.levelOptional',
}

/** Кнопка в поле подписи ссылки: тянет <title> страницы по URL. Своё состояние
 *  занятости на строку; неактивна, пока в соседнем поле не валидный адрес. */
function LinkTitleButton({ url, onLabel, lang }: { url: string; onLabel: (v: string) => void; lang: Lang }) {
  const [busy, setBusy] = useState(false)
  const ok = /^https?:\/\/\S+/i.test(url.trim())
  async function gen() {
    if (busy || !ok) return
    setBusy(true)
    const res = await fetchLinkTitleAction(url.trim())
    setBusy(false)
    if ('label' in res) onLabel(res.label)
  }
  return (
    <Tooltip label={t('editor.linkTitleFromUrl', lang)}>
      <IconButton size="xs" variant="ghost" onClick={gen} disabled={busy || !ok} label={t('editor.linkTitleFromUrl', lang)} className="hover:text-accent">
        {busy ? <Loader2 size={iconSizeFor('sm')} className="animate-spin" /> : <Sparkles size={iconSizeFor('sm')} />}
      </IconButton>
    </Tooltip>
  )
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

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[0.6875rem] text-muted">{t('editor.level', lang)}:</span>
        {LEVELS.map((level) => (
          <Button
            key={level}
            size="xs"
            variant={item.level === level ? 'primary' : 'ghost'}
            onClick={() => onPatch({ level })}
            className={`${TOUCH_MIN_H} ${item.level === level ? '' : 'bg-surface-2'}`}
          >
            {t(LEVEL_LABEL[level], lang)}
          </Button>
        ))}
      </div>
      <LineField value={item.why} onChange={(why) => onPatch({ why })} lang={lang} className="" label={t('editor.why', lang)} placeholder={t('editor.whyPh', lang)} />

      {/* «ЗДЕСЬ НУЖЕН ЧЕЛОВЕК»: пункт зависит от того, чего не знает никакая модель —
          местные цены, вкус, время на вашем оборудовании. Снятая пометка = «человек
          ответил», это единственный способ её закрыть. */}
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-[0.6875rem] text-muted">{t('needsHumanLabel', lang)}</span>
        <Switch
          checked={item.needsHuman}
          onCheckedChange={(on) => onPatch({ needsHuman: on, ...(on ? {} : { needsHumanAsk: '' }) })}
          aria-label={`${index + 1}: ${t('needsHumanLabel', lang)}`}
        />
      </div>
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
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 text-[0.6875rem] text-muted">{t('dangerLabel', lang)}</span>
            <Switch checked={item.danger ?? isRiskyCommand(item.command)} onCheckedChange={(danger) => onPatch({ danger })} aria-label={`${index + 1}: ${t('dangerLabel', lang)}`} />
          </div>
          {item.danger === false && isRiskyCommand(item.command) && <p className="text-[0.6875rem] text-muted">{t('dangerStillCommented', lang)}</p>}
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

      {item.refs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {item.refs.map((r, ri) => {
            const patchRef = (p: Partial<EditorItem['refs'][number]>) => onPatch({ refs: item.refs.map((x, xi) => (xi === ri ? { ...x, ...p } : x)) })
            return (
              <div key={ri} className="flex items-center gap-2">
                <BubbleTextEditor
                  value={r.label}
                  onChange={(label) => patchRef({ label })}
                  singleLine
                  className="w-[12.5rem] shrink-0"
                  textareaClassName="leading-normal"
                  lang={lang}
                  ariaLabel={t('editor.linkLabel', lang)}
                  placeholder={t('editor.linkLabel', lang)}
                  trailing={<LinkTitleButton url={r.url} lang={lang} onLabel={(label) => patchRef({ label })} />}
                />
                <Input className="font-mono leading-normal" aria-label={t('editor.linkUrl', lang)} placeholder="https://…" value={r.url} onChange={(e) => patchRef({ url: e.target.value })} />
                <RemoveBtn onClick={() => onPatch({ refs: item.refs.filter((_, xi) => xi !== ri) })} label={t('editor.removeLink', lang)} />
              </div>
            )
          })}
        </div>
      )}

      {item.imagePreview ? (
        <div className="relative w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.imagePreview} alt="" className="max-h-[10rem] rounded-md border border-border" />
          {/* Снять скриншот — служебное действие в правом верхнем углу картинки. */}
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

      <div className="flex flex-wrap gap-3 pt-1 text-[0.78125rem]">
        <AddLink onClick={() => onPatch({ subtasks: [...item.subtasks, ''] })}>{t('editor.addSubitem', lang)}</AddLink>
        <AddLink onClick={() => onPatch({ refs: [...item.refs, { label: '', url: '' }] })}>{t('editor.addLinkWord', lang)}</AddLink>
      </div>
    </div>
  )
}
