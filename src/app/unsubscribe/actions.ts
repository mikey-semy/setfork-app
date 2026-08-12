'use server'

import { redirect } from 'next/navigation'
import { applyUnsubscribe } from '@/shared/email/unsubscribe'

/** Кнопка «Отписаться» на странице. Право на отписку несёт токен из письма,
 *  поэтому сессия здесь не нужна — человек может быть не залогинен. */
export async function unsubscribeAction(formData: FormData): Promise<void> {
  const ok = await applyUnsubscribe(String(formData.get('token') ?? ''))
  redirect(ok ? '/unsubscribe?done=1' : '/unsubscribe?failed=1')
}
