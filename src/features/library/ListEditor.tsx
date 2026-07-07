'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  BarChart3,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  ChevronUp,
  Footprints,
  GripVertical,
  Heading,
  Image as ImageIcon,
  ImageUp,
  Loader2,
  Plus,
  Redo2,
  Sparkles,
  Text as TextIcon,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { emptyItem, emptyBlock, type EditorItem, type EditorPoll } from './editor'
import { BLOCK_TYPES, BLOCK_META, newOptionId, type BlockType } from './blocks'
import { refineList, uploadStepImage } from './actions'

const BLOCK_ICON: Record<BlockType, typeof Footprints> = { step: Footprints, text: TextIcon, image: ImageIcon, poll: BarChart3 }
const blockLabel = (t: BlockType, ru: boolean): string => (ru ? BLOCK_META[t].ru : BLOCK_META[t].en)

const input =
  'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13.5px] text-ink outline-none focus:border-border-strong'

export function ListEditor({
  name = 'items',
  initialItems,
  lang,
  aiRefine,
  ordered = true,
}: {
  name?: string
  initialItems: EditorItem[]
  lang: Lang
  /** Включает панель «Улучшить с ИИ»; передай title/desc/tags для контекста. */
  aiRefine?: { title: string; desc: string; tags: string[] }
  /** Упорядоченный список — нумерация; иначе набор (маркеры). */
  ordered?: boolean
}) {
  const ru = lang === 'ru'
  const first = initialItems.length ? initialItems : [emptyItem()]
  const [items, setItemsRaw] = useState<EditorItem[]>(first)
  const [uploading, setUploading] = useState<number | null>(null)
  const [dragI, setDragI] = useState<number | null>(null)
  const [overI, setOverI] = useState<number | null>(null)

  // Стабильные id пунктов (параллельно items) — нужны для ключей React и FLIP-анимации
  // перестановки. Начальные id детерминированы (без гидрационных расхождений).
  const nextUid = useRef(first.length)
  const newUid = () => 'r' + nextUid.current++
  const [uids, setUidsRaw] = useState<string[]>(() => first.map((_, i) => 'r' + i))

  // История для undo/redo. Снимок хранит и пункты, и их id (чтобы undo/redo и анимация
  // не путали, кто есть кто). Текстовые правки заменяют верхний снимок,
  // структурные (добавить/удалить/переместить/refine) — добавляют новый шаг.
  type Snap = { items: EditorItem[]; uids: string[] }
  const hist = useRef<Snap[]>([{ items: first, uids: first.map((_, i) => 'r' + i) }])
  const ptr = useRef(0)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const syncFlags = () => {
    setCanUndo(ptr.current > 0)
    setCanRedo(ptr.current < hist.current.length - 1)
  }
  const restore = (s: Snap) => {
    setItemsRaw(s.items)
    setUidsRaw(s.uids)
  }

  // Текстовая правка: порядок/состав не меняются — id те же, обновляем верхний снимок.
  const setText = (next: EditorItem[]) => {
    hist.current[ptr.current] = { items: next, uids }
    setItemsRaw(next)
  }
  // Структурная правка: новый шаг истории (пункты + их id).
  const commit = (next: EditorItem[], nextUids: string[]) => {
    hist.current = hist.current.slice(0, ptr.current + 1)
    hist.current.push({ items: next, uids: nextUids })
    ptr.current = hist.current.length - 1
    setItemsRaw(next)
    setUidsRaw(nextUids)
    syncFlags()
  }
  const undo = () => {
    if (ptr.current > 0) {
      ptr.current -= 1
      restore(hist.current[ptr.current])
      syncFlags()
    }
  }
  const redo = () => {
    if (ptr.current < hist.current.length - 1) {
      ptr.current += 1
      restore(hist.current[ptr.current])
      syncFlags()
    }
  }

  const patch = (i: number, p: Partial<EditorItem>) =>
    setText(items.map((it, idx) => (idx === i ? { ...it, ...p } : it)))

  // FLIP-анимация перестановки: карточка плавно «доезжает» до новой позиции,
  // а не перепрыгивает. Меряем позиции до/после и анимируем дельту (WAAPI).
  const listRef = useRef<HTMLDivElement>(null)
  const prevRects = useRef<Map<string, number>>(new Map())
  useLayoutEffect(() => {
    const nodes = listRef.current?.querySelectorAll<HTMLElement>('[data-uid]')
    if (!nodes) return
    const now = new Map<string, number>()
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    nodes.forEach((node) => {
      const uid = node.dataset.uid!
      const top = node.getBoundingClientRect().top
      now.set(uid, top)
      const prev = prevRects.current.get(uid)
      if (prev != null && prev !== top && !reduce) {
        node.animate(
          [{ transform: `translateY(${prev - top}px)` }, { transform: 'translateY(0)' }],
          { duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        )
      }
    })
    prevRects.current = now
  }, [uids])

  const [instruction, setInstruction] = useState('')
  const [refining, setRefining] = useState(false)
  const [refineErr, setRefineErr] = useState('')

  async function runRefine() {
    const ins = instruction.trim()
    if (!ins || refining) return
    setRefining(true)
    setRefineErr('')
    const res = await refineList({ items, title: aiRefine?.title ?? '', desc: aiRefine?.desc ?? '', tags: aiRefine?.tags ?? [], instruction: ins })
    setRefining(false)
    if ('error' in res) {
      setRefineErr(
        res.error === 'ratelimited'
          ? ru ? 'Слишком часто — подожди.' : 'Too many requests — wait a bit.'
          : res.error === 'ai_quota'
            ? ru ? 'Исчерпан месячный лимит AI.' : 'Monthly AI limit reached.'
            : ru ? 'Не удалось. Переформулируй.' : 'Failed. Try rephrasing.',
      )
      return
    }
    if (res.items.length) {
      commit(res.items, res.items.map(() => newUid()))
      setInstruction('')
    }
  }

  async function uploadFor(i: number, file: File) {
    setUploading(i)
    const fd = new FormData()
    fd.append('file', file)
    const res = await uploadStepImage(fd)
    setUploading(null)
    if ('error' in res) alert(res.error)
    else patch(i, { imageKey: res.key, imagePreview: res.url })
  }
  // Тип последнего добавленного блока — «повтор предыдущего» в инсертере.
  const [lastType, setLastType] = useState<BlockType>('step')
  // Вставка блока на позицию index (0..len). index === len → в конец.
  const insertAt = (index: number, type: BlockType) => {
    const at = Math.max(0, Math.min(index, items.length))
    const nextI = [...items.slice(0, at), emptyBlock(type), ...items.slice(at)]
    const nextU = [...uids.slice(0, at), newUid(), ...uids.slice(at)]
    setLastType(type)
    commit(nextI, nextU)
  }
  const removeItem = (i: number) => {
    if (items.length > 1) commit(items.filter((_, idx) => idx !== i), uids.filter((_, idx) => idx !== i))
  }
  // Смена типа блока на месте (для /-команды в пустом блоке).
  const setType = (i: number, type: BlockType) => {
    setLastType(type)
    commit(items.map((it, idx) => (idx === i ? { ...emptyBlock(type), section: it.section } : it)), uids)
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= items.length) return
    const nextI = [...items]
    const nextU = [...uids]
    ;[nextI[i], nextI[j]] = [nextI[j], nextI[i]]
    ;[nextU[i], nextU[j]] = [nextU[j], nextU[i]]
    commit(nextI, nextU)
  }
  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return
    const nextI = [...items]
    const nextU = [...uids]
    const [movedI] = nextI.splice(from, 1)
    const [movedU] = nextU.splice(from, 1)
    nextI.splice(to, 0, movedI)
    nextU.splice(to, 0, movedU)
    commit(nextI, nextU)
  }
  const moveToEdge = (i: number, edge: 'top' | 'bottom') => reorder(i, edge === 'top' ? 0 : items.length - 1)

  // Клавиши: Ctrl/⌘+Z / +Shift+Z / +Y — undo/redo (не в полях, там нативно);
  // Alt+↑/↓ — переместить пункт под фокусом.
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const el = e.target as HTMLElement
    const inField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z') {
      if (inField) return
      e.preventDefault()
      e.shiftKey ? redo() : undo()
    } else if (mod && e.key.toLowerCase() === 'y') {
      if (inField) return
      e.preventDefault()
      redo()
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const card = el.closest('[data-i]') as HTMLElement | null
      if (!card) return
      e.preventDefault()
      move(Number(card.dataset.i), e.key === 'ArrowUp' ? -1 : 1)
    }
  }

  return (
    <div className="flex flex-col gap-3" onKeyDown={onKeyDown}>
      <input type="hidden" name={name} value={JSON.stringify(items)} />

      {/* Тулбар: undo/redo + подсказка */}
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          title={ru ? 'Отменить (Ctrl+Z)' : 'Undo (Ctrl+Z)'}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 disabled:opacity-40 enabled:hover:border-border-strong enabled:text-ink-2"
        >
          <Undo2 size={13} /> {ru ? 'Отменить' : 'Undo'}
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!canRedo}
          title={ru ? 'Повторить (Ctrl+Shift+Z)' : 'Redo (Ctrl+Shift+Z)'}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 disabled:opacity-40 enabled:hover:border-border-strong enabled:text-ink-2"
        >
          <Redo2 size={13} /> {ru ? 'Повторить' : 'Redo'}
        </button>
        <span className="ml-1 hidden sm:inline">{ru ? 'перетаскивай ⠿, Alt+↑/↓ — двигать' : 'drag ⠿, Alt+↑/↓ to move'}</span>
      </div>

      {aiRefine && (
        <div className="rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-accent">
            <Sparkles size={14} /> {ru ? 'Улучшить с ИИ' : 'Improve with AI'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${input} min-w-[240px] flex-1`}
              placeholder={ru ? 'напр. добавь шаг про TLS и команды' : 'e.g. add a TLS step with commands'}
              value={instruction}
              disabled={refining}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void runRefine()
                }
              }}
            />
            <button
              type="button"
              onClick={() => void runRefine()}
              disabled={refining || !instruction.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-fg disabled:opacity-50"
            >
              {refining ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {refining ? (ru ? 'Правлю…' : 'Refining…') : ru ? 'Применить' : 'Apply'}
            </button>
          </div>
          <p className="mt-1.5 text-[11.5px] text-ink-2">
            {ru
              ? 'ИИ перепишет пункты. Скриншоты и ссылки при этом сбрасываются.'
              : 'AI rewrites the items. Screenshots and links are reset.'}
          </p>
          {refineErr && <p className="mt-1 text-[12px] text-danger">{refineErr}</p>}
        </div>
      )}

      <div ref={listRef} className="flex flex-col gap-3">
      {items.map((it, i) => (
        <div
          key={uids[i]}
          data-i={i}
          data-uid={uids[i]}
          onDragOver={(e) => {
            if (dragI !== null) {
              e.preventDefault()
              if (overI !== i) setOverI(i)
            }
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (dragI !== null) reorder(dragI, i)
            setDragI(null)
            setOverI(null)
          }}
          className={`rounded-lg border bg-surface p-4 transition-colors ${
            overI === i && dragI !== null ? 'border-accent' : 'border-border'
          } ${dragI === i ? 'opacity-50' : ''}`}
        >
          <div className="mb-2.5 flex items-center gap-2">
            <span
              draggable
              onDragStart={() => setDragI(i)}
              onDragEnd={() => {
                setDragI(null)
                setOverI(null)
              }}
              title={ru ? 'Перетащить' : 'Drag to reorder'}
              className="cursor-grab rounded p-0.5 text-muted hover:text-ink active:cursor-grabbing"
            >
              <GripVertical size={15} />
            </span>
            {it.type === 'step' ? (
              <span className="font-mono text-[12px] text-muted">
                {ordered ? `${ru ? 'Пункт' : 'Item'} ${items.slice(0, i).filter((x) => x.type === 'step').length + 1}` : '•'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-mono text-[12px] text-muted">
                {(() => {
                  const Icon = BLOCK_ICON[it.type]
                  return <Icon size={13} />
                })()}
                {blockLabel(it.type, ru)}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => moveToEdge(i, 'top')}
                disabled={i === 0}
                className="rounded p-1 text-muted hover:text-ink disabled:opacity-30 disabled:hover:text-muted"
                title={ru ? 'В начало' : 'Move to top'}
              >
                <ChevronsUp size={15} />
              </button>
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="rounded p-1 text-muted hover:text-ink disabled:opacity-30 disabled:hover:text-muted"
                title={ru ? 'Выше' : 'Move up'}
              >
                <ChevronUp size={15} />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === items.length - 1}
                className="rounded p-1 text-muted hover:text-ink disabled:opacity-30 disabled:hover:text-muted"
                title={ru ? 'Ниже' : 'Move down'}
              >
                <ChevronDown size={15} />
              </button>
              <button
                type="button"
                onClick={() => moveToEdge(i, 'bottom')}
                disabled={i === items.length - 1}
                className="rounded p-1 text-muted hover:text-ink disabled:opacity-30 disabled:hover:text-muted"
                title={ru ? 'В конец' : 'Move to bottom'}
              >
                <ChevronsDown size={15} />
              </button>
              <button
                type="button"
                onClick={() => removeItem(i)}
                className="rounded p-1 text-muted hover:text-danger"
                title={ru ? 'Удалить' : 'Remove'}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>

          {it.type === 'step' && (
          <div className="flex flex-col gap-2">
            {/* Заголовок секции-группы: если задан — начинает новую группу пунктов */}
            <div className={`flex items-center gap-1.5 ${it.section.trim() ? 'text-accent' : 'text-muted'}`}>
              <Heading size={13} className="shrink-0" />
              <input
                className="w-full bg-transparent text-[12.5px] font-semibold outline-none placeholder:font-normal placeholder:text-muted"
                aria-label={ru ? `Секция пункта ${i + 1}` : `Item ${i + 1} section`}
                placeholder={ru ? 'Секция (необязательно) — группирует пункты ниже' : 'Section (optional) — groups the items below'}
                value={it.section}
                onChange={(e) => patch(i, { section: e.target.value })}
              />
            </div>
            <input
              className={input}
              aria-label={ru ? `Заголовок пункта ${i + 1}` : `Item ${i + 1} title`}
              placeholder={ru ? 'Заголовок пункта' : 'Item title'}
              value={it.title}
              onChange={(e) => patch(i, { title: e.target.value })}
            />
            <input
              className={input}
              aria-label={ru ? `Описание пункта ${i + 1}` : `Item ${i + 1} description`}
              placeholder={ru ? 'Описание (необязательно)' : 'Description (optional)'}
              value={it.desc}
              onChange={(e) => patch(i, { desc: e.target.value })}
            />
            <input
              className={`${input} font-mono`}
              aria-label={ru ? `Команда пункта ${i + 1}` : `Item ${i + 1} command`}
              placeholder={ru ? 'Команда (необязательно)' : 'Command (optional)'}
              value={it.command}
              onChange={(e) => patch(i, { command: e.target.value })}
            />

            {/* Уровень + «зачем» */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11.5px] text-muted">{ru ? 'Уровень' : 'Level'}:</span>
              {(['required', 'recommended', 'optional'] as const).map((lv) => (
                <button
                  key={lv}
                  type="button"
                  onClick={() => patch(i, { level: lv })}
                  className={`rounded px-2 py-0.5 text-[11.5px] ${
                    it.level === lv ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-ink-2 hover:text-ink'
                  }`}
                >
                  {lv === 'required'
                    ? ru ? 'Обязательно' : 'Required'
                    : lv === 'recommended'
                      ? ru ? 'Рекомендуется' : 'Recommended'
                      : ru ? 'Опционально' : 'Optional'}
                </button>
              ))}
            </div>
            <input
              className={input}
              placeholder={ru ? 'Зачем этот шаг (необязательно)' : 'Why this step matters (optional)'}
              value={it.why}
              onChange={(e) => patch(i, { why: e.target.value })}
            />

            {/* Подпункты */}
            {it.subtasks.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {it.subtasks.map((s, si) => (
                  <div key={si} className="flex items-center gap-2">
                    <span className="text-muted">–</span>
                    <input
                      className={input}
                      aria-label={ru ? `Подпункт ${si + 1}` : `Sub-item ${si + 1}`}
                      placeholder={ru ? 'Подпункт' : 'Sub-item'}
                      value={s}
                      onChange={(e) =>
                        patch(i, { subtasks: it.subtasks.map((x, xi) => (xi === si ? e.target.value : x)) })
                      }
                    />
                    <button
                      type="button"
                      onClick={() => patch(i, { subtasks: it.subtasks.filter((_, xi) => xi !== si) })}
                      className="text-muted hover:text-danger"
                      aria-label={ru ? 'Удалить подпункт' : 'Remove sub-item'}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Ссылки */}
            {it.refs.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {it.refs.map((r, ri) => (
                  <div key={ri} className="flex items-center gap-2">
                    <input
                      className={`${input} max-w-[200px]`}
                      aria-label={ru ? 'Название ссылки' : 'Link label'}
                      placeholder={ru ? 'Название ссылки' : 'Link label'}
                      value={r.label}
                      onChange={(e) =>
                        patch(i, {
                          refs: it.refs.map((x, xi) => (xi === ri ? { ...x, label: e.target.value } : x)),
                        })
                      }
                    />
                    <input
                      className={`${input} font-mono`}
                      aria-label={ru ? 'URL ссылки' : 'Link URL'}
                      placeholder="https://…"
                      value={r.url}
                      onChange={(e) =>
                        patch(i, { refs: it.refs.map((x, xi) => (xi === ri ? { ...x, url: e.target.value } : x)) })
                      }
                    />
                    <button
                      type="button"
                      onClick={() => patch(i, { refs: it.refs.filter((_, xi) => xi !== ri) })}
                      className="text-muted hover:text-danger"
                      aria-label={ru ? 'Удалить ссылку' : 'Remove link'}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Скриншот */}
            {it.imagePreview ? (
              <div className="relative w-fit">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.imagePreview} alt="" className="max-h-[160px] rounded-md border border-border" />
                <button
                  type="button"
                  onClick={() => patch(i, { imageKey: '', imagePreview: '' })}
                  aria-label="remove image"
                  className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md bg-black/60 text-white hover:bg-black/80"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <StepImageInput uploading={uploading === i} onFile={(f) => uploadFor(i, f)} ru={ru} />
            )}

            <div className="flex flex-wrap gap-3 pt-1 text-[12px]">
              <button
                type="button"
                onClick={() => patch(i, { subtasks: [...it.subtasks, ''] })}
                className="text-accent hover:underline"
              >
                + {ru ? 'подпункт' : 'sub-item'}
              </button>
              <button
                type="button"
                onClick={() => patch(i, { refs: [...it.refs, { label: '', url: '' }] })}
                className="text-accent hover:underline"
              >
                + {ru ? 'ссылку' : 'link'}
              </button>
            </div>
          </div>
          )}

          {/* Text-блок: markdown-врезка. Пустой + '/' → меню смены типа. */}
          {it.type === 'text' && (
            <TextBlockBody
              value={it.text}
              onChange={(v) => patch(i, { text: v })}
              onSlash={(type) => setType(i, type)}
              ru={ru}
            />
          )}

          {/* Image-блок: картинка + подпись. */}
          {it.type === 'image' && (
            <div className="flex flex-col gap-2">
              {it.imagePreview ? (
                <div className="relative w-fit">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.imagePreview} alt="" className="max-h-[320px] rounded-md border border-border" />
                  <button
                    type="button"
                    onClick={() => patch(i, { imageKey: '', imagePreview: '' })}
                    aria-label="remove image"
                    className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md bg-black/60 text-white hover:bg-black/80"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <StepImageInput uploading={uploading === i} onFile={(f) => uploadFor(i, f)} ru={ru} />
              )}
              <input
                className={input}
                aria-label={ru ? 'Подпись картинки' : 'Image caption'}
                placeholder={ru ? 'Подпись (необязательно)' : 'Caption (optional)'}
                value={it.caption}
                onChange={(e) => patch(i, { caption: e.target.value })}
              />
            </div>
          )}

          {/* Poll-блок: вопрос + варианты + мульти + дедлайн. */}
          {it.type === 'poll' && <PollBlockBody poll={it.poll} onChange={(poll) => patch(i, { poll })} ru={ru} />}

          {/* Инсертер между блоками: вставить после текущего блока. */}
          <BlockInserter onInsert={(type) => insertAt(i + 1, type)} repeatType={lastType} ru={ru} between />
        </div>
      ))}
      </div>

      {/* Главный инсертер — добавить блок в конец списка. */}
      <div className="flex justify-center pt-1">
        <BlockInserter onInsert={(type) => insertAt(items.length, type)} repeatType={lastType} ru={ru} />
      </div>
    </div>
  )
}

/** Text-блок: авто-растущая textarea. Пустое поле + ввод «/» открывает меню
 *  смены типа блока (быстрый /-командой заменить пустой text на step/image). */
function PollBlockBody({ poll, onChange, ru }: { poll: EditorPoll; onChange: (p: EditorPoll) => void; ru: boolean }) {
  const set = (p: Partial<EditorPoll>) => onChange({ ...poll, ...p })
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
      <input
        className={input}
        aria-label={ru ? 'Вопрос опроса' : 'Poll question'}
        placeholder={ru ? 'Вопрос опроса' : 'Poll question'}
        value={poll.question}
        onChange={(e) => set({ question: e.target.value })}
      />
      <div className="flex flex-col gap-1.5">
        {poll.options.map((o, oi) => (
          <div key={o.id} className="flex items-center gap-2">
            <span className="w-4 text-right text-[11px] text-muted">{oi + 1}</span>
            <input
              className={input}
              aria-label={ru ? `Вариант ${oi + 1}` : `Option ${oi + 1}`}
              placeholder={ru ? `Вариант ${oi + 1}` : `Option ${oi + 1}`}
              value={o.text}
              onChange={(e) => set({ options: poll.options.map((x, xi) => (xi === oi ? { ...x, text: e.target.value } : x)) })}
            />
            <button
              type="button"
              onClick={() => set({ options: poll.options.filter((_, xi) => xi !== oi) })}
              disabled={poll.options.length <= 2}
              className="text-muted hover:text-danger disabled:opacity-30"
              aria-label={ru ? 'Удалить вариант' : 'Remove option'}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-0.5 text-[12px]">
        <button type="button" onClick={() => set({ options: [...poll.options, { id: newOptionId(), text: '' }] })} className="text-accent hover:underline">
          + {ru ? 'вариант' : 'option'}
        </button>
        <label className="inline-flex items-center gap-1.5 text-ink-2">
          <input type="checkbox" checked={poll.multi} onChange={(e) => set({ multi: e.target.checked })} />
          {ru ? 'Мультивыбор' : 'Multi-select'}
        </label>
        <label className="inline-flex items-center gap-1.5 text-ink-2">
          {ru ? 'Дедлайн' : 'Deadline'}:
          <input
            type="datetime-local"
            value={poll.deadline}
            onChange={(e) => set({ deadline: e.target.value })}
            className="rounded border border-border bg-surface px-2 py-1 text-[12px] text-ink"
          />
        </label>
      </div>
    </div>
  )
}

function TextBlockBody({ value, onChange, onSlash, ru }: { value: string; onChange: (v: string) => void; onSlash: (t: BlockType) => void; ru: boolean }) {
  const [menu, setMenu] = useState(false)
  return (
    <div className="relative flex flex-col gap-1">
      <textarea
        className="min-h-[72px] w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2 text-[13.5px] leading-relaxed text-ink outline-none focus:border-border-strong"
        aria-label={ru ? 'Текстовый блок (Markdown)' : 'Text block (Markdown)'}
        placeholder={ru ? 'Текст (Markdown). Введите «/» в пустом блоке для выбора типа…' : 'Text (Markdown). Type “/” in an empty block to pick a type…'}
        value={value}
        onChange={(e) => {
          const v = e.target.value
          if (v === '/' && value === '') { setMenu(true); return }
          setMenu(false)
          onChange(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && menu) { e.preventDefault(); setMenu(false) }
        }}
      />
      {menu && (
        <div className="absolute left-3 top-9 z-10 flex flex-col overflow-hidden rounded-md border border-border bg-surface shadow-lg">
          {BLOCK_TYPES.map((t) => {
            const Icon = BLOCK_ICON[t]
            return (
              <button
                key={t}
                type="button"
                onClick={() => { setMenu(false); onSlash(t) }}
                className="flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink hover:bg-surface-2"
              >
                <Icon size={14} className="text-muted" /> {blockLabel(t, ru)}
              </button>
            )
          })}
        </div>
      )}
      <span className="pl-1 text-[11px] text-muted">{ru ? 'Markdown: **жирный**, [ссылка](url), списки' : 'Markdown: **bold**, [link](url), lists'}</span>
    </div>
  )
}

/** Радиальный «+»-инсертер: по клику из кнопки веером («улыбкой») вылетают
 *  кружки типов блоков; нижний-центральный (primary) = повтор предыдущего типа.
 *  between=true — тонкая линия-разделитель, появляется при наведении. */
function BlockInserter({ onInsert, repeatType, ru, between = false }: { onInsert: (t: BlockType) => void; repeatType: BlockType; ru: boolean; between?: boolean }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  // Клик вне — закрыть.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  // Веер: типы блоков распределяем по дуге ~150° над кнопкой.
  const arc = BLOCK_TYPES
  const R = 62
  const spread = 150 // градусов
  const start = 90 + spread / 2 // слева
  const pick = (t: BlockType) => { onInsert(t); setOpen(false) }

  return (
    <div ref={rootRef} className={`relative flex items-center justify-center ${between ? 'group h-4 w-full' : ''}`}>
      {between && !open && (
        <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border opacity-0 transition-opacity group-hover:opacity-100" />
      )}
      {/* Кружки-типы (веером). Появляются при open. */}
      {arc.map((t, k) => {
        const ang = arc.length > 1 ? start - (spread / (arc.length - 1)) * k : 90
        const rad = (ang * Math.PI) / 180
        const x = Math.cos(rad) * R
        const y = -Math.sin(rad) * R
        const Icon = BLOCK_ICON[t]
        return (
          <button
            key={t}
            type="button"
            aria-label={blockLabel(t, ru)}
            title={blockLabel(t, ru)}
            onClick={() => pick(t)}
            tabIndex={open ? 0 : -1}
            className="absolute grid h-10 w-10 place-items-center rounded-full border border-border bg-surface text-ink shadow-md transition-all duration-200 hover:border-accent hover:text-accent motion-reduce:transition-none"
            style={{
              transform: open ? `translate(${x}px, ${y}px) scale(1)` : 'translate(0,0) scale(0.3)',
              opacity: open ? 1 : 0,
              pointerEvents: open ? 'auto' : 'none',
              zIndex: open ? 20 : undefined,
            }}
          >
            <Icon size={16} />
          </button>
        )
      })}
      {/* Повтор предыдущего типа — нижний-центральный, чуть под кнопкой. */}
      {(() => {
        const Icon = BLOCK_ICON[repeatType]
        return (
          <button
            type="button"
            aria-label={`${ru ? 'Повторить' : 'Repeat'}: ${blockLabel(repeatType, ru)}`}
            title={`${ru ? 'Как предыдущий' : 'Same as previous'}: ${blockLabel(repeatType, ru)}`}
            onClick={() => pick(repeatType)}
            tabIndex={open ? 0 : -1}
            className="absolute grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-fg shadow-md transition-all duration-200 hover:opacity-90 motion-reduce:transition-none"
            style={{
              transform: open ? `translate(0, ${R + 6}px) scale(1)` : 'translate(0,0) scale(0.3)',
              opacity: open ? 1 : 0,
              pointerEvents: open ? 'auto' : 'none',
              zIndex: open ? 20 : undefined,
            }}
          >
            <Icon size={15} />
          </button>
        )
      })()}
      {/* Центральная «+» кнопка. */}
      <button
        type="button"
        aria-label={ru ? 'Добавить блок' : 'Add block'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`z-[1] grid place-items-center rounded-full border transition-all ${
          between ? 'h-7 w-7 opacity-0 group-hover:opacity-100' : 'h-11 w-11'
        } ${open ? 'rotate-45 border-accent bg-accent text-white' : 'border-border bg-surface text-ink-2 hover:border-border-strong hover:text-ink'} ${open ? 'opacity-100' : ''}`}
      >
        <Plus size={between ? 15 : 20} />
      </button>
    </div>
  )
}

function StepImageInput({ uploading, onFile, ru }: { uploading: boolean; onFile: (f: File) => void; ru: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files?.[0]
        if (f) onFile(f)
      }}
      className={`flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-[12.5px] transition-colors ${
        over ? 'border-accent bg-[var(--accent-soft)] text-accent' : 'border-border text-ink-2 hover:border-border-strong'
      }`}
    >
      {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImageUp size={14} />}
      {uploading ? (ru ? 'Загрузка…' : 'Uploading…') : ru ? 'Скриншот: перетащите или нажмите' : 'Screenshot: drag or click'}
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
