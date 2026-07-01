'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2, X } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { emptyItem, type EditorItem } from './editor'

const input =
  'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13.5px] text-ink outline-none focus:border-border-strong'

export function ListEditor({
  name = 'items',
  initialItems,
  lang,
}: {
  name?: string
  initialItems: EditorItem[]
  lang: Lang
}) {
  const ru = lang === 'ru'
  const [items, setItems] = useState<EditorItem[]>(initialItems.length ? initialItems : [emptyItem()])

  const patch = (i: number, p: Partial<EditorItem>) =>
    setItems((xs) => xs.map((it, idx) => (idx === i ? { ...it, ...p } : it)))
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
              <label className="flex cursor-pointer items-center gap-1.5 text-ink-2">
                <input
                  type="checkbox"
                  checked={it.hasImage}
                  onChange={(e) => patch(i, { hasImage: e.target.checked })}
                />
                {ru ? 'место под скриншот' : 'screenshot slot'}
              </label>
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
