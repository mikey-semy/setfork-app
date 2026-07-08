'use client'

import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'
import { Check, GitBranch, ChevronDown, Plus, Trash2, X } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import type { GitBranch as Branch } from '@/core'
import type { Lang } from '@/shared/i18n'
import { createBranchAction, deleteBranchAction, type BranchActionResult } from './actions'

const ERR: Record<string, { ru: string; en: string }> = {
  'bad-name': { ru: 'Только буквы/цифры и .-_', en: 'Letters/digits and .-_ only' },
  exists: { ru: 'Ветка уже есть', en: 'Branch already exists' },
  'not-found': { ru: 'Не найдено', en: 'Not found' },
  protected: { ru: 'main защищена', en: 'main is protected' },
  internal: { ru: 'Ошибка, попробуйте ещё раз', en: 'Something went wrong' },
}

/** Селектор веток (как GitHub branch-picker) в version-bar. Выбор → ?ref=<branch>.
 *  canManage: владелец/коллаборатор — создание (от текущей) и удаление не-main. */
export function BranchPicker({
  base,
  owner,
  slug,
  branches,
  current,
  lang,
  canManage = false,
}: {
  base: string
  owner: string
  slug: string
  branches: Branch[]
  current: string // активная ветка ('main' = дефолт)
  lang: Lang
  canManage?: boolean
}) {
  const ru = lang === 'ru'
  const [open, setOpen] = useState(false)
  // Esc закрывает дропдаун (клик-мимо ловит прозрачный слой ниже).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  if (branches.length === 0 && !canManage) return null

  const fail = (r: BranchActionResult) => {
    if (!r.ok) setErr(ERR[r.code]?.[ru ? 'ru' : 'en'] ?? ERR.internal[ru ? 'ru' : 'en'])
  }

  const create = () => {
    const n = name.trim()
    if (!n || pending) return
    setErr(null)
    startTransition(async () => {
      // redirect на ?ref= при успехе; сюда возвращаемся только при ошибке.
      fail(await createBranchAction(owner, slug, n, current))
    })
  }

  const remove = (branch: string) => {
    if (pending) return
    setErr(null)
    startTransition(async () => {
      const r = await deleteBranchAction(owner, slug, branch)
      fail(r)
      if (r.ok && branch === current) window.location.href = base
    })
  }

  return (
    <div className="relative inline-block">
      <Button onClick={() => setOpen((v) => !v)} title={ru ? 'Ветки' : 'Branches'} aria-expanded={open}>
        <GitBranch size={13} className="text-muted" />
        <span className="max-w-[140px] truncate">{current}</span>
        <ChevronDown size={12} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </Button>
      {open && (
        <>
          {/* Прозрачный слой: клик мимо закрывает (как GitHub, без затемнения). */}
          <div className="fixed inset-0 z-99" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-100 mt-1.5 w-[300px] max-w-[calc(100vw-24px)] rounded-lg border border-border bg-surface p-1.5 shadow-card">
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                  {ru ? 'Ветки' : 'Branches'} <span className="font-mono">{branches.length}</span>
                </span>
                <Button variant="ghost" size="xs" onClick={() => setOpen(false)} className="p-0.5" aria-label={ru ? 'Закрыть' : 'Close'}>
                  <X size={13} />
                </Button>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {branches.map((b) => {
                  const on = b.name === current
                  return (
                    <div key={b.name} className="group flex items-center rounded hover:bg-surface-2">
                      <Link
                        href={b.isDefault ? base : `${base}?ref=${encodeURIComponent(b.name)}`}
                        onClick={() => setOpen(false)}
                        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-[13px] text-ink"
                      >
                        <span className="grid w-4 shrink-0 place-items-center">{on && <Check size={13} className="text-accent" />}</span>
                        <span className="min-w-0 truncate">{b.name}</span>
                        {b.isDefault ? (
                          <Badge className="ml-auto px-1.5 text-[10.5px] font-normal">default</Badge>
                        ) : (
                          <span className="ml-auto font-mono text-[10.5px] text-muted">
                            +{b.ahead}/-{b.behind}
                          </span>
                        )}
                      </Link>
                      {canManage && !b.isDefault && (
                        <Button
                          variant="danger"
                          size="xs"
                          disabled={pending}
                          onClick={() => remove(b.name)}
                          className="mr-1 hidden shrink-0 p-1 group-hover:inline-flex"
                          title={ru ? 'Удалить ветку' : 'Delete branch'}
                        >
                          <Trash2 size={12} />
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
              {canManage && (
                <div className="mt-1 border-t border-border px-1 pt-1.5">
                  <div className="flex items-center gap-1">
                    <Input
                      size="xs"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && create()}
                      placeholder={ru ? 'Новая ветка…' : 'New branch…'}
                      className="min-w-0 flex-1"
                    />
                    <Button size="xs" disabled={pending || !name.trim()} onClick={create} className="shrink-0">
                      <Plus size={12} /> {ru ? 'Создать' : 'Create'}
                    </Button>
                  </div>
                  <p className="px-1 pt-1 text-[11px] text-muted">
                    {err ?? (ru ? `от ${current}` : `from ${current}`)}
                  </p>
                </div>
              )}
          </div>
        </>
      )}
    </div>
  )
}
