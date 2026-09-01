'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Languages, MoreHorizontal, Pencil, Rocket, type LucideIcon } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { Tooltip } from '@/shared/ui/Tooltip'
import { LANG_META, t, type Lang } from '@/shared/i18n'
import { toast } from '@/shared/ui/toast'
// Прямые модули, а не фасад './actions': бочка тянет в клиентский бандл все
// экшены библиотеки разом (react-doctor/no-barrel-import).
import { publishList } from './actions/versions'
import { translateList } from './actions/ai'
import { IconButton } from '@/shared/ui/IconButton'
import { HintDot } from '@/shared/ui/HintDot'

/**
 * Вторичные действия панели списка: правка, перевод, публикация черновика.
 *
 * Набор переменный, поэтому это «...»-меню (как overflow у GitHub), а не россыпь
 * разновысоких кнопок в ряду: на 390px ряд уже занят «Получить» и прогоном, и
 * каждая новая кнопка распирает его или уносит на вторую строку. Но перевод и
 * публикация показываются редко, и в обычном случае в меню остаётся ОДИН пункт —
 * «Редактировать». Выпадающее меню ради одного пункта — лишний тап и лишняя
 * загадка: по карандашу и так понятно, что кнопка делает. Поэтому один пункт
 * рисуем прямой кнопкой-иконкой с тултипом, а «...» возвращается только когда в
 * нём правда есть выбор.
 *
 * Высота у всех веток одна (32px шкалы, как Run и «Получить») — ряд остаётся ровным.
 */

/** Пункт меню. href — переход (обязан остаться ссылкой), onSelect — действие. */
interface MenuAction {
  key: string
  label: string
  Icon: LucideIcon
  href?: string
  onSelect?: () => void
  /** Пункт помечен точкой, пока действие не применили. */
  hint?: Hint
}

/**
 * ПОДСКАЗКА ЖИВЁТ НА ПУНКТЕ, А НЕ НА КНОПКЕ МЕНЮ.
 *
 * Точка на кнопке «Ещё действия» гасла в момент открытия меню — ровно тогда, когда
 * человек впервые получал шанс увидеть, О ЧЁМ она была. Внутри его встречал обычный
 * список пунктов, и подсказка расходовалась впустую (жалоба владельца).
 *
 * Теперь у подсказки две части. Точка на КНОПКЕ зовёт открыть меню и гаснет от
 * открытия — свою работу она сделала. Точки на ПУНКТАХ показывают, что именно
 * доступно, и держатся, пока действие не применили: пока черновик не опубликован,
 * «Опубликовать» помечено. Кнопка при этом больше не мигает — иначе черновик,
 * лежащий месяцами, дёргал бы на каждой странице.
 */
type Hint = 'publish' | 'translate'
type HintState = { templateId: string; pending: Set<Hint>; menuSeen: boolean } | null
/** Ключ на КАЖДОЕ действие: принятая публикация не должна гасить подсказку перевода. */
const hintKey = (h: Hint, templateId: string) => `sf:hint:${h}:${templateId}`
/** Отдельно — «меню открывали»: это про кнопку, а не про действие внутри. */
const menuSeenKey = (templateId: string) => `sf:hint-seen:${templateId}`
const readFlag = (key: string) => {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    // Заблокированное хранилище не должно прятать полезную подсказку.
    return false
  }
}
const writeFlag = (key: string) => {
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    // Даже без хранилища подсказка уходит в текущем просмотре — состояние ниже.
  }
}

