/**
 * ДИАЛЕКТ СКРИПТА: всё, что зависит от того, каким интерпретатором это читают —
 * shebang, синтаксис комментария, печать прогресса, выход с ошибкой, расширение,
 * MIME и команда запуска.
 *
 * Отдельно от генератора, потому что причина менять здесь ровно одна: «поменялось
 * то, как пишут на диалекте». Раньше это знание жило в трёх местах — таблица
 * `DIALECTS` в генераторе, `Content-Type`/имя файла в роуте `/raw` и написанная
 * руками команда `curl … | bash` в кнопке «Use». Три писателя одной строки — это
 * гарантированное расхождение: правка команды запуска в одном месте не доезжала
 * до двух других.
 */

// Терминатор строки — не только \n: python3 и PowerShell так же трактуют одиночный
// \r, поэтому /\r?\n/ границу «данные vs код» НЕ держит (на этом подтверждались
// инъекции из title и desc).
export const LINE_TERMINATORS = /\r\n|\r|\n/g

/** Одна строка вместо любой многострочности — для мест, где перенос недопустим. */
export const flatten = (s: string): string => s.replace(LINE_TERMINATORS, ' ')

// Все три диалекта комментируют через «# …» (без хвостовых пробелов).
export function hashComment(s: string): string {
  return s
    .split(LINE_TERMINATORS)
    .map((l) => `# ${l}`.replace(/\s+$/, ''))
    .join('\n')
}

