importScripts('js/localforage.min.js');

var CACHE_NAME = 'new-hacker-tab-v1';

/****
 * Three States
 * - fresh: a few minutes old (CacheFirst)
 * - old: old enough te be refreshed (StaleWhileRevalidate)
 * - outdated: very old, wait until new data has been fetched (NetworkFirst)
 */
self.addEventListener('fetch', function(event) {
	const secondsUntilOld = 60*60*1; // one hour
	const secondsUntilOutdated = 60*60*6; // 6 hours

	console.log("fetch event for", event.request.url)
	event.respondWith(
		// get the matching cache entry (or undefined if no match is found)
		caches.match(event.request).then(function(cacheResponse) {
			// detect if the cache entry is fresh, old, outdated or undefined (does not include a date header)
			return detectCacheState(event.request.url, cacheResponse, secondsUntilOld, secondsUntilOutdated).then(function(cacheState){

				// Depending on the state we proceed differently:
				// if cacheState fresh -> return cache
				// if cacheState old -> start network, updateCache + return cache
				// if cacheState outdated -> start network, updateCache + return network first or cache as fallback (if it exists)
				// if cacheState undefined -> start network, updateCache + return network
				if (cacheState === "fresh") {
					// the cache entry is "fresh", so we jsut return it
					return cacheResponse;
				} else if (cacheState === "old") {
					// the cache entry is "old", so we return the cache entry and refresh it via the network in the background
					fetchToCache(event.request, CACHE_NAME).catch(() => undefined);
					return cacheResponse;
				} else if (cacheState === "outdated") {
					// the cache entry is "outdated", so we try to get a newer version via the network
					// return the network reponse if successful, otherwise the old cache, if it exists
					return fetchToCache(event.request, CACHE_NAME).then(function(networkResponse){
						if(networkResponse) {
							//console.log("using the networkResponse", networkResponse.url)
							return networkResponse
						} else {
							// use the old cache response if the network failed and a cache response exists
							if (cacheResponse) {
								//console.log("falling back to outdated cache response", cacheResponse.url)
								return cacheResponse;
							} else {
								//console.log("failed response from network and cache")
								return networkResponse;
							}
						}
					}).catch(() => {
						// e.g. chrome, offline, disabled cache (/outdated cache)
						console.log("CATCH to cache response", event.request.url)
						cacheResponse
					});
				} else {
					return fetchToCache(event.request, CACHE_NAME);
				}
			});
		})
	);
});

// Extract date header from response
// returns
// - the unix timestamp in milliseconds
// - NaN on error
// We require the 'url' parameter, as the url is not always accessable from the response
async function getResponseDate(url, response) {
    if (!response.headers.has('date')) {
		var timestamp = await localforage.getItem(url);
		if (timestamp !== null) {
			//console.log("Using localforage date", timestamp, "for", response.url, "vs", url)
			return timestamp;
		}
		//console.log("NO localforage date for", url)
		return NaN;
    } else {
		// returns NaN if parsing fails
		return (new Date(response.headers.get('date'))).getTime();
	}
}

async function detectCacheState(url, cacheResponse, oldDuration, outdatedDuration) {
	if (cacheResponse) {
		const now = Date.now();
		const cacheResponseDate = await getResponseDate(url, cacheResponse);
		//console.log("cacheResponseDate", cacheResponseDate, url)

		if (isNaN(cacheResponseDate)) {
			// we treat responses which do not contain a date header as old (background update while using cache)
			console.log("cache hit WITHOUT date (old); should NOT happen anymore.")
			return "old";
		} else {
			const ageInSeconds = (now - cacheResponseDate)/1000
			if (ageInSeconds > outdatedDuration) {
				console.log("cache hit outdated", ageInSeconds)
				return "outdated";
			} else if (ageInSeconds > oldDuration) {
				console.log("cache hit old", ageInSeconds)
				return "old"
			} else {
				console.log("cache hit fresh", ageInSeconds)
				return "fresh";
			}
		}
	}
	console.log("cache MISS");
	return undefined;
}

function fetchToCache(request, cacheName) {
	return fetch(request).then(function(networkResponse) {
		//console.log("got response for", networkResponse.url)

		// Check if we received a valid response
		// if(!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
		// we want to allow opaque responses (status === 0)
		if(networkResponse) {
			// save to cache in the background
			saveResponseToCache(cacheName, request, networkResponse);
		}

		return networkResponse;
	})
}

function saveResponseToCache(name, request, response) {
	// IMPORTANT: Clone the response. A response is a stream
	// and because we want the browser to consume the response
	// as well as the cache consuming the response, we need
	// to clone it so we have two streams.
	var responseToCache = response.clone();

	return caches.open(name).then(cache => {
		cache.put(request, responseToCache);

		// save the fetch date to local storage
		//console.log("WRITING date for", request)
		localforage.setItem(request.url, Date.now());
	});
}

//self.addEventListener('install', function(event) {
//  event.waitUntil(self.skipWaiting());
//});
//self.addEventListener('activate', function(event) {
//  event.waitUntil(self.clients.claim());
//});
