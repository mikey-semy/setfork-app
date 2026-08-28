// БЕЗ loading.tsx намеренно. Скелетон на этом сегменте включает потоковую отдачу:
// шапка ответа уходит клиенту сразу, и notFound() из загрузчика уже не может поставить
// 404 — прод отдавал страницу «не найдено» с кодом 200, а поисковик считал её живой.
// Замер после снятия скелетона: первый байт 0,3 с — ждать нечего.
import type { Metadata } from 'next'
import { ViewBeacon } from '@/features/analytics/ViewBeacon'
import { DigChatHost } from '@/features/dig/DigChat'
import { requireViewableMeta } from '@/features/library/guard'
import { FeedList } from '@/features/library/FeedList'
import { CourseProgress } from '@/features/quizzes/CourseProgress'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { breadcrumbList, creativeWork, itemList, JsonLd } from '@/shared/seo/jsonld'
import { PAGE, STACK } from '@/shared/ui/control'
import { ListAbout } from './ListAbout'
import { ListAdNotices } from './ListAdNotices'
import { ListAside } from './ListAside'
import { ListBlocks } from './ListBlocks'
import { ListDraftNotices } from './ListDraftNotices'
import { ListToolbar } from './ListToolbar'
import { ListViewBanner } from './ListViewBanner'
import { loadListPage } from './load'

/**
 * Мета страницы списка.
 *
 * Заголовок вкладки как в GitHub: owner/slug (layout добавит « · SetFork»).
 *
 * ⚠️ ПОЧЕМУ ЗДЕСЬ ЯВНО ОБЪЯВЛЕН `openGraph`, хотя он есть в корневом layout.
 * Метаданные в Next сливаются ПОВЕРХНОСТНО: сегмент, не объявивший `openGraph`,
 * наследует родительский объект ЦЕЛИКОМ — вместе с его `title` и `description`.
 * Пока здесь возвращался один `title`, при отправке ссылки в мессенджер
 * показывалось название САЙТА, а не название списка (замер 28.08). То же и с
 * `description`: свой заголовок был, описание приезжало общесайтовое.
 */
export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }): Promise<Metadata> {
  const { handle, slug } = await params
  // Вкладка браузера = человеческий title, а не slug (title гейтит requireViewableMeta).
  const [meta, lang] = await Promise.all([requireViewableMeta(handle, slug), getLang()])
  const path = `/${handle}/${slug}`
  if (!meta) return { title: `${handle}/${slug}`, alternates: { canonical: path } }

  const title = tr(meta.title, lang) || `${handle}/${slug}`
  const description = listDescription(tr(meta.desc, lang), title)
  // Видит владелец — не значит «показываем поисковику»: черновик, приватный и снятый
  // модерацией доступны по прямой ссылке своему, но в индексе им делать нечего.
  // Тот же предикат, что и в карте сайта, — правило видимости одно на всех.
  const indexable = meta.status === 'published' && meta.visibility === 'public' && meta.moderation === 'active'

  return {
    title,
    description,
    alternates: { canonical: path },
    robots: indexable ? undefined : { index: false, follow: false },
    openGraph: { type: 'article', siteName: 'SetFork', url: path, title, description },
    twitter: { card: 'summary_large_image', title, description },
  }
}

/** Описание для поисковика: своё, если автор его написал, иначе честная замена.
 *  Режем по границе слова — обрезка на середине слова читается как поломка. */
