'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  ChevronDown,
  Globe,
  History,
  ListChecks,
  Lock,
  LogIn,
  LogOut,
  Menu,
  MoreHorizontal,
  PlayCircle,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  UserPlus,
  UserRound,
} from 'lucide-react'
import { NotificationsBell } from '@/features/notifications/NotificationsBell'
import { QualifierSearch } from '@/features/library/QualifierSearch'
import { MobileSearch } from './MobileSearch'
import { ListSwitcher } from './ListSwitcher'
import type { NotificationItem } from '@/features/notifications/queries'
import { LangSwitch, ThemeModeSwitch } from '@/shared/ui/controls'
import { TOUCH_HIT } from '@/shared/ui/control'
import { Avatar } from '@/shared/ui/Avatar'
import { Button } from '@/shared/ui/button'
import { IconButton } from '@/shared/ui/IconButton'
import { Tooltip } from '@/shared/ui/Tooltip'
import { useSidebar } from './sidebar-context'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { t, tr, type Lang, type LocaleText } from '@/shared/i18n'
import type { SessionUser } from '@/shared/auth/session'

// Роуты, чей первый сегмент — НЕ handle пользователя (для бредкрамба в шапке):
// общий список под тестом-синхроном с src/app (разъезд давал «SF guilds»).
import { RESERVED_TOP } from '@/shared/nav/reserved-top'

