'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { GitBranch, ChevronDown, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Tooltip } from '@/shared/ui/Tooltip'
import type { GitBranch as Branch } from '@/core'
import { PickerPanel, PickerRow } from '@/shared/ui/PickerPanel'
import { t, type Lang } from '@/shared/i18n'
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
  const router = useRouter()
  const [name, setName] = useState('')
  const [q, setQ] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  if (branches.length === 0 && !canManage) return null
  const term = q.trim().toLowerCase()
  const shown = term ? branches.filter((b) => b.name.toLowerCase().includes(term)) : branches

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
      <Tooltip label={ru ? 'Ветки' : 'Branches'}>
        <Button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="h-9">
          <GitBranch size={13} className="text-muted" />
          <span className="max-w-[140px] truncate">{current}</span>
          <ChevronDown size={12} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </Button>
      </Tooltip>
      {open && (
        <>
          {/* Прозрачный слой: клик мимо закрывает (как GitHub, без затемнения). */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1.5 w-[300px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            <PickerPanel
              title={t('switchBranch', lang)}
              onClose={() => setOpen(false)}
              closeLabel={t('close', lang)}
              // Поиск — когда веток больше горстки: у списка из двух он лишний шум.
              search={
                branches.length > 5
                  ? { value: q, onChange: setQ, placeholder: t('findBranch', lang), clearLabel: t('clear', lang) }
                  : undefined
              }
              footer={
                canManage ? (
                  <>
                    {/* Поле и кнопка одной высоты — иначе ряд «ступенькой» (правило владельца). */}
                    <div className="flex items-center gap-1.5">
                      <Input
                        size="sm"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && create()}
                        placeholder={t('newBranchName', lang)}
                        className="h-8 min-w-0 flex-1"
                      />
                      <Button size="sm" disabled={pending || !name.trim()} onClick={create} className="h-8 shrink-0">
                        <Plus size={12} /> {t('create', lang)}
                      </Button>
                    </div>
                    <p className="px-0.5 pt-1 text-[11px] text-muted">{err ?? (ru ? `от ${current}` : `from ${current}`)}</p>
                  </>
                ) : null
              }
            >
              {shown.map((b) => (
                <PickerRow
                  key={b.name}
                  selected={b.name === current}
                  label={b.name}
                  onClick={() => {
                    setOpen(false)
                    router.push(b.isDefault ? base : `${base}?ref=${encodeURIComponent(b.name)}`)
                  }}
                  right={
                    b.isDefault ? (
                      <Badge className="px-1.5 text-[11px] font-normal">{t('branchDefault', lang)}</Badge>
                    ) : (
                      <span className="font-mono text-[11px] text-muted">
                        +{b.ahead}/-{b.behind}
                      </span>
                    )
                  }
                  actions={
                    canManage && !b.isDefault ? (
                      <Tooltip label={ru ? 'Удалить ветку' : 'Delete branch'}>
                        <Button variant="danger" size="xs" disabled={pending} onClick={() => remove(b.name)} className="p-1">
                          <Trash2 size={12} />
                        </Button>
                      </Tooltip>
                    ) : null
                  }
                />
              ))}
              {shown.length === 0 && <div className="px-2 py-3 text-[12.5px] text-muted">{t('nothingFound', lang)}</div>}
            </PickerPanel>
          </div>
        </>
      )}
    </div>
  )
}
