import { notFound, redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db, templates, users } from '@/shared/db'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { getGeneration } from '@/features/generation/queries'
import { getMessages } from '@/shared/ai/generation-messages'
import { rosterAvatars } from '@/shared/ai/roster'
import { getClarify } from '@/shared/ai/council-clarify'
import { GenerationChat } from '@/features/generation/GenerationChat'
import { gnomeReputation, REP_MIN_GENS } from '@/features/generation/reputation'

export const metadata = { title: 'Draft' }

export default async function GenerationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ v?: string; e?: string }>
}) {
  const [{ id }, sp, session, lang] = await Promise.all([params, searchParams, getSession(), getLang()])
  if (!session) redirect('/login')

  const gen = await getGeneration(id, session.userId)
  if (!gen) notFound()

  // Уже принят → открываем созданный список.
  if (gen.chosenTemplateId) {
    const [row] = await db
      .select({ handle: users.handle, slug: templates.slug })
      .from(templates)
      .innerJoin(users, eq(templates.ownerId, users.id))
      .where(eq(templates.id, gen.chosenTemplateId))
    if (row) redirect(`/${row.handle}/${row.slug}`)
  }

  // Беседа — из БД: переживает уход со страницы, перезапуск и неделю. Статус — колонка, а не
  // догадка по таблице jobs. Уточнения пока отдельным стором.
  const [messages, clarifyQuestions, avatars, rep] = await Promise.all([getMessages(gen.id), getClarify(gen.id), rosterAvatars(), gnomeReputation()])
  // Репутация НАРУЖУ (HQ §6): бейдж «✓ N%» = доля генераций с участием гнома, где список
  // приняли. Меньше REP_MIN_GENS выходов ИЛИ ноль принятых — не показываем: «✓ 0%» читался
  // как «этому гному нельзя верить» и ставил в тупик (фидбек владельца со скрина).
  const repBadges: Record<string, string> = {}
  for (const [who, r] of Object.entries(rep))
    if (r.gens >= REP_MIN_GENS && r.accepted > 0) repBadges[who] = `✓ ${Math.round((r.accepted / r.gens) * 100)}%`

  return (
    <GenerationChat
      generationId={gen.id}
      lang={lang}
      candidates={gen.candidates}
      status={gen.status}
      messages={messages}
      listKind={gen.listKind}
      detail={gen.detail}
      avatars={avatars}
      repBadges={repBadges}
      error={sp.e}
      clarifyQuestions={clarifyQuestions}
    />
  )
}
