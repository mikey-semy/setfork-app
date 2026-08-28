'use client'
import Link from 'next/link'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { NotificationsBell } from '@/features/notifications/NotificationsBell'
import { QualifierSearch } from '@/features/library/QualifierSearch'
import type { NotificationItem } from '@/features/notifications/queries'
import { IconButton } from '@/shared/ui/IconButton'
import { t, type Lang } from '@/shared/i18n'
import type { SessionUser } from '@/shared/auth/session'
import { MobileSearch } from '../MobileSearch'
import { useSidebar } from '../sidebar-context'
import { TopNavCrumb } from './TopNavCrumb'
import { CreateMenu, GuestMenu, UserMenu } from './TopNavMenus'
import { pageTitleKey } from './page-title'
import { useCrumb } from './use-crumb'
import { TOUCH_HIT } from '@/shared/ui/control'

// Убираем дефолтный аутлайн (Radix возвращает фокус на триггер после закрытия — из-за
// этого «залипало» выделение); кольцо оставляем только для клавиатуры.
const focusRing = 'outline-hidden focus-visible:ring-2 focus-visible:ring-border-strong'

/**
 * Шапка сайта: логотип с тумблером сайдбара, бредкрамб, заголовок страницы, поиск и
 * меню. Главная навигация живёт в левом рэйле и в drawer'е бургера — здесь её нет.
 *
 * Части разложены: крамб знает про свой путь и подгрузку названия, меню — про свои
 * пункты, таблица заголовков — про соответствие «раздел → подпись».
 */
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
  const { toggle: toggleSidebar } = useSidebar() // ☰ = лого-символ списка + тумблер сайдбара
  const { crumb, title: crumbTitle, visibility, isListPage } = useCrumb(pathname)
  // На странице поиска поле в шапке не нужно: оно живёт в контенте во всю ширину.
  const isSearch = pathname.startsWith('/search')
  useSearchHotkey()

  const titleKey = pageTitleKey(pathname, !!user)

  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-surface px-4 py-2.5 print:hidden">
      {/* Бургер + SF = логотип на одном уровне: ☰ читается как «список», линии жирные */}
      <div className="flex shrink-0 items-center gap-1.5">
        <IconButton variant="ghost" label={t('menu', lang)} onClick={toggleSidebar} className={`text-ink ${focusRing}`}>
          <Menu size={21} strokeWidth={2.75} />
        </IconButton>
        {/* Имя начинается с видимого «SF» (WCAG 2.5.3 label-in-name): голый "SetFork" его не содержал. */}
        {/* Цель «домой» была 23x18 — самая мелкая постоянная цель приложения, и стоит она
            на КАЖДОЙ странице (живой замер 28.08.2026). Рост запрещён: высоту полосы
            задаёт не логотип, и 44px раздули бы шапку с 53 до 65px — та же ошибка, что
            была у поиска. Поэтому зона по вертикали и отступ по горизонтали: видимая
            надпись прежняя, цель становится 39x44. */}
        <Link href="/" className={`font-logo text-page leading-none text-ink px-2 ${TOUCH_HIT}`} aria-label="SF — SetFork">
          SF
        </Link>
      </div>

      {crumb && !isSearch && (
        <TopNavCrumb crumb={crumb} title={crumbTitle} visibility={visibility} isListPage={isListPage} pathname={pathname} lang={lang} focusRing={focusRing} />
      )}

      {titleKey && <span className="ml-1 truncate text-title font-semibold text-ink">{t(titleKey, lang)}</span>}

      {/* Правая группа не сжимается: место отдаёт бредкрамб (у него truncate), а аватар
          и иконки держат свой размер — иначе аватар плющится в овал. */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* Небольшой виджет-поиск с подсказками — на всех страницах, КРОМЕ страницы поиска */}
        {!isSearch && (
          <>
            <div className="hidden md:block">
              <QualifierSearch
                lang={lang}
                initial=""
                size="md"
                /* Высоту шапки задаёт НЕ поиск: она собрана из py-2.5 вокруг контрола
                   ступени md и равна 53px (токен --h-topbar). Дефолтный `grow` растит
                   поле до 44px на грубом указателе — полоса стала бы 65px, а соседние
                   кнопка «плюс» и колокольчик остались бы 32px, и ряд разъезжается.
                   Ровно тот случай, под который заведён проп `fixed`, и ровно то, что
                   владелец видел как «кнопка не по высоте поиска». */
                touch="fixed"
                containerClassName="w-menu xl:w-panel-lg"
                hint={<kbd className="hidden rounded-md border border-border px-1.5 text-caption font-medium leading-[1.125rem] text-muted lg:inline">/</kbd>}
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
            {!isListPage && <CreateMenu lang={lang} focusRing={focusRing} />}
            {/* Разделитель отбивает аватар от остальной шапки. */}
            <span className="mx-0.5 h-5 w-px bg-border" />
            <UserMenu user={user} isAdmin={isAdmin} lang={lang} focusRing={focusRing} />
          </>
        ) : (
          <GuestMenu lang={lang} focusRing={focusRing} />
        )}
      </div>
    </header>
  )
}

/** Хоткей «/» фокусирует поле поиска в шапке (как на GitHub). */
function useSearchHotkey() {
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
}
