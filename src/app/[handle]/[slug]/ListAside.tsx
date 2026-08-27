import Link from 'next/link'
import { CourseOutline } from '@/features/library/CourseOutline'
import { ListLineage } from '@/features/library/ListLineage'
import { ReportButton } from '@/features/reports/ReportButton'
import { AsideCard, PageAside } from '@/shared/ui/PageAside'
import { SectionLabel } from '@/shared/ui/SectionLabel'
import { UserLine } from '@/shared/ui/UserLine'
import { Badge } from '@/shared/ui/badge'
import { t, tr, type Lang, type LocaleText } from '@/shared/i18n'
import { ListAbout } from './ListAbout'
import type { ListPageData } from './load'

type Props = Pick<
  ListPageData,
  | 'lessons'
  | 'viewer'
  | 'backlinks'
  | 'base'
  | 'tpl'
  | 'isOwner'
  | 'lineage'
  | 'lineageExact'
  | 'lineageNames'
  | 'contributors'
  // нужно вложенному «О списке»
  | 'branches'
  | 'currentVersion'
  | 'watchers'
> & { lang: Lang }

/** Сколько участников показываем в сайдбаре; остальные — в зачёте вкладов. */
const CONTRIBUTORS_SHOWN = 8

/**
 * About-сайдбар: оглавление курса, обратные ссылки, «О списке», родословная,
 * участники и жалоба.
 *
 * Секции сайдбара — БЕЗ рамки и подложки, разделены волосяной линией (как «About /
 * Releases / Contributors» у GitHub). Карточка-контейнер тут ничего не группировала:
 * на десктопе она обводила и без того отдельную колонку, а на мобиле, где внутри
 * остаются одни контрибьюторы, давала пустую рамку с отступами — то самое «странное
 * пустое место».
 *
 * На УЗКОМ экране сайдбар уезжает под содержимое, поэтому описание, теги и
 * родословная показываются только с lg: наверху страницы они уже прочитаны, а дубль
 * внизу — лишний экран прокрутки ни за чем.
 */
export function ListAside(props: Props) {
  const { lessons, viewer, backlinks, base, tpl, isOwner, lineage, lineageExact, lineageNames, contributors, lang } = props
  return (
    <PageAside>
      <CourseOutline lessons={lessons} showProgress={!!viewer} lang={lang} />
      {backlinks.length > 0 && (
        <AsideCard title={t('list.linkedFrom', lang)}>
          <ul className="flex flex-col gap-1.5">
            {backlinks.map((b) => (
              <li key={`${b.handle}/${b.slug}`}>
                <Link href={`/${b.handle}/${b.slug}`} className="block truncate text-body text-accent hover:underline">
                  {tr(b.title as LocaleText, lang) || `${b.handle}/${b.slug}`}
                </Link>
              </li>
            ))}
          </ul>
        </AsideCard>
      )}
      <div className="flex flex-col gap-4">
        <div className="hidden flex-col gap-4 lg:flex">
          <SectionLabel>{t('about', lang)}</SectionLabel>
          <ListAbout {...props} layout="column" />
        </div>

        {lineage && (
          <div className="hidden lg:block">
            <ListLineage lineage={lineage} exact={lineageExact} gnomeNames={lineageNames} lang={lang} />
          </div>
        )}

        {contributors.length > 0 && (
          <div className="border-t border-border pt-4">
            {/* Как у GitHub: счётчик бейджем в заголовке, ниже — строки «ник имя».
                Сеткой аватаров было не разобрать, кто есть кто. */}
            <SectionLabel className="mb-2 flex items-center gap-1.5">
              {t('contributors', lang)}
              <Badge variant="soft">{contributors.length}</Badge>
            </SectionLabel>
            <div className="flex flex-col gap-1">
              {contributors.slice(0, CONTRIBUTORS_SHOWN).map((c) => (
                <UserLine key={c.handle} handle={c.handle} name={c.name ?? undefined} avatarUrl={c.avatarUrl} size="md" className="min-w-0 py-0.5" />
              ))}
              {contributors.length > CONTRIBUTORS_SHOWN && (
                <Link href={`${base}/leaderboard`} className="mt-0.5 text-body-sm font-semibold text-accent hover:underline">
                  {`+${contributors.length - CONTRIBUTORS_SHOWN}`}
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Жалоба — последней строкой карточки: на узком экране от неё остаются
            только контрибьюторы, и начинать блок кнопкой «пожаловаться» странно. */}
        {!isOwner && (
          <div className="border-t border-border pt-4 text-body text-ink-2">
            <ReportButton templateId={tpl.id} lang={lang} />
          </div>
        )}
      </div>
    </PageAside>
  )
}
