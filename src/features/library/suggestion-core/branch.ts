// Предложение из ВЕТКИ: найти открытое или создать. Причина измениться одна —
// как терминальный путь (`refs/for/main`) заводит и находит своё предложение.

import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { db, suggestions } from '@/shared/db'
// eslint-disable-next-line boundaries/dependencies -- уведомления автору и наблюдателям: тот же кросс-фич-паттерн, что в actions.ts
import { notify } from '@/features/notifications/notify'
// eslint-disable-next-line boundaries/dependencies -- подписка автора: доменный порт curation, а не экшен (тот берёт сессию)
import { curationStore } from '@/features/curation/store'
import { SUGGESTION_NOTE_MAX } from './limits'

/**
 * ПЕРЕХОДНОЕ (живёт до снятия `actor_handle`): перевести предложение с ветки,
 * названной по нику, на ветку по идентификатору.
 *
 * Зачем. До Ф5 ветку правки называло ядро по НИКУ, теперь — по неизменному
 * идентификатору. Фронт и ядро выкатываются порознь, и в окно между выкатками
 * магический пуш ещё попадает в `u/<ник>/main`. После выката ядра ревизия того
 * же человека ложится уже в `u/<id>/main`, дедупликация идёт строго по ветке, и
 * вместо новой ревизии появлялось бы ВТОРОЕ предложение, а первое висело бы
 * открытым и обновить его было бы нечем (авто-ревью core#80).
 *
 * Подбор идёт по ТОЧНОМУ имени, которое вызывающий обязан назвать сам
 * (`legacyBranch`), а не по шаблону «любая ветка `u/…` этого автора». Шаблон
 * забирал бы и ветку, заведённую руками: `u/team/main` — законное имя, владелец
 * вправе запушить такую из терминала, и её предложение вместе с обсуждением
 * молча переехало бы на чужое содержимое (авто-ревью fe#662).
 *
 * Цена точности: если ник сменился между пушем и ревизией, перенос не
 * сработает и появится второе предложение. Это лучше, чем забрать чужое, — и
 * это ровно та ненадёжность ника, из-за которой от него и ушли.
 *
 * Ветку в git не трогаем: старая остаётся как есть, предложение просто смотрит
 * на новую, где лежит свежая ревизия.
 */
async function adoptLegacyHandleBranch(input: {
  templateId: string
  authorId: string
  branch: string
  legacyBranch?: string
}): Promise<string | null> {
  const legacyRef = input.legacyBranch
  if (!legacyRef || legacyRef === input.branch) return null
  const legacy = await db.query.suggestions.findFirst({
    where: (s) =>
      and(
        eq(s.templateId, input.templateId),
        eq(s.authorId, input.authorId),
        eq(s.status, 'open'),
        eq(s.branchRef, legacyRef),
      ),
  })
  if (!legacy) return null
  await db.update(suggestions).set({ branchRef: input.branch }).where(eq(suggestions.id, legacy.id))
  return legacy.id
}

/**
 * Предложение из ветки: найти открытое или создать.
 *
 * Общая часть ДВУХ путей — кнопки «Открыть предложение» в интерфейсе и
 * магического пуша `refs/for/main` из терминала (Ф4). Вынесена, а не
 * скопирована: нумерация, авто-подписка и уведомление владельца должны
 * совпадать, иначе предложение из терминала окажется второсортным — без номера
 * или без уведомления, и разница вылезет не сразу.
 *
 * Сессии здесь НЕТ намеренно: git-путь авторизован токеном, а не куками, и
 * `authorId` приходит уже проверенным. Поэтому и подписка идёт прямо в стор, а
 * не через `ensureWatch`, который берёт пользователя из сессии.
 *
 * Идемпотентна: повторный вызов на ту же ветку возвращает существующее
 * предложение. На этом держатся ревизии — повторный магический пуш двигает ту же
 * ветку и обновляет ТО ЖЕ предложение, а не плодит новые.
 */
export async function ensureBranchSuggestion(input: {
  templateId: string
  ownerId: string
  currentVersion: number
  authorId: string
  branch: string
  note?: string
  /** ПЕРЕХОДНОЕ: как эта же правка называлась до Ф5 (`u/<ник>/<база>`). См.
   *  `adoptLegacyHandleBranch`; убрать вместе с полем `actor_handle`. */
  legacyBranch?: string
}): Promise<{ id: string; created: boolean }> {
  const open = await db.query.suggestions.findFirst({
    where: (s) => and(eq(s.templateId, input.templateId), eq(s.branchRef, input.branch), eq(s.status, 'open')),
  })
  if (open) return { id: open.id, created: false }

  const adopted = await adoptLegacyHandleBranch(input)
  if (adopted) return { id: adopted, created: false }

  // onConflictDoNothing + перечитывание: проверка выше и вставка — два шага, и
  // между ними влезает параллельный запрос. Правило держит частичный уникальный
  // индекс suggestions_open_branch; здесь мы лишь корректно переживаем гонку,
  // возвращая победителя вместо ошибки.
  const [row] = await db
    .insert(suggestions)
    .values({
      templateId: input.templateId,
      authorId: input.authorId,
      note: (input.note ?? `Merge branch '${input.branch}'`).slice(0, SUGGESTION_NOTE_MAX),
      baseVersion: input.currentVersion,
      items: [], // источник правды — tip ветки, материализуется при просмотре
      branchRef: input.branch,
      number: sql`(select coalesce(max(number), 0) + 1 from suggestions where template_id = ${input.templateId})`,
    })
    .onConflictDoNothing()
    .returning({ id: suggestions.id })

  if (!row) {
    const winner = await db.query.suggestions.findFirst({
      where: (s) => and(eq(s.templateId, input.templateId), eq(s.branchRef, input.branch), eq(s.status, 'open')),
    })
    // Гонку проиграли — предложение уже создано параллельным запросом.
    if (winner) return { id: winner.id, created: false }
    throw new Error('suggestion insert conflicted but no open suggestion found')
  }

  await curationStore.ensureWatch(input.templateId, input.authorId)
  if (input.ownerId !== input.authorId) {
    await notify({
      recipientId: input.ownerId,
      actorId: input.authorId,
      type: 'suggestion_new',
      templateId: input.templateId,
      suggestionId: row.id,
    })
  }
  return { id: row.id, created: true }
}
