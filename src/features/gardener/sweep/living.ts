// Рост живого списка: лента прибавляет пункты из потока, а не полируется.
// Причина измениться одна — как материал потока превращается в пункты и что
// считается «использованным событием».

import 'server-only'
import { sql } from 'drizzle-orm'
import { db, suggestions } from '@/shared/db'
import { notify } from '@/features/notifications/notify'
import { generateListRefine, type GeneratedItem } from '@/shared/ai/generate'
import type { ListKind } from '@/shared/ai/list-kind'
import { policyFor } from '@/shared/ai/gardener-policies'
import type { ReadinessInput } from '@/shared/ai/readiness-lenses'
import { freshForDomains, markUsed } from '@/shared/ai/feed-pick'
import { log } from '@/shared/observability'
import { recordAgentAction } from '@/shared/agents/policy'
import { toProposed } from '@/shared/lib/step-input'
import type { Lang } from '@/shared/i18n'
import { noteFor } from './policy'
import { publishGardenerVersion } from './publish'

/** Сколько новостей добавляем за один проход. Больше — и лента за раз меняется до неузнаваемости. */
const FEED_PER_UPDATE = 3

/**
 * Сколько пунктов держим в АКТУАЛЬНОЙ версии живого списка. Разбор ответа модели режет список
 * на 20 (`parseList`), поэтому предел нужен свой и ниже: иначе модель сама решала бы, что
 * выкинуть, ровно на границе. Вытесненное не теряется — предыдущие версии его хранят, и
 * история версий и есть «архив ленты».
 */
const FEED_MAX_ITEMS = 16

/**
 * РОСТ ЖИВОГО СПИСКА: добавить в ленту то, что пришло из потока.
 *
 * Отличие от полировки принципиальное. Обычный список улучшают: тот же материал, лучше
 * сказанный. Лента РАСТЁТ: приходит новое событие — появляется новый пункт, а старые уходят
 * вниз и в конце вытесняются в историю версий.
 *
 * Чего здесь нет намеренно:
 *   - нет вызова модели, когда потоку нечего дать. «Нет новостей» — это не «устоялся» и не
 *     повод для форка, это просто тишина: платить за неё нельзя;
 *   - нет пересказа. Промпт требует своей формулировки и практического пункта, а адрес
 *     источника уходит в `refs` пункта — сноска, а не копия. Тела статей у нас и не хранятся.
 */
