// Service worker для Web Push (фоновые браузерные уведомления SetFork).
// Показывает уведомление даже при закрытой вкладке; клик — фокус/открытие ссылки.

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = data.title || 'SetFork'
  const options = {
    body: data.body || '',
    tag: data.tag,
    data: { url: data.url || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of all) {
        // Уже открытая вкладка приложения — фокусируем и ведём по ссылке.
        if ('focus' in client) {
          await client.focus()
          if (client.navigate) await client.navigate(url).catch(() => {})
          return
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url)
    })(),
  )
})
