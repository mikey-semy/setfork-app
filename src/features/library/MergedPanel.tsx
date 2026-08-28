'use client'

import Link from 'next/link'

import { useState, useTransition } from 'react'
import { GitMerge, Trash2, Undo2, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Spinner } from '@/shared/ui/Spinner'
// eslint-disable-next-line boundaries/dependencies -- удаление ветки уже реализовано в git-фиче
import { deleteBranchAction } from '@/features/git/actions'
import { revertSuggestionAction } from './suggestion-revert-action'

export interface MergedPanelLabels {
  merged: string
  closed: string
  branchSafeToDelete: string
  deleteBranch: string
  branchDeleted: string
  deleteFailed: string
  revert: string
  revertBlocked: string
  /** «Слияние прошло, список ещё не обновился» — версия не спроецирована. */
  notProjected: string
}

/**
 * Панель после закрытия правки — «что дальше»: сообщает исход и ПРЕДЛАГАЕТ
 * действие, а не оставляет пользователя на мёртвой странице.
 *
 * Ветку предлагаем удалить только когда она реально осталась: у items-правки
 * ветки нет вовсе, а у branch-PR она могла быть удалена раньше.
 */
export function MergedPanel({
  owner,
  slug,
  branch,
  accepted,
  mergedVersion,
  notProjected,
  revertOf,
  labels,
}: {
  owner: string
  slug: string
  /** Ветка PR, если он пришёл из ветки и она ещё существует. */
  branch: string | null
  /** true — слито/принято, false — отклонено. */
  accepted: boolean
  /** Версия, в которую вошла правка. Показывается ссылкой — см. комментарий в разметке. */
  mergedVersion?: number | null
  /** Правка из ВЕТКИ, у которой версии нет: слияние прошло, проекция не легла. */
  notProjected?: boolean
  /** id принятого предложения, если его вообще можно откатить (мейнтейнеру). */
  revertOf: string | null
  labels: MergedPanelLabels
}) {
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState(false)
  const [failed, setFailed] = useState(false)
  // Отказ отката НЕ прячем: он объясняет, какие пункты трогали после слияния —
  // без этого «кнопка не сработала» выглядит как поломка.
  const [revertError, setRevertError] = useState('')

  const revert = () => {
    if (!revertOf) return
    startTransition(async () => {
      const res = await revertSuggestionAction(revertOf)
      if (!res.ok) setRevertError(res.conflicts?.length ? `${labels.revertBlocked}: ${res.conflicts.join(', ')}` : res.reason)
    })
  }

  const remove = () => {
    if (!branch) return
    startTransition(async () => {
      const res = await deleteBranchAction(owner, slug, branch)
      if (res.ok) setDone(true)
      else setFailed(true)
    })
  }

  const tone = accepted ? 'border-accent/50 bg-accent/10' : 'border-border bg-surface-2'
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-3 rounded-lg border px-3.5 py-3 ${tone}`}>
      <span className={accepted ? 'text-accent' : 'text-muted'}>{accepted ? <GitMerge size={18} /> : <X size={18} />}</span>
      <div className="min-w-0 flex-1">
        <div className="text-body font-semibold text-ink">
          {accepted ? labels.merged : labels.closed}
          {/* ВО ЧТО именно влилось. Номер версии лежал в базе (`merged_version`), им
              пользовался откат — а человеку его не показывали нигде: страница сообщала
              «принято и закрыто» и обрывалась на этом. У GitHub и Gitea на смерженном
              предложении стоит ссылка на коммит, то есть связь «правка → что вышло»
              видна; версия — наш аналог коммита. */}
          {/* Пусто у ВЕТОЧНОГО предложения — не «версии нет», а «ядро слило, но не
              спроецировало»: git ушёл вперёд базы. Молчать тут нельзя — человек видит
              «принято» и не понимает, почему список не изменился. */}
          {accepted && !mergedVersion && branch !== undefined && notProjected ? (
            <span className="block text-body-sm font-normal text-warn">{labels.notProjected}</span>
          ) : null}
          {accepted && mergedVersion ? (
            <>
              {' '}
              <Link href={`/${owner}/${slug}/compare?from=${mergedVersion - 1}&to=${mergedVersion}`} className="text-accent hover:underline">
                v{mergedVersion}
              </Link>
            </>
          ) : null}
        </div>
        {branch && !done && <div className="text-body-sm text-ink-2">{labels.branchSafeToDelete}</div>}
        {done && <div className="text-body-sm text-muted">{labels.branchDeleted}</div>}
        {failed && <div className="text-body-sm text-danger">{labels.deleteFailed}</div>}
        {revertError && <div className="text-body-sm text-danger [overflow-wrap:anywhere]">{revertError}</div>}
      </div>
      {/* Действие — к правому краю (thumb-зона), единая высота ряда. */}
      {revertOf && (
        <Button variant="outline" disabled={pending} onClick={revert}>
          {pending ? <Spinner size="sm" /> : <Undo2 size={13} />} {labels.revert}
        </Button>
      )}
      {branch && !done && (
        <Button variant="outline" disabled={pending} onClick={remove}>
          {pending ? <Spinner size="sm" /> : <Trash2 size={13} />} {labels.deleteBranch}
        </Button>
      )}
    </div>
  )
}
