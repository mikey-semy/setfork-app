'use server'

import { classifyListLang } from '@/shared/i18n/detect-text-lang'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, repositories, steps, templates, users, type ProposedItem } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { trKey, type LocaleText } from '@/shared/i18n'
import { isContentLang } from '@/shared/i18n/iso639'
import { listQuota } from '@/shared/quota'
import { toStepInput } from '@/shared/lib/step-input'
import { canEditList, editBlockReason, ListWriteError } from '@/core'
import { DestructiveCommandError, findDestructiveSteps } from '@/core/domain/destructive-command'
import { findSecretInContent, SecretFoundError } from '@/core/domain/secret-scan'
import { parseDraftRef, publishHeldQuery, saveOutcomeQuery, shouldHoldPublish } from '../save-outcome'
import { isCollaborator } from '@/features/collab/queries'
// eslint-disable-next-line boundaries/dependencies -- полки принадлежат каталогам; правило «положить на полку» держим ОДНОЙ точкой на все три входа (форма, MCP, пачка MCP), а не копией здесь
import { assignCatalogByName } from '@/features/catalogs/assign'
import { registerTags } from '@/features/tags/service'
import { ensureWatch } from '@/features/watch/actions'
import { parseEditorItems, toProposedItems } from '../editor'
import { fileRefusalWarning, parseEditorFiles } from '../editor-files'
import { carryField } from '../translation-carry'
import { getDraft, getVersionSteps } from '../queries'
import { publishOwnedDraft } from '../publish-draft'
import { deleteDraftIfUnchanged, publishDraftFor, upsertDraft, type DraftRef, type PublishResult } from '../draft'
import { listStore } from '../list-store'
import { VERSION_ERR } from '../version-error'
import { parseTags, slugify } from '../slug'
import { notifyWatchersNewVersion } from '../suggestion-side-effects'
import { enqueueReindex } from '../jobs'
import { authoredFilesOf, ownerHandle } from './shared'

/**
 * Жизнь содержимого списка: создание, правка метаданных, новая версия, черновик
 * правок к опубликованному, публикация и откат к прошлой версии.
 *
 * Одна причина меняться на весь файл — правила записи версии; предложения чужих
 * правок и настройки списка живут отдельно, хотя и зовут отсюда общее.
 */

// ── Создание списка ───────────────────────────────────────────────────

/**
 * Отказ рождения списка — ЗНАЧЕНИЕ, а не переход на адрес с `?e=`.
 *
 * Форма `/new` — это редактор блоков: название, описание, теги и все пункты. Переход
 * начинал новый GET, и человек терял ВСЁ введённое, а не только повод для отказа. Цена
 * ошибки «адрес занят» была «набери список заново» (указано авто-ревью #829).
 *
 * Возврат значения этого не делает: страница не перерисовывается с нуля, состояние
 * редактора остаётся, а сообщение показывается над формой.
 */
export type NewListRefusal =
  | { kind: 'slug_taken'; slug: string }
  | { kind: 'blocked'; reason: string; step: number }
  /** Ключ доступа в содержимом: вид (код правила) и шаг; шаг 0 — название или описание. */
  | { kind: 'secret'; rule: string; provider: string; step: number }
  | { kind: 'list_quota'; limit: number }
  | { kind: 'no_title' }

/**
 * Язык интерфейса как запасной язык нового списка — если текст ему не противоречит. Уверенная
 * догадка по тексту (`classifyListLang`: ru или en) против языка интерфейса — языка не пишем:
 * пусто лучше неверного, пустой язык угадывается по алфавиту. Смесь или пусто — противоречия нет.
 */
function fallbackUnlessContradicted(uiLang: string, texts: string[]): string | null {
  const guess = classifyListLang(texts, false)
  return (guess === 'ru' || guess === 'en') && guess !== uiLang ? null : uiLang
}

