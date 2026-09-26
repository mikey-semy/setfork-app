import Link from 'next/link'
import { RunReportLine } from '@/features/library/RunReportLine'
import { servedLang, tr, type Lang } from '@/shared/i18n'
import { ListStats } from '@/features/library/ListStats'
import type { ListPageData } from './load'
import { TagChip } from '@/shared/ui/TagChip'

type Props = Pick<ListPageData, 'tpl' | 'base' | 'branches' | 'currentVersion' | 'watchers' | 'runReport' | 'latestRelease' | 'isOwner'> & {
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
export function ListAbout({ tpl, base, branches, currentVersion, watchers, runReport, latestRelease, isOwner, lang, layout }: Props) {
  const desc = tr(tpl.desc, lang)
  const revision = currentVersion?.version ?? tpl.currentVersion
  // Сколько правок после релиза: текущий текст новее выпуска — как `v0.7.0-1` у git describe.
  const release = latestRelease ? { tag: latestRelease.tag, ahead: Math.max(0, revision - latestRelease.version) } : null
  return (
    <>
      {/* Описание и теги пишет человек, длину тега никто не режет — без переноса
          один тег или «слово» в описании уносит страницу за край (мобила 390px). */}
      {desc && (
        <p lang={servedLang(tpl.desc, lang)} className={`text-body text-ink-2 [overflow-wrap:anywhere] ${layout === 'row' ? 'leading-snug' : 'leading-relaxed'}`}>
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
          version={revision}
          release={release}
          // Скилл без релиза — версии у него нет; позвать выпустить может только тот, кто вправе.
          releaseHint={!!tpl.isSkill && !latestRelease && isOwner}
          verificationLevel={currentVersion?.verificationLevel}
          verifiedAt={currentVersion?.verifiedAt}
          visibility={tpl.visibility}
          status={tpl.status}
        />
        {/* Строка отчёта о прогоне: метку уровня выше она ОБЪЯСНЯЕТ — что именно
            прогоняли, в чём и чем кончилось. Без отчёта строки нет: «не прогоняли» —
            это отсутствие записи, а не запись об отсутствии. */}
        {runReport && (
          <div className="mt-2">
            <RunReportLine report={runReport} lang={lang} />
          </div>
        )}
      </div>
    </>
  )
}
