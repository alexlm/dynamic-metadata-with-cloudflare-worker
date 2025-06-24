
// Fixed WeWeb service worker for custom domain compatibility
// WeWeb UI shows v445, but actual service worker version is 456
const version = 456; // Match WeWeb's exact deployment version

self.addEventListener('install', event => {
    console.log('WeWeb SW v' + version + ' installed (custom domain fix)');
    console.log('UI version: 445, Actual SW version: ' + version);
    // Force activation to prevent version conflicts
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    console.log('WeWeb SW v' + version + ' activated (custom domain fix)');
    event.waitUntil(
        // Clear old caches when WeWeb deploys new version
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (!cacheName.includes('v' + version)) {
                        console.log('Clearing old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            return self.clients.claim(); // Take control immediately
        })
    );
});

self.addEventListener('fetch', event => {
    // Keep WeWeb's original fetch handling but prevent conflicts
    if (event.request.method === 'POST' || event.request.method === 'PUT' || event.request.method === 'DELETE') {
        return;
    }
    
    // Only intercept same-origin requests to prevent external resource issues
    if (event.request.url.startsWith(self.location.origin)) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Don't cache error responses
                    if (response.status >= 200 && response.status < 300) {
                        return response;
                    }
                    throw new Error('Bad response');
                })
                .catch(() => {
                    // Fallback to network for failed requests
                    return fetch(event.request);
                })
        );
    }
});
