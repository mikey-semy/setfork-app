'use client'

import { useState, useTransition } from 'react'
import { GitMerge, MessagesSquare, Pencil, Trash2, CircleCheck, ShieldCheck } from 'lucide-react'
import { Switch } from '@/shared/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { SettingsSection } from '@/shared/ui/SettingsSection'
import { t, type Lang } from '@/shared/i18n'
import { setPrAllowFrom, setPrMergeMethod, setPrNumber, setPrSetting } from './actions'
import type { PrBoolKey } from './pr-settings'

const row = 'flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0'

/**
 * Настройки предложений — наш аналог раздела Pull Requests в настройках репо.
 *
 * Здесь живут гейты, которые раньше были захардкожены: у GitHub это тоже
 * настройки репозитория, и на разных списках нужны разные. Блокирующее «нужны
 * правки» настройкой НЕ сделано — это смысл вердикта, а не политика.
 */
export function PrSettingsSection({
  templateId,
  settings,
  lang,
}: {
  templateId: string
  settings: {
    allowFrom: 'all' | 'collaborators'
    blockOnUnresolved: boolean
    blockOnFailedChecks: boolean
    requiredApprovals: number
    autoDeleteBranch: boolean
    autoCloseIssues: boolean
    linearOnly: boolean
    mergeMethod: 'merge' | 'squash'
    allowMaintainerEdits: boolean
  }
  lang: Lang
}) {
  return (
    <SettingsSection title={t('prSettingsTitle', lang)}>
      <div className="flex flex-col divide-y divide-border">
        <WhoRow templateId={templateId} initial={settings.allowFrom} lang={lang} />
        <ApprovalsRow templateId={templateId} initial={settings.requiredApprovals} lang={lang} />
        <BoolRow
          templateId={templateId}
          k="blockOnUnresolved"
          initial={settings.blockOnUnresolved}
          icon={<MessagesSquare size={16} className="text-muted" />}
          label={t('prSetUnresolved', lang)}
          hint={t('prSetUnresolvedHint', lang)}
        />
        <BoolRow
          templateId={templateId}
          k="blockOnFailedChecks"
          initial={settings.blockOnFailedChecks}
          icon={<ShieldCheck size={16} className="text-muted" />}
          label={t('prSetChecks', lang)}
          hint={t('prSetChecksHint', lang)}
        />
        <MethodRow templateId={templateId} initial={settings.mergeMethod} lang={lang} />
        <BoolRow
          templateId={templateId}
          k="linearOnly"
          initial={settings.linearOnly}
          icon={<GitMerge size={16} className="text-muted" />}
          label={t('prSetLinear', lang)}
          hint={t('prSetLinearHint', lang)}
        />
        <BoolRow
          templateId={templateId}
          k="allowMaintainerEdits"
          initial={settings.allowMaintainerEdits}
          icon={<Pencil size={16} className="text-muted" />}
          label={t('prSetMaintainerEdits', lang)}
          hint={t('prSetMaintainerEditsHint', lang)}
        />
        <BoolRow
          templateId={templateId}
          k="autoCloseIssues"
          initial={settings.autoCloseIssues}
          icon={<CircleCheck size={16} className="text-muted" />}
          label={t('prSetAutoClose', lang)}
          hint={t('prSetAutoCloseHint', lang)}
        />
        <BoolRow
          templateId={templateId}
          k="autoDeleteBranch"
          initial={settings.autoDeleteBranch}
          icon={<Trash2 size={16} className="text-muted" />}
          label={t('prSetAutoDelete', lang)}
          hint={t('prSetAutoDeleteHint', lang)}
        />
      </div>
    </SettingsSection>
  )
}

function BoolRow({
  templateId,
  k,
  initial,
  icon,
  label,
  hint,
}: {
  templateId: string
  k: PrBoolKey
  initial: boolean
  icon: React.ReactNode
  label: string
  hint: string
}) {
  const [on, setOn] = useState(initial)
  const [, start] = useTransition()
  return (
    <div className={row}>
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5">{icon}</span>
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-ink">{label}</div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{hint}</p>
        </div>
      </div>
      <Switch
        checked={on}
        onCheckedChange={(v) => {
          setOn(v)
          start(() => void setPrSetting(templateId, k, v))
        }}
      />
    </div>
  )
}

/** Кто может предлагать — аналог «Creation allowed by» у GitHub. */
function WhoRow({ templateId, initial, lang }: { templateId: string; initial: 'all' | 'collaborators'; lang: Lang }) {
  const [val, setVal] = useState(initial)
  const [, start] = useTransition()
  return (
    <div className={row}>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink">{t('prSetWho', lang)}</div>
        <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{t('prSetWhoHint', lang)}</p>
      </div>
      <Select
        value={val}
        onValueChange={(v) => {
          const next = v as 'all' | 'collaborators'
          setVal(next)
          start(() => void setPrAllowFrom(templateId, next))
        }}
      >
        <SelectTrigger className="h-[38px] w-auto shrink-0 text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('prSetWhoAll', lang)}</SelectItem>
          <SelectItem value="collaborators">{t('prSetWhoCollab', lang)}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

/** Способ слияния — аналог «Allow merge commits / Allow squash merging» у GitHub. */
function MethodRow({ templateId, initial, lang }: { templateId: string; initial: 'merge' | 'squash'; lang: Lang }) {
  const [val, setVal] = useState(initial)
  const [, start] = useTransition()
  return (
    <div className={row}>
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5">
          <GitMerge size={16} className="text-muted" />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-ink">{t('prSetMethod', lang)}</div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{t('prSetMethodHint', lang)}</p>
        </div>
      </div>
      <Select
        value={val}
        onValueChange={(v) => {
          const next = v as 'merge' | 'squash'
          setVal(next)
          start(() => void setPrMergeMethod(templateId, next))
        }}
      >
        <SelectTrigger className="h-[38px] w-auto shrink-0 text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="merge">{t('prSetMethodMerge', lang)}</SelectItem>
          <SelectItem value="squash">{t('prSetMethodSquash', lang)}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

/** Сколько одобрений нужно (0 = не требуются) — аналог required approvals. */
function ApprovalsRow({ templateId, initial, lang }: { templateId: string; initial: number; lang: Lang }) {
  const [val, setVal] = useState(initial)
  const [, start] = useTransition()
  return (
    <div className={row}>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink">{t('prSetApprovals', lang)}</div>
        <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{t('prSetApprovalsHint', lang)}</p>
      </div>
      <Select
        value={String(val)}
        onValueChange={(v) => {
          const n = Number(v)
          setVal(n)
          start(() => void setPrNumber(templateId, 'requiredApprovals', n))
        }}
      >
        <SelectTrigger className="h-[38px] w-auto shrink-0 text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[0, 1, 2, 3].map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n === 0 ? t('prSetApprovalsNone', lang) : String(n)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
