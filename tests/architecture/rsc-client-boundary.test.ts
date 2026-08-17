import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ГРАНИЦА RSC: из `'use client'`-модуля наружу можно вынести только компонент.
 *
 * Любой экспорт клиентского модуля, прочитанный серверным кодом, — это не значение, а
 * ССЫЛКА на модуль (`createClientModuleProxy`, `typeof === 'function'`). Компонентом она и
 * задумана: React разрешит её на клиенте. А вот число, строка или функция-хелпер приезжают
 * на сервер заглушкой, сохраняя при этом ОБЪЯВЛЕННЫЙ тип, — значит `tsc` молчит, тесты
 * модуля молчат, и код выглядит рабочим.
 *
 * Цена этого молчания уже известна: `DASHBOARD_LISTS` жил в `widgets/ListsPanel.tsx`, а
 * дашборд звал с ним `getUserTemplates(..., { limit })`. На сервере предел был функцией,
 * drizzle выбрасывал его молча (он берёт только number/object), и главная поднимала все 518
 * списков владельца. Панель «чинили» четыре раза — правки были верные и бесполезные, потому
 * что чинили разметку, а ломался запрос.
 *
 * Поэтому граница проверяется здесь, а не в ревью: глазами эта ошибка не видна вовсе.
 */

const SRC = 'src'

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

const files = walk(SRC)
const source = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]))
const isClientModule = (f: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(source.get(f) ?? '')

/** Разрешаем импорт так же, как это делает сборка: алиас `@/`, относительный путь, index. */
const resolveImport = (from: string, spec: string): string | null => {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : spec.startsWith('.') ? join(dirname(from), spec) : null
  if (!base) return null
  for (const c of [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) if (existsSync(c)) return c
  return null
}

/** Компонент отличаем по имени: PascalCase — единственное, что через границу проходит. */
const isComponentName = (name: string) => /^[A-Z][A-Za-z0-9]*$/.test(name)

describe('граница клиентских модулей', () => {
  it('серверный код берёт из `use client`-модулей только компоненты', () => {
    const offenders: string[] = []

    for (const file of files) {
      // Клиент читает клиента напрямую — там границы нет и значения настоящие.
      if (isClientModule(file)) continue
      const src = source.get(file) ?? ''
      for (const m of src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
        if (m[1]) continue // `import type` стирается сборкой — на рантайм не влияет
        const target = resolveImport(file, m[3])
        if (!target || !isClientModule(target)) continue
        const values = m[2]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .filter((s) => !s.startsWith('type ')) // точечный `{ type Foo }` — тоже только тип
          .map((s) => s.split(/\s+as\s+/)[0].trim())
          .filter((n) => !isComponentName(n))
        for (const v of values) offenders.push(`${file} ← ${m[3]}: ${v}`)
      }
    }

    // Список пуст НЕ «пока что»: сюда нельзя дописывать исключения. Значение, нужное обеим
    // сторонам, переносится в обычный модуль (как SIDEBAR_LISTS/DASHBOARD_LISTS в
    // shared/lib/paging) — тогда его настоящим получают и сервер, и клиент.
    expect(offenders).toEqual([])
  })
})
