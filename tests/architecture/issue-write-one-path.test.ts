import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ЗАВЕСТИ ЗАДАЧУ, ОТВЕТИТЬ, ЗАКРЫТЬ — ОДНА РЕАЛИЗАЦИЯ НА ВСЕ ПОВЕРХНОСТИ.
 *
 * У задач их теперь две: форма на сайте и инструменты MCP. Вторая копия правил
 * расходится с первой не «когда-нибудь», а на первой же правке — это у нас уже
 * случилось со слиянием правок (#888: ручное разрешение конфликтов молча забыло версию,
 * проверку исполняемых команд и удаление ветки). Цена расхождения здесь — счётчик
 * частоты (#869) и рассылка уведомлений: и то и другое отсутствует ТИХО, никакой
 * ошибки не видно, просто владелец не узнаёт о задаче, а скрипт пишет без предела.
 *
 * Узда простая: писать задачи в хранилище вправе только ядро. Кто хочет завести задачу —
 * зовёт `openIssue` и получает ворота вместе с ней.
 *
 * ⚠️ ТРИ ИСКЛЮЧЕНИЯ НИЖЕ — НЕ РАЗРЕШЕНИЕ, А ОПИСЬ. Это пути, написанные до ядра; у всех
 * трёх нет счётчика частоты, а у двух — ещё и уведомления о новой задаче (владелец
 * узнаёт о ней, только зайдя на страницу). Список заморожен: новый обход упрётся в этот
 * тест, а старые уходят по одному — тогда и строки отсюда.
 */
const KNOWN_BYPASS = [
  // «Сообщить о шаге, на котором прогон встал»: задача заводится и никому не летит.
  'src/features/runs/actions.ts',
  // «Обсуждение → задача»: ответ в тред есть, уведомления о задаче нет.
  'src/features/comments/thread-to-issue.ts',
  // Садовник заводит задачу о битых ссылках: уведомления есть, частоты нет.
  'src/features/linkcheck/deliver.ts',
]

/** Где хранилищу задач говорят «пиши». */
const WRITES = /collabStore\.(openIssue|addIssueComment|setIssueStatus)\s*\(/

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []
  })

describe('запись задач идёт одним путём', () => {
  const writers = walk('src')
    .filter((p) => WRITES.test(readFileSync(p, 'utf8')))
    // Само хранилище и ядро задач — это и есть путь, а не обход.
    .filter((p) => !p.endsWith('collab-store/store.ts') && !p.endsWith('features/issues/core.ts'))
    .map((p) => p.replace(/\\/g, '/'))

  it('⚠️ мимо ядра задач пишут только известные три пути — и ни одним больше', () => {
    expect(
      writers.sort(),
      'новый путь записи задач обязан звать features/issues/core: там частота и уведомления',
    ).toEqual([...KNOWN_BYPASS].sort())
  })

  it('ядро — единственное место, где считается частота задач', () => {
    const src = readFileSync('src/features/issues/core.ts', 'utf8')
    expect(src, 'создание без счётчика — это #869 обратно').toMatch(/underIssueRate\(/)
    expect(src, 'ответ в треде тоже считается').toMatch(/underCommentRate\(/)

    // Свой `./limits` есть у многих разделов — ищем ИМЕННО модуль задач: по полному
    // пути и по относительному внутри features/issues.
    const others = walk('src')
      .map((p) => p.replace(/\\/g, '/'))
      .filter((p) => !p.endsWith('features/issues/core.ts') && !p.endsWith('features/issues/limits.ts'))
      .filter((p) => {
        const src = readFileSync(p, 'utf8')
        return /@\/features\/issues\/limits'/.test(src) || (p.startsWith('src/features/issues/') && /from '\.\/limits'/.test(src))
      })
    expect(others, 'лимиты задач читает только ядро — иначе счётчиков снова станет два').toEqual([])
  })

  it('поверхность MCP не держит своих правил: она зовёт то же ядро', () => {
    const mcp = readFileSync('src/features/mcp/tools/issues.ts', 'utf8')
    expect(mcp).toMatch(/from '@\/features\/issues\/core'/)
    expect(mcp, 'уведомления и события — забота ядра, здесь их быть не должно').not.toMatch(/notifyMany|recordIssueEvent/)
  })
})
