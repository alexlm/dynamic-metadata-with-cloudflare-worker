// index.ts
import { config } from '../config.js';

export default {
  async fetch(request, env, ctx) {
    try {
      // Extracting configuration values
      const domainSource = config.domainSource;
      const patterns = config.patterns;

      console.log("Worker started");

      // Parse the request URL
      const url = new URL(request.url);
      const referer = request.headers.get('Referer');

      // FIX 1: Handle service worker requests to prevent version conflicts
      if (url.pathname === '/serviceworker.js' || url.pathname === '/sw.js') {
        console.log("Intercepting service worker to fix version conflicts");
        
        try {
          // Fetch the original service worker from WeWeb
          const originalSW = await fetch(`${domainSource}${url.pathname}`);
          
          // Simple service worker that prevents conflicts
          const fixedSW = `
const version = ${Date.now()};
console.log('Fixed service worker v' + version + ' loaded');

self.addEventListener('install', event => {
    console.log('SW v' + version + ' installing');
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    console.log('SW v' + version + ' activating');
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
    // Only handle same-origin requests, let everything else pass through
    if (event.request.url.startsWith(self.location.origin)) {
        event.respondWith(fetch(event.request));
    }
});
`;
          
          return new Response(fixedSW, {
            headers: { 
              'Content-Type': 'application/javascript',
              'Cache-Control': 'no-cache, no-store, must-revalidate'
            }
          });
        } catch (error) {
          console.error('Service worker error:', error);
          // Fallback: disable service worker entirely
          return new Response('// Service worker disabled due to error', {
            headers: { 'Content-Type': 'application/javascript' }
          });
        }
      }

      // Function to get the pattern configuration that matches the URL
      function getPatternConfig(url) {
        for (const patternConfig of patterns) {
          const regex = new RegExp(patternConfig.pattern);
          let pathname = url + (url.endsWith('/') ? '' : '/');
          if (regex.test(pathname)) {
            return patternConfig;
          }
        }
        return null;
      }

      // Function to check if the URL matches the page data pattern (For the WeWeb app)
      function isPageData(url) {
        const pattern = /\/public\/data\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json/;
        return pattern.test(url);
      }

      async function requestMetadata(url, metaDataEndpoint) {
        try {
          // Remove any trailing slash from the URL
          const trimmedUrl = url.endsWith('/') ? url.slice(0, -1) : url;

          // Split the trimmed URL by '/' and get the last part: The id
          const parts = trimmedUrl.split('/');
          const id = parts[parts.length - 1];

          // Replace the placeholder in metaDataEndpoint with the actual id
          const placeholderPattern = /{([^}]+)}/;
          const metaDataEndpointWithId = metaDataEndpoint.replace(placeholderPattern, id);

          // Fetch metadata from the API endpoint
          const metaDataResponse = await fetch(metaDataEndpointWithId);
          const metadata = await metaDataResponse.json();
          return metadata;
        } catch (error) {
          console.error('Metadata fetch error:', error);
          return {};
        }
      }

      // Handle dynamic page requests
      const patternConfig = getPatternConfig(url.pathname);
      if (patternConfig) {
        console.log("Dynamic page detected:", url.pathname);

        // Fetch the source page content
        let source = await fetch(`${domainSource}${url.pathname}`);

        // Remove "X-Robots-Tag" from the headers
        const sourceHeaders = new Headers(source.headers);
        sourceHeaders.delete('X-Robots-Tag');
        source = new Response(source.body, {
          status: source.status,
          headers: sourceHeaders,
        });

        const metadata = await requestMetadata(url.pathname, patternConfig.metaDataEndpoint);
        console.log("Metadata fetched:", metadata);

        // Create a custom header handler with the fetched metadata
        const customHeaderHandler = new CustomHeaderHandler(metadata);

        // Transform the source HTML with the custom headers
        return new HTMLRewriter().on('*', customHeaderHandler).transform(source);

        // Handle page data requests for the WeWeb app
      } else if (isPageData(url.pathname)) {
        console.log("Page data detected:", url.pathname);
        console.log("Referer:", referer);

        // Fetch the source data content
        const sourceResponse = await fetch(`${domainSource}${url.pathname}`);
        let sourceData = await sourceResponse.json();

        let pathname = referer;
        pathname = pathname ? pathname + (pathname.endsWith('/') ? '' : '/') : null;
        if (pathname !== null) {
          const patternConfigForPageData = getPatternConfig(pathname);
          if (patternConfigForPageData) {
            const metadata = await requestMetadata(
              pathname,
              patternConfigForPageData.metaDataEndpoint
            );
            console.log("Metadata fetched:", metadata);

            // Ensure nested objects exist in the source data
            sourceData.page = sourceData.page || {};
            sourceData.page.title = sourceData.page.title || {};
            sourceData.page.meta = sourceData.page.meta || {};
            sourceData.page.meta.desc = sourceData.page.meta.desc || {};
            sourceData.page.meta.keywords = sourceData.page.meta.keywords || {};
            sourceData.page.socialTitle = sourceData.page.socialTitle || {};
            sourceData.page.socialDesc = sourceData.page.socialDesc || {};

            // Update source data with the fetched metadata
            if (metadata.title) {
              sourceData.page.title.en = metadata.title;
              sourceData.page.socialTitle.en = metadata.title;
            }
            if (metadata.description) {
              sourceData.page.meta.desc.en = metadata.description;
              sourceData.page.socialDesc.en = metadata.description;
            }
            if (metadata.image) {
              sourceData.page.metaImage = metadata.image;
            }
            if (metadata.keywords) {
              sourceData.page.meta.keywords.en = metadata.keywords;
            }

            console.log("returning file: ", JSON.stringify(sourceData));
            // Return the modified JSON object
            return new Response(JSON.stringify(sourceData), {
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
      }

      // If the URL does not match any patterns, fetch and return the original content
      console.log("Fetching original content for:", url.pathname);
      const sourceUrl = new URL(`${domainSource}${url.pathname}`);
      const sourceRequest = new Request(sourceUrl, request);
      const sourceResponse = await fetch(sourceRequest);

      // Create a new response without the "X-Robots-Tag" header
      const modifiedHeaders = new Headers(sourceResponse.headers);
      modifiedHeaders.delete('X-Robots-Tag');

      return new Response(sourceResponse.body, {
        status: sourceResponse.status,
        headers: modifiedHeaders,
      });

    } catch (error) {
      console.error('Worker error:', error);
      // Fallback: try to fetch original content
      try {
        const sourceResponse = await fetch(`${config.domainSource}${new URL(request.url).pathname}`);
        return sourceResponse;
      } catch (fallbackError) {
        return new Response('Worker Error: ' + error.message, { status: 500 });
      }
    }
  },
};

// CustomHeaderHandler class to modify HTML content based on metadata
class CustomHeaderHandler {
  constructor(metadata) {
    this.metadata = metadata || {};
    this.viewportMetaFound = false;
    this.statusBarMetaFound = false;
    this.appleWebAppCapableFound = false;
  }

  element(element) {
    try {
      // Replace the <title> tag content
      if (element.tagName === 'title' && this.metadata.title) {
        console.log('Replacing title tag content');
        element.setInnerContent(this.metadata.title);
      }

      // Replace meta tags content
      if (element.tagName === 'meta') {
        const name = element.getAttribute('name');

        if (name === 'viewport') {
          element.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
          this.viewportMetaFound = true;
        } else if (name === 'apple-mobile-web-app-status-bar-style') {
          element.setAttribute('content', 'black');
          this.statusBarMetaFound = true;
        } else if (name === 'apple-mobile-web-app-capable') {
          element.setAttribute('content', 'yes');
          this.appleWebAppCapableFound = true;
        }

        if (this.metadata.title) {
          switch (name) {
            case 'title':
              element.setAttribute('content', this.metadata.title);
              break;
            case 'twitter:title':
              element.setAttribute('content', this.metadata.title);
              break;
          }
        }

        if (this.metadata.description) {
          switch (name) {
            case 'description':
              element.setAttribute('content', this.metadata.description);
              break;
            case 'twitter:description':
              element.setAttribute('content', this.metadata.description);
              break;
          }
        }

        if (this.metadata.image) {
          if (name === 'image') {
            element.setAttribute('content', this.metadata.image);
          }
        }

        if (this.metadata.keywords) {
          if (name === 'keywords') {
            element.setAttribute('content', this.metadata.keywords);
          }
        }

        const itemprop = element.getAttribute('itemprop');
        if (itemprop && this.metadata.title) {
          switch (itemprop) {
            case 'name':
              element.setAttribute('content', this.metadata.title);
              break;
            case 'description':
              if (this.metadata.description) {
                element.setAttribute('content', this.metadata.description);
              }
              break;
            case 'image':
              if (this.metadata.image) {
                element.setAttribute('content', this.metadata.image);
              }
              break;
          }
        }

        const property = element.getAttribute('property');
        if (property) {
          switch (property) {
            case 'og:title':
              if (this.metadata.title) {
                console.log('Replacing og:title');
                element.setAttribute('content', this.metadata.title);
              }
              break;
            case 'og:description':
              if (this.metadata.description) {
                console.log('Replacing og:description');
                element.setAttribute('content', this.metadata.description);
              }
              break;
            case 'og:image':
              if (this.metadata.image) {
                console.log('Replacing og:image');
                element.setAttribute('content', this.metadata.image);
              }
              break;
          }
        }

        // Remove the noindex meta tag
        if (name === 'robots' && element.getAttribute('content') === 'noindex') {
          console.log('Removing noindex tag');
          element.remove();
        }
      }

      // FIX 2: Handle link elements - fix hreflang URLs and favicon
      if (element.tagName === 'link') {
        const rel = element.getAttribute('rel');
        const href = element.getAttribute('href');
        
        // Fix hreflang links that point to WeWeb preview domain
        if (rel === 'alternate' && href && href.includes('weweb-preview.io')) {
          const newHref = href.replace(
            /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.weweb-preview\.io/,
            'smartcuisine.ai'
          );
          element.setAttribute('href', newHref);
          console.log('Fixed hreflang URL:', href, '->', newHref);
        }
        
        // Handle favicon
        if (rel === 'icon' || rel === 'shortcut icon') {
          console.log('Replacing favicon URL');
          element.setAttribute('href', `${config.domainSource}/favicon.ico`);
        }
      }
    } catch (error) {
      console.error('Element processing error:', error);
    }
  }

  end(element) {
    try {
      if (element.tagName === 'head') {
        if (!this.viewportMetaFound) {
          element.append(
            `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`,
            { html: true }
          );
        }
        if (!this.appleWebAppCapableFound) {
          element.append(
            `<meta name="apple-mobile-web-app-capable" content="yes">`,
            { html: true }
          );
        }
        if (!this.statusBarMetaFound) {
          element.append(
            `<meta name="apple-mobile-web-app-status-bar-style" content="black">`,
            { html: true }
          );
        }
      }
    } catch (error) {
      console.error('End element processing error:', error);
    }
  }
}
