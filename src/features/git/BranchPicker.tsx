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
import { t, type Lang, type TKey } from '@/shared/i18n'
import { createBranchAction, deleteBranchAction, type BranchActionResult } from './actions'
import { branchLabel, isServerBranch } from './branch-label'

const ERR: Record<string, TKey> = {
  'bad-name': 'branch.errBadName',
  'exists': 'branch.errExists',
  'not-found': 'branch.errNotFound',
  'protected': 'branch.errProtected',
  'internal': 'branch.errInternal',
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
  // Ветки, заведённые СЕРВЕРОМ под правки из терминала, в списке не показываем.
  // Так же поступают те, у кого взята сама модель: GitHub не держит `refs/pull/*`
  // среди веток, Gerrit — `refs/changes/*`. Причина та же: это не ветки
  // репозитория в пользовательском смысле, у них своя поверхность — страница
  // Предложений. Показывать их здесь значило бы дать владельцу список
  // одинаковых подписей, где не разобрать, какую правку открываешь и какую
  // удаляешь (авто-ревью fe#662), а кнопка удаления рядом ещё и осиротила бы
  // предложение.
  //
  // Смотреть такую ветку можно — по ссылке со страницы предложения; тогда она
  // стоит активной и подписана `currentLabel` на кнопке.
  const own = branches.filter((b) => !isServerBranch(b.name))
  if (own.length === 0 && !canManage) return null
  // Подпись активной ветки — та же, что у строк списка: иначе выбор серверной
  // ветки тут же показывал бы сырой идентификатор на кнопке и в подписи «от …».
  const currentLabel = branchLabel(current, lang)
  const term = q.trim().toLowerCase()
  const shown = term ? own.filter((b) => b.name.toLowerCase().includes(term)) : own

  const fail = (r: BranchActionResult) => {
    if (!r.ok) setErr(t(ERR[r.code] ?? ERR.internal, lang))
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
        <Button onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <GitBranch size={13} className="text-muted" />
          <span className="max-w-[8.75rem] truncate">{currentLabel}</span>
          <ChevronDown size={12} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </Button>
      </Tooltip>
      {open && (
        <>
          {/* Прозрачный слой: клик мимо закрывает (как GitHub, без затемнения). */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="sf-pop-in absolute left-0 top-full z-50 mt-1.5 w-[18.75rem] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            <PickerPanel
              title={t('switchBranch', lang)}
              onClose={() => setOpen(false)}
              closeLabel={t('close', lang)}
              // Поиск — когда веток больше горстки: у списка из двух он лишний шум.
              search={
                own.length > 5
                  ? { value: q, onChange: setQ, placeholder: t('findBranch', lang), clearLabel: t('clear', lang) }
                  : undefined
              }
              footer={
                canManage ? (
                  <>
                    {/* Поле и кнопка одной высоты — иначе ряд «ступенькой» (правило владельца). */}
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && create()}
                        placeholder={t('newBranchName', lang)}
                        className="min-w-0 flex-1"
                      />
                      <Button disabled={pending || !name.trim()} onClick={create} className="shrink-0">
                        <Plus size={12} /> {t('create', lang)}
                      </Button>
                    </div>
                    <p className="px-0.5 pt-1 text-[0.6875rem] text-muted">{err ?? (ru ? `от ${currentLabel}` : `from ${currentLabel}`)}</p>
                  </>
                ) : null
              }
            >
              {shown.map((b) => (
                <PickerRow
                  key={b.name}
                  selected={b.name === current}
                  label={branchLabel(b.name, lang)}
                  onClick={() => {
                    setOpen(false)
                    router.push(b.isDefault ? base : `${base}?ref=${encodeURIComponent(b.name)}`)
                  }}
                  right={
                    b.isDefault ? (
                      <Badge className="px-1.5 text-[0.6875rem] font-normal">{t('branchDefault', lang)}</Badge>
                    ) : (
                      <span className="font-mono text-[0.6875rem] text-muted">
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
              {shown.length === 0 && <div className="px-2 py-3 text-[0.78125rem] text-muted">{t('nothingFound', lang)}</div>}
            </PickerPanel>
          </div>
        </>
      )}
    </div>
  )
}
