import { config } from '../config.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const userAgent = request.headers.get('User-Agent') || '';
    
    // Check if this is a bot/crawler request
    const isBot = /bot|crawler|spider|crawling|facebookexternalhit|whatsapp|telegram|twitter|pinterest|linkedin|slack|discord/i.test(userAgent);
    
    console.log("Request for:", url.pathname);
    console.log("User-Agent:", userAgent);
    console.log("Is Bot:", isBot);
    
    // For non-bot requests, just pass through to origin
    if (!isBot) {
      console.log("Regular user, passing through to origin");
      return fetch(`${config.domainSource}${url.pathname}${url.search}`, {
        headers: request.headers,
        method: request.method,
        body: request.body
      });
    }
    
    // For bot requests, apply metadata modifications
    console.log("Bot detected, applying metadata modifications");
    
    // Parse the request URL
    const referer = request.headers.get('Referer');

    // Function to get the pattern configuration that matches the URL
    function getPatternConfig(url) {
      for (const patternConfig of config.patterns) {
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

    // Handle dynamic page requests for bots
    const patternConfig = getPatternConfig(url.pathname);
    if (patternConfig) {
      console.log("Dynamic page detected for bot:", url.pathname);

      // Fetch the source page content
      let source = await fetch(`${config.domainSource}${url.pathname}${url.search}`);

      // Remove "X-Robots-Tag" from the headers
      const sourceHeaders = new Headers(source.headers);
      sourceHeaders.delete('X-Robots-Tag');
      source = new Response(source.body, {
        status: source.status,
        headers: sourceHeaders
      });

      const metadata = await requestMetadata(url.pathname, patternConfig.metaDataEndpoint);
      console.log("Metadata fetched:", metadata);

      // Create a custom header handler with the fetched metadata
      const customHeaderHandler = new CustomHeaderHandler(metadata);

      // Transform the source HTML with the custom headers
      return new HTMLRewriter()
        .on('*', customHeaderHandler)
        .transform(source);

    // Handle page data requests for the WeWeb app
    } else if (isPageData(url.pathname)) {
      console.log("Page data detected:", url.pathname);
      console.log("Referer:", referer);

      // Fetch the source data content
      const sourceResponse = await fetch(`${config.domainSource}${url.pathname}`);
      let sourceData = await sourceResponse.json();

      let pathname = referer;
      pathname = pathname ? pathname + (pathname.endsWith('/') ? '' : '/') : null;
      if (pathname !== null) {
        const patternConfigForPageData = getPatternConfig(pathname);
        if (patternConfigForPageData) {
          const metadata = await requestMetadata(pathname, patternConfigForPageData.metaDataEndpoint);
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
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    }

    // For all other bot requests, just pass through
    console.log("Fetching original content for bot:", url.pathname);
    const sourceUrl = `${config.domainSource}${url.pathname}${url.search}`;
    const sourceResponse = await fetch(sourceUrl);
    
    // Get the content type
    const contentType = sourceResponse.headers.get('Content-Type') || '';
    
    // Only remove X-Robots-Tag for HTML responses
    if (!contentType.includes('text/html')) {
      return sourceResponse;
    }

    // For HTML responses, remove the X-Robots-Tag header
    const modifiedHeaders = new Headers(sourceResponse.headers);
    modifiedHeaders.delete('X-Robots-Tag');

    return new Response(sourceResponse.body, {
      status: sourceResponse.status,
      headers: modifiedHeaders,
    });
  }
};

// CustomHeaderHandler class to modify HTML content based on metadata
class CustomHeaderHandler {
  constructor(metadata) {
    this.metadata = metadata;
  }

  element(element) {
    // Replace the <title> tag content
    if (element.tagName == "title") {
      console.log('Replacing title tag content');
      element.setInnerContent(this.metadata.title);
    }
    // Replace meta tags content
    if (element.tagName == "meta") {
      const name = element.getAttribute("name");
      switch (name) {
        case "title":
          element.setAttribute("content", this.metadata.title);
          break;
        case "description":
          element.setAttribute("content", this.metadata.description);
          break;
        case "image":
          element.setAttribute("content", this.metadata.image);
          break;
        case "keywords":
          element.setAttribute("content", this.metadata.keywords);
          break;
        case "twitter:title":
          element.setAttribute("content", this.metadata.title);
          break;
        case "twitter:description":
          element.setAttribute("content", this.metadata.description);
          break;
      }

      const itemprop = element.getAttribute("itemprop");
      switch (itemprop) {
        case "name":
          element.setAttribute("content", this.metadata.title);
          break;
        case "description":
          element.setAttribute("content", this.metadata.description);
          break;
        case "image":
          element.setAttribute("content", this.metadata.image);
          break;
      }

      const type = element.getAttribute("property");
      switch (type) {
        case "og:title":
          console.log('Replacing og:title');
          element.setAttribute("content", this.metadata.title);
          break;
        case "og:description":
          console.log('Replacing og:description');
          element.setAttribute("content", this.metadata.description);
          break;
        case "og:image":
          console.log('Replacing og:image');
          element.setAttribute("content", this.metadata.image);
          break;
      }

      // Remove the noindex meta tag
      const robots = element.getAttribute("name");
      if (robots === "robots" && element.getAttribute("content") === "noindex") {
        console.log('Removing noindex tag');
        element.remove();
      }
    }
  }
}