export function TopNav({
  lang,
  user,
  isAdmin,
  unread = 0,
  notifications = [],
}: {
  lang: Lang
  user: SessionUser | null
  isAdmin?: boolean
  unread?: number
  notifications?: NotificationItem[]
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { toggle: toggleSidebar } = useSidebar() // ☰ = лого-символ списка + тумблер сайдбара
  // На странице поиска поле в шапке = полноценный квалификатор-поиск во всю ширину.
  const isSearch = pathname.startsWith('/search')
  // Бредкрамб в шапке (как GitHub owner/repo): показываем чей это профиль/список.
  // Первый сегмент — handle, если это не зарезервированный роут; второй — slug списка.
  const crumb = (() => {
    const segs = pathname.split('/').filter(Boolean)
    if (segs.length === 0 || RESERVED_TOP.has(segs[0])) return null
    return { handle: segs[0], slug: segs[1] } // slug undefined на профиле
  })()
  // Страница списка = /handle/slug/*: там шапка обслуживает список, а не создание нового.
  const isListPage = crumb?.slug != null && crumb.slug !== 'catalogs'

  // Имя списка в бредкрамбе = человеческий title, а не slug. Крамб URL-derived (title
  // не знает) → до-достаём по смене пути; пока грузим — показываем slug (мгновенный
  // фолбэк), приватные title гейтит сам роут. Обновляется и на client-навигации.
  // Оттуда же приватность — замок у названия (тот же признак, что в списке ниже).
  const [crumbTitle, setCrumbTitle] = useState<LocaleText | null>(null)
  // Видимость — ТРИ состояния: пока не ответил роут, она null и значка нет вовсе.
  // Булев флаг врал бы: false означало сразу и «публичный», и «ещё не знаем», а значок
  // глобуса на приватном списке — худшая из возможных подписей.
  const [crumbVis, setCrumbVis] = useState<'public' | 'private' | null>(null)
  const crumbHandle = crumb?.handle
  const crumbSlug = crumb?.slug
  useEffect(() => {
    if (!crumbHandle || !crumbSlug) {
      setCrumbTitle(null)
      setCrumbVis(null)
      return
    }
    let alive = true
    setCrumbTitle(null)
    setCrumbVis(null)
    fetch(`/api/list-title?h=${encodeURIComponent(crumbHandle)}&s=${encodeURIComponent(crumbSlug)}`)
      .then((r) => r.json())
      .then((d: { title?: LocaleText | null; visibility?: 'public' | 'private' }) => {
        if (!alive) return
        setCrumbTitle(d.title ?? null)
        setCrumbVis(d.visibility === 'private' ? 'private' : d.visibility === 'public' ? 'public' : null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [crumbHandle, crumbSlug])
  // Хоткей «/» фокусирует поле поиска в шапке (как на GitHub); Escape закрывает меню.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return
      e.preventDefault()
      document.querySelector<HTMLInputElement>('header input')?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href))
  // Убираем дефолтный аутлайн (Radix возвращает фокус на триггер после закрытия —
  // из-за этого «залипало» выделение); кольцо оставляем только для клавиатуры.
  const focusRing = 'outline-hidden focus-visible:ring-2 focus-visible:ring-border-strong'
  // Иконки пунктов меню — приглушённые: ведёт текст, значок только помогает нащупать
  // строку взглядом (как в меню аккаунта у GitHub).
  const menuIcon = 'text-muted'

  // Контекстный заголовок страницы (в шапке — только он, навигация ушла в сайдбар).
  // На «/» дашборд только у залогиненного; гостю там hero — заголовок не нужен
  // (имя и так огромным лого на самой странице).
  const title = pathname === '/'
    ? user
      ? t('dashboard', lang)
      : ''
    : pathname.startsWith('/search')
      ? t('searchTitle', lang)
      : pathname.startsWith('/explore')
      ? t('explore', lang)
      : pathname.startsWith('/my-lists')
        ? t('myLists', lang)
        : pathname.startsWith('/runs')
          ? t('myRuns', lang)
          : pathname.startsWith('/settings')
            ? t('settings', lang)
            : pathname.startsWith('/generate')
              ? t('generateWithAi', lang)
              : pathname.startsWith('/new')
                ? t('newList', lang)
                : pathname.startsWith('/notifications')
                  ? t('notifications', lang)
                  : pathname.startsWith('/guilds')
                    ? t('guildsTitle', lang)
                    : pathname.startsWith('/tags')
                      ? t('tags', lang)
                      : pathname.startsWith('/feedback')
                        ? t('feedback', lang)
                        : pathname.startsWith('/admin/council')
                          ? t('councilHall', lang)
                          : pathname.startsWith('/admin')
                            ? t('admin', lang)
                            : ''

  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-surface px-4 py-2.5 print:hidden">
      {/* Бургер + SF = логотип на одном уровне: ☰ читается как «список», линии жирные */}
      <div className="flex shrink-0 items-center gap-1.5">
        <IconButton variant="ghost" label={t('menu', lang)} onClick={toggleSidebar} className={`text-ink ${focusRing}`}>
          <Menu size={21} strokeWidth={2.75} />
        </IconButton>
        {/* Имя начинается с видимого «SF» (WCAG 2.5.3 label-in-name): голый "SetFork" его не содержал. */}
        <Link href="/" className="font-logo text-[1.125rem] leading-none text-ink" aria-label="SF — SetFork">
          SF
        </Link>
      </div>
      {/* Главная навигация — в левом рэйле (SideRail, desktop) и в drawer'е бургера
          (мобилка). В шапке её больше нет — только логотип, бредкрамб и заголовок. */}
      {/* Бредкрамб (как GitHub owner/repo): чей профиль/список открыт. Прячем на поиске.
          Слеша между лого и handle нет — только между handle и slug. */}
      {crumb && !isSearch && (
        <nav className="ml-2 flex min-w-0 items-center gap-1 text-[0.875rem]" aria-label="breadcrumb">
          {/* Автор списка: на широком экране — сам хэндл (до 160px, дальше троеточие);
              на мобиле он не влезает и схлопывается в «…» — кнопку, за которой тот же
              переход в профиль. Ширину забирает название, а автор остаётся достижим. */}
          {crumb.slug ? (
            <>
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
              <Link
                href={`/${crumb.handle}`}
                className="hidden max-w-[10rem] shrink-0 truncate font-medium text-ink hover:text-accent sm:block"
              >
                {crumb.handle}
              </Link>
              <span className="shrink-0 text-muted">/</span>
              {/* Значок видимости у названия — как бейдж Public/Private у GitHub, но только
                  иконкой: слово в шапке съедает место, которое нужно самому названию.
                  Подпись отдаём тултипом (и aria-label для скринридера). */}
              {crumbVis && (
                <Tooltip label={crumbVis === 'private' ? t('privateLabel', lang) : t('publicLabel', lang)}>
                  {/* span без роли не может нести aria-label (aria-prohibited-attr) — иконке нужна role="img". */}
                  <span
                    role="img"
                    className="grid size-5 shrink-0 place-items-center text-muted"
                    aria-label={crumbVis === 'private' ? t('privateLabel', lang) : t('publicLabel', lang)}
                  >
                    {crumbVis === 'private' ? <Lock size={13} /> : <Globe size={13} />}
                  </span>
                </Tooltip>
              )}
              {/* Название кликабельно всегда: с под-вкладки уводит на корень списка, а
                  на самом корне Next по ссылке «в себя» не делает НИЧЕГО — там обновляем
                  данные руками и уводим наверх, чтобы клик не выглядел сломанным. */}
              <Link
                href={`/${crumb.handle}/${crumb.slug}`}
                onClick={(e) => {
                  if (pathname !== `/${crumb.handle}/${crumb.slug}`) return
                  e.preventDefault()
                  router.refresh()
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                className="truncate font-semibold text-ink hover:text-accent"
              >
                {crumbTitle ? tr(crumbTitle, lang) : crumb.slug}
              </Link>
              {/* Только на самой странице списка: на /handle/catalogs/* второй сегмент —
                  литерал «catalogs», и переключатель показывал бы фейковый «текущий»
                  список handle/catalogs (замечание авто-ревью #589). */}
              {isListPage && (
              <ListSwitcher
                key={crumb.handle}
                ownerHandle={crumb.handle}
                lang={lang}
                current={{
                  handle: crumb.handle,
                  slug: crumb.slug,
                  title: crumbTitle ?? { en: crumb.slug, ru: crumb.slug },
                  avatarUrl: null,
                  // Пока роут не ответил — видимость НЕ ЗНАЕМ, и врать «публичный»
                  // нельзя: по этому пропу переключатель рисует значок. undefined =
                  // значка нет, а настоящую видимость строка получит от by-owner.
                  visibility: crumbVis ?? undefined,
                }}
              />
              )}
            </>
          ) : (
            <Link href={`/${crumb.handle}`} className="truncate font-semibold text-ink hover:text-accent">
              {crumb.handle}
            </Link>
          )}
        </nav>
      )}
      {/* На самой странице поиска поля в шапке НЕТ: оно живёт в контенте страницы во всю
          ширину. В шапке на мобильном оно сжималось до ~100px (лого + язык + «Войти»
          съедали ширину) и было бесполезным, да и дублировать функцию страницы незачем. */}
      {title && <span className="ml-1 truncate text-[1rem] font-semibold text-ink">{title}</span>}

      {/* Правая группа не сжимается: место отдаёт бредкрамб (у него truncate), а
          аватар и иконки держат свой размер — иначе аватар плющится в овал. */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* Небольшой виджет-поиск с подсказками — на всех страницах, КРОМЕ страницы поиска */}
        {!isSearch && (
          <>
            <div className="hidden md:block">
              <QualifierSearch
                lang={lang}
                initial=""
                size="md"
                containerClassName="w-[13.75rem] xl:w-[18.75rem]"
                hint={
                  <kbd className="hidden rounded-md border border-border px-1.5 text-[0.6875rem] font-medium leading-[1.125rem] text-muted lg:inline">/</kbd>
                }
              />
            </div>
            {/* Мобильный поиск — оверлей на месте (не редирект); на странице списка
                предлагает «искать в этом списке» (?find= — фильтр шагов). */}
            <MobileSearch crumb={crumb} lang={lang} className={`md:hidden ${focusRing}`} />
          </>
        )}

        {user ? (
          <>
            {/* bell / уведомления (выпадашка + страница «Все») */}
            <NotificationsBell unread={unread} items={notifications} lang={lang} />

            {/* «+» create menu (GitHub-стиль: иконка + chevron). На странице списка его
                НЕТ: там шапка — про сам список, а «создать новый» уводит из него;
                действия остаются в сайдбаре и на дашборде. Разделитель оставляем —
                он отбивает аватар от остальной шапки. */}
            {!isListPage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label={t('create', lang)} className={`gap-0.5 bg-transparent px-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink ${focusRing}`}>
                  <Plus size={16} /> <ChevronDown size={13} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href="/new">
                    <Plus size={15} /> {t('newList', lang)}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/generate">
                    <Sparkles size={15} /> {t('generateWithAi', lang)}
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            )}

            <span className="mx-0.5 h-5 w-px bg-border" />

            {/* avatar user menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={user.handle} className={`shrink-0 rounded-full ${TOUCH_HIT} ${focusRing}`}>
                  <Avatar handle={user.handle} avatarUrl={user.avatarUrl} size={32} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  {t('signedInAs', lang)} <span className="font-semibold text-ink">{user.handle}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {/* Создание — своим блоком сверху (как «New repository» у GitHub): на
                    странице списка кнопки «+» в шапке нет, и без этих пунктов создать
                    список оттуда было бы неоткуда. */}
                <DropdownMenuItem asChild>
                  <Link href="/new">
                    <Plus size={15} className={menuIcon} /> {t('newList', lang)}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/generate">
                    <Sparkles size={15} className={menuIcon} /> {t('generateWithAi', lang)}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href={`/${user.handle}`}>
                    <UserRound size={15} className={menuIcon} /> {t('yourProfile', lang)}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/my-lists">
                    <ListChecks size={15} className={menuIcon} /> {t('myLists', lang)}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/runs">
                    <PlayCircle size={15} className={menuIcon} /> {t('myRuns', lang)}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/generate/history">
                    <History size={15} className={menuIcon} /> {t('draftHistory', lang)}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/${user.handle}?tab=starred`}>
                    <Star size={15} className={menuIcon} /> {t('starredTab', lang)}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings">
                    <Settings size={15} className={menuIcon} /> {t('settings', lang)}
                  </Link>
                </DropdownMenuItem>
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/admin">
                        <ShieldCheck size={15} className={menuIcon} /> {t('admin', lang)}
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                  <span className="text-[0.8125rem] text-ink-2">{t('theme', lang)}</span>
                  <ThemeModeSwitch />
                </div>
                <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                  <span className="text-[0.8125rem] text-ink-2">{t('language', lang)}</span>
                  <LangSwitch lang={lang} />
                </div>
                <DropdownMenuSeparator />
                {/* Логаут через fetch, а НЕ форму: Radix закрывает меню и размонтирует
                    форму раньше, чем уходит submit — из-за этого выйти не получалось. */}
                <DropdownMenuItem
                  className="text-danger"
                  onSelect={() => {
                    void fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
                      window.location.href = '/'
                    })
                  }}
                >
                  <LogOut size={15} /> {t('signOut', lang)}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          /* Гость: то же меню, что у вошедшего, только вместо аватара — иконка человека.
             Язык, тема и «Войти» больше не лежат тремя элементами в ряду: на мобиле они
             съедали пол-шапки, и бредкрамбу не оставалось ширины. */
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('signIn', lang)}
                className={`grid size-8 shrink-0 place-items-center rounded-full border border-border text-ink-2 hover:text-ink ${TOUCH_HIT} ${focusRing}`}
              >
                <UserRound size={17} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href="/login">
                  <LogIn size={15} className={menuIcon} /> {t('signIn', lang)}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/register">
                  <UserPlus size={15} className={menuIcon} /> {t('createAccount', lang)}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                <span className="text-[0.8125rem] text-ink-2">{t('theme', lang)}</span>
                <ThemeModeSwitch />
              </div>
              <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                <span className="text-[0.8125rem] text-ink-2">{t('language', lang)}</span>
                <LangSwitch lang={lang} />
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

    </header>
  )
}
