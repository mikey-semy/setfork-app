import { t, type Lang } from '@/shared/i18n'
import { Badge } from '@/shared/ui/badge'

/**
 * РОД СПИСКА ПЛАШКОЙ У ИМЕНИ — «Скилл» и «Шаблон».
 *
 * Эталон — GitHub: шаблонный репозиторий носит у имени метку «Public template», и в
 * общем потоке его видно, не открывая. Состояние (приватный, черновик) — соседняя плашка
 * `ListStateBadge`, у неё тот же вид: одна строка меток у имени, а не россыпь стилей.
 *
 * Метки ставит автор (настройки списка), а не догадка по содержимому: чек-лист со
 * скриптом ещё не обязательно скилл.
 *
 * Без значков — одним словом, как «Public template» у GitHub: значок робота у «Скилла»
 * тянул глаз сильнее самого названия (замечание владельца 25.09), а плашки рода должны
 * читаться одинаково.
 */
export function ListKindBadges({
  item,
  lang,
  className,
}: {
  item: { isSkill?: boolean | null; isTemplate?: boolean | null }
  lang: Lang
  className?: string
}) {
  if (!item.isSkill && !item.isTemplate) return null
  return (
    <>
      {item.isSkill ? (
        <Badge shape="pill" className={className ? `shrink-0 ${className}` : 'shrink-0'}>
          {t('badgeSkill', lang)}
        </Badge>
      ) : null}
      {item.isTemplate ? (
        <Badge shape="pill" className={className ? `shrink-0 ${className}` : 'shrink-0'}>
          {t('badgeTemplate', lang)}
        </Badge>
      ) : null}
    </>
  )
}
