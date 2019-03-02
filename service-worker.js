var CACHE_NAME = 'new-hacker-tab-v1';

// TODO:
// currently we use cacheFirst until it is outdated and switch to Network first then
// Three stages might be better for the user experience:
// - CacheFirst
// - after X minutes: StaleWhileRevalidate
// - after Y minutes: NetworkFirst
// ------------------------------

// Extract date header from response
// returns
// - the unix timestamp in milliseconds
// - NaN on error
function getResponseDate(response) {
    if (!response.headers.has('date')) {
      return NaN;
    } else {
		// returns NaN if parsing fails
		return (new Date(response.headers.get('date'))).getTime();
	}
}

self.addEventListener('fetch', function(event) {
	//console.log("fetch event for", event.request.url)
	event.respondWith(
		caches.match(event.request).then(function(cacheResponse) {
			// response is undefined if the cache did not match

			let outdated = true;

			// Cache hit
			if (cacheResponse) {
				// check if the cache entry is fresh
				const now = Date.now();
				const cacheResponseDate = getResponseDate(cacheResponse);
				let ageInSeconds = undefined;
				if (isNaN(cacheResponseDate)) {
					// we treat responses which do not contain a date header as fresh
					outdated = false
				} else {
					ageInSeconds = (now - cacheResponseDate)/1000
					//console.log("Age", ageInSeconds)
					outdated = (ageInSeconds > 60*60) // one hour
				}
				if (!outdated) {
					//console.log("cache hit fresh", ageInSeconds)
					return cacheResponse;
				}
				//console.log("cache hit outdated", ageInSeconds)
			}

			// fetch from network
			return fetch(event.request).then(function(networkResponse) {
				//console.log("got response for", networkResponse.url)

				// Check if we received a valid response
				//if(!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
				//we want to allow opaque responses
				if(!networkResponse) {
					// use the old cache response if the network failed and a cache response exists
					if (cacheResponse) {
						//console.log("falling back to cache response", networkResponse.url)
						return cacheResponse;
					} else {
						//console.log("failed response skipping cache", networkResponse.url)
						return networkResponse;
					}
				}

				saveResponseToCache(CACHE_NAME, event.request, networkResponse);

				return networkResponse;
			}).catch(function(){
				// e.g. chrome, offline, disabled cache (/outdated cache)
				//console.log("CATCH to cache response", event.request.url)
				return cacheResponse
			});
		})
	);
});

function saveResponseToCache(name, request, response) {
	// IMPORTANT: Clone the response. A response is a stream
	// and because we want the browser to consume the response
	// as well as the cache consuming the response, we need
	// to clone it so we have two streams.
	var responseToCache = response.clone();

	return caches.open(name).then(cache => {
		cache.put(request, responseToCache);
	});
}

self.addEventListener('install', function(event) {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});
