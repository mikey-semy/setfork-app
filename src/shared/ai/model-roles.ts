import 'server-only'
import { getAiSettings } from '@/shared/settings/ai'
import { getRosterAll, rosterAvatars } from './roster'
import { baseModelId } from './health'

/**
 * КТО ЗАНИМАЕТ МОДЕЛЬ — карта «id модели → на каких ролях она стоит».
 *
 * Причина существования: выбирая модель, владелец не видел, ЧТО она будет делать и кто уже на
 * ней сидит. Ролей у нас пять, и они не равнозначны — от финального списка зависит качество,
 * от первой модели пула зависит скорость всего совета, от эмбеддингов зависит поиск. Строка
 * селекта без этого читается как «просто ещё одна модель из 336».
 *
 * Ключ — БАЗОВЫЙ id (без ':online'): веб-суффикс это та же модель, и занятость у них общая.
 */

export type ModelRoleKind = 'chat' | 'fallback' | 'embedding' | 'council' | 'gnome'

export interface ModelRole {
  kind: ModelRoleKind
  /** Готовая подпись на языке интерфейса («Основная», имя специалиста). */
  label: string
  /** Что эта роль делает — одной строкой, для тултипа/страницы моделей. */
  what: string
  /** Аватарка специалиста (только kind='gnome'). */
  avatarUrl?: string
  /** id специалиста — ссылка на его страницу. */
  gnomeId?: string
  /** Позиция в пуле совета, 1-based (только kind='council'). */
  order?: number
}

export interface ModelRolesResult {
  /** Базовый id модели → роли, которые на ней стоят. */
  byModel: Map<string, ModelRole[]>
  /** Модели, которые где-то назначены (для отметки «в работе у нас»). */
  assigned: Set<string>
}

/** Тексты ролей — здесь, а не в трёх разных компонентах: это одно объяснение на весь портал. */
export function roleTexts(ru: boolean): Record<ModelRoleKind, { label: string; what: string }> {
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  return {
    chat: {
      label: say('Main', 'Основная'),
      what: say('Writes the final list — quality matters most here.', 'Пишет финальный список — здесь важнее всего качество.'),
    },
    fallback: {
      label: say('Backup', 'Запасная'),
      what: say('Takes over when the main one is down or the balance is low.', 'Подхватывает, когда основная упала или кончается баланс.'),
    },
    embedding: {
      label: say('Search', 'Поиск'),
      what: say('Turns lists into vectors — semantic search and precedents run on it.', 'Превращает списки в векторы — на ней держатся поиск и прецеденты.'),
    },
    council: {
      label: say('Council pool', 'Пул совета'),
      what: say('Handed to experts in turn; the 1st one also runs the intermediate steps, so it should be fast.', 'Раздаётся экспертам по кругу; 1-я ещё и ведёт промежуточные шаги — ей быть быстрой.'),
    },
    gnome: {
      label: say('Expert', 'Специалист'),
      what: say('This expert thinks with it instead of taking one from the pool.', 'Этот специалист думает ею вместо модели из пула.'),
    },
  }
}

/**
 * Собрать занятость: настройки ИИ (основная/запасная/эмбеддинги/пул) + личные модели ростера.
 * Ростер берём ПОЛНЫЙ (getRosterAll): выключенный специалист всё равно занимает модель — иначе
 * при его включении выбор объяснился бы «сам собой».
 */
export async function modelRoles(ru: boolean): Promise<ModelRolesResult> {
  const texts = roleTexts(ru)
  const [settings, roster, avatars] = await Promise.all([getAiSettings(), getRosterAll(), rosterAvatars()])
  const byModel = new Map<string, ModelRole[]>()
  const add = (model: string, role: ModelRole) => {
    const key = baseModelId((model || '').trim())
    if (!key) return
    const list = byModel.get(key)
    if (list) list.push(role)
    else byModel.set(key, [role])
  }

  add(settings.chatModel, { kind: 'chat', ...texts.chat })
  add(settings.fallbackModel, { kind: 'fallback', ...texts.fallback })
  add(settings.embeddingModel, { kind: 'embedding', ...texts.embedding })
  settings.councilModels.forEach((m, i) =>
    add(m, {
      kind: 'council',
      ...texts.council,
      // Номер значим: 1-я модель пула ведёт промежуточные шаги совета.
      label: `${texts.council.label} #${i + 1}`,
      order: i + 1,
    }),
  )
  for (const e of roster) {
    if (!e.model) continue // пусто = берёт модель из пула, отдельной занятости нет
    add(e.model, {
      kind: 'gnome',
      what: texts.gnome.what,
      label: ru ? e.nameRu : e.nameEn,
      gnomeId: e.id,
      avatarUrl: avatars[e.id] || `/gnomes/${e.avatar || e.id}.webp`,
    })
  }

  return { byModel, assigned: new Set(byModel.keys()) }
}
