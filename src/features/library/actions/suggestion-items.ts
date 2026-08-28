'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { blockComments, blockCommentThreads, db, suggestionReviews, suggestions, type ProposedItem } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { type Lang } from '@/shared/i18n'
import { notify } from '@/features/notifications/notify'
import { canEditList, editBlockReason } from '@/core'
import { parseEditorItems, toProposedItems } from '../editor'
import { toListContent } from '../list-content'
import { canEditSuggestionItems } from '../suggestion-perms'
import { suggestionBlocks } from '../suggestion-blocks'
import { applyFieldValue } from '../suggestion-apply'
import { gitPort, ownerHandle } from './shared'
import { NOREPLY_DOMAIN } from '@/shared/site'

/**
 * ПУНКТЫ предложения: правка редактором и применение предложенной правки одной
 * кнопкой. Причина измениться одна — где живут пункты и что происходит с ревью,
 * когда содержимое поменялось.
 *
 * `writeSuggestionItems` и `gitEmail` НЕ экспортируются намеренно: файл с
 * 'use server' делает каждый экспорт сетевой точкой входа, а этим двум быть
 * вызываемыми из браузера незачем.
 */

/**
 * ПРАВКА ПУНКТОВ предложения после создания — то, чего не было вовсе.
 *
 * До сих пор `suggestions.items` записывались ровно один раз, при создании: ни
 * второй человек не мог внести вклад, ни сам автор — поправить опечатку. На
 * GitHub на правку просто дописывают коммит; у нас пути не было.
 *
 * Один вход на оба вида предложений — разница только в том, где живут пункты:
 * у ветки это `list.json` в её tip (пишем коммитом, авторство человека
 * сохраняется в git), у старых предложений — колонка в БД.
 */
/**
 * Отказ на сохранении правки — ЗНАЧЕНИЕ, а не молчание и не переход.
 *
 * Форма правки предложения — это редактор со всеми пунктами. Три отказа здесь просто
 * ВОЗВРАЩАЛИСЬ: предложение успели закрыть, право на правку отозвали, список
 * заморозили — во всех трёх случаях человек жал «Сохранить» и не получал ничего:
 * ни сохранения, ни объяснения. Причём два первых означают «пока ты правил, снаружи
 * что-то изменилось» — то есть именно тот случай, где молчание хуже всего.
 */
export type EditItemsRefusal = 'closed' | 'not-allowed' | 'frozen' | 'archived' | string

export async function updateSuggestionItems(
  suggestionId: string,
  _prev: EditItemsRefusal | null,
  formData: FormData,
): Promise<EditItemsRefusal | null> {
  const session = await requireSession()
  const lang = await getLang()
  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId), with: { template: true } })
  if (!sug) return 'closed'
  if (sug.status !== 'open') return 'closed'
  if (!(await canEditSuggestionItems(sug, session.userId))) return 'not-allowed'
  const tpl = sug.template
  if (!canEditList(tpl)) return editBlockReason(tpl) === 'archived' ? 'archived' : 'frozen'

  const proposed = toProposedItems(parseEditorItems(formData.get('items')), lang)
  const err = await writeSuggestionItems(sug, proposed, session, lang, `Update suggestion by @${session.handle}`)
  const owner = await ownerHandle(tpl.ownerId)
  const path = `/${owner}/${tpl.slug}/suggestions/${sug.number ?? sug.id}`
  // Отказ записи (конфликт, отказ ядра) — тоже значением: он приходит на набранной
  // правке, и уносить её переходом значит требовать набрать заново.
  if (err) return err
  revalidatePath(path)
  redirect(path)
}

/**
 * ЗАПИСЬ предложенных пунктов — общая для правки редактором и для «применить
 * предложенную правку».
 *
 * Разница между видами предложений только в том, ГДЕ живут пункты: у ветки это
 * `list.json` в её tip, у старых — колонка БД. Два вызывающих не должны знать
 * этой развилки по отдельности, иначе один из них рано или поздно забудет про
 * ветку (ровно так комментарии к пунктам не создавались на branch-PR).
 *
 * Возвращает код ошибки для `?e=`, либо null при успехе.
 */
