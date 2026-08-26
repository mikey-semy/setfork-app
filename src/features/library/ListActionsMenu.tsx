'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Languages, MoreHorizontal, Pencil, Rocket, type LucideIcon } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { Tooltip } from '@/shared/ui/Tooltip'
import { buttonClass } from '@/shared/ui/button-style'
import { LANG_META, t, type Lang } from '@/shared/i18n'
import { toast } from '@/shared/ui/toast'
// Прямые модули, а не фасад './actions': бочка тянет в клиентский бандл все
// экшены библиотеки разом (react-doctor/no-barrel-import).
import { publishList } from './actions/versions'
import { translateList } from './actions/ai'

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
}

type PublishHint = { templateId: string; phase: 'visible' | 'popping' } | null
const publishHintKey = (templateId: string) => `sf:publish-hint:${templateId}`

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
  const [publishHint, setPublishHint] = useState<PublishHint>(null)
  const translateLabel = t('translateInto', lang).replace('{lang}', LANG_META[targetLang].endonym)
  const publishHintLabel = t('publishAvailableHint', lang)

  // Подсказка одноразовая для КАЖДОГО черновика: новый список снова заслуживает
  // ненавязчивого указателя, уже просмотренный — больше не мигает при каждом визите.
  // Через rAF, а не синхронный setState внутри эффекта: первый SSR/гидрационный
  // кадр одинаковый, затем клиент безопасно читает localStorage.
  useEffect(() => {
    if (!canPublish) return
    const id = window.requestAnimationFrame(() => {
      try {
        if (window.localStorage.getItem(publishHintKey(templateId)) !== '1') {
          setPublishHint({ templateId, phase: 'visible' })
        }
      } catch {
        // Заблокированное хранилище не должно прятать полезную подсказку.
        setPublishHint({ templateId, phase: 'visible' })
      }
    })
    return () => window.cancelAnimationFrame(id)
  }, [canPublish, templateId])

  const hintPhase = publishHint?.templateId === templateId ? publishHint.phase : null
  // animationend может не прийти, если вкладка ушла в фон или пользовательская
  // таблица стилей отключила animation. Таймер гарантирует, что «лопнувшая» точка
  // не зависнет прозрачным DOM-узлом.
  useEffect(() => {
    if (hintPhase !== 'popping') return
    const id = window.setTimeout(() => setPublishHint(null), 350)
    return () => window.clearTimeout(id)
  }, [hintPhase])

  const acknowledgePublishHint = () => {
    if (!canPublish || hintPhase !== 'visible') return
    try {
      window.localStorage.setItem(publishHintKey(templateId), '1')
    } catch {
      // Даже без localStorage убираем точку в текущем просмотре.
    }
    setPublishHint({ templateId, phase: 'popping' })
  }

  const doTranslate = () =>
    start(async () => {
      const res = await translateList(templateId, targetLang)
      if ('error' in res) toast.error(t('translateFailed', lang))
      else router.refresh()
    })

  const editHref = isOwner ? `${base}/edit` : `${base}/suggest`
  const editLabel = isOwner ? t('edit', lang) : t('suggestEdit', lang)
  const btn = buttonClass({ className: 'shrink-0 p-0 size-8' })

  // Пункты СПИСКОМ, а не лесенкой условий в разметке: новое действие = новая строка,
  // а решение «меню или одна кнопка» считается по длине и не переписывается заново.
  const actions: MenuAction[] = [{ key: 'edit', label: editLabel, Icon: Pencil, href: editHref }]
  if (canTranslate) actions.push({ key: 'translate', label: translateLabel, Icon: Languages, onSelect: doTranslate })
  if (canPublish) {
    actions.push({
      key: 'publish',
      label: t('publishList', lang),
      // Экшен сам уводит на страницу списка; последствия и отмена публикации живут
      // в опасной зоне настроек — здесь только быстрый путь.
      Icon: Rocket,
      onSelect: () => start(() => publishList(templateId)),
    })
  }

  // Единственное действие — сразу кнопкой, без меню (им всегда оказывается правка).
  if (actions.length === 1) {
    return (
      <Tooltip label={editLabel}>
        <Link href={editHref} aria-label={editLabel} className={btn}>
          <Pencil size={16} />
        </Link>
      </Tooltip>
    )
  }

  return (
    <DropdownMenu onOpenChange={(open) => open && acknowledgePublishHint()}>
      {/* До первого просмотра тултип расшифровывает точку; после — возвращается
          обычное «Ещё действия». Само меню остаётся единственным явным сообщением. */}
      <Tooltip label={hintPhase ? publishHintLabel : t('library.moreActions', lang)}>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={hintPhase ? publishHintLabel : t('library.moreActions', lang)} className={`relative ${btn}`}>
            <MoreHorizontal size={16} />
            {/* Открытие меню = пользователь «заглянул»: точка лопается и навсегда
                запоминается просмотренной для этого списка. */}
            {canPublish && hintPhase && (
              <span
                data-publish-hint
                aria-hidden
                className={`absolute right-0.5 top-0.5 size-1.5 rounded-full bg-warn ${hintPhase === 'popping' ? 'animate-sf-hint-burst' : ''}`}
              />
            )}
          </button>
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
              <a.Icon size={15} className="text-muted" /> {a.label}
            </DropdownMenuItem>
          ),
        )}
        {/* «Коммиты» отсюда ушли: они теперь иконкой с тултипом в строке автора
            (как значок истории справа от коммита у GitHub) — там им и место. */}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