export async function createTemplate(_prev: NewListRefusal | null, formData: FormData): Promise<NewListRefusal | null> {
  const session = await requireSession()
  const uiLang = await getLang()
  const title = String(formData.get('title') ?? '').trim()
  const desc = String(formData.get('desc') ?? '').trim()
  const tags = parseTags(formData.get('tags'))
  const visibility = formData.get('visibility') === 'private' ? 'private' : 'public'
  const ordered = formData.get('ordered') !== 'unordered'
  const gated = formData.get('gated') === 'on'
  // Пустое название раньше просто НИЧЕГО не делало: человек жал «Создать» и не получал
  // ни списка, ни объяснения. `required` в разметке прикрывает обычный путь, но не
  // отправку без JS и не одни пробелы в поле.
  if (!title) return { kind: 'no_title' }
  // Квота на число списков (мягкая защита от абьюза; админ без лимита).
  const quota = await listQuota(session.userId, session.handle)
  if (!quota.ok) return { kind: 'list_quota', limit: quota.limit }

  // Текст нового списка ложится под ЯЗЫК ОРИГИНАЛА: настройка «язык моих списков», иначе язык
  // интерфейса (ADR-0030). Иначе у автора с русским интерфейсом и настройкой `be` белорусский
  // текст лёг бы под `ru`, а список объявил бы себя белорусским — ключ и язык разошлись бы.
  // Запрос — ПОСЛЕ отказов выше: им база не нужна.
  const [me] = await db.select({ listLang: users.listLang }).from(users).where(eq(users.id, session.userId)).limit(1)
  const lang = isContentLang(me?.listLang) ? me.listLang : uiLang
  const proposed = toProposedItems(parseEditorItems(formData.get('items')), lang)

  let slug = slugify(title)
  const owned = await db
    .select({ slug: templates.slug })
    .from(templates)
    .where(and(eq(templates.ownerId, session.userId), eq(templates.slug, slug)))
  if (owned.length) slug = `${slug}-${Date.now().toString(36).slice(-4)}`

  // Страж исполняемых команд стоит в фасаде записи и на СОЗДАНИИ тоже. Без разбора
  // отказа человек получил бы общую ошибку серверного действия («что-то пошло не
  // так») вместо объяснения, какой шаг и чем именно не годится.
  let list
  try {
    list = await listStore.create({
      ownerId: session.userId,
      // Автор пишет на языке интерфейса — это запасной язык списка; настройка «язык моих
      // списков» старше (ADR-0030, решает фасад). ⚠️ Но только если текст ему не противоречит:
      // английский список автора с русским интерфейсом иначе навсегда записался бы русским, и
      // робот увидел бы русскую страницу над английским текстом (ревью по линзам).
      langFallback: fallbackUnlessContradicted(lang, [title, desc ?? '', ...proposed.map((p) => `${p.title ?? ''} ${p.desc ?? ''}`)]),
      slug,
      title: { [lang]: title },
      desc: desc ? { [lang]: desc } : {},
      tags,
      ordered,
      visibility,
      status: 'published',
      origin: 'authored',
      note: 'initial',
      steps: toStepInput(proposed),
    })
  } catch (e) {
    if (e instanceof DestructiveCommandError) return { kind: 'blocked', reason: e.reason, step: e.stepIndex }
    if (e instanceof SecretFoundError) return { kind: 'secret', rule: e.match.rule, provider: e.match.provider, step: e.stepIndex }
    // Адрес занят: возвращаем человека в форму с названной причиной, а не роняем в
    // страницу ошибки Next. До 27.08.2026 сюда попадал ЛЮБОЙ отказ ядра и уходил в
    // `throw` — вертикаль «собрать список» показала, что причина, которую ядро честно
    // шлёт трейлером, на этом пути не читалась никем. Занятый адрес — самый частый из
    // отказов рождения и единственный, который человек может исправить сам.
    if (e instanceof ListWriteError && e.code === 'exists') return { kind: 'slug_taken', slug }
    throw e
  }
  if (gated) await db.update(templates).set({ gated: true }).where(eq(templates.id, list.id)) // course quiz-gate
  await assignCatalogByName(list.id, session.userId, String(formData.get('catalog') ?? ''))
  await registerTags(tags) // новые теги → в реестр
  await ensureWatch(list.id) // владелец следит за своим списком
  // Гейта публикации здесь больше нет: состояние решено ДО записи и приехало значением
  // вставки (фасад listStore.create), а проверку в очередь ставит тот же фасад.
  await enqueueReindex(list.id) // авто-индексация в поиск (через очередь)

  redirect(`/${await ownerHandle(session.userId)}/${slug}`)
}

