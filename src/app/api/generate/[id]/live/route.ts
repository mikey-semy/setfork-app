import { NextResponse, type NextRequest } from 'next/server'
import { getSession } from '@/shared/auth/session'
import { getGeneration } from '@/features/generation/queries'
import { getMessages } from '@/shared/ai/generation-messages'

/**
 * Живая беседа: статус + реплики свежее `after`. Чат поллит ЕГО, а не router.refresh() —
 * тот перерисовывал всю страницу (сессия, уведомления, шаблоны, сайдбар) раз в 2.5с ради
 * пары новых строк. Прецедент лёгкого поллинга — /api/notifications/recent.
 *
 * Отдаём и число вариантов: появился новый кандидат → страница подтянет карточку через refresh,
 * но уже по факту, а не вслепую.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const gen = await getGeneration(id, session.userId) // внутри проверка владельца
  if (!gen) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const afterRaw = req.nextUrl.searchParams.get('after')
  const after = afterRaw ? new Date(afterRaw) : undefined
  const messages = await getMessages(id, after && !Number.isNaN(after.getTime()) ? after : undefined)

  return NextResponse.json(
    {
      status: gen.status,
      candidates: gen.candidates.length,
      chosen: Boolean(gen.chosenTemplateId),
      messages,
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
