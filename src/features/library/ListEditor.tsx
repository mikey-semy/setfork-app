'use client'

import { useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  ImageUp,
  Loader2,
  Plus,
  Redo2,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { emptyItem, type EditorItem } from './editor'
import { refineList, uploadStepImage } from './actions'

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

  // История для undo/redo. Текстовые правки заменяют верхний снимок,
  // структурные (добавить/удалить/переместить/refine) — добавляют новый шаг.
  const hist = useRef<EditorItem[][]>([first])
  const ptr = useRef(0)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const syncFlags = () => {
    setCanUndo(ptr.current > 0)
    setCanRedo(ptr.current < hist.current.length - 1)
  }

  // Текстовая правка: обновляем состояние и синхронизируем верхний снимок.
  const setText = (next: EditorItem[]) => {
    hist.current[ptr.current] = next
    setItemsRaw(next)
  }
  // Структурная правка: новый шаг истории.
  const commit = (next: EditorItem[]) => {
    hist.current = hist.current.slice(0, ptr.current + 1)
    hist.current.push(next)
    ptr.current = hist.current.length - 1
    setItemsRaw(next)
    syncFlags()
  }
  const undo = () => {
    if (ptr.current > 0) {
      ptr.current -= 1
      setItemsRaw(hist.current[ptr.current])
      syncFlags()
    }
  }
  const redo = () => {
    if (ptr.current < hist.current.length - 1) {
      ptr.current += 1
      setItemsRaw(hist.current[ptr.current])
      syncFlags()
    }
  }

  const patch = (i: number, p: Partial<EditorItem>) =>
    setText(items.map((it, idx) => (idx === i ? { ...it, ...p } : it)))

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
          : ru ? 'Не удалось. Переформулируй.' : 'Failed. Try rephrasing.',
      )
      return
    }
    if (res.items.length) {
      commit(res.items)
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
  const addItem = () => commit([...items, emptyItem()])
  const removeItem = (i: number) => {
    if (items.length > 1) commit(items.filter((_, idx) => idx !== i))
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }
  const reorder = (from: number, to: number) => {
    if (from === to) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    commit(next)
  }

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

      {items.map((it, i) => (
        <div
          key={i}
          data-i={i}
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
            <span className="font-mono text-[12px] text-muted">{ordered ? `${ru ? 'Пункт' : 'Item'} ${i + 1}` : '•'}</span>
            <div className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => move(i, -1)} className="rounded p-1 text-muted hover:text-ink" title="up">
                <ChevronUp size={15} />
              </button>
              <button type="button" onClick={() => move(i, 1)} className="rounded p-1 text-muted hover:text-ink" title="down">
                <ChevronDown size={15} />
              </button>
              <button
                type="button"
                onClick={() => removeItem(i)}
                className="rounded p-1 text-muted hover:text-danger"
                title="remove"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <input
              className={input}
              placeholder={ru ? 'Заголовок пункта' : 'Item title'}
              value={it.title}
              onChange={(e) => patch(i, { title: e.target.value })}
            />
            <input
              className={input}
              placeholder={ru ? 'Описание (необязательно)' : 'Description (optional)'}
              value={it.desc}
              onChange={(e) => patch(i, { desc: e.target.value })}
            />
            <input
              className={`${input} font-mono`}
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
        </div>
      ))}

      <button
        type="button"
        onClick={addItem}
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-dashed border-border py-3 text-[13px] font-semibold text-ink-2 hover:border-border-strong hover:text-ink"
      >
        <Plus size={15} /> {ru ? 'Добавить пункт' : 'Add item'}
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
