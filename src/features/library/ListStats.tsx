import Link from 'next/link'
import { Eye, GitBranch, GitFork, Globe, Lock, PlayCircle, Star, Tag } from 'lucide-react'
import { fmtCount } from '@/shared/lib/count'
import { plural, t, type Lang } from '@/shared/i18n'

/**
 * Показатели списка одной строкой (как сводка под описанием репозитория у GitHub):
 * звёзды, форки, наблюдатели, просмотры, ветки, версия, активность, публичность.
 *
 * Один компонент на оба места — сводку на мобиле (ряд с переносом) и About-сайдбар
 * на десктопе (колонка): цифры на одной странице должны совпадать по составу и виду.
 *
 * Числа сокращаем (1.2k), а форму слова берём по исходному числу — «1 ветка»,
 * «2 ветки», «5 веток». У сокращённых (≥1000) всегда форма родительного мн. ч.:
 * «1.2k звёзд», иначе на 1201 вышло бы «1.2k звезда».
 */
export function ListStats({
  base,
  lang,
  layout = 'row',
  stars,
  forks,
  watchers,
  runs,
  branches,
  version,
  visibility,
}: {
  base: string
  lang: Lang
  /** 'row' — ряд с переносом (мобила), 'column' — столбец (сайдбар). */
  layout?: 'row' | 'column'
  stars: number
  forks: number
  watchers: number
  runs: number
  branches: number
  version: number
  visibility: 'public' | 'private'
}) {
  const num = (n: number, key: Parameters<typeof plural>[1]) => (
    <>
      <b className="text-ink">{fmtCount(n)}</b> {plural(n >= 1000 ? 0 : n, key, lang)}
    </>
  )
  const item = 'inline-flex items-center gap-1.5'
  const link = `${item} hover:text-accent`

  return (
    <div
      className={
        layout === 'row'
          ? 'flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-2'
          : 'flex flex-col gap-2 text-[13px] text-ink-2'
      }
    >
      {/* Версия — первой: она из всей сводки самое «что это сейчас», а не счётчик.
          Цифру, как и у остальных, держим белой — иначе пункт выпадает из ряда. */}
      <Link href={`${base}/releases`} className={link}>
        {/* v и число — одним узлом: во flex-ряду с gap они иначе разъезжаются («v 1»). */}
        <Tag size={14} className="text-muted" />
        <span>
          v<b className="text-ink">{version}</b>
        </span>
      </Link>
      <span className={item}>
        <Star size={14} className="text-muted" /> {num(stars, 'stars')}
      </span>
      <Link href={`${base}/forks`} className={link}>
        <GitFork size={14} className="text-muted" /> {num(forks, 'forks')}
      </Link>
      <span className={item}>
        <Eye size={14} className="text-muted" /> {num(watchers, 'watchers')}
      </span>
      <Link href={`${base}/versions`} className={link}>
        <GitBranch size={14} className="text-muted" /> {num(branches, 'branches')}
      </Link>
      {/* Вместо «Activity» у GitHub — свой показатель: сколько раз список прогнали.
          Ссылки нет: страницы прогонов конкретного списка не существует, а Аналитика
          и так стоит вкладкой сверху. */}
      <span className={item}>
        <PlayCircle size={14} className="text-muted" /> {num(runs, 'runs')}
      </span>
      {/* Публичность — как «Public repository» в конце сводки у GitHub. */}
      <span className={item}>
        {visibility === 'private' ? (
          <>
            <Lock size={14} className="text-muted" /> {t('privateLabel', lang)}
          </>
        ) : (
          <>
            <Globe size={14} className="text-muted" /> {t('publicLabel', lang)}
          </>
        )}
      </span>
    </div>
  )
}
