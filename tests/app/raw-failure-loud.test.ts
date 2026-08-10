// ОТКАЗ СЕРВЕРА НЕ ДОЛЖЕН ВЫГЛЯДЕТЬ УСПЕШНЫМ ПРОГОНОМ.
//
// `curl -fsSL … | bash` при 404/500/503 завершается кодом 0: `-f` не печатает тело, в
// шелл уходит пустой поток, а код возврата конвейера — это код `bash`, то есть ноль.
// Значит `curl … | bash && echo provisioned` печатает «provisioned», не выполнив ничего;
// то же самое делает шаг CI и любая автоматизация. Карточка реестра 014, P1.
//
// Проверяется РЕАЛЬНЫМ прогоном против настоящего HTTP-сервера — утверждение здесь про
// поведение конвейера, а его нельзя доказать чтением кода.
import { execFile, execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AUTHORED_DIALECT, dialectSpec, errorScript, scriptFilename } from '@/core/domain/script-dialect'

const SLUG = 'deploy-to-vps'
const REFUSED = [503, 404, 429, 500]
/** Содержимое ЧУЖОГО файла с тем же именем — он обязан пережить прогон. */
const MINE = '# мой собственный скрипт, его нельзя терять\n'

let server: Server
let origin = ''

/** Отдаёт статус из пути (`/503`) и заглушку отказа в теле — как это делает продукт. */
beforeAll(async () => {
  server = createServer((req, res) => {
    const status = Number((req.url ?? '/200').slice(1).split('?')[0]) || 200
    const spec = dialectSpec(AUTHORED_DIALECT)
    const body =
      status === 200
        ? `${spec.shebang}\n${spec.echo('running')}\n`
        : errorScript(AUTHORED_DIALECT, [`SetFork: refused with ${status}.`])
    res.writeHead(status, { 'Content-Type': spec.mime })
    res.end(body)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const addr = server.address()
  origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
})

afterAll(() => new Promise<void>((done) => server.close(() => done())))

/**
 * Код возврата команды, как её увидит человек в своём терминале.
 *
 * АСИНХРОННО, и это существенно: сервер-пробник живёт в этом же процессе, а
 * `execFileSync` держит событийный цикл — запрос curl просто некому обслужить, и
 * прогон виснет до таймаута.
 */
function exitCode(command: string, dir?: string): Promise<number> {
  const cwd = dir ?? mkdtempSync(join(tmpdir(), 'sf-run-'))
  return new Promise((done) => {
    execFile('bash', ['-c', command], { cwd, timeout: 30_000 }, (err) => {
      if (!err) return done(0)
      done(typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : -1)
    })
  })
}

const has = (cmd: string, args: string[]) => {
  try {
    execFileSync(cmd, args, { stdio: 'ignore', timeout: 10_000 })
    return true
  } catch {
    return false
  }
}
const canRun = has('bash', ['-c', 'true']) && has('curl', ['--version'])

describe.skipIf(!canRun)('команда запуска не может тихо преуспеть', () => {
  const published = (status: number) =>
    dialectSpec(AUTHORED_DIALECT).run(`${origin}/${status}`, scriptFilename(SLUG, AUTHORED_DIALECT))

  for (const status of REFUSED) {
    it(`${status}: опубликованная команда возвращает НЕ ноль`, async () => {
      expect(await exitCode(published(status))).not.toBe(0)
    })
  }

  it('200: опубликованная команда по-прежнему отрабатывает успешно', async () => {
    expect(await exitCode(published(200))).toBe(0)
  })

  it('чужой файл с тем же именем не затирается', async () => {
    // Скачивание по имени списка прямо в текущий каталог убило бы собственный
    // `deploy-to-vps.sh` человека: `curl -o` перезаписывает молча. Находка авто-ревью.
    const cwd = mkdtempSync(join(tmpdir(), 'sf-own-'))
    const own = join(cwd, scriptFilename(SLUG, AUTHORED_DIALECT))
    writeFileSync(own, MINE)
    expect(await exitCode(published(200), cwd)).toBe(0)
    expect(readFileSync(own, 'utf8')).toBe(MINE)
  })

  // Замер, ради которого форму команды и меняли: он обязан остаться в тесте, иначе
  // через полгода кто-нибудь «упростит» команду обратно до конвейера.
  for (const status of REFUSED) {
    it(`${status}: старая форма (конвейер) вернула бы НОЛЬ — так и была потеряна ошибка`, async () => {
      expect(await exitCode(`curl -fsSL "${origin}/${status}" | bash`)).toBe(0)
    })
  }

  it('тело отказа не исполняется даже без -f: это комментарии и выход с ошибкой', async () => {
    // Без `-f` тело доходит до интерпретатора. Раньше там был обычный текст
    // («SetFork is down for maintenance»), и шелл отвечал `command not found`.
    expect(await exitCode(`curl -sSL "${origin}/503" | bash`)).not.toBe(0)
  })
})
