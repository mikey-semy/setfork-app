import Link from 'next/link'
import { tr, type Lang } from '@/shared/i18n'
import { ListStats } from '@/features/library/ListStats'
import type { ListPageData } from './load'
import { TagChip } from '@/shared/ui/TagChip'

type Props = Pick<ListPageData, 'tpl' | 'base' | 'branches' | 'currentVersion' | 'watchers'> & {
  lang: Lang
  /** row — сводка строкой (мобильная шапка), column — колонкой (сайдбар на lg). */
  layout: 'row' | 'column'
}

/**
 * «О списке»: описание, теги и сводка показателей. Одно и то же содержимое стоит
 * ДВАЖДЫ — наверху на мобиле (как у GitHub под названием репозитория) и в
 * About-сайдбаре на десктопе, — поэтому живёт одним компонентом: раньше это были две
 * копии разметки, и они успели разойтись (у сайдбарной не было переноса длинных слов,
 * и один тег без пробелов распирал колонку).
 */
export function ListAbout({ tpl, base, branches, currentVersion, watchers, lang, layout }: Props) {
  const desc = tr(tpl.desc, lang)
  return (
    <>
      {/* Описание и теги пишет человек, длину тега никто не режет — без переноса
          один тег или «слово» в описании уносит страницу за край (мобила 390px). */}
      {desc && (
        <p className={`text-body text-ink-2 [overflow-wrap:anywhere] ${layout === 'row' ? 'leading-snug' : 'leading-relaxed'}`}>
          {desc}
        </p>
      )}
      {tpl.tags.length > 0 && (
        <div className={`flex flex-wrap gap-1.5 ${layout === 'row' ? 'mt-2' : ''}`}>
          {tpl.tags.map((tag) => (
            <TagChip
              key={tag}
              slug={tag}
              href={`/search?q=${encodeURIComponent(`tag:${tag}`)}`}
              className="min-w-0 [overflow-wrap:anywhere]"
            />
          ))}
        </div>
      )}
      {/* Сводка показателей — как строка под описанием репозитория у GitHub. */}
      <div className={layout === 'row' ? 'mt-3' : 'border-t border-border pt-4'}>
        <ListStats
          base={base}
          lang={lang}
          layout={layout}
          stars={tpl.starsCount}
          forks={tpl.forksCount}
          watchers={watchers}
          runs={tpl.runsCount}
          branches={Math.max(1, branches.length)}
          version={currentVersion?.version ?? tpl.currentVersion}
          verificationLevel={currentVersion?.verificationLevel}
          verifiedAt={currentVersion?.verifiedAt}
          visibility={tpl.visibility}
          status={tpl.status}
        />
      </div>
    </>
  )
}
