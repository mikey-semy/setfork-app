'use client'

import { useState } from 'react'
import { Inbox, Pencil, Plus, Tag, Trash2 } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { Alert, type AlertVariant } from '@/shared/ui/Alert'
import { Badge, type BadgeVariant } from '@/shared/ui/badge'
import { ActionRow, DangerZone } from '@/shared/ui/DangerZone'
import { DataTableV2 } from '@/shared/ui/data-table/DataTableV2'
import { nodeColumn, numberColumn, textColumn } from '@/shared/ui/data-table/column-builders'
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
import { CONTROL_H, CONTROL_TEXT, ICON_SIZE, LAYER, TEXT, type ControlSize } from '@/shared/ui/control'
import { t } from '@/shared/i18n'

// Эталон интерфейса: все примитивы shared/ui во всех размерах и состояниях.
// Смысл страницы — РАЗНОБОЙ ВИДЕН ГЛАЗАМИ: контролы одного размера стоят в одном
// ряду, и любое расхождение по высоте/кеглю бросается в глаза до того, как
// расползётся по страницам. Новый примитив/размер/вариант — сначала сюда.

const SIZES: ControlSize[] = ['md', 'sm', 'xs']
const BUTTON_VARIANTS: ButtonVariant[] = ['primary', 'outline', 'ghost', 'danger', 'dangerSolid']
const BADGE_VARIANTS: BadgeVariant[] = ['outline', 'ok', 'accent', 'soft', 'danger', 'warn']
const ALERT_VARIANTS: AlertVariant[] = ['danger', 'warn', 'ok', 'info']

type DemoRow = { name: string; role: string; score: number }

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="mb-1 text-[0.875rem] font-bold text-ink">{title}</h2>
      {hint && <p className="mb-4 text-[0.78125rem] text-muted">{hint}</p>}
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  )
}

function SizeTag({ children }: { children: React.ReactNode }) {
  return <div className="w-14 shrink-0 font-mono text-[0.6875rem] text-muted">{children}</div>
}

/** Живое демо классов появления: перезапуск перемонтированием по ключу. */
function MotionDemo({ lang }: { lang: Lang }) {
  const [run, setRun] = useState(0)
  const box = 'rounded-md border border-border bg-surface-2 px-3 py-2 text-[0.8125rem] text-ink'
  return (
    <div className="flex flex-col gap-3">
      <div key={run} className="grid gap-3 sm:grid-cols-3">
        <div className={cn2('sf-overlay-in', box)}>sf-overlay-in</div>
        <div className={cn2('sf-pop-in', box)}>sf-pop-in</div>
        <div className={cn2('sf-rise-in', box)}>sf-rise-in</div>
      </div>
      <div>
        <Button size="sm" variant="ghost" onClick={() => setRun((v) => v + 1)}>
          {t('admin.replay', lang)}
        </Button>
      </div>
    </div>
  )
}
const cn2 = (a: string, b: string) => `${a} ${b}`

