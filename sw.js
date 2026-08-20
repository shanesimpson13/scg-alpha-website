/* Service worker for EdgeLvl.
 *
 * It exists so the terminal can be INSTALLED, which is the only way macOS
 * shows notifications as coming from EdgeLvl rather than from Google Chrome.
 * Chrome will not offer to install a site without one.
 *
 * It deliberately caches NOTHING. Every instinct with a service worker is to
 * add offline caching, and it would be actively dangerous here: a cached
 * index.html or a cached /api response means someone reads a stale market cap,
 * or a stop level from ten minutes ago, and acts on it with real money. An
 * offline trading terminal is not a degraded trading terminal, it is a
 * misleading one. So the fetch handler is empty — no respondWith, so every
 * request goes to the network exactly as it would without this file.
 *
 * skipWaiting + claim so a new version takes over immediately instead of
 * waiting for every tab to close, which matters when the thing being fixed is
 * on the money path.
 */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

// Present, empty, and passive. Its only job is to satisfy the installability
// check; adding respondWith here would start serving cached data.
self.addEventListener('fetch', () => {});

/* Clicking a notification should raise the window we already have rather than
 * open a second copy of the terminal. */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const mint = (event.notification.data || {}).mint;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) {
          // Only the page knows how to render a coin, so hand the mint over
          // rather than navigating and losing whatever state is on screen.
          if (mint) client.postMessage({ openMint: mint });
          return client.focus();
        }
      }
      return self.clients.openWindow(mint ? `/?coin=${mint}` : '/');
    })
  );
});
