import { Info } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import type { ListPageData } from './load'

type Props = Pick<ListPageData, 'mon' | 'showAdMarking' | 'showDisclosure' | 'adAdvertisers'> & { lang: Lang }

/**
 * Обязательная маркировка рекламы над содержимым списка: РФ-пометка «Реклама» с
 * рекламодателем и FTC-раскрытие партнёрских ссылок. Отдельный файл, потому что
 * причина его менять — не продукт, а требования к рекламе: обе плашки обязаны
 * стоять ДО ссылок, к которым относятся.
 */
export function ListAdNotices({ mon, showAdMarking, showDisclosure, adAdvertisers, lang }: Props) {
  return (
    <>
      {/* РФ-маркировка «Реклама» — до ссылок; компактная пометка (сам erid
          едет в ссылке через /api/go). ч. 16 ст. 18.1 требует назвать
          рекламодателя — добавляем наименование+ИНН из правил.
          self-start: во flex-колонке элемент иначе растянулся бы на всю
          ширину, а пометка должна быть по содержимому. */}
      {showAdMarking && (
        <div className="inline-flex flex-wrap items-center gap-x-1.5 self-start rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[0.6875rem] font-medium text-ink-2">
          <span>{mon.adMarkingText}</span>
          {adAdvertisers.length > 0 && (
            <span className="font-normal text-muted">
              · {t('adAdvertiser', lang)}:{' '}
              {adAdvertisers
                .map((a) => (a.advertiserInn ? `${a.advertiser}, ${t('innLabel', lang)} ${a.advertiserInn}` : a.advertiser))
                .join('; ')}
            </span>
          )}
        </div>
      )}

      {/* FTC-дисклеймер: показывается ДО ссылок (требование к affiliate-раскрытию). */}
      {showDisclosure && (
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-4 py-3 text-[0.78125rem] text-ink-2">
          <Info size={15} className="shrink-0 text-muted" /> {mon.disclosureText}
        </div>
      )}
    </>
  )
}
