'use server'
import { redirect } from 'next/navigation'
import { requireSession } from '@/shared/auth/session'
import { issueCode, parseAuthorize, pruneExpiredCodes } from '@/shared/auth/oauth-server'

/**
 * Согласие человека → одноразовый код → возврат к клиенту.
 *
 * ⚠️ ЗАПРОС ПРОВЕРЯЕТСЯ ЗАНОВО, а не берётся на веру из формы: между показом экрана и
 * нажатием прошло время, и содержимое скрытого поля — это ввод, а не доверенные данные.
 *
 * ⚠️ ОТКАЗ ТОЖЕ ВОЗВРАЩАЕТСЯ КЛИЕНТУ (`access_denied`), а не оставляет его ждать: иначе
 * Claude висит до таймаута, и человек видит «не удалось подключиться» без причины.
 */
export async function grantAccess(formData: FormData): Promise<void> {
  const session = await requireSession()
  const parsed = parseAuthorize(new URLSearchParams(String(formData.get('q') ?? '')))
  if (!parsed.ok) redirect('/')

  const back = new URL(parsed.req.redirectUri)
  if (parsed.req.state) back.searchParams.set('state', parsed.req.state)

  if (formData.get('deny')) {
    back.searchParams.set('error', 'access_denied')
    redirect(back.toString())
  }

  await pruneExpiredCodes()
  const code = await issueCode(parsed.req, session.userId)
  back.searchParams.set('code', code)
  redirect(back.toString())
}
