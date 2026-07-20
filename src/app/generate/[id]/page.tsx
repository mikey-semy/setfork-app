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
  const [messages, clarifyQuestions, avatars] = await Promise.all([getMessages(gen.id), getClarify(gen.id), rosterAvatars()])

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
      error={sp.e}
      clarifyQuestions={clarifyQuestions}
    />
  )
}
