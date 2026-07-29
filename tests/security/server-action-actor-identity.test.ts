import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * СТАТИЧЕСКИЙ КАРАУЛ: экшен не берёт личность действующего лица из аргументов.
 *
 * Любой экспорт из файла с 'use server' — это сетевая точка входа, которую клиент
 * зовёт с ЛЮБЫМИ аргументами. Если такая функция принимает `actorUserId`, то гейт
 * вида `ownerId !== actorUserId` сверяется с числом, которое прислал нападающий, —
 * проверка есть, а защиты нет. Ровно так уехали `applySuggestion` (принять правку от
 * имени владельца) и `startPendingLogin` (pending-логин на чужой id, минуя пароль).
 *
 * Лечится не проверкой внутри, а местом: ядро живёт в модуле БЕЗ 'use server', и
 * зовёт его сервер — экшен со своей сессией или MCP с userId токена.
 *
 * Тест читает исходники, а не гоняет код: он должен ловить ДОБАВЛЕНИЕ такой функции,
 * даже если её никто ещё не вызывает.
 */

const ACTOR_PARAM = /\b(actorUserId|actorId|uid|sessionUserId)\s*[?]?\s*:\s*string/
// `userId` бывает и ЦЕЛЬЮ действия («убрать вот этого коллаборатора»), а не тем, от
// чьего имени действуют. Такие места перечислены поимённо: список короткий, и каждое
// новое имя в нём — повод объяснить, почему это цель, а не личность.
const TARGET_NOT_ACTOR: Record<string, string> = {
  'src/features/collab/actions.ts#removeCollaborator': 'userId — КОГО убирают; действующее лицо берётся из requireSession выше',
}

// withFileTypes, а не statSync на каждый файл: обход src это тысячи записей, и на
// Windows под параллельными тестами лишний системный вызов на каждую превращал
// караул в падение по таймауту — то есть в ложную тревогу вместо проверки.
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(p)
  }
  return out
}

interface Offender {
  where: string
  signature: string
}

function findOffenders(): Offender[] {
  const offenders: Offender[] = []
  for (const file of walk('src')) {
    const src = readFileSync(file, 'utf8')
    if (!/^['"]use server['"]/m.test(src)) continue
    const rel = file.replace(/\\/g, '/')
    // Сигнатура может занимать несколько строк — берём от `export async function`
    // до первой закрывающей скобки параметров.
    for (const m of src.matchAll(/export\s+async\s+function\s+(\w+)\s*\(([^)]*)\)/g)) {
      const [, name, params] = m
      const key = `${rel}#${name}`
      if (TARGET_NOT_ACTOR[key]) continue
      if (ACTOR_PARAM.test(params) || /\buserId\s*[?]?\s*:\s*string/.test(params)) {
        offenders.push({ where: key, signature: `${name}(${params.replace(/\s+/g, ' ').trim()})` })
      }
    }
  }
  return offenders
}

describe('личность действующего лица не приходит аргументом в экшен', () => {
  // Запас по времени: тест читает весь src, а на холодной ФС это секунды.
  it('ни один экспорт из "use server" не принимает чужой userId', { timeout: 60_000 }, () => {
    const offenders = findOffenders()
    expect(
      offenders,
      `Эти функции — сетевые точки входа с личностью в аргументе:\n${offenders.map((o) => `  ${o.where}: ${o.signature}`).join('\n')}\n` +
        'Вынесите ядро в модуль БЕЗ "use server" (см. suggestion-core.ts, signed-cookies.ts) либо добавьте в TARGET_NOT_ACTOR с объяснением, почему это цель, а не действующее лицо.',
    ).toEqual([])
  })

  it('сам караул работает — узнаёт сигнатуру с actorUserId', () => {
    expect(ACTOR_PARAM.test('suggestionId: string, actorUserId: string')).toBe(true)
    expect(ACTOR_PARAM.test('formData: FormData')).toBe(false)
  })
})
