'use client'

import { useState } from 'react'
import { Inbox, Pencil, Plus, Tag, Trash2 } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { Alert, type AlertVariant } from '@/shared/ui/Alert'
import { Badge, type BadgeVariant } from '@/shared/ui/badge'
import { ActionRow, DangerZone } from '@/shared/ui/DangerZone'
import { DataTable, DataTableRow } from '@/shared/ui/DataTable'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Field } from '@/shared/ui/Field'
import { SettingsSection } from '@/shared/ui/SettingsSection'
import { UserLine } from '@/shared/ui/UserLine'
import { PageHeader } from '@/shared/ui/PageHeader'
import { useConfirm } from '@/shared/ui/use-confirm'
import { Button, type ButtonVariant } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { Input } from '@/shared/ui/input'
import { SearchField } from '@/shared/ui/SearchField'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { SideNav } from '@/shared/ui/SideNav'
import { Switch } from '@/shared/ui/switch'
import { TagInput } from '@/shared/ui/TagInput'
import { Textarea } from '@/shared/ui/textarea'
import { toast } from '@/shared/ui/toast'
import { Tooltip } from '@/shared/ui/Tooltip'
import { CONTROL_H, CONTROL_TEXT, type ControlSize } from '@/shared/ui/control'

// Эталон интерфейса: все примитивы shared/ui во всех размерах и состояниях.
// Смысл страницы — РАЗНОБОЙ ВИДЕН ГЛАЗАМИ: контролы одного размера стоят в одном
// ряду, и любое расхождение по высоте/кеглю бросается в глаза до того, как
// расползётся по страницам. Новый примитив/размер/вариант — сначала сюда.

const SIZES: ControlSize[] = ['md', 'sm', 'xs']
const BUTTON_VARIANTS: ButtonVariant[] = ['primary', 'outline', 'ghost', 'danger', 'dangerSolid']
const BADGE_VARIANTS: BadgeVariant[] = ['outline', 'ok', 'accent', 'soft', 'danger', 'warn']
const ALERT_VARIANTS: AlertVariant[] = ['danger', 'warn', 'ok', 'info']

type Say = (en: string, ru: string) => string

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="mb-1 text-[14px] font-bold text-ink">{title}</h2>
      {hint && <p className="mb-4 text-[12.5px] text-ink-3">{hint}</p>}
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  )
}

function SizeTag({ children }: { children: React.ReactNode }) {
  return <div className="w-14 shrink-0 font-mono text-[11px] text-muted">{children}</div>
}

/** Главная проверка: контролы одного size в одном ряду — одна высота, один кегль. */
function RowCheck({ size, say }: { size: ControlSize; say: Say }) {
  const [q, setQ] = useState('')
  return (
    <div className="flex items-center gap-2">
      <SizeTag>{size}</SizeTag>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <Button size={size} variant="primary">
          {say('Save', 'Сохранить')}
        </Button>
        <Button size={size}>{say('Cancel', 'Отмена')}</Button>
        <Input size={size} placeholder="input" className="w-36 flex-none" />
        <Select>
          <SelectTrigger size={size} className="w-36 flex-none">
            <SelectValue placeholder="select" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">Option A</SelectItem>
            <SelectItem value="b">Option B</SelectItem>
          </SelectContent>
        </Select>
        <SearchField size={size} value={q} onValueChange={setQ} placeholder="search" className="w-36 flex-none" ariaLabel="search" />
      </div>
    </div>
  )
}

