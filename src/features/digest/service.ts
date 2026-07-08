import 'server-only'
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { db, digests, jobs, users } from '@/shared/db'
import { enqueueJob } from '@/shared/jobs/queue'
import { sendMail } from '@/shared/email/mailer'
import { appOrigin } from '@/shared/auth/app-origin'
import { escapeHtml as esc } from '@/shared/lib/escape'
import { log } from '@/shared/observability'
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
    .where(and(eq(jobs.type, 'digest'), inArray(jobs.status, ['pending', 'processing'])))
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
  const recipients = await db
    .select({ id: users.id, handle: users.handle, email: users.email })
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
      subject: digestSubject(digest),
      html: renderDigestEmail(r.handle, digest),
    })
    if (!ok) continue // SMTP не настроен/сбой — не двигаем точку отсчёта
    await db.insert(digests).values({ userId: r.id, items })
    sent++
  }
  log.info('digest sweep done', { recipients: recipients.length, sent, empty })
  return { sent, empty }
}

function digestSubject(d: Digest): string {
  if (d.starred.length) {
    const n = d.starred.length
    return `${n} of your saved ${n === 1 ? 'list' : 'lists'} got better while you were away`
  }
  if (d.ownLists.length) return 'Your lists got attention this week'
  return 'Your forks have upstream updates'
}


function renderDigestEmail(recipientHandle: string, d: Digest): string {
  const origin = appOrigin()
  const link = (owner: string, slug: string) =>
    `<a href="${esc(`${origin}/${owner}/${slug}`)}" style="color:#2159d6;text-decoration:none;font-weight:600">${esc(`${owner}/${slug}`)}</a>`

  const section = (title: string, rows: string[]): string =>
    rows.length
      ? `<p style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b6b66;margin:18px 0 6px">${esc(title)}</p>
         <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7">${rows.join('')}</ul>`
      : ''

  const starred = d.starred.map((i) => {
    const by = i.improvedBy.length ? ` — improved by ${esc(i.improvedBy.join(', '))}` : ''
    return `<li>${link(i.owner, i.slug)}: +${i.newVersions} ${i.newVersions === 1 ? 'version' : 'versions'}${by}</li>`
  })
  const upstream = d.upstream.map(
    (i) => `<li>${link(i.owner, i.slug)}: +${i.newVersions} upstream ${i.newVersions === 1 ? 'version' : 'versions'} since your fork</li>`,
  )
  const own = d.ownLists.map((i) => {
    const open = i.open ? ` — <b>${i.open} awaiting your review</b>` : ''
    const total = i.accepted + i.open
    return `<li>${link(recipientHandle, i.slug)}: ${total} ${total === 1 ? 'edit' : 'edits'} from ${esc(i.authors.join(', '))}${open}</li>`
  })

  return `<!doctype html><html><body style="margin:0;background:#f4f4f1;font-family:Helvetica,Arial,sans-serif;color:#1c1c1a">
  <div style="max-width:520px;margin:0 auto;padding:24px">
    <div style="font-weight:800;font-size:20px;letter-spacing:-.02em">S<span style="color:#2159d6">F</span></div>
    <div style="background:#fff;border:1px solid #e7e6e0;border-radius:12px;padding:20px;margin-top:14px">
      ${section('Your saves got better', starred)}
      ${section('Upstream moved ahead of your fork', upstream)}
      ${section('Attention on your lists', own)}
    </div>
    <p style="color:#a3a39c;font-size:12px;margin-top:16px">Weekly digest · manage emails in Settings → Notifications</p>
  </div></body></html>`
}
