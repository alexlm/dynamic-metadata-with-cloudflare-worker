// index.ts
import { config } from '../config.js';

export default {
  async fetch(request, env, ctx) {
    // Extracting configuration values
    const domainSource = config.domainSource;
    const patterns = config.patterns;

    console.log("Worker started");

    // Parse the request URL
    const url = new URL(request.url);
    const referer = request.headers.get('Referer');

    // SERVICE WORKER FIX: Intercept and force version to 444
    if (url.pathname === '/serviceworker.js' || url.pathname === '/sw.js') {
      console.log("🔥 Intercepting service worker - forcing version to 444");
      
      try {
        // Fetch WeWeb's original service worker
        const originalSW = await fetch(`${domainSource}${url.pathname}`);
        let originalCode = await originalSW.text();
        
        // Log what WeWeb is generating
        console.log("WeWeb's original service worker version:", originalCode.match(/const version = (\d+);/)?.[1] || 'not found');
        
        // Force replace ANY version number with 444
        const fixedCode = originalCode.replace(
          /const version = \d+;/g, 
          'const version = 444;'
        );
        
        // Also handle if WeWeb changes the format
        const finalCode = fixedCode
          .replace(/version = \d+/g, 'version = 444')
          .replace(/version:\s*\d+/g, 'version: 444');
        
        console.log("✅ Service worker version forced to 444");
        
        return new Response(finalCode, {
          headers: { 
            'Content-Type': 'application/javascript',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'X-Forced-Version': '444'
          }
        });
        
      } catch (error) {
        console.error("❌ Service worker modification failed:", error);
        
        // Fallback: hardcoded working service worker
        const fallbackSW = `
const version = 444;
self.addEventListener('install', event => {
    // eslint-disable-next-line no-console
    console.log(\`Service worker v\${version} installed\`);
});
self.addEventListener('activate', event => {
    // eslint-disable-next-line no-console
    console.log(\`Service worker v\${version} activated\`);
});
self.addEventListener('fetch', event => {
    //No cache in service worker
    if (event.request.method === 'POST' || event.request.method === 'PUT' || event.request.method === 'DELETE') {
        return;
    }
    event.respondWith(fetch(event.request));
});
`;
        
        return new Response(fallbackSW, {
          headers: { 
            'Content-Type': 'application/javascript',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          }
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
  },
};

// CustomHeaderHandler class to modify HTML content based on metadata
class CustomHeaderHandler {
  constructor(metadata) {
    this.metadata = metadata;
    this.viewportMetaFound = false;
    this.statusBarMetaFound = false;
    this.appleWebAppCapableFound = false;
  }

  element(element) {
    // Replace the <title> tag content
    if (element.tagName === 'title') {
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

      switch (name) {
        case 'title':
          element.setAttribute('content', this.metadata.title);
          break;
        case 'description':
          element.setAttribute('content', this.metadata.description);
          break;
        case 'image':
          element.setAttribute('content', this.metadata.image);
          break;
        case 'keywords':
          element.setAttribute('content', this.metadata.keywords);
          break;
        case 'twitter:title':
          element.setAttribute('content', this.metadata.title);
          break;
        case 'twitter:description':
          element.setAttribute('content', this.metadata.description);
          break;
      }

      const itemprop = element.getAttribute('itemprop');
      switch (itemprop) {
        case 'name':
          element.setAttribute('content', this.metadata.title);
          break;
        case 'description':
          element.setAttribute('content', this.metadata.description);
          break;
        case 'image':
          element.setAttribute('content', this.metadata.image);
          break;
      }

      const property = element.getAttribute('property');
      switch (property) {
        case 'og:title':
          console.log('Replacing og:title');
          element.setAttribute('content', this.metadata.title);
          break;
        case 'og:description':
          console.log('Replacing og:description');
          element.setAttribute('content', this.metadata.description);
          break;
        case 'og:image':
          console.log('Replacing og:image');
          element.setAttribute('content', this.metadata.image);
          break;
      }

      // Remove the noindex meta tag
      if (name === 'robots' && element.getAttribute('content') === 'noindex') {
        console.log('Removing noindex tag');
        element.remove();
      }
    }

    // Replace favicon URL and process link elements
    if (element.tagName === 'link') {
      const rel = element.getAttribute('rel');
      console.log(`Processing link element with rel: ${rel}`);
      if (rel === 'icon' || rel === 'shortcut icon') {
        console.log('Replacing favicon URL');
        element.setAttribute('href', `${config.domainSource}/favicon.ico?_wwcv=150`);
      }
    }
  }

  end(element) {
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
  }
}
