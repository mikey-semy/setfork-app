// Клиентские хелперы Web Push: регистрация service worker + подписка/отписка.
// Вызываются из тумблера «Уведомления в браузере» в настройках.

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

function supported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** Регистрирует SW, спрашивает разрешение, подписывается и сохраняет подписку. true = успех. */
export async function subscribeToPush(): Promise<boolean> {
  if (!supported()) return false
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return false
  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  const res = await fetch('/api/push/public-key')
  const { publicKey } = (await res.json()) as { publicKey?: string }
  if (!publicKey) return false // VAPID не настроен на сервере
  const existing = await reg.pushManager.getSubscription()
  const sub =
    existing ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource }))
  const r = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sub),
  })
  return r.ok
}

/** Отписывается и удаляет подписку на сервере. */
export async function unsubscribeFromPush(): Promise<void> {
  if (!supported()) return
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await fetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {})
    await sub.unsubscribe().catch(() => {})
  }
}

/** Есть ли активная push-подписка в этом браузере (push сам покажет уведомления). */
export async function hasPushSubscription(): Promise<boolean> {
  if (!supported()) return false
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return Boolean(sub)
}
