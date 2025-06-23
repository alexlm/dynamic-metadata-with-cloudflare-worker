// index.ts
import { config } from '../config.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Simple pass-through - just proxy to WeWeb
    const wewebUrl = `https://dbca59a5-fca8-4527-9d3a-2871dbf3822c.weweb-preview.io${url.pathname}`;
    return fetch(wewebUrl);
  }
};
