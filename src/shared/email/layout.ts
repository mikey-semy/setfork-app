import 'server-only'
import { t, type Lang } from '@/shared/i18n'
import { appOrigin } from '@/shared/auth/app-origin'
import { aboutUrl, legalUrl } from '@/shared/docs'
import { escapeHtml as esc } from '@/shared/lib/escape'

// Общая обёртка ВСЕХ писем: шапка с логотипом, карточка с содержимым и подвал —
// тот же набор ссылок, что в подвале сайта (widgets/Footer.tsx). Применяется в
// sendMail, поэтому письмо без подвала отправить нельзя.

/** Палитра писем. В HTML-почте нет CSS-переменных и внешних стилей, поэтому
 *  цвета живут ЗДЕСЬ одним набором, а не литералами по шаблонам писем. */
export const EMAIL_COLOR = {
  page: '#f4f4f1',
  card: '#ffffff',
  border: '#e7e6e0',
  ink: '#1c1c1a',
  muted: '#6b6b66',
  faint: '#a3a39c',
  accent: '#2159d6',
} as const

/** Шрифты письма — те же, что на сайте (globals.css): интерфейсный Hanken Grotesk
 *  и Chakra Petch у логотипа. Веб-шрифты в почте не грузятся (Gmail режет
 *  @font-face), поэтому это стек: где шрифт установлен — письмо как сайт, где нет —
 *  системный, а не Times. */
const FONT = {
  sans: `'Hanken Grotesk', system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif`,
  logo: `'Chakra Petch', 'Hanken Grotesk', system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif`,
} as const

/** Ширина письма: помещается на телефоне без зума и не растягивается на десктопе. */
const WIDTH_PX = 480

/** Минимальная высота ВЕРХНЕЙ части письма (карточка + строка «почему пришло»):
 *  короткие письма добиваются до неё, поэтому подвал у них начинается на одном
 *  уровне, а не прыгает от длины текста. Длинные письма растут дальше. */
const CONTENT_MIN_PX = 240

/**
 * Кнопка письма. Под ней — тот же адрес текстом: часть почтовых клиентов
 * вырезает кнопки, и без строки-адреса письмо становится бесполезным.
 * `word-break` не даёт длинной ссылке распереть письмо на телефоне.
 */
export function emailButton(href: string, label: string): string {
  return (
    `<p style="margin:20px 0 8px"><a href="${esc(href)}" style="display:inline-block;background:${EMAIL_COLOR.ink};color:${EMAIL_COLOR.card};text-decoration:none;font-weight:600;font-size:14px;padding:12px 18px;border-radius:8px">${esc(label)}</a></p>` +
    `<p style="color:${EMAIL_COLOR.muted};font-size:13px;margin:0;word-break:break-all">${esc(href)}</p>`
  )
}

/** Приписка под кнопкой: срок жизни ссылки, «если это не ты — проигнорируй». */
export function emailHint(text: string): string {
  return `<p style="color:${EMAIL_COLOR.muted};font-size:13px;line-height:1.5;margin:16px 0 0">${esc(text)}</p>`
}

/** Ссылки подвала — те же пункты и в том же порядке, что на сайте; у массовых
 *  писем в конце добавляется отписка. */
function footerLinks(lang: Lang, unsubscribeUrl?: string): Array<{ href: string; label: string }> {
  const origin = appOrigin()
  const links = [
    { href: `${origin}/explore`, label: t('explore', lang) },
    { href: aboutUrl(), label: t('aboutProject', lang) },
    { href: `${origin}/feedback`, label: t('feedback', lang) },
    { href: legalUrl('terms', lang), label: t('terms', lang) },
    { href: legalUrl('privacy', lang), label: t('privacy', lang) },
  ]
  if (unsubscribeUrl) links.push({ href: unsubscribeUrl, label: t('unsubscribe.action', lang) })
  return links
}

/**
 * Собирает готовое письмо из тела.
 * @param body  HTML содержимого — БЕЗ скелета и подвала, их добавляет обёртка.
 * @param note  Почему письмо пришло (для уведомлений и рассылок). Служебным
 *              письмам — подтверждению адреса, сбросу пароля — не нужен.
 * @param unsubscribeUrl  Тот же адрес, что уходит в заголовок List-Unsubscribe.
 *              Ссылка ОБЯЗАНА быть и в видимом подвале: заголовок показывают не
 *              все клиенты, а в текстовой части письма его нет вовсе.
 */
export function renderEmail(p: { lang: Lang; body: string; note?: string; unsubscribeUrl?: string }): string {
  const links = footerLinks(p.lang, p.unsubscribeUrl)
    .map(
      (l) =>
        `<a href="${esc(l.href)}" style="color:${EMAIL_COLOR.muted};text-decoration:none">${esc(l.label)}</a>`,
    )
    .join(`<span style="color:${EMAIL_COLOR.faint}"> · </span>`)

  // «Почему это письмо пришло» — НАД подвалом, а не внутри него: подвал у всех
  // писем обязан выглядеть одинаково.
  const note = p.note
    ? `<p style="color:${EMAIL_COLOR.faint};font-size:13px;line-height:1.5;margin:12px 0 0">${esc(p.note)}</p>`
    : ''

  return `<!doctype html><html><body style="margin:0;background:${EMAIL_COLOR.page};font-family:${FONT.sans};color:${EMAIL_COLOR.ink}">
  <div style="max-width:${WIDTH_PX}px;margin:0 auto;padding:24px">
    <a href="${esc(appOrigin())}" style="display:inline-block;font-family:${FONT.logo};font-weight:800;font-size:16px;letter-spacing:.08em;color:${EMAIL_COLOR.ink};text-decoration:none">SETFORK</a>
    <div style="min-height:${CONTENT_MIN_PX}px">
      <div style="background:${EMAIL_COLOR.card};border:1px solid ${EMAIL_COLOR.border};border-radius:12px;padding:20px;margin-top:14px;font-size:15px;line-height:1.5">
        ${p.body}
      </div>
      ${note}
    </div>
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid ${EMAIL_COLOR.border}">
      <p style="font-size:13px;line-height:1.8;margin:0">${links}</p>
      <p style="color:${EMAIL_COLOR.faint};font-size:13px;margin:6px 0 0">© ${new Date().getFullYear()} SetFork</p>
    </div>
  </div></body></html>`
}