function listDescription(desc: string | undefined, title: string): string {
  const own = desc?.trim()
  if (!own) return `${title} — a runnable, versioned list on SetFork.`
  if (own.length <= META_DESCRIPTION_MAX) return own
  const cut = own.slice(0, META_DESCRIPTION_MAX)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/** Больше этого поисковик всё равно обрежет сам — лучше обрезать осмысленно. */
const META_DESCRIPTION_MAX = 160

/**
 * Страница списка. Здесь только состав: что и в каком порядке стоит в колонке
 * содержимого и в сайдбаре. Правила («какую версию показываем», «что доступно без
 * сессии», «какой урок заблокирован») живут в [load.ts](./load.ts), вид каждой
 * полосы — в соседних `List*.tsx`.
 */
export default async function ListPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>
  searchParams: Promise<{ find?: string; ref?: string; v?: string }>
}) {
  const [{ handle: owner, slug }, sp, lang] = await Promise.all([params, searchParams, getLang()])
  const loaded = await loadListPage({ owner, slug, sp, lang })
  const { tpl, currentVersion, steps, related, viewer, isOwner, readOnlyView, mon, digGnomes, quizBids, quizPassed, completion, base } = loaded

  // Структурные данные — только у публично видимой страницы: у черновика их быть
  // не должно ровно потому же, почему его нет в карте сайта.
  const indexable = tpl.status === 'published' && tpl.visibility === 'public' && tpl.moderation === 'active'
  const path = `/${owner}/${slug}`

  return (
    <>
      {indexable ? (
        <>
          <JsonLd
            data={creativeWork({
              name: tr(tpl.title, lang),
              description: tr(tpl.desc, lang) || undefined,
              path,
              authorName: tpl.owner.name || owner,
              authorPath: `/${owner}`,
              datePublished: tpl.createdAt,
              dateModified: tpl.updatedAt,
              tags: tpl.tags,
              // Как ниже в печатной шапке: показанная версия может быть не текущей,
              // а на некоторых путях её нет вовсе.
              version: currentVersion?.version ?? tpl.currentVersion,
            })}
          />
          <JsonLd data={breadcrumbList([{ name: owner, path: `/${owner}` }, { name: tr(tpl.title, lang) || slug, path }])} />
          {/* Шаги отдаём списком: это то, ЧТО здесь исполняется, и единственная
              часть страницы, ради которой машина сюда приходит. Потолок в 25 —
              чтобы разметка не раздувалась на курсах в сотню уроков. */}
          <JsonLd
            data={itemList(
              tr(tpl.title, lang) || slug,
              steps.slice(0, 25).map((s) => ({ name: tr(s.title, lang) || `${s.n}` })),
            )}
          />
        </>
      ) : null}

      {/* Просмотр: владелец себя не накручивает, сервер дополнительно дедупит. */}
      {!isOwner && mon.viewTracking && <ViewBeacon templateId={tpl.id} />}
      {viewer && !readOnlyView && <DigChatHost gnomes={digGnomes} lang={lang} />}

      <div className={PAGE}>
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Основное: содержимое-эталон */}
          {/* Единый вертикальный ритм колонки: интервал задаёт контейнер, а не
              каждая полоса своим mb-* (см. STACK). */}
          <main className={`min-w-0 flex-1 ${STACK}`}>
            {/* Заголовок только для печати (в экране он в шапке) */}
            <div className="hidden print:block">
              <h1 className="text-heading font-bold text-ink">{tr(tpl.title, lang)}</h1>
              {tr(tpl.desc, lang) && <p className="mt-1 text-body text-ink-2">{tr(tpl.desc, lang)}</p>}
              <p className="mt-1 font-mono text-caption text-muted">
                {owner}/{slug} · v{currentVersion?.version ?? tpl.currentVersion}
              </p>
            </div>

            {/* About на мобиле — НАВЕРХУ (как GitHub): описание, теги, статы со словами.
                На десктопе всё это в About-сайдбаре справа. */}
            <div className="lg:hidden print:hidden">
              <ListAbout {...loaded} lang={lang} layout="row" />
            </div>

            <ListDraftNotices {...loaded} lang={lang} />
            <ListAdNotices {...loaded} lang={lang} />
            <ListToolbar {...loaded} lang={lang} />
            <ListViewBanner {...loaded} lang={lang} />

            {viewer && (quizBids.length > 0 || completion) && (
              <CourseProgress
                passed={quizPassed}
                total={quizBids.length}
                lang={lang}
                certificateHref={`${base}/certificate`}
                leaderboardHref={`${base}/leaderboard`}
                completed={completion}
              />
            )}

            <ListBlocks {...loaded} lang={lang} />

            {/* Связанные списки (Д6): и человеку — куда идти дальше, и обходчику —
                по чему обходить корпус. Карточки те же, что в ленте: своей
                разновидности карточки списка заводить незачем. */}
            {related.length > 0 && (
              <section aria-labelledby="related-lists" className="print:hidden">
                <h2 id="related-lists" className="mb-3 text-body font-semibold text-ink">
                  {t('list.relatedLists', lang)}
                </h2>
                <FeedList items={related} lang={lang} viewerId={viewer?.userId} />
              </section>
            )}
          </main>

          <ListAside {...loaded} lang={lang} />
        </div>
      </div>
    </>
  )
}
