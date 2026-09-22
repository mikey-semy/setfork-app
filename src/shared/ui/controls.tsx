'use client'

import { useTheme } from 'next-themes'
import { langHref, splitLangPath } from '@/shared/i18n/url'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { LOCALES, t, type Lang } from '@/shared/i18n'
import { Tooltip } from './Tooltip'
import { Segment, SegmentedControl } from './SegmentedControl'
import { TOUCH_HIT } from './control'

export function LangSwitch({ lang }: { lang: Lang }) {
  const router = useRouter()
  function set(next: Lang) {
    if (next === lang) return
    // Кука — чтобы выбор пережил переходы на страницы БЕЗ префикса.
    document.cookie = `lang=${next}; path=/; max-age=${60 * 60 * 24 * 365}`
    // ⚠️ Но одной куки мало: с 22.09.2026 язык ИЗ АДРЕСА главнее её. На `/ru/explore`
    // кнопка EN ставила куку, делала `refresh()` — и страница оставалась русской, потому
    // что адрес по-прежнему говорил «ru». Переключатель молча не работал бы ровно там,
    // где язык виден в строке браузера (находка авто-ревью).
    const path = window.location.pathname
    const target = langHref(path, next) + window.location.search + window.location.hash
    // ⚠️ ПОЛНАЯ загрузка, а не `router.push`. Клиентский переход в App Router НЕ
    // перерисовывает корневой макет — а в нём и `<html lang>`, и шапка с меню. Проверено
    // живьём: адрес менялся на `/en/explore`, а `lang` у документа оставался `ru`, и
    // вся обвязка страницы продолжала говорить по-русски. Смена языка — редкое действие,
    // и лишняя перезагрузка тут дешевле половины страницы на чужом языке.
    if (splitLangPath(path).lang) window.location.assign(target)
    else router.refresh()
  }
  return (
    <SegmentedControl label={t('language', lang)} size="xs" shape="pill">
      {LOCALES.map((l) => (
        <Segment key={l} active={lang === l} onClick={() => set(l)} className="uppercase">
          {l}
        </Segment>
      ))}
    </SegmentedControl>
  )
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const isDark = mounted && resolvedTheme === 'dark'
  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="grid h-7.5 w-7.5 place-items-center rounded-full border border-border text-ink-2 hover:text-ink"
    >
      {isDark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  )
}

/** Трёхрежимный переключатель темы (light/dark/system) — один модуль на два места:
 *  labels=false — компактный сегмент из иконок (дропдаун аватарки),
 *  labels=true — кнопки с подписями (Настройки → Appearance). */
export function ThemeModeSwitch({ labels = false, lang }: { labels?: boolean; lang?: Lang }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  // Язык нужен обоим видам переключателя, а приходит он пропом только из настроек:
  // в дропдауне аватарки подписи живут в подсказках, и там язык знает вызывающий.
  const l: Lang = lang ?? 'en'
  const modes = [
    { value: 'light', label: t('lightMode', l), icon: Sun },
    { value: 'dark', label: t('darkMode', l), icon: Moon },
    { value: 'system', label: t('systemMode', l), icon: Monitor },
  ] as const
  const current = mounted ? theme : undefined

  if (!labels) {
    return (
      <SegmentedControl label={t('theme', l)} size="xs" shape="pill">
        {modes.map(({ value, label, icon: Icon }) => (
          <Tooltip key={value} label={label}>
            <Segment active={current === value} aria-label={label} onClick={() => setTheme(value)} className="px-1.5">
              <Icon size={13} />
            </Segment>
          </Tooltip>
        ))}
      </SegmentedControl>
    )
  }
  return (
    <div className="flex flex-wrap gap-2">
      {modes.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => setTheme(value)}
          // Зона нажатия: карточка 38px высотой, а пальцу нужно 44 (живой замер 28.08.2026
          // на 390px нашёл эти три среди самых мелких целей). Растить нельзя — высоту тут
          // задаёт содержимое, и рост развалил бы ряд; значит зона. Она выступает на 3px
          // сверху и снизу, а зазор ряда 8px, так что соседние строки при переносе не
          // перекрываются — тот же расчёт, что держит узда stacked-hit.
          // eslint-disable-next-line no-restricted-syntax -- карточка варианта выбора: высота от содержимого, а не от шкалы
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-body text-ink transition-colors ${TOUCH_HIT} ${
            current === value ? 'border-accent bg-accent-soft' : 'border-border hover:border-border-strong'
          }`}
        >
          <Icon size={14} className="text-muted" /> {label}
        </button>
      ))}
    </div>
  )
}
