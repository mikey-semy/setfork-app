'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { t, tr, type Lang, type LocaleText } from '@/shared/i18n'
import { IconButton } from '@/shared/ui/IconButton'
import { Tooltip } from '@/shared/ui/Tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { LIST_VISIBILITY_BADGE } from '@/shared/list-visibility'
import { ListSwitcher } from '../ListSwitcher'
import type { Crumb, CrumbVisibility } from './use-crumb'

/**
 * Бредкрамб шапки: чей профиль или список открыт, с переключателем списков владельца.
 *
 * Автор списка: на широком экране — сам хэндл (до 160px, дальше троеточие); на мобиле он
 * не влезает и схлопывается в «…» — кнопку, за которой тот же переход в профиль. Ширину
 * забирает название, а автор остаётся достижим.
 */
export function TopNavCrumb({
  crumb,
  title,
  visibility,
  isListPage,
  pathname,
  lang,
  focusRing,
}: {
  crumb: Crumb
  title: LocaleText | null
  visibility: CrumbVisibility
  isListPage: boolean
  pathname: string
  lang: Lang
  focusRing: string
}) {
  const router = useRouter()

  if (!crumb.slug) {
    return (
      <nav className="ml-2 flex min-w-0 items-center gap-1 text-body-lg" aria-label="breadcrumb">
        <Link href={`/${crumb.handle}`} className="truncate font-semibold text-ink hover:text-accent">
          {crumb.handle}
        </Link>
      </nav>
    )
  }

  const listPath = `/${crumb.handle}/${crumb.slug}`
  const visBadge = visibility ? LIST_VISIBILITY_BADGE[visibility] : null
  const visLabel = visBadge ? t(visBadge.labelKey, lang) : ''

  return (
    <nav className="ml-2 flex min-w-0 items-center gap-1 text-body-lg" aria-label="breadcrumb">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton size="sm" variant="ghost" label={crumb.handle} className={`sm:hidden ${focusRing}`}>
            <MoreHorizontal size={16} />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem asChild>
            <Link href={`/${crumb.handle}`}>{crumb.handle}</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Link href={`/${crumb.handle}`} className="hidden max-w-field shrink-0 truncate font-medium text-ink hover:text-accent sm:block">
        {crumb.handle}
      </Link>
      <span className="shrink-0 text-muted">/</span>

      {/* Значок состояния у названия — как бейдж Public/Private у GitHub, но только
          иконкой: слово в шапке съедает место, которое нужно самому названию.
          Подпись отдаём тултипом (и aria-label для скринридера). Черновик здесь —
          третье состояние, а не «публичный»: см. shared/list-visibility. */}
      {visBadge && (
        <Tooltip label={visLabel}>
          {/* span без роли не может нести aria-label (aria-prohibited-attr) — иконке нужна role="img". */}
          <span role="img" className="grid size-5 shrink-0 place-items-center text-muted" aria-label={visLabel}>
            <visBadge.Icon size={13} />
          </span>
        </Tooltip>
      )}

      {/* Название кликабельно всегда: с под-вкладки уводит на корень списка, а на самом
          корне Next по ссылке «в себя» не делает НИЧЕГО — там обновляем данные руками и
          уводим наверх, чтобы клик не выглядел сломанным. */}
      <Link
        href={listPath}
        onClick={(e) => {
          if (pathname !== listPath) return
          e.preventDefault()
          router.refresh()
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
        className="truncate font-semibold text-ink hover:text-accent"
      >
        {title ? tr(title, lang) : crumb.slug}
      </Link>

      {isListPage && (
        <ListSwitcher
          key={crumb.handle}
          ownerHandle={crumb.handle}
          lang={lang}
          current={{
            handle: crumb.handle,
            slug: crumb.slug,
            title: title ?? { en: crumb.slug, ru: crumb.slug },
            avatarUrl: null,
            // Пока роут не ответил — видимость НЕ ЗНАЕМ, и врать «публичный» нельзя:
            // по этому пропу переключатель рисует значок. undefined = значка нет.
            visibility: visibility ?? undefined,
          }}
        />
      )}
    </nav>
  )
}