// ── Владелец: правка метаданных списка (название/описание/теги/порядок) ──
// slug НЕ трогаем — он технический и авто-генерённый, пользователя не касается.
// title/desc меняем в ТЕКУЩЕМ языке интерфейса, значения на других языках сохраняем
// (carryField — то же правило, что у шагов: не тронул поле — прежнее значение
// целиком). Простое слияние `{...prev, [lang]: title}` здесь не годилось: поле,
// показанное ОТКАТОМ на другой язык, при каждом сохранении записывало чужой текст
// как перевод — и кнопка «Перевести» считала, что переводить уже нечего.
export async function updateListMeta(templateId: string, formData: FormData): Promise<void> {
  const session = await requireSession()
  const lang = await getLang()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl || tpl.ownerId !== session.userId) return
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return // название обязательно
  const desc = String(formData.get('desc') ?? '').trim()
  const tags = parseTags(formData.get('tags'))
  const ordered = formData.get('ordered') !== 'unordered'
  // Язык оригинала (ADR-0030): код ISO 639-1 или пусто — «не задан». Чужое значение не пишем.
  const rawSource = String(formData.get('sourceLang') ?? '')
  const sourceLang = rawSource === '' ? null : isContentLang(rawSource) ? rawSource : tpl.lang
  // ⚠️ Ключ — тот, что форма ПОКАЗАЛА (`trKey`), а не язык интерфейса: белорусское название,
  // открытое русским интерфейсом без перевода, иначе сохранилось бы под `ru` рядом с `be`, и
  // оригинал раздвоился бы. Нечего было показать — язык оригинала, иначе интерфейса.
  const keyFor = (text: LocaleText) => trKey(text, lang) ?? (isContentLang(sourceLang) ? sourceLang : lang)
  // Мета пишется здесь МИМО фасада, и его страж ключей её не видит. Название публичного
  // списка видно в ленте и поиске раньше шагов — ключ в нём утекает первым.
  const leak = findSecretInContent([], undefined, { title, desc, tags })
  if (leak) redirect(`/${session.handle}/${tpl.slug}/settings?secret=${leak.match.rule}&step=0`)
  await db
    .update(templates)
    .set({
      title: carryField({ [keyFor(tpl.title as LocaleText)]: title }, tpl.title as LocaleText),
      desc: carryField(desc ? { [keyFor(tpl.desc as LocaleText)]: desc } : {}, tpl.desc as LocaleText),
      lang: sourceLang,
      tags,
      ordered,
      updatedAt: new Date(),
    })
    .where(eq(templates.id, templateId))
  await registerTags(tags)
  revalidatePath(`/${session.handle}/${tpl.slug}`)
  revalidatePath(`/${session.handle}/${tpl.slug}/settings`)
}

// ── Владелец: сохранить как новую версию ─────────────────────────────
// ── Черновик правок к опубликованному списку ──────────────────────────
/**
 * РАБОЧАЯ КОПИЯ вместо версии на каждую правку (решение владельца 04.08.2026:
 * «из-за одного символа менять версию не хочется»). Правки копятся в черновике
 * сколько угодно раз, а версия создаётся ОДНА — явной публикацией.
 *
 * Черновик у каждого автора свой (владелец, соавторы): общая копия затиралась бы
 * при параллельной работе. base_version запоминает, от чего правили, — если список
 * успел уйти вперёд, публикация об этом скажет, а не перезапишет чужое молча.
 */
