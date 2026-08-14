'use client'

import { useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Switch } from '@/shared/ui/switch'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { Field } from '@/shared/ui/Field'
import { FormSaveBar } from '@/shared/ui/FormSaveBar'
import { t, type Lang } from '@/shared/i18n'
import type { AffiliateRule } from '@/core'
import { setMonetizationSettings } from './actions'
import { buttonClass } from '@/shared/ui/button-style'

export interface MonetizationFormValues {
  viewTracking: boolean
  linkTracking: boolean
  affiliateEnabled: boolean
  affiliateRules: AffiliateRule[]
  disclosureEnabled: boolean
  disclosureText: string
  adMarkingEnabled: boolean
  adMarkingText: string
  donateUrl: string
}

// Строка правила с клиентским id: стабильный key для добавляемых/удаляемых
// строк (index-as-key ломал бы фокус при удалении из середины). Начальные id
// детерминированы (r<i>) — SSR и клиент сходятся; новые — из счётчика.
type RuleRow = AffiliateRule & { rowId: string }

function ToggleRow({ name, title, hint, defaultChecked }: { name: string; title: string; hint: string; defaultChecked: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-[0.875rem] font-medium text-ink">{title}</div>
        <p className="text-[0.78125rem] text-muted">{hint}</p>
      </div>
      <Switch name={name} defaultChecked={defaultChecked} />
    </div>
  )
}

