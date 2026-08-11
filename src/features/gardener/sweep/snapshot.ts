// Снимок списка для модели: строки версии → то, что уходит в refine.
//
// Причина измениться у модуля одна и она дорогая: **refine получает список JSON'ом
// и возвращает его целиком**, поэтому поле блочной модели, которого в снимке нет,
// исчезает из результата. Появилось новое поле у шага — оно обязано появиться
// здесь, иначе каждый проход ухода будет молча его стирать. Так уже случилось с
// пометками «здесь нужен человек» (тест `snapshot-fields.itest.ts`).
//
// Заодно здесь определяются язык и тип списка: и то, и другое считается ПО ТЕМ ЖЕ
// строкам, что уходят в снимок, — одна поездка по данным, один портрет списка.

import 'server-only'
import { and, asc, eq } from 'drizzle-orm'
import { db, steps, templates, templateVersions } from '@/shared/db'
import { LIST_KINDS, type ListKind } from '@/shared/ai/list-kind'
import { dominantLang, inferListKind } from '@/shared/ai/gardener-policies'
import type { GeneratedItem } from '@/shared/ai/generate'
import type { Lang, LocaleText } from '@/shared/i18n'
import { loc } from './policy'

/** Список в той форме, в какой его видит модель. */
export interface ListSnapshot {
  lang: Lang
  kind: ListKind
  current: { title: string; desc: string; tags: string[]; items: GeneratedItem[] }
}

type Candidate = {
  id: string
  currentVersion: number
  title: LocaleText
  desc: LocaleText | null
  tags: string[]
  listKind: string | null
}

/**
 * Собрать снимок списка: строки текущей версии, язык контента и тип.
 *
 * Тип определяется по цепочке колонка → структурная эвристика → грамматика
 * заголовка, и определённое лениво дозаписывается в колонку (самозаполняющийся
 * бэкфилл) — поэтому функция и пишет, а не только читает.
 */
export async function snapshotOf(tpl: Candidate): Promise<ListSnapshot> {
  const [ver] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, tpl.id), eq(templateVersions.version, tpl.currentVersion)))
  const rows = ver ? await db.select().from(steps).where(eq(steps.versionId, ver.id)).orderBy(asc(steps.n)) : []

  // Язык списка — по его контенту (раньше RU-список рефайнился на английском
  // и садовник предлагал перевод вместо улучшения).
  const lang = dominantLang([tpl.title, tpl.desc, ...rows.map((s) => s.title)])
  // Тип списка: колонка → структурная эвристика → грамматика заголовка;
  // определённое лениво дозаписываем (самозаполняющийся бэкфилл).
  const kind: ListKind = (LIST_KINDS as readonly string[]).includes(tpl.listKind ?? '')
    ? (tpl.listKind as ListKind)
    : inferListKind({
        title: loc(tpl.title, lang),
        sections: rows.map((s) => loc(s.section, lang)).filter(Boolean),
        commandCount: rows.filter((s) => s.command.trim()).length,
      })
  if (!tpl.listKind) await db.update(templates).set({ listKind: kind }).where(eq(templates.id, tpl.id))

  return {
    lang,
    kind,
    current: {
      title: loc(tpl.title, lang),
      desc: loc(tpl.desc, lang),
      tags: tpl.tags,
      items: rows.map((s) => ({
        title: loc(s.title, lang),
        desc: loc(s.desc, lang),
        command: s.command,
        section: loc(s.section, lang),
        level: s.level,
        why: loc(s.why, lang),
        // Пометки «здесь нужен человек» ОБЯЗАНЫ входить в снимок: refine получает список
        // JSON'ом и возвращает его целиком, поэтому поле, которого в снимке нет, исчезает
        // из результата — то есть каждый проход ухода СТИРАЛ бы честные пометки.
        needsHuman: s.needsHuman,
        needsHumanAsk: loc(s.needsHumanAsk, lang),
        subtasks: (s.subtasks ?? []).map((x) => loc(x, lang)).filter(Boolean),
        refs: (s.refs ?? []).map((r) => ({ label: loc(r.label, lang), url: r.url ?? '' })),
      })),
    },
  }
}