export async function saveDraft(templateId: string, formData: FormData): Promise<void> {
  const { tpl, handle, overwrote, destructive, secret, file } = await upsertDraftFromForm(templateId, formData, 'save')
  revalidatePath(`/${handle}/${tpl.slug}`, 'layout')
  // ⚠️ СОХРАНЯЕМ ВСЕГДА, НО ГОВОРИМ ПРАВДУ О ПОСЛЕДСТВИЯХ.
  //
  // Отказать здесь нельзя: форма серверная, отказ уходит редиректом, страница
  // перечитывает черновик из базы — и набранное пропадает. Отказ, после которого
  // работа потеряна, хуже той гонки, от которой он защищает. Поэтому запись идёт, а
  // человек узнаёт, что именно случилось:
  //   over=1      — его состав лёг поверх правок, пришедших через агента в тот же
  //                 черновик (до этого обе стороны не узнавали ни о чём);
  //   warn=destructive — в шаге есть запрещённая команда, и публикация откажет. Раньше
  //                 этот отказ приходил ПОЗЖЕ и ДРУГОМУ человеку — владельцу, нажавшему
  //                 «Опубликовать», по шагу, которого он не писал.
  //   warn=secret — в шаге ключ доступа, и публикация откажет по той же причине.
  redirect(`/${handle}/${tpl.slug}/edit?${saveOutcomeQuery({ overwrote, destructiveStep: destructive?.step ?? null, secret, file })}`)
}

/**
 * Опубликовать ТО, ЧТО СЕЙЧАС В РЕДАКТОРЕ: сначала сохраняем состав формы в черновик,
 * потом публикуем его. Кнопка публикации живёт в той же форме, что и «сохранить», —
 * иначе она уносила бы предыдущее сохранение, а всё дописанное после него пропадало
 * бы молча (находка self-review).
 */
export async function publishEdits(templateId: string, formData: FormData): Promise<void> {
  // Режим передаётся ВНУТРЬ общей записи, а исход наружу не возвращается. Так сделано
  // намеренно: первая редакция возвращала `overwrote` вызывающему, и `publishEdits`
  // его выбрасывал — сторож срабатывал, а дверь открывалась. Пока решение принимает
  // вызывающий, его можно забыть принять; здесь забыть нечего.
  const { saved } = await upsertDraftFromForm(templateId, formData, 'publish')
  // ⚠️ Публикуем ИМЕННО сохранённый снимок. Запись отпустила замок, а публикация
  // читает черновик заново — в зазор успевает `patch_list(publish:false)`, и в версию
  // уходит текст, которого человек не видел. Удержание от затирания это не ловит: оно
  // смотрело до зазора (P1 авто-ревью по #945).
  await publishDraft(templateId, {
    listVersion: saved.listVersion,
    draft: { id: saved.id, rev: saved.rev },
  })
}

/**
 * Общая часть: собрать черновик из формы редактора и записать его.
 *
 * `mode` говорит, что будет дальше. В режиме `publish` затирание ОСТАНАВЛИВАЕТ поездку
 * прямо здесь — иначе исход пришлось бы возвращать наверх и надеяться, что там его
 * разберут; именно так он однажды и потерялся (P1 авто-ревью по #945).
 */
