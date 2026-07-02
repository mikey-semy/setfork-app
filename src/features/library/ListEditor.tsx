'use client'

import { useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ImageUp, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react'
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
}: {
  name?: string
  initialItems: EditorItem[]
  lang: Lang
  /** Включает панель «Улучшить с ИИ»; передай title/desc/tags для контекста. */
  aiRefine?: { title: string; desc: string; tags: string[] }
}) {
  const ru = lang === 'ru'
  const [items, setItems] = useState<EditorItem[]>(initialItems.length ? initialItems : [emptyItem()])
  const [uploading, setUploading] = useState<number | null>(null)
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
      setItems(res.items)
      setInstruction('')
    }
  }

  const patch = (i: number, p: Partial<EditorItem>) =>
    setItems((xs) => xs.map((it, idx) => (idx === i ? { ...it, ...p } : it)))

  async function uploadFor(i: number, file: File) {
    setUploading(i)
    const fd = new FormData()
    fd.append('file', file)
    const res = await uploadStepImage(fd)
    setUploading(null)
    if ('error' in res) alert(res.error)
    else patch(i, { imageKey: res.key, imagePreview: res.url })
  }
  const addItem = () => setItems((xs) => [...xs, emptyItem()])
  const removeItem = (i: number) => setItems((xs) => (xs.length > 1 ? xs.filter((_, idx) => idx !== i) : xs))
  const move = (i: number, dir: -1 | 1) =>
    setItems((xs) => {
      const j = i + dir
      if (j < 0 || j >= xs.length) return xs
      const next = [...xs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name={name} value={JSON.stringify(items)} />

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
          {refineErr && <p className="mt-1 text-[12px] text-[var(--danger)]">{refineErr}</p>}
        </div>
      )}

      {items.map((it, i) => (
        <div key={i} className="rounded-lg border border-border bg-surface p-4">
          <div className="mb-2.5 flex items-center gap-2">
            <span className="font-mono text-[12px] text-muted">{ru ? 'Пункт' : 'Item'} {i + 1}</span>
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
                className="rounded p-1 text-muted hover:text-[var(--danger)]"
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
                      className="text-muted hover:text-[var(--danger)]"
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
                      className="text-muted hover:text-[var(--danger)]"
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
