// from https://gist.github.com/prateekbh/7f047938b5d1aab1b8a8b0f92d093ef2
// mentioned in https://github.com/GoogleChrome/workbox/issues/1816
//
importScripts('/js/workbox-sw.js');

class SWRCacheExpiration extends workbox.expiration.CacheExpiration {
  async refreshEntries() {
      if (this._isRunning) {
        this._rerunRequested = true;
        return;
      }
      this._isRunning = true;

      const now = Date.now();

      // First, expire old entries, if maxAgeSeconds is set.
      const oldEntries = await this._findOldEntries(now);

      // Once that's done, check for the maximum size.
      const extraEntries = await this._findExtraEntries();

      // Use a Set to remove any duplicates following the concatenation, then
      // convert back into an array.
      const allUrls = [...new Set(oldEntries.concat(extraEntries))];
      console.log(`Refresing ${allUrls}`);

      await this._refreshURL(allUrls);
      this._isRunning = false;
  }

  async _refreshURL(urls) {
    const cache = await caches.open(this._cacheName);
    for (const url of urls) {
      //await cache.delete(url); // moving this 3 lines down doesn't solve the problem
      const response = fetch(url, {cache: 'reload', mode: 'no-cors'}).catch(()=>{});
      if (response.ok) {
        await cache.put(url, response);
      }
    }
  }
}

class SWRExiprationPlugin extends workbox.expiration.Plugin {
  _getCacheExpiration(cacheName) {
    let cacheExpiration = this._cacheExpirations.get(cacheName);
    if (!cacheExpiration) {
      cacheExpiration = new SWRCacheExpiration(cacheName, this._config);
      this._cacheExpirations.set(cacheName, cacheExpiration);
    }
    return cacheExpiration;
  }

  cachedResponseWillBeUsed({cacheName, cachedResponse, event}) {
    if (!cachedResponse) {
      return null;
    }

    let isFresh = this._isResponseDateFresh(cachedResponse);

    // Expire entries to ensure that even if the expiration date has
    // expired, it'll only be used once.
    const cacheExpiration = this._getCacheExpiration(cacheName);

    // If expired swap the content in cache but return from cache for this one time.
    if (!isFresh) {
      event.waitUntil(cacheExpiration.refreshEntries());
    }

    // Always return from cache, even after expiration.
    return cachedResponse;
  }
}

workbox.routing.registerRoute(
  () => {return true}, // a regex never matches 3rd party urls
  workbox.strategies.cacheFirst({
    cacheName: 'universal-cache',
    plugins: [
      new SWRExiprationPlugin({
        maxAgeSeconds: 60*60,
      }),
      new workbox.cacheableResponse.Plugin({
        statuses: [0, 200] // cache 3rd party (NOTE: caches failed requests too)
      }),
    ],
  })
);

self.addEventListener('install', function(event) {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});
