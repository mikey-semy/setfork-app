// Webhook Telegram-бота (только вход на сайт). Telegram шлёт апдейты сюда
// (входящий трафик из-за рубежа в РФ не режется) с секретом из setWebhook.
// /start tl_<токен> → кнопка «Да, это я»; callback → токен подтверждён, браузер
// доберёт сессию поллингом. Явное подтверждение защищает от чужих ссылок:
// прислать жертве свой t.me-линк и получить её аккаунт нельзя без клика «это я».
import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, telegramLoginTokens } from '@/shared/db'
import { t, type Lang, type TKey } from '@/shared/i18n'
import { parseConfirmToken, parseStartToken, telegramLoginCode, tgApi, telegramConfigured, type TgUpdate } from '@/shared/telegram'
import { appHost } from '@/shared/auth/app-origin'


/** Язык ответа бота — из language_code отправителя (телеграмный, не наша кука). */
const langOf = (code: string | undefined): Lang => (code?.toLowerCase().startsWith('ru') ? 'ru' : 'en')

const msg = (key: TKey, lang: Lang) => t(key, lang).replace('{site}', appHost())

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!telegramConfigured() || !secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ ok: true }) // не палим наружу, что тут что-то есть
  }
  const update = (await req.json().catch(() => ({}))) as TgUpdate

  if (update.message?.chat) {
    const chatId = update.message.chat.id
    const lang = langOf(update.message.from?.language_code)
    const token = parseStartToken(update.message.text)
    if (token) {
      const [row] = await db.select().from(telegramLoginTokens).where(eq(telegramLoginTokens.token, token)).limit(1)
      const alive = row && !row.confirmedAt && row.expiresAt > new Date()
      await tgApi('sendMessage', alive
        ? {
            chat_id: chatId,
            text: msg('tgBotConfirm', lang),
            reply_markup: { inline_keyboard: [[{ text: t('tgBotConfirmBtn', lang), callback_data: `tglogin:${token}` }]] },
          }
        : { chat_id: chatId, text: msg('tgBotStale', lang) })
    } else if (update.message.text?.startsWith('/start')) {
      await tgApi('sendMessage', { chat_id: chatId, text: msg('tgBotHello', lang) })
    }
    return NextResponse.json({ ok: true })
  }

  if (update.callback_query) {
    const cb = update.callback_query
    const lang = langOf(cb.from?.language_code)
    const token = parseConfirmToken(cb.data)
    let code = ''
    if (token && cb.from?.id) {
      const [row] = await db.select().from(telegramLoginTokens).where(eq(telegramLoginTokens.token, token)).limit(1)
      if (row && !row.confirmedAt && row.expiresAt > new Date()) {
        await db
          .update(telegramLoginTokens)
          .set({
            tgId: cb.from.id,
            tgName: [cb.from.first_name, cb.from.last_name].filter(Boolean).join(' ') || null,
            tgUsername: cb.from.username ?? null,
            confirmedAt: new Date(),
          })
          .where(eq(telegramLoginTokens.id, row.id))
        // Код доставляем ПОДТВЕРДИВШЕМУ в Telegram; завершить вход можно только введя
        // его в браузере-инициаторе (с токеном) — relay чужой ссылки не даёт сессию (F2).
        code = telegramLoginCode(token, cb.from.id)
      }
    }
    await tgApi('answerCallbackQuery', {
      callback_query_id: cb.id,
      text: t(code ? 'tgBotCbOk' : 'tgBotCbStale', lang),
    })
    if (code && cb.message?.chat && cb.message.message_id) {
      await tgApi('editMessageText', {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: t('tgBotCode', lang).replace('{code}', code),
      })
    }
  }
  return NextResponse.json({ ok: true })
}
