import 'server-only'
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { db, digests, jobs, users } from '@/shared/db'
import { enqueueJob } from '@/shared/jobs/queue'
import { sendMail } from '@/shared/email/mailer'
import { appOrigin } from '@/shared/auth/app-origin'
import { escapeHtml as esc } from '@/shared/lib/escape'
import { EMAIL_COLOR } from '@/shared/email/layout'
import { unsubscribeUrl } from '@/shared/email/unsubscribe'
import { fill, plural, t, type Lang } from '@/shared/i18n'
import { log } from '@/shared/observability'
import { loopPolicy, recordAgentAction } from '@/shared/agents/policy'
import { buildDigest, digestSize, type Digest } from './queries'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Гарантирует, что в очереди есть ровно одна будущая digest-джоба.
 * Вызывается на старте воркера и в конце каждого прогона — джоба
 * самоподдерживается без внешнего cron.
 */
export async function ensureDigestScheduled(): Promise<void> {
  const pending = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, 'digest'), eq(jobs.status, 'pending')))
    .limit(1)
  if (pending.length) return
  await enqueueJob('digest', {}, { delayMs: WEEK_MS, maxAttempts: 3 })
  log.info('digest scheduled', { inDays: 7 })
}

/**
 * Недельный проход: собрать и отправить дайджест каждому получателю.
 * Получатели — только с email и явно включённой почтой (notifyPrefs.email);
 * пустой дайджест не отправляется и не двигает точку отсчёта.
 */
export async function runWeeklyDigestSweep(): Promise<{ sent: number; empty: number }> {
  // Сухой прогон — как у остальных петель, и здесь он особенно уместен: петля
  // ОТПРАВЛЯЕТ ПИСЬМА людям. «Посмотреть, что она сделает» без рассылки — ровно то,
  // ради чего сухой прогон и заведён.
  const loop = await loopPolicy('digest')
  if (loop.dryRun) {
    await recordAgentAction({ loop: 'digest', action: 'send', resultStatus: 'dry-run', decision: { mode: 'skip-live-run' }, policyVersion: loop.policyVersion })
    log.info('digest: сухой прогон — письма не отправляем')
    return { sent: 0, empty: 0 }
  }
  const recipients = await db
    .select({ id: users.id, handle: users.handle, email: users.email, lang: users.lang })
    .from(users)
    .where(
      and(
        isNotNull(users.email),
        eq(users.deleted, false),
        sql`(${users.notifyPrefs} ->> 'email')::boolean is true`,
      ),
    )

  let sent = 0
  let empty = 0
  for (const r of recipients) {
    const [last] = await db
      .select({ sentAt: digests.sentAt })
      .from(digests)
      .where(eq(digests.userId, r.id))
      .orderBy(desc(digests.sentAt))
      .limit(1)
    const since = last?.sentAt ?? new Date(Date.now() - WEEK_MS)

    const digest = await buildDigest(r.id, since)
    const items = digestSize(digest)
    if (items === 0) {
      empty++
      continue
    }

    const ok = await sendMail({
      to: r.email!,
      lang: r.lang,
      subject: digestSubject(digest, r.lang),
      body: renderDigestEmail(r.handle, digest, r.lang),
      note: t('emailFooter', r.lang),
      unsubscribeUrl: await unsubscribeUrl(r.id, r.email!),
    })
    if (!ok) continue // SMTP не настроен/сбой — не двигаем точку отсчёта
    await db.insert(digests).values({ userId: r.id, items })
    sent++
  }
  log.info('digest sweep done', { recipients: recipients.length, sent, empty })
  return { sent, empty }
}

function digestSubject(d: Digest, lang: Lang): string {
  if (d.starred.length) {
    const n = d.starred.length
    return fill('digest.subjectStarred', lang, { n, lists: plural(n, 'lists', lang) })
  }
  if (d.ownLists.length) return t('digest.subjectOwn', lang)
  return t('digest.subjectUpstream', lang)
}


function renderDigestEmail(recipientHandle: string, d: Digest, lang: Lang): string {
  const origin = appOrigin()
  const link = (owner: string, slug: string) =>
    `<a href="${esc(`${origin}/${owner}/${slug}`)}" style="color:${EMAIL_COLOR.accent};text-decoration:none;font-weight:600">${esc(`${owner}/${slug}`)}</a>`

  const section = (title: string, rows: string[]): string =>
    rows.length
      ? `<p style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${EMAIL_COLOR.muted};margin:18px 0 6px">${esc(title)}</p>
         <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7">${rows.join('')}</ul>`
      : ''

  const versions = (n: number) => fill('digest.newVersions', lang, { n, versions: plural(n, 'versions', lang) })

  const starred = d.starred.map((i) => {
    const by = i.improvedBy.length ? ` — ${esc(fill('digest.improvedBy', lang, { authors: i.improvedBy.join(', ') }))}` : ''
    return `<li>${link(i.owner, i.slug)}: ${esc(versions(i.newVersions))}${by}</li>`
  })
  const upstream = d.upstream.map((i) => {
    const n = i.newVersions
    return `<li>${link(i.owner, i.slug)}: ${esc(fill('digest.upstreamSince', lang, { n, versions: plural(n, 'versions', lang) }))}</li>`
  })
  const own = d.ownLists.map((i) => {
    const open = i.open ? ` — <b>${esc(fill('digest.awaitingReview', lang, { n: i.open }))}</b>` : ''
    const total = i.accepted + i.open
    const edits = fill('digest.editsFrom', lang, { n: total, edits: plural(total, 'edits', lang), authors: i.authors.join(', ') })
    return `<li>${link(recipientHandle, i.slug)}: ${esc(edits)}${open}</li>`
  })

  // Только СОДЕРЖИМОЕ письма: шапку, подвал сайта и «почему это письмо пришло»
  // добавляет общая обёртка в sendMail.
  return `${section(t('digest.sectionStarred', lang), starred)}
      ${section(t('digest.sectionUpstream', lang), upstream)}
      ${section(t('digest.sectionOwn', lang), own)}`
}
