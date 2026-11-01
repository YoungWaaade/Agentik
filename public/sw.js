// Supersept service worker: makes the home screen app installable and shows Web Push notifications
// (sessions that finished or wait for an answer, agents' replies), even with the app closed.
// No fetch handler on purpose: the app always talks to the live server, nothing is cached here.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const abs = (u) => { try { return u ? new URL(u, self.location.origin).href : null; } catch { return null; } };

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  // iOS revokes the subscription of a site whose pushes show nothing: always show one.
  e.waitUntil(self.registration.showNotification(d.title || 'Supersept', {
    body: d.body || '',
    tag: d.tag || undefined, // a newer notification about the same session/chat replaces the previous one
    renotify: !!d.tag,
    // The agent speaking (its avatar, absolute URL) or the app icon. iOS ignores it and always shows the
    // app icon; Android, Chrome, Firefox and macOS show it. The badge stays the app's (Android draws it
    // as a one-colour silhouette in the status bar: a photo would be a blob).
    icon: abs(d.icon) || abs('/icon.png'),
    badge: abs('/favicon.png'),
    data: { url: d.url || '/' },
  }));
});

// Tap: bring the app to the front on the right screen (#/ws/<id>, #/agent/<slug>/<conversation>).
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const c = all.find((x) => new URL(x.url).origin === self.location.origin);
    if (c) {
      // The page switches screens itself (hash route): no reload, the live socket stays up.
      c.postMessage({ type: 'open', url });
      try { await c.focus(); } catch {}
      return;
    }
    await self.clients.openWindow(url);
  })());
});
