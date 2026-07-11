'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Switch } from '@/shared/ui/switch'
import { t, type Lang } from '@/shared/i18n'
import type { AffiliateRule } from '@/core'
import { setMonetizationSettings } from './actions'

const field = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] text-ink outline-hidden focus:border-border-strong'
const lbl = 'mb-1.5 block text-[12.5px] font-semibold text-ink-2'

export interface MonetizationFormValues {
  viewTracking: boolean
  linkTracking: boolean
  affiliateEnabled: boolean
  affiliateRules: AffiliateRule[]
  disclosureEnabled: boolean
  disclosureText: string
  donateUrl: string
}

function ToggleRow({ name, title, hint, defaultChecked }: { name: string; title: string; hint: string; defaultChecked: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-[14px] font-medium text-ink">{title}</div>
        <p className="text-[12px] text-muted">{hint}</p>
      </div>
      <Switch name={name} defaultChecked={defaultChecked} />
    </div>
  )
}

export function MonetizationSettingsForm({ lang, v }: { lang: Lang; v: MonetizationFormValues }) {
  const [rules, setRules] = useState<AffiliateRule[]>(v.affiliateRules)
  const [affiliateOn, setAffiliateOn] = useState(v.affiliateEnabled)

  const patch = (i: number, p: Partial<AffiliateRule>) => setRules((xs) => xs.map((r, idx) => (idx === i ? { ...r, ...p } : r)))
  // Пустые строки не сериализуем — parseAffiliateRules на сервере всё равно их отбросит.
  const serialized = JSON.stringify(rules.filter((r) => r.match.trim() && r.param.trim() && r.value.trim()))

  return (
    <form action={setMonetizationSettings} className="flex flex-col gap-5">
      <input type="hidden" name="affiliateRules" value={serialized} />

      <div className="text-[12.5px] font-semibold text-ink">{t('monTrafficTitle', lang)}</div>
      <ToggleRow name="viewTracking" title={t('monViewsTitle', lang)} hint={t('monViewsHint', lang)} defaultChecked={v.viewTracking} />
      <ToggleRow name="linkTracking" title={t('monClicksTitle', lang)} hint={t('monClicksHint', lang)} defaultChecked={v.linkTracking} />

      <div className="border-t border-border pt-4 text-[12.5px] font-semibold text-ink">{t('monAffiliateTitle', lang)}</div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[14px] font-medium text-ink">{t('monAffiliateApply', lang)}</div>
          <p className="text-[12px] text-muted">{t('monAffiliateApplyHint', lang)}</p>
        </div>
        {/* Uncontrolled (defaultChecked): у контролируемого Radix-Switch скрытый
            checkbox рассинхронизируется после RSC-refresh и молча теряет 'on'
            при следующем submit. affiliateOn — только для подсветки правил. */}
        <Switch name="affiliateEnabled" defaultChecked={v.affiliateEnabled} onCheckedChange={setAffiliateOn} />
      </div>

      <div className={affiliateOn ? '' : 'pointer-events-none opacity-50'}>
        <label className={lbl}>{t('monRulesLabel', lang)}</label>
        <div className="flex flex-col gap-2">
          {rules.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={r.match}
                onChange={(e) => patch(i, { match: e.target.value })}
                placeholder="amazon.com"
                className={`${field} font-mono`}
                aria-label={t('monRuleDomain', lang)}
              />
              <input
                value={r.param}
                onChange={(e) => patch(i, { param: e.target.value })}
                placeholder="tag"
                className={`${field} max-w-[140px] font-mono`}
                aria-label={t('monRuleParam', lang)}
              />
              <input
                value={r.value}
                onChange={(e) => patch(i, { value: e.target.value })}
                placeholder="setfork-20"
                className={`${field} max-w-[180px] font-mono`}
                aria-label={t('monRuleValue', lang)}
              />
              <button
                type="button"
                onClick={() => setRules((xs) => xs.filter((_, idx) => idx !== i))}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:text-danger"
                aria-label={t('monRuleRemove', lang)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setRules((xs) => [...xs, { match: '', param: '', value: '' }])}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink hover:border-border-strong"
        >
          <Plus size={13} /> {t('monRuleAdd', lang)}
        </button>
        <p className="mt-1.5 text-[12px] text-muted">{t('monRulesHint', lang)}</p>
      </div>

      <ToggleRow name="disclosureEnabled" title={t('monDisclosureTitle', lang)} hint={t('monDisclosureHint', lang)} defaultChecked={v.disclosureEnabled} />
      <div>
        <label className={lbl}>{t('monDisclosureText', lang)}</label>
        <textarea name="disclosureText" defaultValue={v.disclosureText} rows={2} className={field} />
      </div>

      <div className="border-t border-border pt-4 text-[12.5px] font-semibold text-ink">{t('monSupportTitle', lang)}</div>
      <div>
        <label className={lbl}>{t('monDonateLabel', lang)}</label>
        <input name="donateUrl" defaultValue={v.donateUrl} placeholder="https://…" className={`${field} font-mono`} />
        <p className="mt-1 text-[12px] text-muted">{t('monDonateHint', lang)}</p>
      </div>

      <div className="flex justify-end border-t border-border pt-4">
        <button className="rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-fg">{t('monSave', lang)}</button>
      </div>
    </form>
  )
}
