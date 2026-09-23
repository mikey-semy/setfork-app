import { and, eq, ilike, sql } from 'drizzle-orm'
import { normalizeHandle } from '@/shared/auth/handle-input'
import { likePrefix } from '@/shared/db/like'
import { listedPeople } from '@/features/profile/search'
import { getSession } from '@/shared/auth/session'
import { db, users } from '@/shared/db'
import { avatarSrc } from '@/shared/media'
import { rateLimit, tooMany } from '@/shared/rate-limit'

// Поиск пользователей по префиксу handle — @mention в редакторе И `by:`-автокомплит
// на публичной странице поиска. Хендлы публичны → доступно и анонимам
// (rate-limit по IP, если нет сессии).
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const session = await getSession()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon'
  const rl = await rateLimit(session ? `usearch:${session.userId}` : `usearch:ip:${ip}`, 60, 60_000) // 60 запросов / мин
  if (!rl.ok) return tooMany(rl)
  // «@ma» и «ma» — один запрос: правило то же, что у полей ввода ника (handle-input).
  const q = normalizeHandle(new URL(req.url).searchParams.get('q') ?? '')
  if (!q) return Response.json([])
  // ПОРЯДОК ОБЯЗАТЕЛЕН, и не ради красоты. Без него `limit(8)` берёт произвольную
  // восьмёрку из подходящих: человек набирает `ma`, ников на `ma` полсотни, и он видит
  // случайные восемь — причём РАЗНЫЕ между нажатиями для одного и того же префикса.
  // Нужного человека можно не увидеть вовсе, и выглядит это не ошибкой, а «его нет».
  //
  // Сортируем по длине ника, потом по алфавиту: при вводе `ma` короткий `mark` полезнее
  // длинного `marketing-bot-2024` — он ближе к тому, что набирают целиком. Алфавит вторым
  // ключом делает выдачу ВОСПРОИЗВОДИМОЙ: одинаковый запрос — одинаковый ответ, иначе
  // список прыгает под пальцем.
  const rows = await db
    .select({ handle: users.handle, avatarUrl: users.avatarUrl })
    .from(users)
    // Кого показывать — то же правило, что у поиска людей (listedPeople): подсказка ника —
    // такой же поиск людей, и закрытый профиль в ней не всплывает. Добавить такого
    // человека соавтором по-прежнему можно, набрав ник целиком, — как у GitHub.
    // `%` и `_` в запросе — буквы, а не шаблон (likePrefix).
    .where(and(listedPeople(), ilike(users.handle, likePrefix(q))))
    .orderBy(sql`length(${users.handle})`, users.handle)
    .limit(8)
  const out = await Promise.all(rows.map(async (r) => ({ handle: r.handle, avatarUrl: await avatarSrc(r.avatarUrl, 32) })))
  return Response.json(out)
}