async function upsertDraftFromForm(templateId: string, formData: FormData, mode: 'save' | 'publish') {
  const session = await requireSession()
  const [lang, tpl] = await Promise.all([getLang(), db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })])
  if (!tpl) redirect('/')
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) redirect('/')
  if (!canEditList(tpl)) redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}?e=${editBlockReason(tpl) ?? 'frozen'}`)

  const items = toProposedItems(parseEditorItems(formData.get('items')), lang)
  const meta = {
    tags: parseTags(formData.get('tags')),
    ordered: formData.get('ordered') !== 'unordered',
    gated: formData.get('gated') === 'on',
  }
  const note = String(formData.get('note') ?? '').trim()
  const handle = await ownerHandle(tpl.ownerId)
  // Файлы автора — полным набором, если их трогали; не трогали — поля нет, и черновик
  // держит то, что в нём было (см. `parseEditorFiles`).
  const authored = parseEditorFiles(formData.get('authored'))
  if (authored === 'bad') redirect(`/${handle}/${tpl.slug}/edit?e=files-bad`)
  // Какой черновик видел автор: разбирается ЗДЕСЬ, до любых действий. Раньше разбор
  // стоял ниже, и ранняя ветка «состав опустел» успевала удалить черновик, ни с чем
  // его не сверив, — самое необратимое действие оказывалось единственным без проверки.
  const expected = parseDraftRef(formData.get('draftRef'))
  // Пустой состав в черновике не храним: он подменил бы опубликованный список
  // пустотой в редакторе, а опубликовать его всё равно нельзя.
  if (items.length === 0) {
    const { overwrote } = await deleteDraftIfUnchanged(tpl, session.userId, expected)
    // Расхождение — не удаляем: человек убрал бы вместе со своим и чужое, не увидев.
    redirect(`/${handle}/${tpl.slug}/edit?${overwrote ? 'saved=1&over=1&held=1' : 'e=empty'}`)
  }
  // base_version НЕ переписываем у уже устаревшего черновика: сдвинуть его значит
  // сказать «правки сделаны от свежей версии», а они сделаны от старой — и следующая
  // публикация затёрла бы чужую работу молча. Признак устаревания снимает только
  // осознанный отказ от правок (discardDraft), а не автосохранение.
  // Какой черновик видел автор: форма несёт строку и её номер, чтобы запись могла
  // понять, не подменили ли черновик, пока редактор был открыт.
  const saved = await upsertDraft(tpl, session.userId, { items, meta, note, authored }, { expected })
  const overwrote = saved.overwrote
  // ⚠️ Публикация поверх обнаруженного затирания НЕ ИДЁТ. Отказ здесь безопасен, в
  // отличие от «Сохранить»: черновик уже записан строкой выше, набранное не теряется.
  // Человек читает, что случилось, и жмёт «Опубликовать» второй раз — страница к тому
  // моменту перечитала черновик, ревизия совпадает, публикация проходит.
  if (mode === 'publish' && shouldHoldPublish({ overwrote })) {
    revalidatePath(`/${handle}/${tpl.slug}`, 'layout')
    redirect(`/${handle}/${tpl.slug}/edit?${publishHeldQuery()}`)
  }
  // Страж исполняемых команд — ТОТ ЖЕ, что на обеих ветках MCP. Здесь он не отказывает,
  // а предупреждает: см. комментарий в `saveDraft` про цену отказа в серверной форме.
  const [first] = findDestructiveSteps(items)
  // Ключ доступа — то же самое: черновик видит только автор, а публикация откажет.
  const leak = findSecretInContent(items)
  const secret = leak ? { step: leak.step, rule: leak.match.rule } : null
  // Файлы — те же стражи: скрипт судится по языку, ключ ищется во всех.
  const file = authored ? fileRefusalWarning(authored) : null
  return { tpl, handle, overwrote, saved, destructive: first ? { step: first.index + 1 } : null, secret, file }
}

/** Убрать черновик и вернуться к опубликованному состоянию. */
export async function discardDraft(templateId: string, formData?: FormData): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return
  // ⚠️ ТРЕТЬЯ ВЕТКА, которая удаляла черновик вовсе без сверки. «Отказаться от правок» —
  // про СВОИ правки; если в тот же черновик успел дописать агент, человек отказывается
  // и от чужого, о чём не знает. Останавливаемся один раз и показываем, что там есть.
  const expected = parseDraftRef(formData?.get('draftRef'))
  const { overwrote } = await deleteDraftIfUnchanged(tpl, session.userId, expected)
  if (overwrote) {
    const owner = await ownerHandle(tpl.ownerId)
    revalidatePath(`/${owner}/${tpl.slug}`, 'layout')
    redirect(`/${owner}/${tpl.slug}/edit?saved=1&over=1&held=1`)
  }
  const handle = await ownerHandle(tpl.ownerId)
  revalidatePath(`/${handle}/${tpl.slug}`, 'layout')
  redirect(`/${handle}/${tpl.slug}`)
}

/** Отказ публикации → причина в адресе редактора. Одна таблица, а не лесенка тернарников:
 *  новая причина без строки здесь не соберётся (`Record` по всем кодам). */
const PUBLISH_REASON: Record<Extract<PublishResult, { error: string }>['error'], string> = {
  stale: 'stale',
  empty: 'empty',
  'out-of-sync': 'outofsync',
  moved: 'moved',
  'no draft': 'nodraft',
  'files-invalid': 'files-invalid',
  'files-unsupported': 'files-unsupported',
}

/**
 * Опубликовать накопленный черновик ОДНОЙ версией. Путь записи тот же, что у
 * обычного сохранения (ListStore.addVersion → git-коммит + проекция), — черновик
 * лишь копил состав, поэтому публикация ничем не отличается от прежней правки.
 *
 * Если список успел уйти вперёд (кто-то опубликовал версию, пока правки лежали в
 * черновике), публикацию не делаем: молча перезаписать чужую работу хуже, чем
 * попросить перечитать. Автор увидит это на странице редактора.
 */
async function publishDraft(templateId: string, expect?: DraftRef): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return
  const handle = await ownerHandle(tpl.ownerId)
  if (!canEditList(tpl)) redirect(`/${handle}/${tpl.slug}?e=${editBlockReason(tpl) ?? 'frozen'}`)

  // Теги черновика в реестр здесь БОЛЬШЕ НЕ ЗОВЁМ: это делает сама публикация черновика
  // (features/library/draft), одной точкой на веб и MCP. Ручной вызов на каждом входе
  // однажды уже разъехался — у MCP его просто не было.
  let res: PublishResult
  try {
    res = await publishDraftFor(tpl, session.userId, undefined, { expect })
  } catch (e) {
    // Запрещённая команда — показываем автору причину и номер шага, как при
    // обычном сохранении: молчаливый отказ читается как «кнопка не работает».
    // Место — шаг либо файл автора: «шаг 0» человек не нашёл бы нигде.
    const file = (path?: string) => (path ? `&file=${encodeURIComponent(path)}` : '')
    if (e instanceof DestructiveCommandError) redirect(`/${handle}/${tpl.slug}/edit?blocked=${e.reason}&step=${e.stepIndex}${file(e.path)}`)
    if (e instanceof SecretFoundError) redirect(`/${handle}/${tpl.slug}/edit?secret=${e.match.rule}&step=${e.stepIndex}${file(e.path)}`)
    throw e
  }
  // Причины РАЗНЫЕ: «нечего публиковать» и «черновик опустел» — разные сообщения,
  // иначе человек читает про удаление, которого не было.
  if ('error' in res) {
    // `moved` — черновик подменили между сохранением и публикацией. Причина своя:
    // «нечего публиковать» и «опубликовали бы не то, что вы видели» — разные вещи,
    // и второе требует посмотреть состав, а не нажать ещё раз наугад.
    const reason = PUBLISH_REASON[res.error]
    // Отказ ядра по файлам называет файл и предел — его текст едет на страницу.
    const detail = res.detail ? `&fd=${encodeURIComponent(res.detail)}` : ''
    redirect(`/${handle}/${tpl.slug}/edit?e=${reason}${detail}`)
  }
  await notifyWatchersNewVersion(tpl.id, session.userId)
  await enqueueReindex(tpl.id)
  revalidatePath(`/${handle}/${tpl.slug}`, 'layout')
  // Версия вышла (наблюдатели о ней узнали), а набор файлов ядро не подтвердило: правка
  // файлов осталась в черновике поверх новой версии. Вернуть в редактор и сказать — иначе
  // человек уйдёт, решив, что файлы опубликованы.
  redirect(res.filesNotApplied ? `/${handle}/${tpl.slug}/edit?e=files-not-applied` : `/${handle}/${tpl.slug}`)
}

// ── Возврат к прошлой версии ──────────────────────────────────────────
/**
 * «Вернуть эту версию» — семантика revert из GitHub: содержимое версии N
 * копируется в НОВУЮ версию N+1, история не переписывается и не теряется
 * (откат самого отката тоже возможен). Идёт через ListStore.addVersion —
 * тот же путь, что у обычного сохранения, включая запись в git.
 *
 * `expectedVersion` ЗДЕСЬ НЕТ — и это решение, а не пропуск (принято при разборе
 * маршрутов записи вместе с переводом, садовником и `update_list`, где он появился).
 * Основание у отката — не «то, что я читал», а НАЗВАННАЯ версия N: действие значит
 * «пусть содержимым снова станет v3», и оно одинаково осмысленно при текущей v7 и при
 * v8, легшей секундой раньше. Отказ «список изменился» тут ничего не спас бы: откат и
 * так объявлен перезаписывающим — он отбрасывает всё после v3, и v8 в том числе.
 * Про окно важно сказать честно: значимое окно здесь НЕ в коде. Между чтением снимка и
 * записью действительно доли секунды, но страница истории отрисована раньше, и между её
 * рендером и нажатием проходит сколько угодно времени. Решение держится не на узости
 * окна, а на том, ЧТО ОЗНАЧАЕТ действие: человек выбрал версию по номеру и согласился
 * заменить ею текущее содержимое — вместе со всем, что появилось после неё.
 */
export async function revertToVersion(templateId: string, version: number): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return
  // Возвращать можно только к существующей ПРОШЛОЙ версии (текущая — не откат).
  if (!Number.isInteger(version) || version < 1 || version >= tpl.currentVersion) return

  const snap = await getVersionSteps(tpl.id, version)
  if (!snap) return
  const handle = await ownerHandle(tpl.ownerId)
  // Файлы — ТОЙ версии, к которой возвращаемся: «пусть содержимым снова станет v3»
  // касается и `scripts/`. Не прочитались — отказ с причиной, а не откат блоков при
  // чужих файлах.
  const authored = await authoredFilesOf(handle, tpl.slug, version).catch(() => null)
  if (authored === null) redirect(`/${handle}/${tpl.slug}/versions?e=files-unreadable`)

  try {
    await listStore.addVersion(tpl.id, {
      note: `revert to v${version}`,
      steps: toStepInput(snap.steps as unknown as ProposedItem[]),
      authorId: session.userId,
      authored,
    })
  } catch (e) {
    // Отказ записи — не сбой кнопки: без этой ветки человек получал безымянный
    // экран ошибки и не мог узнать, что откат вообще не при чём. Ведём туда,
    // ОТКУДА нажали, — в историю версий, и своим текстом: сообщение экрана правки
    // обещает, что черновик цел, а у отката черновика обычно нет вовсе (замечание
    // авто-ревью на #824).
    //
    // Перечислять коды здесь НЕЛЬЗЯ: своего гейта у этой кнопки нет (`canEditList`
    // не спрашивается вовсе), и барьер фасада для неё — единственная проверка.
    // Пока ветка знала один код, архив и заморозка улетали наружу безымянными.
    // Теперь код едет в адрес как есть, а текст ему подбирает VERSION_ERR — общая
    // со страницей таблица, и код без текста туда не попадёт (узда).
    if (e instanceof ListWriteError && VERSION_ERR[e.code]) {
      redirect(`/${handle}/${tpl.slug}/versions?e=${e.code}`)
    }
    // Старая версия может нести то, что сейчас не принимается (команду или ключ, которые
    // тогда ещё не проверялись): откат — новая версия, и страж её не пропустит.
    if (e instanceof DestructiveCommandError || e instanceof SecretFoundError) {
      redirect(`/${handle}/${tpl.slug}/versions?e=content-refused`)
    }
    throw e
  }
  await notifyWatchersNewVersion(tpl.id, session.userId)
  await enqueueReindex(tpl.id)

  revalidatePath(`/${handle}/${tpl.slug}`)
  revalidatePath(`/${handle}/${tpl.slug}/versions`)
  redirect(`/${handle}/${tpl.slug}`)
}

// ── Публикация черновика (draft → published) ─────────────────────────
export async function publishList(templateId: string): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return
  // Само правило (твоё ли, черновик ли, гейт модерации) — в publish-draft: у кнопки,
  // MCP и пакетного действия профиля оно обязано быть ОДНО.
  const { skip } = await publishOwnedDraft(session.userId, tpl.id)
  if (skip) return

  revalidatePath('/', 'layout')
  redirect(`/${await ownerHandle(tpl.ownerId)}/${tpl.slug}`)
}