export function UiKitGallery({ lang }: { lang: Lang }) {
  const say: Say = (en, ru) => (lang === 'ru' ? ru : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  const [checked, setChecked] = useState(true)
  const { confirm, confirmDialog } = useConfirm()
  const [confirmed, setConfirmed] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <Section
        title={say('Control scale', 'Шкала контролов')}
        hint={say(
          'One source — shared/ui/control.ts: same-size controls in a row must match in height and font. md = 38px (settings-row standard), sm = 32px, xs = 28px. Fields are 16px on mobile — otherwise iOS zooms.',
          'Один источник — shared/ui/control.ts: контролы одного размера в одном ряду обязаны совпадать по высоте и кеглю. md = 38px (стандарт рядов настроек), sm = 32px, xs = 28px. Поля на мобиле — 16px, иначе iOS зумит.',
        )}
      >
        {SIZES.map((s) => (
          <RowCheck key={s} size={s} say={say} />
        ))}
        <div className="flex flex-wrap gap-4 border-t border-border pt-3">
          {SIZES.map((s) => (
            <div key={s} className="flex items-center gap-2 font-mono text-[11px] text-muted">
              <span>{s}</span>
              <span>{CONTROL_H[s]}</span>
              <span>{CONTROL_TEXT[s]}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title={say('Buttons', 'Кнопки')}
        hint={say(
          'Variants × sizes; button text is 1–2 short words, icon + aria-label on mobile.',
          'Варианты × размеры; текст в кнопке — 1–2 коротких слова, на мобиле иконка + aria-label.',
        )}
      >
        {SIZES.map((size) => (
          <div key={size} className="flex items-center gap-2">
            <SizeTag>{size}</SizeTag>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {BUTTON_VARIANTS.map((v) => (
                <Button key={v} size={size} variant={v}>
                  {v}
                </Button>
              ))}
              <Button size={size} disabled>
                disabled
              </Button>
              <Tooltip label={say('Icon + aria-label', 'Иконка + aria-label')}>
                <Button size={size} aria-label={say('Add', 'Добавить')}>
                  <Plus size={size === 'xs' ? 13 : 15} />
                </Button>
              </Tooltip>
            </div>
          </div>
        ))}
      </Section>

      <Section
        title={say('Fields', 'Поля ввода')}
        hint={say(
          'No hand-rolled field classes in features — these primitives only.',
          'Никаких самопальных классов рамок в фичах — только эти примитивы.',
        )}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input placeholder={say('Default (md)', 'Обычное (md)')} />
          <Input placeholder="font-mono" className="font-mono" />
          <Input size="sm" placeholder="sm" />
          <Input disabled placeholder="disabled" />
        </div>
        <Textarea rows={2} placeholder="Textarea (box)" />
        <TagInput lang={lang} initial={['docker', 'linux']} name="uikit-tags" />
      </Section>

      <Section
        title={say('Field — form row anatomy', 'Field — анатомия строки формы')}
        hint={say(
          'Label + control + hint + error in one primitive; no local label constants in features.',
          'Подпись + контрол + подсказка + ошибка одним примитивом; никаких локальных label-констант в фичах.',
        )}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={say('With hint', 'С подсказкой')} hint={say('Explains the value by example', 'Объясняет значение примером')}>
            <Input placeholder="value" />
          </Field>
          <Field label={say('With error', 'С ошибкой')} error={say('Explains what to fix', 'Объясняет, что исправить')}>
            <Input placeholder="value" aria-invalid />
          </Field>
        </div>
      </Section>

      <Section title={say('Alerts', 'Баннеры состояния')} hint={say('Form errors (?e=), warnings, success — not hand-rolled borders.', 'Ошибки форм (?e=), предупреждения, успех — не рукописные рамки.')}>
        {ALERT_VARIANTS.map((v) => (
          <Alert key={v} variant={v}>
            {v} — {say('message text, wraps safely on narrow screens', 'текст сообщения, безопасно переносится на узких экранах')}
          </Alert>
        ))}
      </Section>

      <Section title={say('Choice controls', 'Выбор и переключатели')}>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
            <Checkbox defaultChecked className="size-4" /> Checkbox
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
            <Switch checked={checked} onCheckedChange={setChecked} /> Switch
          </label>
        </div>
      </Section>

      <Section title={say('Badges & hints', 'Бейджи и подсказки')}>
        <div className="flex flex-wrap items-center gap-2">
          {BADGE_VARIANTS.map((v) => (
            <Badge key={v} variant={v}>
              {v}
            </Badge>
          ))}
          <Tooltip label={say('Tooltip (not title=)', 'Тултип (не title=)')}>
            <Badge variant="soft">tooltip →</Badge>
          </Tooltip>
          <Button size="xs" variant="ghost" onClick={() => toast(say('Toast: short and useful', 'Тост: коротко и по делу'))}>
            toast
          </Button>
        </div>
      </Section>

      <Section
        title={say('Page header', 'Шапка страницы')}
        hint={say(
          'One primitive instead of 27 hand-rolled h1 variants: page 18px / section 16px, truncate, actions wrap below on mobile.',
          'Один примитив вместо 27 рукописных вариантов h1: page 18px / section 16px, truncate, действия на мобиле переносятся вниз.',
        )}
      >
        <div className="rounded-md border border-dashed border-border p-3">
          <PageHeader
            title={say('Very long page title that truncates instead of breaking corners', 'Очень длинный заголовок страницы, который обрезается, а не ломает углы')}
            subtitle={say('Subtitle explains the page in one line', 'Подзаголовок объясняет страницу одной строкой')}
            icon={<Tag size={16} />}
            meta={<Badge variant="soft">42</Badge>}
            actions={
              <Button size="sm" variant="primary">
                {say('Action', 'Действие')}
              </Button>
            }
            className="mb-0"
          />
        </div>
      </Section>

      <Section
        title={say('Empty states', 'Пустые состояния')}
        hint={say(
          'bordered — page/list without content; plain — reports/feeds; inline — a row inside a table.',
          'bordered — страница/список без содержимого; plain — отчёты/ленты; inline — строка внутри таблицы.',
        )}
      >
        <EmptyState
          icon={<Inbox size={22} />}
          title={say('Nothing here yet', 'Здесь пока пусто')}
          hint={say('Bordered: with icon, title and CTA', 'Bordered: с иконкой, заголовком и действием')}
          action={{ href: '/admin/ui-kit', label: say('Create', 'Создать') }}
        />
        <EmptyState variant="plain" hint={say('Plain: hint only — title is optional', 'Plain: только hint — title опционален')} />
        <EmptyState variant="inline" hint={say('Inline: a row inside a container', 'Inline: строка внутри контейнера')} />
      </Section>

      <Section title={say('Danger zone', 'Опасная зона')}>
        <DangerZone title={say('Danger zone', 'Опасная зона')}>
          <ActionRow
            title={say('Delete something', 'Удалить что-нибудь')}
            sub={say('Irreversible; shows useConfirm() instead of native confirm', 'Необратимо; показывает useConfirm() вместо нативного confirm')}
          >
            <Button
              size="sm"
              variant="dangerSolid"
              onClick={async () => {
                const ok = await confirm({
                  title: say('Delete something?', 'Удалить что-нибудь?'),
                  intro: say('This is only a UI Kit demo — nothing is deleted.', 'Это демо UI Kit — ничего не удаляется.'),
                  confirmLabel: say('Delete', 'Удалить'),
                })
                setConfirmed(ok ? say('confirmed', 'подтверждено') : say('cancelled', 'отменено'))
              }}
            >
              {say('Delete', 'Удалить')}
            </Button>
            {confirmed && <span className="text-[12.5px] text-muted">{confirmed}</span>}
          </ActionRow>
        </DangerZone>
        {confirmDialog}
      </Section>

      <Section
        title={say('Side navigation', 'Боковое меню')}
        hint={say(
          'One SideNav for settings, admin and list settings — docs-style: groups, accent active item, mobile collapse.',
          'Один SideNav для настроек, админки и настроек списка — стиль docs: группы, активный пункт акцентом, свёртка на мобиле.',
        )}
      >
        <div className="max-w-[260px]">
          <SideNav
            mobileLabel={say('Sections', 'Разделы')}
            groups={[
              {
                title: say('Group', 'Группа'),
                items: [
                  { key: 'a', href: '#', label: say('Active item', 'Активный пункт'), icon: <Tag size={14} />, active: true },
                  { key: 'b', href: '#', label: say('Regular item', 'Обычный пункт'), icon: <Inbox size={14} /> },
                  { key: 'c', href: '#', label: say('Dimmed (no match)', 'Приглушён (мимо поиска)'), icon: <Pencil size={14} />, dimmed: true },
                  { key: 'd', href: '#', label: say('Danger', 'Опасный'), icon: <Trash2 size={14} />, danger: true },
                ],
              },
            ]}
          />
        </div>
      </Section>

      <Section
        title={say('Composites', 'Конструкции')}
        hint={say(
          'SettingsSection, DataTable and UserLine — assembled once, reused everywhere.',
          'SettingsSection, DataTable и UserLine — собраны один раз, переиспользуются везде.',
        )}
      >
        <SettingsSection
          title={say('Settings section', 'Секция настроек')}
          hint={say('Card + title + hint; save via FormSaveBar, footer is for secondary rows', 'Карточка + заголовок + пояснение; сохранение — FormSaveBar, футер — для вторичных рядов')}
          footer={
            <Button size="sm" variant="ghost">
              {say('Secondary', 'Вторичное')}
            </Button>
          }
        >
          <Field label={say('A field inside', 'Поле внутри')}>
            <Input placeholder="value" />
          </Field>
        </SettingsSection>
        <DataTable
          template="minmax(0,1fr) 96px 88px"
          minWidth={420}
          header={
            <>
              <span>{say('Person', 'Человек')}</span>
              <span>{say('Role', 'Роль')}</span>
              <span className="text-right">{say('Score', 'Счёт')}</span>
            </>
          }
        >
          <DataTableRow>
            <UserLine handle="demo" size="md" name="Demo User" />
            <Badge variant="soft">admin</Badge>
            <span className="text-right font-mono text-[12.5px]">42</span>
          </DataTableRow>
          <DataTableRow muted>
            <UserLine handle="sleepy" size="md" at={say('3 d ago', '3 дн назад')} />
            <Badge variant="outline">guest</Badge>
            <span className="text-right font-mono text-[12.5px]">0</span>
          </DataTableRow>
        </DataTable>
        <div className="flex flex-wrap items-center gap-4">
          <UserLine handle="demo" size="xs" at="xs" />
          <UserLine handle="demo" size="sm" at="sm" />
          <UserLine handle="demo" size="md" at="md" />
        </div>
      </Section>

      <Section
        title={say('Settings row (etalon)', 'Ряд настроек (эталон)')}
        hint={say(
          'Bottom-right of a section: one row, one height; secondary actions are icons with tooltips, text on md+ only.',
          'Правый нижний угол секции: один ряд, одна высота; вторичные действия — иконки с тултипом, текст только на md+.',
        )}
      >
        <div className="flex items-center justify-end gap-2 rounded-md border border-dashed border-border p-3">
          <Tooltip label={say('Delete', 'Удалить')}>
            <Button size="sm" variant="danger" aria-label={say('Delete', 'Удалить')}>
              <Trash2 size={15} />
            </Button>
          </Tooltip>
          <Tooltip label={say('Rename', 'Переименовать')}>
            <Button size="sm" variant="ghost" aria-label={say('Rename', 'Переименовать')}>
              <Pencil size={15} />
              <span className="hidden md:inline">{say('Rename', 'Переименовать')}</span>
            </Button>
          </Tooltip>
          <Button size="sm" variant="primary">
            {say('Save', 'Сохранить')}
          </Button>
        </div>
      </Section>
    </div>
  )
}
