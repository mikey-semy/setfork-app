'use client'

import { DatePicker } from '@/shared/ui/DatePicker'
import { TEXT } from '@/shared/ui/control'
import { t, type Lang } from '@/shared/i18n'
import { newOptionId } from '../blocks'
import type { EditorPoll } from '../editor'
import { AddLink, CheckLabel, FieldRow, LineField, RemoveBtn } from './block-fields'

/** Poll-блок: вопрос, варианты, мультивыбор и дедлайн. Голоса считает страница списка. */
export function PollBlockBody({ poll, onChange, lang }: { poll: EditorPoll; onChange: (p: EditorPoll) => void; lang: Lang }) {
  const set = (p: Partial<EditorPoll>) => onChange({ ...poll, ...p })
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
      <LineField value={poll.question} onChange={(question) => set({ question })} lang={lang} className="" label={t('poll.questionPh', lang)} />
      <div className="flex flex-col gap-1.5">
        {poll.options.map((o, oi) => (
          <div key={o.id} className="flex items-center gap-2">
            <span className={`w-4 text-right ${TEXT.caption} text-muted`}>{oi + 1}</span>
            <LineField
              value={o.text}
              onChange={(v) => set({ options: poll.options.map((x, xi) => (xi === oi ? { ...x, text: v } : x)) })}
              lang={lang}
              label={t('editor.optionN', lang).replace('{n}', String(oi + 1))}
            />
            {/* Меньше двух вариантов — уже не опрос. */}
            <RemoveBtn
              onClick={() => set({ options: poll.options.filter((_, xi) => xi !== oi) })}
              disabled={poll.options.length <= 2}
              label={t('editor.removeOption', lang)}
            />
          </div>
        ))}
      </div>
      <FieldRow>
        <AddLink onClick={() => set({ options: [...poll.options, { id: newOptionId(), text: '' }] })}>{t('editor.addOption', lang)}</AddLink>
        <CheckLabel checked={poll.multi} onChange={(multi) => set({ multi })}>
          {t('poll.multi', lang)}
        </CheckLabel>
        <span className="inline-flex items-center gap-1.5 text-ink-2">
          {t('poll.deadline', lang)}:
          <DatePicker value={poll.deadline} onChange={(v) => set({ deadline: v })} lang={lang} />
        </span>
      </FieldRow>
    </div>
  )
}
