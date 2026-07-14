'use client'

import { useRef, useState } from 'react'
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
        <div className="text-[14px] font-medium text-ink">{title}</div>
        <p className="text-[12px] text-muted">{hint}</p>
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
        <div className={lbl}>{t('monRulesLabel', lang)}</div>
        <div className="flex flex-col gap-2">
          {rules.map((r) => (
            <div key={r.rowId} className="flex flex-wrap items-center gap-2">
              <input
                value={r.match}
                onChange={(e) => patch(r.rowId, { match: e.target.value })}
                placeholder="amazon.com"
                className={`${field} min-w-[140px] flex-1 font-mono`}
                aria-label={t('monRuleDomain', lang)}
              />
              <input
                value={r.param}
                onChange={(e) => patch(r.rowId, { param: e.target.value })}
                placeholder="tag"
                className={`${field} max-w-[120px] font-mono`}
                aria-label={t('monRuleParam', lang)}
              />
              <input
                value={r.value}
                onChange={(e) => patch(r.rowId, { value: e.target.value })}
                placeholder="setfork-20"
                className={`${field} max-w-[160px] font-mono`}
                aria-label={t('monRuleValue', lang)}
              />
              {/* erid (РФ-маркировка) — опционально; задан → ссылки этого домена
                  помечаются рекламой и несут токен в /api/go. */}
              <input
                value={r.erid ?? ''}
                onChange={(e) => patch(r.rowId, { erid: e.target.value })}
                placeholder="erid"
                className={`${field} max-w-[150px] font-mono`}
                aria-label={t('monRuleErid', lang)}
              />
              <button
                type="button"
                onClick={() => setRules((xs) => xs.filter((x) => x.rowId !== r.rowId))}
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
          onClick={() => setRules((xs) => [...xs, { match: '', param: '', value: '', rowId: `n${++nextRow.current}` }])}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink hover:border-border-strong"
        >
          <Plus size={13} /> {t('monRuleAdd', lang)}
        </button>
        <p className="mt-1.5 text-[12px] text-muted">{t('monRulesHint', lang)}</p>
      </div>

      <ToggleRow name="disclosureEnabled" title={t('monDisclosureTitle', lang)} hint={t('monDisclosureHint', lang)} defaultChecked={v.disclosureEnabled} />
      <div>
        <label htmlFor="mon-disclosure-text" className={lbl}>
          {t('monDisclosureText', lang)}
        </label>
        <textarea id="mon-disclosure-text" name="disclosureText" defaultValue={v.disclosureText} rows={2} className={field} />
      </div>

      <div className="border-t border-border pt-4 text-[12.5px] font-semibold text-ink">{t('monAdMarkingTitle', lang)}</div>
      <ToggleRow name="adMarkingEnabled" title={t('monAdMarkingApply', lang)} hint={t('monAdMarkingHint', lang)} defaultChecked={v.adMarkingEnabled} />
      <div>
        <label htmlFor="mon-ad-marking-text" className={lbl}>
          {t('monAdMarkingText', lang)}
        </label>
        <input id="mon-ad-marking-text" name="adMarkingText" defaultValue={v.adMarkingText} placeholder="Реклама" className={field} />
        <p className="mt-1 text-[12px] text-muted">{t('monAdMarkingTextHint', lang)}</p>
      </div>

      <div className="border-t border-border pt-4 text-[12.5px] font-semibold text-ink">{t('monSupportTitle', lang)}</div>
      <div>
        <label htmlFor="mon-donate-url" className={lbl}>
          {t('monDonateLabel', lang)}
        </label>
        <input id="mon-donate-url" name="donateUrl" defaultValue={v.donateUrl} placeholder="https://…" className={`${field} font-mono`} />
        <p className="mt-1 text-[12px] text-muted">{t('monDonateHint', lang)}</p>
      </div>

      <div className="flex justify-end border-t border-border pt-4">
        <button type="submit" className="rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-fg">
          {t('monSave', lang)}
        </button>
      </div>
    </form>
  )
}
