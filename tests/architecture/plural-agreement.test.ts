import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ЧИСЛО РЯДОМ СО СЛОВАРНЫМ СУЩЕСТВИТЕЛЬНЫМ, У КОТОРОГО ЕСТЬ ФОРМЫ.
 *
 * `t('lists', lang)` — это заголовок «Списки», и рядом с числом он даёт «5 списки»,
 * «1 списки», «22 списки». На английском та же строка ошибается только при единице
 * («1 lists»), поэтому дефект переживает любую проверку, сделанную на одной локали:
 * английский почти всегда прав по совпадению.
 *
 * Ловим КЛАСС, а не экземпляр: карточку папки звёзд починили точечно, но правило
 * («у ключа есть формы в PLURALS — значит рядом с числом обязан стоять plural()»)
 * иначе живёт только в голове того, кто чинил.
 *
 * Проверяется ровно один шаблон — число, пробел, `t(<ключ с формами>)`, — потому что
 * доказуемо именно он. Число, собранное в переменную двумя строками выше, тест не
 * увидит, и делать вид, что увидит, не надо.
 */

const SRC = 'src'

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) ? [p] : []
  })

/** Ключи, у которых объявлены формы, — источник тот же, что у `plural()`. */
const pluralKeys = (): string[] => {
  const src = readFileSync('src/shared/i18n/index.ts', 'utf8')
  const block = src.slice(src.indexOf('const PLURALS'), src.indexOf('} as const'))
  return [...block.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*)\s*:\s*\{/gm)].map((m) => m[1])
}

describe('согласование числа и существительного', () => {
  it('рядом с числом стоит plural(), а не словарный заголовок', () => {
    const keys = pluralKeys()
    expect(keys).toContain('lists')
    // `{count} {t('lists', lang)}` в JSX и `${count} ${t('lists', lang)}` в шаблоне.
    const pattern = new RegExp(String.raw`\$?\{[^{}]*\}\s*\$?\{\s*t\(\s*'(${keys.join('|')})'`, 'g')

    const hits: string[] = []
    for (const file of files(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(pattern)) {
        const line = text.slice(0, m.index).split('\n').length
        hits.push(`${file}:${line} — t('${m[1]}') рядом с числом; нужен plural(n, '${m[1]}', lang)`)
      }
    }
    expect(hits).toEqual([])
  })

  /**
   * ⚠️ ПРОВЕРКА ВЫШЕ СЛЕПА ПО ПОСТРОЕНИЮ: она берёт ключи из `PLURALS` и потому видит
   * только те слова, для которых формы УЖЕ завели. «0 комментировать» — подпись кнопки
   * рядом с числом — она пропустила ровно поэтому: ключа `comments` в наборе не было, а
   * значит и шаблона, который его ищет.
   *
   * Здесь ловится обратное: СЧЁТНОЕ выражение рядом с любым словарным словом. Такое
   * место либо склоняется (`plural`), либо это осознанное исключение — тогда оно названо
   * поимённо и с причиной. Список исключений — храповик: он может только сокращаться.
   *
   * ⚠️ ГРАНИЦА ПРОВЕРКИ. «Счётным» считается выражение, по которому это видно из имени:
   * `x.length`, `…Count`, `…Total`, число литералом. Счёт, положенный в переменную с
   * именем вроде `n` двумя строками выше, тест не увидит — и делать вид, что увидит, не
   * надо: первая версия этой проверки принимала за число ЛЮБОЕ выражение в скобках и
   * выдала 17 срабатываний, из которых настоящих было четыре. Узда, которую приучаются
   * пролистывать, хуже отсутствующей.
   */
  it('счётное выражение рядом со словарным словом либо склоняется, либо названо исключением', () => {
    /** Слова, которые при числе не меняются, — и почему. */
    const ALLOWED: Record<string, string> = {
      'list.stepsMatch': 'фраза целиком: «N/M шагов по запросу» — числитель и знаменатель, а не счёт',
      'admin.h': 'единица измерения: «5 ч» не склоняется',
      'admin.vectorizedSuffix': 'хвост фразы, склоняется слово перед ним: «5 строк с векторами»',
      runBlockedLabel: 'краткая форма при числе не меняется: «1 заблокировано» и «5 заблокировано» одинаково верны',
    }
    const COUNTABLE = /(\.length|Count|Total|^\s*\d+\s*$)\s*$/
    const pattern = /\$?\{([^{}]*)\}\s*\$?\{\s*t\(\s*'([^']+)'/g

    const hits: string[] = []
    for (const file of files(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(pattern)) {
        if (!COUNTABLE.test(m[1]) || ALLOWED[m[2]]) continue
        const line = text.slice(0, m.index).split('\n').length
        hits.push(`${file}:${line} — «{счёт} {t('${m[2]}')}»: нужен plural() либо запись в ALLOWED с причиной`)
      }
    }
    expect(hits).toEqual([])
  })
})
