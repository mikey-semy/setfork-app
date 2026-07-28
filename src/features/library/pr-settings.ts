import { PR_DEFAULTS, type PrSettings } from '@/shared/db/schema'

/**
 * Настройки предложений с подставленными дефолтами.
 *
 * Отдельная чистая функция, а не `{...PR_DEFAULTS, ...raw}` по месту: значения из
 * jsonb приходят из БД и могут быть чем угодно (старая форма, ручная правка,
 * мусор). Гейт слияния не должен зависеть от того, что кто-то положил строку туда,
 * где ожидается число.
 */
export function withPrDefaults(raw: unknown): Required<PrSettings> {
  const o = (raw ?? {}) as Record<string, unknown>
  const bool = (k: keyof PrSettings) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : PR_DEFAULTS[k as 'linearOnly'])
  const approvals = Number(o.requiredApprovals)
  return {
    allowFrom: o.allowFrom === 'collaborators' ? 'collaborators' : 'all',
    linearOnly: bool('linearOnly'),
    mergeMethod: o.mergeMethod === 'squash' ? 'squash' : 'merge',
    blockOnUnresolved: bool('blockOnUnresolved'),
    // Отрицательное и нечисловое → 0; больше 10 одобрений на список — заведомо опечатка.
    requiredApprovals: Number.isFinite(approvals) ? Math.min(10, Math.max(0, Math.trunc(approvals))) : PR_DEFAULTS.requiredApprovals,
    autoDeleteBranch: bool('autoDeleteBranch'),
    autoCloseIssues: bool('autoCloseIssues'),
    allowMaintainerEdits: bool('allowMaintainerEdits'),
  }
}

/** Ключи, которые UI умеет переключать (валидация входа экшена). */
export const PR_BOOL_KEYS = [
  'linearOnly',
  'blockOnUnresolved',
  'autoDeleteBranch',
  'autoCloseIssues',
  'allowMaintainerEdits',
] as const
export type PrBoolKey = (typeof PR_BOOL_KEYS)[number]