export async function growLiving(
  tpl: { id: string; slug: string; tags: string[] },
  current: { title: string; desc: string; tags: string[]; items: GeneratedItem[] },
  lang: Lang,
  kind: ListKind,
  ctx: { tenderId: string; agentId: string; policyVersion: number; domains?: string[]; mode?: 'version' | 'suggestion'; ownerId?: string; baseVersion?: number },
): Promise<{ result: 'grown' | 'nothing-new' | 'failed'; snapshot?: ReadinessInput }> {
  // Ищем материал по тегам списка И по доменам мастера, который за него отвечает. Только по
  // тегам списка искать нельзя: теги списку придумала МОДЕЛЬ при создании («kubernetes», «ci»),
  // а тему подписки задавал ЧЕЛОВЕК («devops») — они законно не совпадают, и лента, которая
  // родилась из новости, больше никогда не нашла бы себе материала. Домен мастера — тот самый
  // мостик: по нему материал и достался ему в первый раз.
  const domains = [...new Set([...tpl.tags, ...(ctx.domains ?? [])])]
  const fresh = await freshForDomains(domains, FEED_PER_UPDATE)
  if (!fresh.length) return { result: 'nothing-new' }

  // События идут в ИНСТРУКЦИЮ, а она обёрнута spotlight внутри refine: заголовки чужих лент —
  // недоверенный ввод, и лента с инъекцией не должна перехватывать задачу.
  const events = fresh
    .map((f, i) => `${i + 1}. ${f.title}${f.publishedAt ? ` [${f.publishedAt.toISOString().slice(0, 10)}]` : ''} — ${f.url}${f.hint ? `\n   ${f.hint}` : ''}`)
    .join('\n')
  const instruction = `${policyFor(kind, {})}
GROW THE LIST, do not polish it. New events happened in this list's topic:
${events}

For EACH event add ONE new item at the TOP of the list:
- your OWN wording of what a person should DO about it — never a retelling or summary of the news;
- start the description with the event date if it is given;
- put the event URL into the item's refs (label = the source name).
Keep the existing items below in their current order and wording. If the list then has more than ${FEED_MAX_ITEMS} items, drop the OLDEST ones from the bottom — the version history keeps them.`

  const grown = await generateListRefine(current, instruction, lang, {
    userId: ctx.tenderId,
    feature: 'refine',
    refType: 'template',
    refId: tpl.id,
    kind,
  })
  if (!grown || !grown.items.length) return { result: 'failed' }

  // Модель могла вернуть тот же список (события проигнорированы). Тогда версии нет и материал
  // НЕ сжигаем: иначе новость исчезала бы, ни разу не появившись в ленте (находка Codex).
  const norm = (xs: GeneratedItem[]) => JSON.stringify(toProposed(xs, lang))
  if (norm(grown.items) === norm(current.items)) {
    log.info('gardener: living list unchanged, material kept', { slug: tpl.slug })
    return { result: 'failed' }
  }

  const items = toProposed(grown.items.slice(0, FEED_MAX_ITEMS), lang)
  if (ctx.mode === 'suggestion') {
    // Чужой живой список растёт ПРЕДЛОЖЕНИЕМ: свежесть ему нужна так же, как своему, но писать
    // в список человека от своего имени нельзя. Обе находки ревью держатся вместе только так.
    const [created] = await db
      .insert(suggestions)
      .values({
        templateId: tpl.id,
        authorId: ctx.tenderId,
        note: noteFor(kind, lang),
        baseVersion: ctx.baseVersion ?? 1,
        items,
        number: sql`(select coalesce(max(number), 0) + 1 from suggestions where template_id = ${tpl.id})`,
      })
      .returning({ id: suggestions.id })
    await notify({ recipientId: ctx.ownerId ?? '', actorId: ctx.tenderId, type: 'suggestion_new', templateId: tpl.id, suggestionId: created.id })
  } else {
    await publishGardenerVersion(tpl.id, items, { note: noteFor(kind, lang), authorId: ctx.tenderId })
  }
  // Материал списываем ПОСЛЕ версии: упади запись — новости остались бы «использованными»
  // без списка, и повод пропал бы навсегда.
  //
  // И списываем ТОЛЬКО то, что реально попало в результат. Проверки «список не изменился»
  // недостаточно: модель могла добавить два события из трёх, а помечались все — третье
  // исчезало навсегда, ни разу не появившись в ленте. Ищем адрес события в готовых
  // пунктах: промпт требует класть его в refs, значит адрес — честный признак того,
  // что событие обработано. Не нашли ни одного (модель переписала ссылки) — списываем
  // всё, как раньше: иначе одни и те же новости крутились бы вечно.
  const produced = JSON.stringify(items).toLowerCase()
  const landed = fresh.filter((f) => produced.includes(f.url.toLowerCase()))
  await markUsed((landed.length ? landed : fresh).map((f) => f.id), tpl.id)
  if (landed.length && landed.length < fresh.length) {
    log.info('gardener: часть событий не вошла в ленту — остаются для следующего прохода', {
      slug: tpl.slug,
      landed: landed.length,
      kept: fresh.length - landed.length,
    })
  }
  await recordAgentAction({
    loop: 'gardener',
    action: 'list.grow',
    resultStatus: 'ok',
    agentId: ctx.agentId,
    actorUserId: ctx.tenderId,
    signal: { templateId: tpl.id, slug: tpl.slug, events: fresh.length },
    decision: { mode: ctx.mode === 'suggestion' ? 'grow-feed-suggestion' : 'grow-feed', sources: fresh.map((f) => f.url).slice(0, FEED_PER_UPDATE) },
    resultRef: tpl.slug,
    policyVersion: ctx.policyVersion,
  })
  log.info('gardener: living list grown', { slug: tpl.slug, events: fresh.length })
  return {
    result: 'grown',
    snapshot: { title: grown.title || current.title, desc: grown.desc || current.desc, tags: grown.tags.length ? grown.tags : current.tags, items: grown.items.slice(0, FEED_MAX_ITEMS) },
  }
}
