import { loadSkill, warnIfLong } from '@/features/library/skill-load'
import { gitCore } from '@/features/git/core'
import { toSkillMarkdown } from '@/features/library/skill'
import { cacheHeaders } from '@/shared/http/cache'
import { problemListNotFound, problemRefNotFound } from '@/shared/http/problem'

/**
 * GET /{handle}/{slug}/SKILL.md — список как скилл агента, ОДНИМ ФАЙЛОМ.
 *
 *   npx skills add https://setfork.com/{handle}/{slug}/SKILL.md
 *
 * Стандарт Agent Skills (agentskills.io): шапка `name` + `description`, дальше инструкция.
 * Соседних файлов у этого адреса нет, поэтому фон и скрипт сюда не входят — в теле
 * ссылка на полный скилл архивом (`skill.tar.gz`).
 *
 * `?ref=v0.7.0` — скилл тега релиза или версии (`?ref=v3`); ссылка на архив в теле несёт
 * тот же ref. Неизвестный ref — 404.
 *
 * Видимость, язык и кеш — как у экспорта в markdown (см. `loadSkill`).
 */
export async function GET(req: Request, { params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  const ref = new URL(req.url).searchParams.get('ref')
  const loaded = await loadSkill(handle, slug, gitCore, ref)
  if (!loaded) return ref ? problemRefNotFound(ref) : problemListNotFound()

  const body = toSkillMarkdown(loaded.list, loaded.lang, loaded.ctx)
  warnIfLong(body, handle, slug)
  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      // `inline`: агент и браузер читают файл, а не скачивают его.
      'Content-Disposition': 'inline; filename="SKILL.md"',
      // Как у экспорта: ответ зависит от сессии и языка зрителя, общему кешу он не нужен.
      ...cacheHeaders({ shared: false }),
    },
  })
}
