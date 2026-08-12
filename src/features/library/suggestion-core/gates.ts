// Ворота предложения — ОДИН набор на оба пути принятия.
//
// Путей два: предложение из ВЕТКИ вливается git-слиянием, предложение из ПУНКТОВ
// принимается как новая версия. Правило должно быть одно — иначе настройка списка
// работает у одного вида предложений и молча не работает у другого.
//
// Этот принцип в модуле был объявлен, но выполнен только для внешних проверок
// (`checksGate` вынесли ровно с такой мотивировкой). Остальные четверо ворот —
// черновик, запрошенные правки, нерешённые обсуждения, число одобрений — были
// выписаны в каждом пути отдельно и уже разошлись порядком: ветка спрашивала
// одобрения до проверок, пункты — после. Пятые ворота, добавленные в одно место,
// разошлись бы уже поведением.

import 'server-only'
import { countApprovals, hasBlockingReview } from '../review-queries'
// eslint-disable-next-line boundaries/dependencies -- счётчик нерешённых обсуждений живёт в comments
import { countUnresolvedThreads } from '@/features/comments/queries'
import { blockingReportedChecks } from '../suggestion-checks'
import type { withPrDefaults } from '../pr-settings'

type PrSettings = ReturnType<typeof withPrDefaults>

/**
 * Гейт внешних проверок.
 *
 * Отдельной функцией, потому что его зовут и ворота целиком, и страница
 * предложения — ей нужно показать причину до нажатия кнопки.
 */
export async function checksGate(suggestionId: string, enabled: boolean, currentRevision?: string | null): Promise<string | null> {
  if (!enabled) return null
  const { failed, pending, stale } = await blockingReportedChecks(suggestionId, currentRevision)
  if (failed.length) return `checks failed: ${failed.join(', ')}`
  if (pending.length) return `checks still running: ${pending.join(', ')}`
  // Проверяли ДРУГУЮ ревизию — держим так же: «проверено» относится к содержимому,
  // а не к предложению вообще.
  if (stale.length) return `checks ran on an older revision: ${stale.join(', ')}`
  return null
}

/**
 * Все ворота ревью разом: причина отказа или null.
 *
 * Порядок один на оба пути и назван здесь явно. Набор пропускаемых и
 * отклоняемых предложений от порядка не зависит — от него зависит только то,
 * какую из нескольких одновременных причин увидит человек.
 *
 * Запрошенные правки блокируют ВСЕГДА: это не настройка, а смысл ревью.
 */
export async function reviewGates(
  sug: { id: string; draft: boolean | null },
  prs: PrSettings,
  revision: string | null,
): Promise<string | null> {
  // Черновик не предъявлен к слиянию — его и не рассматриваем.
  if (sug.draft) return 'draft'
  if (await hasBlockingReview(sug.id)) return 'a reviewer requested changes'
  if (prs.blockOnUnresolved && (await countUnresolvedThreads(sug.id))) return 'unresolved discussions'
  if (prs.requiredApprovals > 0 && (await countApprovals(sug.id)) < prs.requiredApprovals)
    return `needs ${prs.requiredApprovals} approval(s)`
  return checksGate(sug.id, prs.blockOnFailedChecks, revision)
}