/** Главная проверка: контролы одного size в одном ряду — одна высота, один кегль. */
function RowCheck({ size, lang }: { size: ControlSize; lang: Lang }) {
  const [q, setQ] = useState('')
  return (
    <div className="flex items-center gap-2">
      <SizeTag>{size}</SizeTag>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <Button size={size} variant="primary">
          {t('common.save', lang)}
        </Button>
        <Button size={size}>{t('admin.cancel', lang)}</Button>
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
  const [checked, setChecked] = useState(true)
  const { confirm, confirmDialog } = useConfirm()
  const [confirmed, setConfirmed] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <Section
        title={t('admin.controlScale', lang)}
        hint={t('admin.oneSourceSharedUi', lang)}
      >
        {SIZES.map((s) => (
          <RowCheck key={s} size={s} lang={lang} />
        ))}
        <div className="flex flex-wrap gap-4 border-t border-border pt-3">
          {SIZES.map((s) => (
            <div key={s} className="flex items-center gap-2 font-mono text-[0.6875rem] text-muted">
              <span>{s}</span>
              <span>{CONTROL_H[s]}</span>
              <span>{CONTROL_TEXT[s]}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title={t('admin.buttons', lang)}
        hint={t('admin.variantsSizesButtonText', lang)}
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
              <Tooltip label={t('admin.iconAriaLabel', lang)}>
                <Button size={size} aria-label={t('admin.add', lang)}>
                  <Plus size={ICON_SIZE[size]} />
                </Button>
              </Tooltip>
            </div>
          </div>
        ))}
      </Section>

      <Section
        title={t('admin.fields', lang)}
        hint={t('admin.noHandRolledField', lang)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input placeholder={t('admin.defaultMd', lang)} />
          <Input placeholder="font-mono" className="font-mono" />
          <Input size="sm" placeholder="sm" />
          <Input disabled placeholder="disabled" />
        </div>
        <Textarea rows={2} placeholder="Textarea (box)" />
        <TagInput lang={lang} initial={['docker', 'linux']} name="uikit-tags" />
      </Section>

      <Section
        title={t('admin.fieldFormRowAnatomy', lang)}
        hint={t('admin.labelControlHintError', lang)}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('admin.withHint', lang)} hint={t('admin.explainsValueByExample', lang)}>
            <Input placeholder="value" />
          </Field>
          <Field label={t('admin.withError', lang)} error={t('admin.explainsWhatFix', lang)}>
            <Input placeholder="value" aria-invalid />
          </Field>
        </div>
      </Section>

      <Section title={t('admin.alerts', lang)} hint={t('admin.formErrorsEWarnings', lang)}>
        {ALERT_VARIANTS.map((v) => (
          <Alert key={v} variant={v}>
            {v} — {t('admin.messageTextWrapsSafely', lang)}
          </Alert>
        ))}
      </Section>

      <Section title={t('admin.choiceControls', lang)}>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-[0.8125rem] text-ink">
            <Checkbox defaultChecked className="size-4" /> Checkbox
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[0.8125rem] text-ink">
            <Switch checked={checked} onCheckedChange={setChecked} /> Switch
          </label>
        </div>
      </Section>

      <Section title={t('admin.badgesHints', lang)}>
        <div className="flex flex-wrap items-center gap-2">
          {BADGE_VARIANTS.map((v) => (
            <Badge key={v} variant={v}>
              {v}
            </Badge>
          ))}
          <Tooltip label={t('admin.tooltipNotTitle', lang)}>
            <Badge variant="soft">tooltip →</Badge>
          </Tooltip>
          <Button size="xs" variant="ghost" onClick={() => toast(t('admin.toastShortUseful', lang))}>
            toast
          </Button>
        </div>
      </Section>

      <Section
        title={t('admin.pageHeader', lang)}
        hint={t('admin.onePrimitiveInstead27', lang)}
      >
        <div className="rounded-md border border-dashed border-border p-3">
          <PageHeader
            title={t('admin.veryLongPageTitle', lang)}
            subtitle={t('admin.subtitleExplainsPageOne', lang)}
            icon={<Tag size={16} />}
            meta={<Badge variant="soft">42</Badge>}
            actions={
              <Button size="sm" variant="primary">
                {t('admin.action', lang)}
              </Button>
            }
            className="mb-0"
          />
        </div>
      </Section>

      <Section
        title={t('admin.emptyStates', lang)}
        hint={t('admin.borderedPageListWithout', lang)}
      >
        <EmptyState
          icon={<Inbox size={22} />}
          title={t('admin.nothingHereYet', lang)}
          hint={t('admin.borderedIconTitleCta', lang)}
          action={{ href: '/admin/ui-kit', label: t('admin.create', lang) }}
        />
        <EmptyState variant="plain" hint={t('admin.plainHintOnlyTitle', lang)} />
        <EmptyState variant="inline" hint={t('admin.inlineRowInsideContainer', lang)} />
      </Section>

      <Section title={t('admin.dangerZone', lang)}>
        <DangerZone title={t('admin.dangerZone', lang)}>
          <ActionRow
            title={t('admin.deleteSomething', lang)}
            sub={t('admin.irreversibleShowsUseconfirmInstead', lang)}
          >
            <Button
              size="sm"
              variant="dangerSolid"
              onClick={async () => {
                const ok = await confirm({
                  title: t('admin.deleteSomething2', lang),
                  intro: t('admin.thisOnlyUiKit', lang),
                  confirmLabel: t('common.delete', lang),
                })
                setConfirmed(ok ? t('admin.confirmed', lang) : t('admin.cancelled', lang))
              }}
            >
              {t('common.delete', lang)}
            </Button>
            {confirmed && <span className="text-[0.78125rem] text-muted">{confirmed}</span>}
          </ActionRow>
        </DangerZone>
        {confirmDialog}
      </Section>

      <Section
        title={t('admin.dataTableV2', lang)}
        hint={t('admin.tanStackRealTableClick', lang)}
      >
        <DataTableV2<DemoRow>
          cardOnMobile
          rowKey={(r) => r.name}
          empty={{ hint: t('admin.noRows', lang) }}
          columns={[
            nodeColumn<DemoRow>({
              id: 'person',
              header: t('admin.person', lang),
              render: (r) => <UserLine handle="demo" name={r.name} size="sm" />,
            }),
            textColumn<DemoRow>({ id: 'role', header: t('admin.role', lang), value: (r) => r.role }),
            numberColumn<DemoRow>({ id: 'score', header: t('admin.score', lang), value: (r) => r.score }),
          ]}
          data={[
            { name: 'Demo User', role: 'admin', score: 42 },
            { name: 'Second One', role: 'guest', score: 7 },
            { name: 'Third Person', role: 'editor', score: 19 },
          ]}
        />
      </Section>

      <Section
        title={t('admin.motion', lang)}
        hint={t('admin.tokensFast120Base', lang)}
      >
        <MotionDemo lang={lang} />
      </Section>

      <Section
        title={t('admin.typography', lang)}
        hint={t('admin.sevenRolesInstead20', lang)}
      >
        <div className="flex flex-col gap-2">
          {(Object.entries(TEXT) as [keyof typeof TEXT, string][]).map(([role, cls]) => (
            <div key={role} className="flex items-baseline gap-3">
              <span className="w-20 shrink-0 font-mono text-[0.6875rem] text-muted">{role}</span>
              <span className={cls}>{t('admin.sampleTextRole', lang)}</span>
              <span className="font-mono text-[0.6875rem] text-muted">{cls}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 border-t border-border pt-3 font-mono text-[0.6875rem] text-muted">
          {Object.entries(LAYER).map(([name, z]) => (
            <span key={name}>
              {name}={z}
            </span>
          ))}
        </div>
      </Section>

      <Section
        title={t('admin.sideNavigation', lang)}
        hint={t('admin.oneSidenavSettingsAdmin', lang)}
      >
        <div className="max-w-[16.25rem]">
          <SideNav
            mobileLabel={t('admin.sections', lang)}
            groups={[
              {
                title: t('admin.group', lang),
                items: [
                  { key: 'a', href: '#', label: t('admin.activeItem', lang), icon: <Tag size={14} />, active: true },
                  { key: 'b', href: '#', label: t('admin.regularItem', lang), icon: <Inbox size={14} /> },
                  { key: 'c', href: '#', label: t('admin.dimmedNoMatch', lang), icon: <Pencil size={14} />, dimmed: true },
                  { key: 'd', href: '#', label: t('admin.danger', lang), icon: <Trash2 size={14} />, danger: true },
                ],
              },
            ]}
          />
        </div>
      </Section>

      <Section
        title={t('admin.composites', lang)}
        hint={t('admin.settingsSectionUserlineAssembledOnce', lang)}
      >
        <SettingsSection
          title={t('admin.settingsSection', lang)}
          hint={t('admin.cardTitleHintSave', lang)}
          footer={
            <Button size="sm" variant="ghost">
              {t('admin.secondary', lang)}
            </Button>
          }
        >
          <Field label={t('admin.aFieldInside', lang)}>
            <Input placeholder="value" />
          </Field>
        </SettingsSection>
        <div className="flex flex-wrap items-center gap-4">
          <UserLine handle="demo" size="xs" at="xs" />
          <UserLine handle="demo" size="sm" at="sm" />
          <UserLine handle="demo" size="md" at="md" />
        </div>
      </Section>

      <Section
        title={t('admin.settingsRowEtalon', lang)}
        hint={t('admin.bottomRightSectionOne', lang)}
      >
        <div className="flex items-center justify-end gap-2 rounded-md border border-dashed border-border p-3">
          <Tooltip label={t('common.delete', lang)}>
            <Button size="sm" variant="danger" aria-label={t('common.delete', lang)}>
              <Trash2 size={15} />
            </Button>
          </Tooltip>
          <Tooltip label={t('common.rename', lang)}>
            <Button size="sm" variant="ghost" aria-label={t('common.rename', lang)}>
              <Pencil size={15} />
              <span className="hidden md:inline">{t('common.rename', lang)}</span>
            </Button>
          </Tooltip>
          <Button size="sm" variant="primary">
            {t('common.save', lang)}
          </Button>
        </div>
      </Section>
    </div>
  )
}
