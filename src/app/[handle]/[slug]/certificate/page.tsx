import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Award } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { requireViewableMeta } from '@/features/library/guard'
import { getCourseCompletion } from '@/features/quizzes/queries'
import { CertificatePrintButton } from '@/features/quizzes/CertificatePrintButton'
import { PAGE_NARROW } from '@/shared/ui/control'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle, slug }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('courseCertificate', lang)} · ${handle}/${slug}` }
}

export default async function CertificatePage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle: owner, slug }, lang, session] = await Promise.all([params, getLang(), getSession()])
  const ru = lang === 'ru'
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()

  const base = `/${owner}/${slug}`
  const completion = await getCourseCompletion(meta.id, session?.userId)
  const title = tr(meta.title, lang)
  const issuer = meta.ownerName ?? meta.ownerHandle
  const learner = session?.name ?? session?.handle ?? ''

  return (
    <>
      <div className={PAGE_NARROW}>
        {!session ? (
          <p className="text-[0.875rem] text-ink-2">
            {ru ? 'Войдите, чтобы увидеть свой сертификат.' : 'Log in to see your certificate.'}{' '}
            <Link href={`/login?next=${encodeURIComponent(`${base}/certificate`)}`} className="text-accent hover:underline">
              {ru ? 'Войти' : 'Log in'}
            </Link>
          </p>
        ) : !completion ? (
          <div className="rounded-lg border border-border bg-surface p-6 text-center">
            <p className="text-[0.875rem] text-ink-2">{ru ? 'Вы ещё не завершили этот курс.' : 'You have not completed this course yet.'}</p>
            <Link href={base} className="mt-3 inline-block text-[0.8125rem] text-accent hover:underline">
              {ru ? '← К курсу' : '← Back to the course'}
            </Link>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            {/* Сам сертификат — печатается; рамка decorative */}
            <div className="w-full overflow-hidden rounded-xl border-2 border-ok/50 bg-surface p-8 text-center shadow-card sm:p-12">
              <div className="mx-auto flex flex-col items-center gap-1 border-b border-border pb-6">
                <Award size={40} className="text-ok" />
                <div className="mt-2 font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted">
                  {ru ? 'Сертификат о прохождении' : 'Certificate of Completion'}
                </div>
              </div>
              <p className="mt-6 text-[0.8125rem] text-muted">{ru ? 'Настоящим подтверждается, что' : 'This certifies that'}</p>
              <p className="mt-1 text-[1.625rem] font-bold tracking-tight text-ink">{learner}</p>
              <p className="mt-4 text-[0.8125rem] text-muted">{ru ? 'успешно прошёл курс' : 'has successfully completed'}</p>
              <p className="mt-1 text-[1.25rem] font-semibold text-ink">{title}</p>
              <div className="mt-8 flex items-center justify-center gap-8 text-[0.78125rem] text-ink-2">
                <div className="flex flex-col">
                  <span className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted">{ru ? 'Дата' : 'Date'}</span>
                  <span className="mt-0.5 font-medium text-ink">{completion.completedAt.toLocaleDateString(ru ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted">{ru ? 'Версия' : 'Version'}</span>
                  <span className="mt-0.5 font-medium text-ink">v{completion.version}</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted">{ru ? 'Автор курса' : 'Issued by'}</span>
                  <span className="mt-0.5 font-medium text-ink">{issuer}</span>
                </div>
              </div>
              <div className="mt-8 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted">SetFork · setfork.com/{owner}/{slug}</div>
            </div>
            <div className="flex items-center gap-3 print:hidden">
              <CertificatePrintButton label={ru ? 'Печать / PDF' : 'Print / PDF'} />
              <Link href={base} className="text-[0.8125rem] text-accent hover:underline">
                {ru ? '← К курсу' : '← Back to the course'}
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
