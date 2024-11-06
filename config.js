export const config = {
  domainSource: "https://dbca59a5-fca8-4527-9d3a-2871dbf3822c.weweb-preview.io", // Your WeWeb app preview link
  patterns: [
      {
          pattern: "/recipe/[^/]+",
          metaDataEndpoint: "https://x1ep-0nkn-l9fv.n2.xano.io/api:biMU4Ny2/recipes/get_single/{recipes_id}"
      }
      // Add more patterns and their metadata endpoints as needed
  ]
};
