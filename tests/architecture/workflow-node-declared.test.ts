import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

/**
 * ДЖОБА, КОТОРАЯ ЗОВЁТ NODE, ОБЯЗАНА ЕГО ПОСТАВИТЬ.
 *
 * На своих раннерах `node` в PATH есть всегда — древний, системный. Он не понимает
 * `import`, поэтому любой наш скрипт падает на первой строке с `SyntaxError`. Джоба при
 * этом продолжается: `node ... || true` или необязательный шаг проглатывают падение.
 *
 * Стоило это дорого. Подсчёт версии в джобе `image` падал именно так, аргумент сборки не
 * передавался, next.config откатывался на номер из package.json — и на прод месяцами
 * уезжало «0.1.0» при полутысяче коммитов, а выкатка рапортовала об успехе. Владелец
 * спрашивал дважды, прежде чем причину нашли: три джобы из четырёх node ставили, а эта
 * нет — сборка идёт внутри докера, и казалось, что снаружи node ей не нужен.
 *
 * Проверка текстовая и работает без сети: она смотрит РАЗОБРАННЫЙ yaml, а не грепает
 * строки, потому что `node` в комментарии — не вызов, и на грепе это уже давало ложную
 * тревогу (в `deploy` node упоминается только в объяснении).
 */
const DIR = new URL('../../.github/workflows', import.meta.url).pathname

/**
 * Вызов наших инструментов ГДЕ УГОДНО в строке, а не только в её начале.
 *
 * ⚠️ Первая редакция искала `^\s*(node|npm|npx)\s` — и не видела ровно тот вызов, ради
 * которого узда написана: `APP_VERSION="$(node scripts/build-version.mjs)"` начинается с
 * имени переменной. Мутация (убрать setup-node из `image`) прошла ЗЕЛЁНОЙ. Проверка,
 * написанная по образу одного вызова, а не по смыслу «джоба запускает node».
 */
const CALLS_NODE = /(^|[\s(`"'$])(node|npm|npx)\s|node_modules\/\.bin\//

type Job = { steps?: { uses?: string; run?: string }[] }

const jobsOf = (file: string): [string, Job][] => {
  const doc = parse(readFileSync(join(DIR, file), 'utf8')) as { jobs?: Record<string, Job> }
  return Object.entries(doc.jobs ?? {})
}

const needsNode = (job: Job) =>
  (job.steps ?? []).some((s) => typeof s.run === 'string' && s.run.split('\n').some((l) => CALLS_NODE.test(l)))

const setsUpNode = (job: Job) => (job.steps ?? []).some((s) => (s.uses ?? '').startsWith('actions/setup-node'))

const files = readdirSync(DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
const all = files.flatMap((f) => jobsOf(f).map(([name, job]) => ({ where: `${f}:${name}`, job })))

describe('джоба, которая зовёт node, ставит node', () => {
  it('сканер видит джобы — иначе «нарушений нет» ничего не значит', () => {
    // Контроль к самому себе: пустая выборка прошла бы проверку ниже молча.
    expect(files.length, 'файлов воркфлоу не найдено — сканер смотрит не туда').toBeGreaterThan(0)
    expect(all.length, 'джоб не найдено — разбор yaml сломался').toBeGreaterThan(3)
    expect(all.filter(({ job }) => needsNode(job)).length, 'ни одна джоба не зовёт node — так не бывает').toBeGreaterThan(0)
  })

  it('у каждой такой джобы есть actions/setup-node', () => {
    const silent = all.filter(({ job }) => needsNode(job) && !setsUpNode(job)).map(({ where }) => where)
    expect(
      silent,
      'джоба зовёт наши скрипты, но node не ставит: на раннере возьмётся системный, он не понимает import, и падение будет тихим',
    ).toEqual([])
  })
})
