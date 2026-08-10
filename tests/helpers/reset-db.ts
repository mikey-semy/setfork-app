import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/shared/db'

/**
 * Очистка таблиц между тестами — с ограниченным ожиданием блокировки.
 *
 * Голый `TRUNCATE` берёт ACCESS EXCLUSIVE и ждёт столько, сколько понадобится.
 * Если предыдущий файл оставил незакрытое соединение с открытой транзакцией,
 * ожидание упирается в `hookTimeout` (30 с), vitest обрывает хук — и дальше
 * тесты идут по НЕОЧИЩЕННОЙ базе, падая каскадом на `duplicate key`. Так это и
 * выглядело 09–10.08: один зависший хук, следом три красных файла и остановленная
 * выкатка, причём в логе не было ни слова о том, кто держал блокировку.
 *
 * Поэтому здесь: ждать не дольше `LOCK_WAIT`, а при отказе — рассказать, КТО
 * держит, прямо в тексте ошибки. Диагноз должен приезжать вместе с падением, а
 * не добываться повторным прогоном.
 */
const LOCK_WAIT = process.env.TEST_LOCK_WAIT ?? '5s'

/** Postgres: запрос не смог взять блокировку за отведённое время. */
const LOCK_NOT_AVAILABLE = '55P03'

type Blocker = { pid: number; state: string | null; wait: string | null; query: string | null; seconds: number | null }

async function blockers(): Promise<Blocker[]> {
  try {
    const res = await db.execute(sql`
      select pid,
             state,
             wait_event_type || ':' || coalesce(wait_event, '') as wait,
             left(query, 200) as query,
             round(extract(epoch from (now() - coalesce(xact_start, query_start))))::int as seconds
        from pg_stat_activity
       where datname = current_database()
         and pid <> pg_backend_pid()
       order by seconds desc nulls last
       limit 5`)
    return (res as unknown as { rows?: Blocker[] }).rows ?? (res as unknown as Blocker[])
  } catch {
    return []
  }
}

/**
 * `resetTables(sql`${templates}, ${users}`)` — то же, что прежний
 * `truncate table … restart identity cascade`, но с потолком ожидания.
 */
async function truncate(tables: SQL, restart: SQL, cascade: SQL) {
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local lock_timeout = '${LOCK_WAIT}'`))
    await tx.execute(sql`truncate table ${tables}${restart}${cascade}`)
  })
}

/** Прерванный тест оставляет соединение в `idle in transaction` — оно и держит блокировку. */
async function dropStuckTransactions(): Promise<number> {
  const res = await db.execute(sql`
    select pg_terminate_backend(pid) from pg_stat_activity
     where datname = current_database()
       and pid <> pg_backend_pid()
       and state = 'idle in transaction'
       and now() - state_change > interval '5 seconds'`)
  const rows = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[])
  return rows.length
}

export async function resetTables(tables: SQL, opts: { restartIdentity?: boolean; cascade?: boolean } = {}) {
  const restart = opts.restartIdentity === false ? sql`` : sql` restart identity`
  const cascade = opts.cascade === false ? sql`` : sql` cascade`
  try {
    await truncate(tables, restart, cascade)
  } catch (e) {
    // drizzle заворачивает ошибку драйвера в свою: код лежит в cause, а не сверху.
    // Проверять только верхний уровень — значит никогда не увидеть 55P03.
    const err = e as { code?: string; cause?: { code?: string } }
    if (err?.code !== LOCK_NOT_AVAILABLE && err?.cause?.code !== LOCK_NOT_AVAILABLE) throw e

    const busy = await blockers()
    const line = (b: Blocker) => {
      const state = [b.state ?? '?', b.wait].filter(Boolean).join(', ждёт ')
      return `  pid ${b.pid} [${state}] ${b.seconds ?? '?'}с: ${b.query ?? ''}`
    }
    // Пояснение для пустого списка подставляем через `||`, а не тернарником:
    // тернарник с кириллицей запрещён линтом (правило про словарь i18n).
    const who = busy.map(line).join('\n') || '  (pg_stat_activity ничего не показал)'

    // Одна попытка разорвать каскад. Прерванный по таймауту тест оставляет
    // соединение в `idle in transaction` НАВСЕГДА: пул его не вернёт, а держит
    // оно ровно те таблицы, которые мы чистим. Дальше падал КАЖДЫЙ следующий
    // файл — уже на duplicate key, потому что база осталась грязной. Убиваем
    // такие соединения (это тестовая база, ронять нечего) и пробуем ещё раз.
    const killed = await dropStuckTransactions()
    if (killed > 0) {
      // В логе прогона должно остаться, что база чинилась сама.
      console.warn(`[reset-db] сняты ${killed} зависших соединений (idle in transaction), повтор очистки.\nДержали:\n${who}`)
      await truncate(tables, restart, cascade)
      return
    }

    throw new Error(
      `Очистка таблиц не получила блокировку за ${LOCK_WAIT} — база осталась грязной, и следующие тесты упадут на duplicate key.\n` +
        `Кто держит соединение:\n${who}\n` +
        `Зависших транзакций не нашлось — значит блокировку держит активный запрос, а не брошенная транзакция.`,
    )
  }
}
