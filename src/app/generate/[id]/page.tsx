import { notFound, redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db, templates, users } from '@/shared/db'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { getGeneration, getGenerationStatus } from '@/features/generation/queries'
import { GenerationReview } from '@/features/generation/GenerationReview'

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
  const status = await getGenerationStatus(id)

  // Уже принят → открываем созданный список.
  if (gen.chosenTemplateId) {
    const [row] = await db
      .select({ handle: users.handle, slug: templates.slug })
      .from(templates)
      .innerJoin(users, eq(templates.ownerId, users.id))
      .where(eq(templates.id, gen.chosenTemplateId))
    if (row) redirect(`/${row.handle}/${row.slug}`)
  }

  return (
    <GenerationReview
      generationId={gen.id}
      query={gen.query}
      lang={lang}
      candidates={gen.candidates}
      status={status}
      initialIdx={Number(sp.v) || gen.candidates[gen.candidates.length - 1]?.idx || 1}
      error={sp.e}
    />
  )
}
