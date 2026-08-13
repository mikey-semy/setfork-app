import { LayoutTemplate, PlayCircle } from 'lucide-react'
import { startRun } from '@/features/runs/actions'
import { useTemplate } from '@/features/library/actions'
import { BranchPicker } from '@/features/git/BranchPicker'
import { CloneDropdown } from '@/features/git/CloneDropdown'
import { CommitBar } from '@/features/library/CommitBar'
import { ListActionsMenu } from '@/features/library/ListActionsMenu'
import { Tooltip } from '@/shared/ui/Tooltip'
import { buttonClass } from '@/shared/ui/button-style'
import { TOUCH_BOX } from '@/shared/ui/control'
import { t, type Lang } from '@/shared/i18n'
import type { ListPageData } from './load'

type Props = Pick<
  ListPageData,
  | 'owner'
  | 'slug'
  | 'base'
  | 'tpl'
  | 'branches'
  | 'refBranch'
  | 'canManageBranches'
  | 'viewer'
  | 'readOnlyView'
  | 'isOwner'
  | 'titleIsForeign'
  | 'currentVersion'
  | 'versionAuthors'
  | 'commitsCount'
  | 'latestNote'
> & { lang: Lang }

/**
 * Панель над списком — то же место, что у GitHub над файлами репозитория: слева
 * выбор ветки, справа действия (шаблон, клонирование, «…», прогон), под ними строка
 * последнего коммита.
 *
 * УПРАВЛЕНИЕ — вне рамки, отдельной строкой над коробкой коммита: ровно как у
 * GitHub, где «main ▾» и «Code» стоят НАД коробкой последнего коммита, а не внутри
 * неё. Рамка вокруг кнопок читалась как лишний контейнер: она ничего не
 * группировала, кроме самой себя.
 *
 * Мобильная логика (фидбек владельца): ДВЕ плотные строки — (1) инфо: ветка ·
 * аватар · ник · vN · ⚒ · время; (2) действия ВПРАВО: Run · Получить · ✎. Всё
 * лишнее для узкого экрана (note, счётчики, blame) — только sm+.
 */
export function ListToolbar({
  owner,
  slug,
  base,
  tpl,
  branches,
  refBranch,
  canManageBranches,
  viewer,
  readOnlyView,
  isOwner,
  titleIsForeign,
  currentVersion,
  versionAuthors,
  commitsCount,
  latestNote,
  lang,
}: Props) {
  if (!currentVersion) return null
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.78125rem] text-ink-2 print:hidden">
        {/* Пикер веток показываем ВСЕГДА, когда ветка есть (как GitHub «main ▾» —
            даже одна ветка и на чужом списке; canManage лишь гейтит создание). */}
        {branches.length > 0 && (
          <BranchPicker base={base} owner={owner} slug={slug} branches={branches} current={refBranch ?? 'main'} lang={lang} canManage={canManageBranches} />
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {tpl.isTemplate && viewer && (
            <form action={useTemplate.bind(null, tpl.id)} className="inline-flex">
              <Tooltip label={t('list.useTemplateHint', lang)}>
                <button
                  type="submit"
                  className={buttonClass()}
                >
                  <LayoutTemplate size={14} /> <span className="hidden md:inline">{t('list.useTemplate', lang)}</span>
                </button>
              </Tooltip>
            </form>
          )}
          <CloneDropdown base={base} slug={slug} lang={lang} />
          {/* Вторичное (правка/перевод/публикация черновика) — одним «...»-меню,
              а не россыпью разновысоких иконок (эталон: секции настроек). Ряд на
              390px и так занят «Получить» и прогоном: ещё одна кнопка его распирает,
              поэтому публикация уходит сюда, а меню помечается точкой.
              Публикацию предлагаем только владельцу и только на текущей версии: на
              снимке прошлой версии она опубликовала бы не то, что человек видит. */}
          <ListActionsMenu
            base={base}
            isOwner={isOwner}
            templateId={tpl.id}
            lang={lang}
            canTranslate={canManageBranches && !readOnlyView && titleIsForeign}
            canPublish={isOwner && tpl.status === 'draft' && !readOnlyView}
            targetLang={lang}
          />
          {/* Run — первичное действие (прогон): к ПРАВОМУ КРАЮ ряда (thumb-зона, по
              mobile-ui: primary справа-внизу). Кнопка-иконка 36×36, подпись в тултипе/aria. */}
          {/* На альтернативном снимке (ветка/прошлая версия) прогон не предлагаем:
              он всё равно стартовал бы на ТЕКУЩЕЙ версии — обманчиво. */}
          {viewer && !readOnlyView && (
            <form action={startRun.bind(null, tpl.id)} className="inline-flex">
              <Tooltip label={t('runStart', lang)}>
                <button type="submit" aria-label={t('runStart', lang)} className={buttonClass({ variant: 'primary', className: `p-0 size-8 ${TOUCH_BOX}` })}>
                  <PlayCircle size={16} />
                </button>
              </Tooltip>
            </form>
          )}
        </div>
      </div>

      <CommitBar
        authors={versionAuthors}
        message={latestNote || t('noCommitMessage', lang)}
        version={currentVersion.version}
        createdAt={currentVersion.createdAt}
        commitsCount={commitsCount}
        versionsHref={`${base}/versions`}
        lang={lang}
        labels={{
          history: t('versionsTab', lang),
          expand: t('list.showFullMessage', lang),
          collapse: t('list.hideMessage', lang),
          commitLink: t('list.thisCommitHistory', lang),
          and: t('list.and', lang),
          others: t('list.andNOthers', lang),
        }}
      />
    </>
  )
}
