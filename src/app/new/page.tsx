import { redirect } from 'next/navigation'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { getTopics } from '@/features/library/queries'
import { createTemplate } from '@/features/library/actions'

export default async function NewListPage() {
  const [lang, session] = await Promise.all([getLang(), getSession()])
  if (!session) redirect('/login')
  const topics = await getTopics()
  const ru = lang === 'ru'

  return (
    <div className="mx-auto w-full max-w-[680px] px-6 py-8">
        <form action={createTemplate}>
          <h1 className="mb-6 text-[18px] font-bold text-ink">{t('newList', lang)}</h1>

          <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">
            {ru ? 'Название' : 'Title'}
          </label>
          <input
            name="title"
            required
            placeholder={ru ? 'напр. Деплой на VPS' : 'e.g. Deploy to a VPS'}
            className="mb-5 w-full rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[14px] text-ink outline-none"
          />

          <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">
            {ru ? 'Описание' : 'Description'}
          </label>
          <input
            name="desc"
            placeholder={ru ? 'Коротко, о чём список' : 'One line about the list'}
            className="mb-5 w-full rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[14px] text-ink outline-none"
          />

          <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">{t('topics', lang)}</label>
          <select
            name="topic"
            className="mb-5 w-full rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[14px] text-ink outline-none"
          >
            <option value="">—</option>
            {topics.map((tp) => (
              <option key={tp.slug} value={tp.slug}>
                {tr(tp.label, lang)}
              </option>
            ))}
          </select>

          <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">
            {ru ? 'Шаги (по одному на строку)' : 'Steps (one per line)'}
          </label>
          <textarea
            name="steps"
            rows={8}
            placeholder={ru ? 'Стянуть свежий main\nПрогнать тесты\nСобрать образ…' : 'Pull the latest main\nRun the test suite\nBuild the image…'}
            className="mb-6 w-full rounded-md border border-border bg-surface-2 px-3 py-2.5 font-mono text-[13px] text-ink outline-none"
          />

          <button className="rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-fg">
            {ru ? 'Создать список' : 'Create list'}
          </button>
        </form>
    </div>
  )
}
