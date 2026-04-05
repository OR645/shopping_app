/// <reference lib="webworker" />
// Vite PWA injects Workbox runtime caching — this file handles custom logic.

declare const self: ServiceWorkerGlobalScope

// ── Push notification handler ──────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return

  let data: { body: string; data?: Record<string, unknown> }
  try {
    data = event.data.json()
  } catch {
    data = { body: event.data.text() }
  }

  const options: NotificationOptions = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    dir: 'rtl',
    lang: 'he',
    data: data.data,
    actions: [
      { action: 'open', title: 'פתח רשימה' },
      { action: 'dismiss', title: 'סגור' },
    ],
    vibrate: [100, 50, 100],
    tag: 'shopping-update',   // replace previous notification of same type
    renotify: true,
  }

  event.waitUntil(
    self.registration.showNotification('קניות ביחד', options)
  )
})

// ── Notification click ─────────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  if (event.action === 'dismiss') return

  const listId = event.notification.data?.list_id
  const url = listId ? `/?list=${listId}` : '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing tab if open
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus()
          client.postMessage({ type: 'navigate', url })
          return
        }
      }
      // Open new tab
      return self.clients.openWindow(url)
    })
  )
})

// ── Background sync (offline mutation replay) ──────────────────────────────────
self.addEventListener('sync', (event: SyncEvent) => {
  if (event.tag === 'replay-mutations') {
    event.waitUntil(replayQueuedMutations())
  }
})

async function replayQueuedMutations() {
  // The actual queue draining is handled by the app on reconnect.
  // This is a belt-and-suspenders trigger for Background Sync API.
  const clients = await self.clients.matchAll()
  for (const client of clients) {
    client.postMessage({ type: 'sync:trigger' })
  }
}