// Экранирование строк для echo/print каждого диалекта (переводы строк → пробел).
const escSh = (s: string) => flatten(s).replace(/'/g, `'\\''`)
const escPs = (s: string) => flatten(s).replace(/`/g, '``').replace(/"/g, '`"').replace(/\$/g, '`$')
// Python: содержимое литерала в двойных кавычках даёт встроенная сериализация — она
// экранирует кавычки, слеши и ВЕСЬ диапазон управляющих символов, чего самописный вариант
// не делал (на \r литерал оставался незакрытым и скрипт не компилировался целиком).
const escPy = (s: string) => JSON.stringify(flatten(s)).slice(1, -1)

export type ScriptDialect = 'sh' | 'ps1' | 'py'

export function normalizeDialect(v: string | null | undefined): ScriptDialect {
  const s = (v ?? '').toLowerCase()
  if (s === 'ps1' || s === 'powershell' || s === 'pwsh') return 'ps1'
  if (s === 'py' || s === 'python') return 'py'
  return 'sh'
}

interface DialectSpec {
  shebang: string | null
  pre: string | null // строка, задающая «стоп на первой ошибке»
  echo: (s: string) => string // прогресс-строка
  /** Оператор «завершиться с ненулевым кодом» — им кончается любая заглушка отказа. */
  fail: string
  /**
   * КОМАНДА ЗАПУСКА для шапки скрипта и кнопки «Получить»: готовый адрес и имя
   * файла артефакта. Адрес приходит собранным — диалект к нему ничего не
   * дописывает, иначе `?lang=` приклеивался бы вторым вопросительным знаком к
   * адресу, у которого уже есть выборка пунктов.
   */
  run: (url: string, filename: string) => string
  ext: string
  mime: string
}

const DIALECTS: Record<ScriptDialect, DialectSpec> = {
  sh: {
    shebang: '#!/usr/bin/env bash',
    pre: 'set -euo pipefail',
    echo: (s) => `echo '${escSh(s)}'`,
    fail: 'exit 1',
    // СНАЧАЛА СКАЧАТЬ, ПОТОМ ЗАПУСТИТЬ — см. ниже, почему не конвейер и почему
    // во временный каталог. Адрес и путь В КАВЫЧКАХ: с выборкой пунктов в адресе
    // появляется `&`, а голый `&` шелл читает как «в фон» и рвёт команду пополам.
    run: (u, f) => `d=$(mktemp -d) && curl -fsSL "${u}" -o "$d/${f}" && bash "$d/${f}"`,
    ext: 'sh',
    mime: 'text/x-shellscript; charset=utf-8',
  },
  ps1: {
    shebang: null, // PowerShell без shebang
    pre: "$ErrorActionPreference = 'Stop'",
    echo: (s) => `Write-Host "${escPs(s)}"`,
    fail: 'exit 1',
    // Конвейер здесь безопасен: `irm` на не-2xx БРОСАЕТ, и до `iex` дело не доходит.
    // Это и есть та асимметрия, из-за которой sh и py пришлось переводить на файл.
    run: (u) => `irm "${u}" | iex`,
    ext: 'ps1',
    mime: 'text/plain; charset=utf-8',
  },
  py: {
    shebang: '#!/usr/bin/env python3',
    pre: null, // в python необработанное исключение и так останавливает скрипт
    echo: (s) => `print("${escPy(s)}")`,
    fail: 'raise SystemExit(1)',
    run: (u, f) => `d=$(mktemp -d) && curl -fsSL "${u}" -o "$d/${f}" && python3 "$d/${f}"`,
    ext: 'py',
    mime: 'text/x-python; charset=utf-8',
  },
}

export const dialectSpec = (d: ScriptDialect): Readonly<DialectSpec> => DIALECTS[d]
export const dialectExt = (d: ScriptDialect) => DIALECTS[d].ext
export const dialectMime = (d: ScriptDialect) => DIALECTS[d].mime

/**
 * ПОЧЕМУ КОМАНДА ЗАПУСКА НЕ КОНВЕЙЕР.
 *
 * `curl -fsSL … | bash` при отказе сервера завершается УСПЕХОМ. Флаг `-f` не
 * печатает тело ошибки, то есть в шелл уходит пустой поток; пустой скрипт
 * отрабатывает нормально, а код возврата конвейера — это код ПОСЛЕДНЕЙ команды,
 * то есть `bash`, то есть ноль. Проба против локального сервера:
 *
 *   == 503 == curl: (22) … returned error: 503   pipeline exit=0
 *   == 404 == curl: (22) … returned error: 404   pipeline exit=0
 *   == 500 == curl: (22) … returned error: 500   pipeline exit=0
 *
 * Значит `curl … | bash && echo provisioned` печатает «provisioned», не выполнив
 * ничего, — и то же самое делает шаг CI или чужой скрипт. Скачивание в файл через
 * `&&` разрывает эту цепочку: отказ виден кодом возврата curl, и вторая половина
 * команды просто не запускается. Заодно артефакт остаётся на диске — ровно то, что
 * просит собственная надпись скрипта «сначала проверь, потом запускай».
 *
 * И ОБЯЗАТЕЛЬНО ВО ВРЕМЕННЫЙ КАТАЛОГ. Скачивание по имени списка прямо в текущий
 * каталог тихо затирает чужой файл: у человека в проекте вполне может лежать свой
 * `deploy.sh`, а `curl -o` перезаписывает без вопросов. Списки с одинаковым слагом
 * у разных владельцев столкнулись бы так же. `--no-clobber` не годится: при
 * существующем файле curl пропускает загрузку и возвращает 0, то есть `bash`
 * выполнит СТАРЫЙ файл — ровно тот класс «тихо сделали не то», от которого здесь и
 * уходим. Поэтому `mktemp -d`: имя файла остаётся читаемым, столкнуться не с чем.
 */

/**
 * Имя файла артефакта. Слаг приходит из АДРЕСА, а адреса старых списков
 * создавались правилами, которых больше нет: в базе живут слаги вида `-`, и такой
 * файл скачивается как `-.sh`, после чего обычное `bash *.sh` разворачивается в
 * аргумент, начинающийся с дефиса. Санитайзер на выдаче, а не доверие к хранилищу.
 */
export function scriptFilename(slug: string, dialect: ScriptDialect): string {
  const base = slug.replace(/[^A-Za-z0-9._-]/g, '').replace(/^[-.]+/, '')
  return `${base || 'list'}.${DIALECTS[dialect].ext}`
}

/** Адрес `/raw` для диалекта: `?lang=` дописывается только чужому. */
export function scriptUrl(rawUrl: string, dialect: ScriptDialect): string {
  if (dialect === AUTHORED_DIALECT) return rawUrl
  return `${rawUrl}${rawUrl.includes('?') ? '&' : '?'}lang=${dialect}`
}

/**
 * ДИАЛЕКТ, НА КОТОРОМ НАПИСАНЫ АВТОРСКИЕ КОМАНДЫ.
 *
 * Модель списка его не объявляет: у пункта одно строковое поле `command` и нигде
 * — ни у списка, ни у шага — не сказано, чем его исполнять. При этом весь продукт
 * исходит из шелла: страж разрушительных команд разбирает строку по правилам
 * шелла (склейка `\`-продолжений, `#`-комментарий вне кавычек, `echo`/`printf` как
 * «только печатает»), кнопка запуска предлагает `| bash`, шапка скрипта — тоже.
 *
 * Пока в модели нет объявленного runtime, честный исполняемый выход возможен
 * ровно один. Это НЕ значит, что чужой диалект надо переводить строковыми
 * заменами: `export FOO=bar`, конвейер или heredoc не становятся Python оттого,
 * что сверху приписали `#!/usr/bin/env python3`.
 */
export const AUTHORED_DIALECT: ScriptDialect = 'sh'

/** Вправе ли диалект нести авторские команды исполняемыми. */
export const carriesCommands = (d: ScriptDialect): boolean => d === AUTHORED_DIALECT

/**
 * Заглушка отказа: тело, которое ЛЮБОЙ из трёх интерпретаторов прочтёт как
 * «только комментарии и выход с ошибкой».
 *
 * Нужна потому, что тело отказа у этой поверхности попадает не в глаза человеку,
 * а в интерпретатор: `curl … | bash` исполнит всё, что пришло. Обычный текст
 * ошибки («SetFork is down for maintenance») шелл читает как команду.
 */
export function errorScript(dialect: ScriptDialect, message: string[]): string {
  const d = DIALECTS[dialect]
  const out: string[] = []
  if (d.shebang) out.push(d.shebang)
  message.forEach((line) => out.push(hashComment(line)))
  out.push(d.fail, '')
  return out.join('\n')
}
