// Модель ревью правки — ЧИСТЫЙ модуль (без 'use server').
//
// Почему отдельным файлом: в файле с 'use server' разрешены только экспорты
// async-функций. Константа вердиктов и тип представления там ломают сборку —
// причём не в том файле, а при сборе данных страниц, которые его транзитивно
// импортируют («Failed to collect page data for /[handle]»). Поэтому значения и
// типы живут здесь, а экшены — в review-actions.ts.

/** Вердикты ревью. Явные значения — у Gitea «request changes» спрятан за Reject. */
export const VERDICTS = ['comment', 'approve', 'changes'] as const
export type Verdict = (typeof VERDICTS)[number]

export const isVerdict = (v: unknown): v is Verdict =>
  typeof v === 'string' && (VERDICTS as readonly string[]).includes(v)

export interface ReviewView {
  id: string
  verdict: Verdict
  body: string
  createdAt: Date
  /** Голос блокирует принятие (правки запрошены владельцем/коллаборатором). */
  blocking: boolean
  /** Снят мейнтейнером: голос остаётся в истории, но принятие больше не держит. */
  dismissed: { by: string | null; reason: string; at: Date } | null
  /** Это вердикт самого зрителя — своё снимают «убрать ревью», а не снятием. */
  isMine: boolean
  reviewer: { handle: string; name: string | null; avatarUrl: string | null }
}
