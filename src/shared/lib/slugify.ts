// Чистые правила имени: ни базы, ни server-only — модуль годится и КЛИЕНТУ.
//
// Отдельно от slug.ts сознательно: там рядом живут проверки занятости, а они ходят в
// Postgres. Клиентскому компоненту хватало импорта одного slugify, чтобы Turbopack
// затянул в браузерный бандл драйвер `pg` и уронил сборку на `Can't resolve 'dns'`.
export function parseTags(raw: unknown): string[] {
  return [
    ...new Set(
      String(raw ?? '')
        .toLowerCase()
        .split(/[\s,]+/)
        .map((tag) => tag.replace(/[^a-z0-9а-яё-]/gi, '').trim())
        .filter(Boolean),
    ),
  ].slice(0, 8)
}

import { translitRu } from '@/shared/lib/translit'

export function slugify(input: string): string {
  return (
    // Кириллица транслитерируется, а не вырезается: раньше русский заголовок
    // давал слаг «-» (реальный случай: MCP-создание «Домашнее маршмеллоу»).
    translitRu(input)
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      // Крайние дефисы срезаем ДО фолбэка: заголовок из одних разделителей
      // («— —», «...») иначе давал слаг «-», и адрес /owner/-/releases выглядел
      // как сломанный роут. Теперь такой заголовок честно уходит в 'list'.
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'list'
  )
}