async function writeSuggestionItems(
  sug: { id: string; authorId: string; branchRef: string | null; coauthorIds: unknown; template: { id: string; ownerId: string; slug: string; currentVersion: number } },
  proposed: ProposedItem[],
  session: { userId: string; handle: string },
  lang: Lang,
  message: string,
): Promise<string | null> {
  const tpl = sug.template
  const owner = await ownerHandle(tpl.ownerId)

  if (sug.branchRef) {
    // Пункты ветки живут в git. Базу берём из снапшота: заголовок/теги/порядок
    // принадлежат ветке, а не БД, и перетирать их правкой пунктов нельзя.
    const { gitCore, BranchOpError } = await gitPort()
    const snap = await gitCore.branchSnapshot({ owner, slug: tpl.slug }, sug.branchRef).catch(() => null)
    if (!snap) return 'not-found'
    // Содержимое версии, а не готовый файл: канон собирает ядро (владелец формата).
    // Раскладка ОБЩАЯ с показом канона текстом (Ф4) — см. toListContent: до этого
    // она жила здесь инлайном и была уже третьей копией конвертера шагов.
    const content = toListContent(
      proposed,
      { title: snap.title, desc: snap.desc, tags: snap.tags, ordered: snap.ordered, version: tpl.currentVersion + 1 },
      lang,
    )
    try {
      // expectedTip — снапшот, который правил человек: если ветку подвинули, пишем
      // не поверх чужого пуша, а честно отказываем.
      await gitCore.commitToBranch({ owner, slug: tpl.slug }, sug.branchRef, content, {
        message,
        expectedTip: snap.tipSha,
        author: { name: session.handle, email: gitEmail(session.handle) },
      })
    } catch (e) {
      return e instanceof BranchOpError ? e.code : 'internal'
    }
  } else {
    await db.update(suggestions).set({ items: proposed }).where(eq(suggestions.id, sug.id))
  }

  // СОДЕРЖИМОЕ ИЗМЕНИЛОСЬ → прежние одобрения к нему не относятся. Рецензент
  // одобрял то, что читал; без сброса автор мог дождаться нужного числа одобрений,
  // подменить пункты и слить непроверенное — гейт «нужно N одобрений» становился
  // формальностью. Так же поступает GitHub с dismiss stale reviews.
  //
  // Снимаем ТОЛЬКО «одобряю»: «просит доработать» относится к самой правке, и
  // стирать его правкой значило бы дать обход блокировки — достаточно было бы
  // тронуть пункт. Комментарии тоже остаются: они не гейт.
  await db
    .delete(suggestionReviews)
    .where(and(eq(suggestionReviews.suggestionId, sug.id), eq(suggestionReviews.verdict, 'approve')))

  // Соавторство: правку внёс не автор — запоминаем, иначе вклад исчезнет
  // (у ветки он остался бы в git, у items — нигде).
  if (sug.authorId !== session.userId) {
    const prev = (sug.coauthorIds as string[] | null) ?? []
    if (!prev.includes(session.userId)) {
      await db.update(suggestions).set({ coauthorIds: [...prev, session.userId] }).where(eq(suggestions.id, sug.id))
    }
    await notify({
      recipientId: sug.authorId,
      actorId: session.userId,
      type: 'suggestion_edited',
      templateId: tpl.id,
      suggestionId: sug.id,
    })
  }
  return null
}

/**
 * ПРИМЕНИТЬ предложенную правку пункта одной кнопкой.
 *
 * Наш случай сильнее, чем у GitHub: там suggested change — патч строк файла, и он
 * рассыпается, стоит строкам уехать. У нас тред знает БЛОК (устойчивая
 * идентичность, ADR-0013) и ПОЛЕ, поэтому применение — это подстановка значения:
 * пункт можно было переставить, переименовать соседей — правка всё равно ляжет
 * туда, куда задумано.
 *
 * Право — то же, что у правки пунктов: применяет тот, кто и так мог бы вписать
 * этот текст руками.
 */
export async function applySuggestedEdit(commentId: string): Promise<void> {
  const session = await requireSession()
  const lang = await getLang()
  const [row] = await db
    .select({
      suggestedText: blockComments.suggestedText,
      appliedAt: blockComments.appliedAt,
      pending: blockComments.pending,
      threadId: blockCommentThreads.id,
      blockId: blockCommentThreads.blockId,
      field: blockCommentThreads.field,
      suggestionId: blockCommentThreads.suggestionId,
    })
    .from(blockComments)
    .innerJoin(blockCommentThreads, eq(blockCommentThreads.id, blockComments.threadId))
    .where(eq(blockComments.id, commentId))
    .limit(1)
  // Черновик ещё никому не показан — применять нечего.
  if (!row || row.suggestedText === null || row.appliedAt || row.pending) return

  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, row.suggestionId), with: { template: true } })
  if (!sug || sug.status !== 'open') return
  if (!(await canEditSuggestionItems(sug, session.userId))) return
  const tpl = sug.template
  if (!canEditList(tpl)) return

  const owner = await ownerHandle(tpl.ownerId)
  const path = `/${owner}/${tpl.slug}/suggestions/${sug.number ?? sug.id}`
  // Пункты берём тем же правилом, что и вся страница: у ветки — из tip.
  const items = await suggestionBlocks(sug, owner, tpl.slug)
  const idx = items.findIndex((it) => it.blockId === row.blockId)
  if (idx < 0) redirect(`${path}?e=orphaned`) // блок исчез — применять некуда

  const next = items.map((it, i) => (i === idx ? applyFieldValue(it, row.field, row.suggestedText!, lang) : it))
  const err = await writeSuggestionItems(sug, next, session, lang, `Apply suggestion from @${session.handle}`)
  if (err) redirect(`${path}?e=${err}`)

  // Применили — отмечаем и закрываем тред: обсуждать больше нечего (так же
  // поступает GitHub, и без этого счётчик нерешённых врал бы.)
  await db.update(blockComments).set({ appliedAt: new Date() }).where(eq(blockComments.id, commentId))
  await db
    .update(blockCommentThreads)
    .set({ resolvedAt: new Date(), resolvedById: session.userId })
    .where(eq(blockCommentThreads.id, row.threadId))
  revalidatePath(path)
  redirect(path)
}

/**
 * Адрес для авторства коммита — ВСЕГДА стабильный noreply по нику.
 *
 * Раньше сюда подставлялась почта аккаунта. Список публичный и клонируется целиком:
 * почта уезжала в git-историю навсегда и доставалась любому, кто сделал clone. При
 * этом человек её оставлял для входа и писем, а не для публикации — согласия на
 * публикацию он не давал.
 *
 * Ник и так виден на странице, поэтому авторство остаётся человеческим: `@ник` в
 * имени, стабильный адрес в поле почты. Захочет показать настоящую — это отдельная
 * осознанная настройка, а не поведение по умолчанию.
 */
function gitEmail(handle: string): string {
  return `${handle}@${NOREPLY_DOMAIN}`
}
