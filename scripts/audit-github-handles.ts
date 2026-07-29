// Разбор наследства старого GitHub-входа. Запуск: npx tsx scripts/audit-github-handles.ts
//
// Зачем: до фикса вход через GitHub писал `gh.login` прямо в `handle`, минуя воронку
// регистрации — то есть минуя RESERVED_HANDLES, занятость и ADMIN_HANDLES. Сам путь
// закрыт (src/shared/auth/users.ts), но СТРОКИ, заведённые им раньше, остались: аккаунт,
// успевший занять админский ник, остаётся админом и после фикса, потому что getAdmin()
// смотрит на текущий ник в БД.
//
// Автоматически такие ники НЕ переименовываем: под то же правило попадает собственный
// аккаунт владельца, если он заведён через GitHub, — молчаливое переименование лишило бы
// его админки. Поэтому скрипт по умолчанию только показывает найденное; переименование
// конкретной строки включается явно: --apply --user <id>.
//
// Переименование идёт через ту же воронку (uniqueHandle), что регистрация, и пишется в
// журнал аудита как admin-действие.
import 'dotenv/config'
import { eq, isNotNull } from 'drizzle-orm'
import { auditLog, db, users } from '@/shared/db'
import { RESERVED_HANDLES, uniqueHandle } from '@/shared/auth/handle'
import { isAdminHandle } from '@/shared/auth/admin-handle'

/** Ник, который сегодняшняя воронка занять бы не дала. */
function forbidden(handle: string): 'admin' | 'reserved' | null {
  const h = handle.toLowerCase()
  if (isAdminHandle(h)) return 'admin'
  return RESERVED_HANDLES.has(h) ? 'reserved' : null
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const target = process.argv[process.argv.indexOf('--user') + 1]

  const rows = await db
    .select({ id: users.id, handle: users.handle, githubId: users.githubId, createdAt: users.createdAt })
    .from(users)
    .where(isNotNull(users.githubId))

  const suspects = rows.map((r) => ({ ...r, why: forbidden(r.handle) })).filter((r) => r.why)

  if (!suspects.length) {
    console.log(`GitHub-аккаунтов: ${rows.length}. Ни один не держит зарезервированный или админский ник — наследства нет.`)
    return
  }

  console.log(`GitHub-аккаунтов: ${rows.length}. Держат запрещённый воронкой ник: ${suspects.length}`)
  for (const s of suspects) {
    console.log(`  ${s.handle}  (${s.why}, id=${s.id}, github=${s.githubId}, заведён ${s.createdAt?.toISOString?.() ?? '—'})`)
  }

  if (!apply) {
    console.log('\nЭто сухой прогон. Решение за человеком: админский ник может принадлежать самому владельцу.')
    console.log('Переименовать конкретную строку: npx tsx scripts/audit-github-handles.ts --apply --user <id>')
    return
  }
  if (!target) {
    console.error('\n--apply требует --user <id>: переименовывать все подряд нельзя, среди них может быть аккаунт владельца.')
    process.exitCode = 1
    return
  }
  const victim = suspects.find((s) => s.id === target)
  if (!victim) {
    console.error(`\nСтроки ${target} среди найденных нет — переименовывать нечего.`)
    process.exitCode = 1
    return
  }
  const next = await uniqueHandle(['github-user'])
  await db.update(users).set({ handle: next }).where(eq(users.id, victim.id))
  // Пишем в журнал напрямую: recordAudit тянет 'server-only' (он для запросов, а тут скрипт).
  await db.insert(auditLog).values({
    actorId: victim.id,
    action: 'account.handle-change',
    targetType: 'user',
    targetId: victim.id,
    meta: { from: victim.handle, to: next, reason: `наследство старого GitHub-входа (${victim.why})` },
  })
  console.log(`\n${victim.handle} → ${next}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
