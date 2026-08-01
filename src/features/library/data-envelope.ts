import type { Lang } from '@/shared/i18n'
import { tr } from '@/shared/i18n'
import type { ExportList } from './export'

/**
 * КОНВЕРТ ДАННЫХ СПИСКА — то, что видит чужой код.
 *
 * Отдельный модуль (а не пара строк в роуте), потому что это ПУБЛИЧНЫЙ КОНТРАКТ: его читают
 * чужие программы, и менять его молча нельзя. Здесь же он проверяется тестом.
 *
 * Три вещи, без которых справочник бесполезен и которым нас научил сегодняшний разбор цен:
 *  - `version` и `updatedAt` — «когда это в последний раз проверяли». Прайсы Яндекса и
 *    GigaChat расходятся по блогам именно потому, что нигде не написано, когда цифру видели
 *    живой;
 *  - `url` и `source` у строк — откуда взято. Ссылки шага (refs) едут как есть;
 *  - `kind` с версией — чтобы потребитель мог отличить наш формат от следующего.
 *
 * `steps` — ТЕКУЩАЯ форма списка (шаги). Когда появится табличный тип, рядом встанет `rows`
 * с объявленными колонками; `kind` тогда сменится на v2, а v1 продолжит отдаваться прежним.
 */

export const DATA_KIND = 'setfork.list/v1'

export interface ListDataStep {
  n: number
  title: string
  desc: string
  /** Команда шага (может быть пустой — у нетехнических списков её и нет). */
  command: string
  level: string
  why: string
  subtasks: string[]
  /** Только ссылки с адресом: ref без url — оформление, а не источник. */
  refs: { label: string; url: string }[]
}

export interface ListDataEnvelope {
  kind: typeof DATA_KIND
  /** `handle/slug` — как список зовут в CLI и MCP. */
  ref: string
  url: string
  title: string
  desc: string
  tags: string[]
  /** Номер версии списка: та же нумерация, что в истории и в git. */
  version: number
  /** Когда список менялся в последний раз (ISO-8601, UTC). */
  updatedAt: string
  /** Порядок шагов значим (чек-лист) или нет (набор). */
  ordered: boolean
  /** Язык, на котором отданы тексты. */
  lang: Lang
  steps: ListDataStep[]
}

/**
 * Собрать конверт. Тексты уже сведены к ОДНОМУ языку: чужому коду нужен готовый текст, а не
 * наша внутренняя мультиязычная структура — иначе каждый потребитель напишет свой `tr()`.
 */
export function toDataEnvelope(list: ExportList, lang: Lang, url: string, updatedAt: Date): ListDataEnvelope {
  return {
    kind: DATA_KIND,
    ref: `${list.ownerHandle}/${list.slug}`,
    url,
    title: tr(list.title, lang),
    desc: tr(list.desc, lang),
    tags: list.tags,
    version: list.version,
    updatedAt: updatedAt.toISOString(),
    ordered: list.ordered,
    lang,
    steps: list.steps
      // Блоки (текст, картинка, опрос) — оформление страницы, а не данные: в конверт идут
      // только шаги. Иначе потребителю пришлось бы фильтровать наши типы у себя.
      .filter((s) => !s.type || s.type === 'step')
      .map((s) => ({
        n: s.n,
        title: tr(s.title, lang),
        desc: tr(s.desc, lang),
        command: s.command ?? '',
        level: s.level ?? '',
        why: tr(s.why, lang),
        subtasks: (s.subtasks ?? []).map((t) => tr(t, lang)),
        refs: (s.refs ?? [])
          .filter((r): r is { label: typeof r.label; url: string } => Boolean(r.url))
          .map((r) => ({ label: tr(r.label, lang), url: r.url })),
      })),
  }
}

/** Слабый ETag: меняется ровно тогда, когда меняется содержимое (версия + отметка правки). */
export function dataEtag(version: number, updatedAt: Date, lang: Lang): string {
  return `W/"v${version}-${updatedAt.getTime()}-${lang}"`
}
