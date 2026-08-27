import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Award } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { requireViewableMeta } from '@/features/library/guard'
import { completionHolderMeta, getCourseCompletion } from '@/features/quizzes/queries'
import { CertificatePrintButton } from '@/features/quizzes/CertificatePrintButton'
import { PAGE_NARROW } from '@/shared/ui/control'
import { SITE_HOST } from '@/shared/site'
import { cardClass } from '@/shared/ui/card-style'
import { SectionLabel } from '@/shared/ui/SectionLabel'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle, slug }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('courseCertificate', lang)} · ${handle}/${slug}` }
}

export default async function CertificatePage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle: owner, slug }, lang, session] = await Promise.all([params, getLang(), getSession()])
  const ru = lang === 'ru'
  // Сертификат — документ ЧЕЛОВЕКА, а не часть чужого списка: он не должен исчезать,
  // когда курс закрыли или сняли модерацией. Поэтому недоступность курса сама по себе
  // ещё не 404 — сначала смотрим, есть ли у зрителя запись о прохождении.
  const meta = await requireViewableMeta(owner, slug)
  const holder = meta ?? (await completionHolderMeta(owner, slug, session?.userId))
  if (!holder) notFound()

  const base = `/${owner}/${slug}`
  const completion = await getCourseCompletion(holder.id, session?.userId)
  // Факты берём из СНИМКА на момент выдачи. Пересобирать документ о прошлом из текущих
  // данных нельзя: после переименования курса, смены имени в профиле или передачи
  // владения он начинал утверждать другое.
  const restored = !!completion && !completion.courseTitle
  const title = completion?.courseTitle ? tr(completion.courseTitle, lang) : tr(holder.title, lang)
  const issuer = completion?.issuerName ?? completion?.issuerHandle ?? holder.ownerName ?? holder.ownerHandle
  const learner = completion?.learnerName ?? completion?.learnerHandle ?? session?.name ?? session?.handle ?? ''

  return (
    <>
      <div className={PAGE_NARROW}>
        {!session ? (
          <p className="text-body-lg text-ink-2">
            {t('certLoginPrompt', lang)}{' '}
            <Link href={`/login?next=${encodeURIComponent(`${base}/certificate`)}`} className="text-accent hover:underline">
              {t('certLogin', lang)}
            </Link>
          </p>
        ) : !completion ? (
          <div className={cardClass({ pad: 'lg', className: 'text-center' })}>
            <p className="text-body-lg text-ink-2">{t('certNotCompleted', lang)}</p>
            <Link href={base} className="mt-3 inline-block text-body text-accent hover:underline">
              {t('certBackToCourse', lang)}
            </Link>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            {/* Сам сертификат — печатается; рамка decorative */}
            {/* eslint-disable-next-line no-restricted-syntax -- герой-сертификат: печатная форма со своей рамкой (border-2) и радиусом */}
            <div className="w-full overflow-hidden rounded-xl border-2 border-ok/50 bg-surface p-8 text-center shadow-card sm:p-12">
              <div className="mx-auto flex flex-col items-center gap-1 border-b border-border pb-6">
                <Award size={40} className="text-ok" />
                <SectionLabel className="mt-2 font-mono tracking-display">
                  {t('certHeading', lang)}
                </SectionLabel>
              </div>
              <p className="mt-6 text-body text-muted">{t('certThisCertifies', lang)}</p>
              <p className="mt-1 text-display-lg font-bold tracking-tight text-ink">{learner}</p>
              <p className="mt-4 text-body text-muted">{t('certHasCompleted', lang)}</p>
              <p className="mt-1 text-heading font-semibold text-ink">{title}</p>
              <div className="mt-8 flex items-center justify-center gap-8 text-body-sm text-ink-2">
                <div className="flex flex-col">
                  <SectionLabel as="span" className="font-mono tracking-display">{t('certDate', lang)}</SectionLabel>
                  <span className="mt-0.5 font-medium text-ink">{completion.completedAt.toLocaleDateString(ru ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </div>
                <div className="flex flex-col">
                  <SectionLabel as="span" className="font-mono tracking-display">{t('certVersion', lang)}</SectionLabel>
                  <span className="mt-0.5 font-medium text-ink">v{completion.version}</span>
                </div>
                <div className="flex flex-col">
                  <SectionLabel as="span" className="font-mono tracking-display">{t('certIssuedBy', lang)}</SectionLabel>
                  <span className="mt-0.5 font-medium text-ink">{issuer}</span>
                </div>
              </div>
              {/* Документ, выданный до появления снимка: факты взяты из текущих данных,
                  и честнее это назвать, чем выдавать их за зафиксированные тогда. */}
              {restored && (
                <div className="mt-4 text-caption text-muted print:hidden">
                  {t('certRestoredNote', lang)}
                </div>
              )}
              <SectionLabel className="mt-8 font-mono tracking-display">SetFork · {SITE_HOST}/{owner}/{slug}</SectionLabel>
            </div>
            <div className="flex items-center gap-3 print:hidden">
              <CertificatePrintButton label={t('certPrintPdf', lang)} />
              <Link href={base} className="text-body text-accent hover:underline">
                {t('certBackToCourse', lang)}
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
