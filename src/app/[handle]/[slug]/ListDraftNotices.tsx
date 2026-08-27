import Link from 'next/link'
import { FileText, Sparkles } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { DismissibleHint } from '@/shared/ui/DismissibleHint'
import { timeAgo } from '@/shared/ui/timeAgo'
import { CONTROL_H, CONTROL_TEXT } from '@/shared/ui/control'
import type { ListPageData } from './load'

type Props = Pick<ListPageData, 'myDraft' | 'tpl' | 'base'> & { lang: Lang }

/**
 * Плашки о состоянии самого списка: есть неопубликованные правки, список пришёл
 * из ИИ-черновика и требует проверки. Одна причина менять этот файл — правила
 * черновиков правок.
 *
 * Того, что список НЕ ОПУБЛИКОВАН, здесь нет намеренно: это состояние, а не
 * происшествие. Оно показано меткой у названия (ListHeader), а действие живёт
 * кнопкой в панели (ListToolbar) и строкой опасной зоны — как у GitHub, где
 * видимость меняют в Danger Zone, а не уговорами над репозиторием.
 */
export function ListDraftNotices({ myDraft, tpl, base, lang }: Props) {
  return (
    <>
      {/* Неопубликованные правки видит только тот, кто их писал: черновик у
          каждого автора свой, и чужой черновик — не его дело. Без этой метки
          про накопленные правки легко забыть — список выглядит как обычно. */}
      {myDraft && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3 print:hidden">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-body font-semibold text-ink">
              <FileText size={15} className="text-muted" /> {t('draftEditsPending', lang)}
            </div>
            <p className="mt-0.5 text-body-sm text-ink-2">
              {t('draftEditsPendingHint', lang).replace('{when}', timeAgo(myDraft.updatedAt, lang))}
            </p>
          </div>
          {/* Ссылка-кнопка тем же размером, что кнопки рядом: высоты берём из
              шкалы контролов, а не подбираем на глаз. */}
          <Link
            href={`${base}/edit`}
            className={`inline-flex ${CONTROL_H.md} items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 ${CONTROL_TEXT.md} font-semibold text-ink hover:border-border-strong`}
          >
            {t('openDraft', lang)}
          </Link>
        </div>
      )}

      {tpl.origin === 'ai_draft' && tpl.status === 'published' && (
        <DismissibleHint
          storageKey={`hint:ai-draft:${tpl.id}`}
          className="rounded-lg border border-accent bg-accent-soft px-4 py-3 text-body text-accent print:hidden"
        >
          <Sparkles size={15} className="shrink-0" /> {t('aiVerifyHint', lang)}
        </DismissibleHint>
      )}
    </>
  )
}