export function MonetizationSettingsForm({ lang, v }: { lang: Lang; v: MonetizationFormValues }) {
  // Черновик формы: state сознательно инициализируется из пропсов — после
  // сохранения revalidatePath приносит новые значения, а незакоммиченный
  // черновик правок терять нельзя (это форма, а не зеркало сервера).
  const [rules, setRules] = useState<RuleRow[]>(() => v.affiliateRules.map((r, i) => ({ ...r, rowId: `r${i}` })))
  const [affiliateOn, setAffiliateOn] = useState(v.affiliateEnabled)
  const nextRow = useRef(0)

  const patch = (rowId: string, p: Partial<AffiliateRule>) => setRules((xs) => xs.map((r) => (r.rowId === rowId ? { ...r, ...p } : r)))
  // Пустые строки не сериализуем — parseAffiliateRules на сервере всё равно их отбросит.
  const serialized = JSON.stringify(
    rules.filter((r) => r.match.trim() && r.param.trim() && r.value.trim()).map(({ rowId: _rowId, ...r }) => r),
  )

  return (
    <form action={setMonetizationSettings} className="flex flex-col gap-5">
      <input type="hidden" name="affiliateRules" value={serialized} />

      <div className="text-[0.78125rem] font-semibold text-ink">{t('monTrafficTitle', lang)}</div>
      <ToggleRow name="viewTracking" title={t('monViewsTitle', lang)} hint={t('monViewsHint', lang)} defaultChecked={v.viewTracking} />
      <ToggleRow name="linkTracking" title={t('monClicksTitle', lang)} hint={t('monClicksHint', lang)} defaultChecked={v.linkTracking} />

      <div className="border-t border-border pt-4 text-[0.78125rem] font-semibold text-ink">{t('monAffiliateTitle', lang)}</div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[0.875rem] font-medium text-ink">{t('monAffiliateApply', lang)}</div>
          <p className="text-[0.78125rem] text-muted">{t('monAffiliateApplyHint', lang)}</p>
        </div>
        {/* Uncontrolled (defaultChecked): у контролируемого Radix-Switch скрытый
            checkbox рассинхронизируется после RSC-refresh и молча теряет 'on'
            при следующем submit. affiliateOn — только для подсветки правил. */}
        <Switch name="affiliateEnabled" defaultChecked={v.affiliateEnabled} onCheckedChange={setAffiliateOn} />
      </div>

      <Field
        label={t('monRulesLabel', lang)}
        hint={t('monRulesHint', lang)}
        htmlFor="mon-rule-domain"
        className={affiliateOn ? '' : 'pointer-events-none opacity-50'}
      >
        <div className="flex flex-col gap-3">
          {rules.map((r, i) => (
            <div key={r.rowId} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id={i === 0 ? 'mon-rule-domain' : undefined}
                  value={r.match}
                  onChange={(e) => patch(r.rowId, { match: e.target.value })}
                  placeholder="amazon.com"
                  className="min-w-[8.75rem] flex-1 font-mono"
                  aria-label={t('monRuleDomain', lang)}
                />
                <Input
                  value={r.param}
                  onChange={(e) => patch(r.rowId, { param: e.target.value })}
                  placeholder="tag"
                  className="max-w-[7.5rem] font-mono"
                  aria-label={t('monRuleParam', lang)}
                />
                <Input
                  value={r.value}
                  onChange={(e) => patch(r.rowId, { value: e.target.value })}
                  placeholder="setfork-20"
                  className="max-w-[10rem] font-mono"
                  aria-label={t('monRuleValue', lang)}
                />
                {/* erid (РФ-маркировка) — опционально; задан → ссылки этого домена
                    помечаются рекламой и несут токен в /api/go. */}
                <Input
                  value={r.erid ?? ''}
                  onChange={(e) => patch(r.rowId, { erid: e.target.value })}
                  placeholder="erid"
                  className="max-w-[9.375rem] font-mono"
                  aria-label={t('monRuleErid', lang)}
                />
                <button
                  type="button"
                  onClick={() => setRules((xs) => xs.filter((x) => x.rowId !== r.rowId))}
                  className={buttonClass({ variant: 'danger', className: 'size-8 shrink-0 p-0' })}
                  aria-label={t('monRuleRemove', lang)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {/* Идентификация рекламодателя (ч. 16 ст. 18.1) — нужна только для
                  помеченных рекламой ссылок, поэтому показываем при заданном erid. */}
              {r.erid?.trim() && (
                <div className="flex flex-wrap items-center gap-2 pl-3">
                  <span className="text-[0.6875rem] text-muted">↳</span>
                  <Input
                    value={r.advertiser ?? ''}
                    onChange={(e) => patch(r.rowId, { advertiser: e.target.value })}
                    placeholder={t('monRuleAdvertiser', lang)}
                    className="min-w-[11.25rem] flex-1"
                    aria-label={t('monRuleAdvertiser', lang)}
                  />
                  <Input
                    value={r.advertiserInn ?? ''}
                    onChange={(e) => patch(r.rowId, { advertiserInn: e.target.value })}
                    placeholder={t('monRuleInn', lang)}
                    inputMode="numeric"
                    className="max-w-[10rem] font-mono"
                    aria-label={t('monRuleInn', lang)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setRules((xs) => [...xs, { match: '', param: '', value: '', rowId: `n${++nextRow.current}` }])}
          className={buttonClass({ className: 'mt-2' })}
        >
          <Plus size={13} /> {t('monRuleAdd', lang)}
        </button>
      </Field>

      <ToggleRow name="disclosureEnabled" title={t('monDisclosureTitle', lang)} hint={t('monDisclosureHint', lang)} defaultChecked={v.disclosureEnabled} />
      <Field label={t('monDisclosureText', lang)}>
        <Textarea name="disclosureText" defaultValue={v.disclosureText} rows={2} />
      </Field>

      <div className="border-t border-border pt-4 text-[0.78125rem] font-semibold text-ink">{t('monAdMarkingTitle', lang)}</div>
      <ToggleRow name="adMarkingEnabled" title={t('monAdMarkingApply', lang)} hint={t('monAdMarkingHint', lang)} defaultChecked={v.adMarkingEnabled} />
      <Field label={t('monAdMarkingText', lang)} hint={t('monAdMarkingTextHint', lang)}>
        <Input name="adMarkingText" defaultValue={v.adMarkingText} placeholder="Реклама" />
      </Field>

      <div className="border-t border-border pt-4 text-[0.78125rem] font-semibold text-ink">{t('monSupportTitle', lang)}</div>
      <Field label={t('monDonateLabel', lang)} hint={t('monDonateHint', lang)}>
        <Input name="donateUrl" defaultValue={v.donateUrl} placeholder="https://…" className="font-mono" />
      </Field>

      <FormSaveBar lang={lang} />
    </form>
  )
}
