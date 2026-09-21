// Что происходит, когда садовник записал новую версию списка.
//
// Три шага всегда идут вместе — версия, уведомление наблюдателей, переиндексация, —
// и до 11.08 эта тройка была скопирована в трёх местах: рост живого списка, прямая
// правка своего списка, авто-мёрдж на кураторском. Порядок в копиях уже расходился,
// а забыть один шаг в четвёртой копии стоило бы тихой поломки: список правится, но в
// поиске остаётся прежним, а подписавшийся ничего не узнаёт.
//
// Причина измениться у модуля одна: меняется набор последствий записи.

import 'server-only'
import { ListWriteError } from '@/core'
import { listStore } from '@/features/library/list-store'
import { notifyMany } from '@/features/notifications/notify'
import { getWatcherIds } from '@/features/watch/queries'
import { enqueueReindex } from '@/features/library/jobs'
import { toStepInput } from '@/shared/lib/step-input'
import type { ProposedItem } from '@/shared/db'

/**
 * Записать версию от имени садовника и довести последствия до конца.
 *
 * `note` приходит снаружи: он описывает ПРИЧИНУ правки (полировка, рост ленты,
 * авто-мёрдж), а её знает вызывающий, не этот модуль.
 *
 * `afterVersion` — то, что обязано быть записано ДО того, как о версии узнают.
 * Порядок здесь нагружен, и это выяснилось дорого: авто-мёрдж на кураторском
 * списке помечает предложение принятым, и если делать это ПОСЛЕ уведомлений,
 * то сбой `getWatcherIds`/`enqueueReindex` оставит предложение открытым при уже
 * записанной версии — а следующий проход смёржит его повторно, второй такой же
 * версией. Обратный порядок в худшем случае теряет уведомление, и только.
 *
 * `expectedVersion` — версия, ИЗ КОТОРОЙ садовник прочитал состав (`snapshotOf`
 * берёт шаги ровно `tpl.currentVersion`). Обязательное поле, а не «если знаете»:
 * вызывающих трое, и необязательное означало бы, что защита есть у того, кто про
 * неё вспомнил.
 *
 * ЗДЕСЬ ОТКАЗ — ПРАВИЛЬНЫЙ ИСХОД, и это решение принято по маршруту отдельно.
 * Между чтением состава и записью стоят refine (или рост ленты), проверка ссылок и
 * линзы — десятки секунд платных вызовов. Если владелец за это время опубликовал
 * свою версию, садовник пишет содержимое, которого он уже не видел, и работа
 * человека исчезает из текущей версии. Человек при этом НЕ ЖДЁТ у экрана: проход
 * идёт по расписанию и повторится следующей ночью — уже от свежего состава. Цена
 * отказа — один платный вызов модели, цена записи — чужая правка.
 *
 * Отказ отдаётся ЗНАЧЕНИЕМ (`'stale'`), а не исключением: проход идёт партией по
 * спискам, и брошенное наружу исключение оборвало бы остальные кандидаты из-за
 * гонки на одном. Последствия записи при отказе не наступают ВООБЩЕ — версии нет,
 * значит и `afterVersion` (пометка предложения принятым) не срабатывает: оно
 * остаётся открытым и доедет следующим проходом.
 */
export async function publishGardenerVersion(
  templateId: string,
  items: ProposedItem[],
  opts: { note: string; authorId: string; expectedVersion: number; afterVersion?: () => Promise<void> },
): Promise<'published' | 'stale'> {
  try {
    await listStore.addVersion(templateId, {
      note: opts.note,
      steps: toStepInput(items),
      authorId: opts.authorId,
      expectedVersion: opts.expectedVersion,
    })
  } catch (e) {
    if (e instanceof ListWriteError && e.code === 'stale') return 'stale'
    throw e
  }
  await opts.afterVersion?.()
  await notifyMany(await getWatcherIds(templateId, 'versions'), { actorId: opts.authorId, type: 'new_version', templateId })
  await enqueueReindex(templateId)
  return 'published'
}