export function ListActionsMenu({
  base,
  isOwner,
  templateId,
  lang,
  canTranslate,
  canPublish,
  targetLang,
}: {
  base: string
  isOwner: boolean
  templateId: string
  lang: Lang
  /** Показывать «Перевести» — только владельцу/коллаборатору и когда контент реально иноязычный. */
  canTranslate: boolean
  /** Показывать «Опубликовать список» — владельцу неопубликованного черновика. */
  canPublish: boolean
  targetLang: Lang
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [hints, setHints] = useState<HintState>(null)
  const translateLabel = t('translateInto', lang).replace('{lang}', LANG_META[targetLang].endonym)
  const publishHintLabel = t('publishAvailableHint', lang)
  const translateHintLabel = t('translateAvailableHint', lang)

  // Подсказки читаются для КАЖДОГО черновика отдельно: новый список снова заслуживает
  // ненавязчивого указателя, уже разобранный — молчит. Через rAF, а не синхронный
  // setState внутри эффекта: первый SSR/гидрационный кадр одинаковый, затем клиент
  // безопасно читает localStorage.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      const pending = new Set<Hint>()
      if (canPublish && !readFlag(hintKey('publish', templateId))) pending.add('publish')
      if (canTranslate && !readFlag(hintKey('translate', templateId))) pending.add('translate')
      setHints({ templateId, pending, menuSeen: readFlag(menuSeenKey(templateId)) })
    })
    return () => window.cancelAnimationFrame(id)
  }, [canPublish, canTranslate, templateId])

  const state = hints?.templateId === templateId ? hints : null
  const isPending = (h: Hint) => !!state?.pending.has(h)
  // Точка на кнопке — пока есть хоть одна неприменённая подсказка И меню ещё не
  // открывали: дальше зовёт уже сам пункт внутри.
  const [burstingTrigger, setBurstingTrigger] = useState(false)
  const triggerHint = !!state && state.pending.size > 0 && !state.menuSeen
  // animationend может не прийти, если вкладка ушла в фон или пользовательская
  // таблица стилей отключила animation. Таймер гарантирует, что «лопнувшая» точка
  // не зависнет прозрачным DOM-узлом.
  useEffect(() => {
    if (!burstingTrigger) return
    const id = window.setTimeout(() => setBurstingTrigger(false), 350)
    return () => window.clearTimeout(id)
  }, [burstingTrigger])

  const openedMenu = () => {
    if (!triggerHint) return
    writeFlag(menuSeenKey(templateId))
    setBurstingTrigger(true)
    setHints((h) => (h ? { ...h, menuSeen: true } : h))
  }

  // Подсказка пункта расходуется применением действия, а не взглядом на него:
  // «Опубликовать» перестаёт быть помеченным, когда список опубликован.
  const acknowledge = (h: Hint) => {
    if (!isPending(h)) return
    writeFlag(hintKey(h, templateId))
    setHints((s) => {
      if (!s) return s
      const pending = new Set(s.pending)
      pending.delete(h)
      return { ...s, pending }
    })
  }

  const doTranslate = () =>
    start(async () => {
      const res = await translateList(templateId, targetLang)
      if ('error' in res) toast.error(t('translateFailed', lang))
      else router.refresh()
    })

  // Пока точка на кнопке есть — подпись её расшифровывает: сама по себе точка не
  // говорит ничего, и для экранного диктора она не существует вовсе. Публикация
  // важнее перевода, поэтому при обеих подсказках названа она.
  const triggerLabel = !triggerHint
    ? t('library.moreActions', lang)
    : isPending('publish')
      ? publishHintLabel
      : translateHintLabel

  const editHref = isOwner ? `${base}/edit` : `${base}/suggest`
  const editLabel = isOwner ? t('edit', lang) : t('suggestEdit', lang)

  // Пункты СПИСКОМ, а не лесенкой условий в разметке: новое действие = новая строка,
  // а решение «меню или одна кнопка» считается по длине и не переписывается заново.
  const actions: MenuAction[] = [{ key: 'edit', label: editLabel, Icon: Pencil, href: editHref }]
  if (canTranslate)
    actions.push({
      key: 'translate',
      label: translateLabel,
      Icon: Languages,
      hint: 'translate',
      onSelect: () => {
        acknowledge('translate')
        doTranslate()
      },
    })
  if (canPublish) {
    actions.push({
      key: 'publish',
      label: t('publishList', lang),
      // Экшен сам уводит на страницу списка; последствия и отмена публикации живут
      // в опасной зоне настроек — здесь только быстрый путь.
      Icon: Rocket,
      hint: 'publish',
      onSelect: () => {
        acknowledge('publish')
        start(() => publishList(templateId))
      },
    })
  }

  // Единственное действие — сразу кнопкой, без меню (им всегда оказывается правка).
  if (actions.length === 1) {
    return (
      <Tooltip label={editLabel}>
        <IconButton size="md" href={editHref} label={editLabel}>
          <Pencil size={16} />
        </IconButton>
      </Tooltip>
    )
  }

  return (
    <DropdownMenu onOpenChange={(open) => open && openedMenu()}>
      {/* До первого просмотра тултип расшифровывает точку; после — возвращается
          обычное «Ещё действия». Само меню остаётся единственным явным сообщением. */}
      <Tooltip label={triggerLabel}>
        <DropdownMenuTrigger asChild>
          <IconButton size="md" label={triggerLabel} className="relative">
            <MoreHorizontal size={16} />
            {/* Точка зовёт заглянуть внутрь и на этом свою работу заканчивает:
                дальше показывает уже сам помеченный пункт. */}
            {(triggerHint || burstingTrigger) && <HintDot data-publish-hint bursting={burstingTrigger} />}
          </IconButton>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end">
        {actions.map((a) =>
          a.href ? (
            <DropdownMenuItem key={a.key} asChild>
              <Link href={a.href}>
                <a.Icon size={15} className="text-muted" /> {a.label}
              </Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              key={a.key}
              disabled={pending}
              onSelect={(e) => {
                e.preventDefault() // не закрывать до старта перехода
                a.onSelect?.()
              }}
            >
              <a.Icon size={15} className="text-muted" />
              {/* Точка ничего не говорит диктору — смысл несёт подпись рядом с ней. */}
              <span className="flex-1">{a.label}</span>
              {a.hint && isPending(a.hint) && <HintDot place="inline" />}
            </DropdownMenuItem>
          ),
        )}
        {/* «Коммиты» отсюда ушли: они теперь иконкой с тултипом в строке автора
            (как значок истории справа от коммита у GitHub) — там им и место. */}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
