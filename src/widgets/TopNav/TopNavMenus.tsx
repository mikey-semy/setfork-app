'use client'
import Link from 'next/link'
import { ChevronDown, History, ListChecks, LogIn, LogOut, PlayCircle, Plus, Settings, ShieldCheck, Sparkles, Star, UserPlus, UserRound } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { Button } from '@/shared/ui/button'
import { LangSwitch, ThemeModeSwitch } from '@/shared/ui/controls'
import { TOUCH_HIT } from '@/shared/ui/control'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import type { SessionUser } from '@/shared/auth/session'

// Иконки пунктов меню — приглушённые: ведёт текст, значок только помогает нащупать
// строку взглядом (как в меню аккаунта у GitHub).
const menuIcon = 'text-muted'

/** Тема и язык — одинаковые строки в меню вошедшего и гостя; поэтому один компонент. */
function AppearanceRows({ lang }: { lang: Lang }) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
        <span className="text-body text-ink-2">{t('theme', lang)}</span>
        <ThemeModeSwitch />
      </div>
      <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
        <span className="text-body text-ink-2">{t('language', lang)}</span>
        <LangSwitch lang={lang} />
      </div>
    </>
  )
}

/** Пункт-ссылка меню: иконка приглушена, ведёт текст. */
function MenuLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <DropdownMenuItem asChild>
      <Link href={href}>
        {icon} {children}
      </Link>
    </DropdownMenuItem>
  )
}

/**
 * Кнопка «+» (создание). На странице списка её НЕТ: там шапка — про сам список, а
 * «создать новый» уводит из него; действия остаются в сайдбаре и на дашборде.
 */
export function CreateMenu({ lang, focusRing }: { lang: Lang; focusRing: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={t('create', lang)} className={`gap-0.5 bg-transparent px-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink ${focusRing}`}>
          <Plus size={16} /> <ChevronDown size={13} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <MenuLink href="/new" icon={<Plus size={15} />}>{t('newList', lang)}</MenuLink>
        <MenuLink href="/generate" icon={<Sparkles size={15} />}>{t('generateWithAi', lang)}</MenuLink>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Меню аккаунта под аватаром: создание, свои разделы, настройки, вид, выход. */
export function UserMenu({ user, isAdmin, lang, focusRing }: { user: SessionUser; isAdmin?: boolean; lang: Lang; focusRing: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* ui-parity-ok: аватар как открывалка меню — сам круг и есть вид, рамка и отступ кнопки его бы обрезали */}
        <button type="button" aria-label={user.handle} className={`shrink-0 rounded-full ${TOUCH_HIT} ${focusRing}`}>
          <Avatar handle={user.handle} avatarUrl={user.avatarUrl} size={32} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          {t('signedInAs', lang)} <span className="font-semibold text-ink">{user.handle}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* Создание — своим блоком сверху (как «New repository» у GitHub): на странице
            списка кнопки «+» в шапке нет, и без этих пунктов создать список оттуда было
            бы неоткуда. */}
        <MenuLink href="/new" icon={<Plus size={15} className={menuIcon} />}>{t('newList', lang)}</MenuLink>
        <MenuLink href="/generate" icon={<Sparkles size={15} className={menuIcon} />}>{t('generateWithAi', lang)}</MenuLink>
        <DropdownMenuSeparator />
        <MenuLink href={`/${user.handle}`} icon={<UserRound size={15} className={menuIcon} />}>{t('yourProfile', lang)}</MenuLink>
        <MenuLink href="/my-lists" icon={<ListChecks size={15} className={menuIcon} />}>{t('myLists', lang)}</MenuLink>
        <MenuLink href="/runs" icon={<PlayCircle size={15} className={menuIcon} />}>{t('myRuns', lang)}</MenuLink>
        <MenuLink href="/generate/history" icon={<History size={15} className={menuIcon} />}>{t('draftHistory', lang)}</MenuLink>
        <MenuLink href={`/${user.handle}?tab=starred`} icon={<Star size={15} className={menuIcon} />}>{t('starredTab', lang)}</MenuLink>
        <MenuLink href="/settings" icon={<Settings size={15} className={menuIcon} />}>{t('settings', lang)}</MenuLink>
        {isAdmin && (
          <>
            <DropdownMenuSeparator />
            <MenuLink href="/admin" icon={<ShieldCheck size={15} className={menuIcon} />}>{t('admin', lang)}</MenuLink>
          </>
        )}
        <DropdownMenuSeparator />
        <AppearanceRows lang={lang} />
        <DropdownMenuSeparator />
        {/* Логаут через fetch, а НЕ форму: Radix закрывает меню и размонтирует форму
            раньше, чем уходит submit — из-за этого выйти не получалось. */}
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
  )
}

/**
 * Меню гостя: то же место, что у вошедшего, только вместо аватара — иконка человека.
 * Язык, тема и «Войти» не лежат тремя элементами в ряду: на мобиле они съедали
 * пол-шапки, и бредкрамбу не оставалось ширины.
 */
export function GuestMenu({ lang, focusRing }: { lang: Lang; focusRing: string }) {
  return (
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
        <MenuLink href="/login" icon={<LogIn size={15} className={menuIcon} />}>{t('signIn', lang)}</MenuLink>
        <MenuLink href="/register" icon={<UserPlus size={15} className={menuIcon} />}>{t('createAccount', lang)}</MenuLink>
        <DropdownMenuSeparator />
        <AppearanceRows lang={lang} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
