export const config = {
  //domainSource: "https://dbca59a5-fca8-4527-9d3a-2871dbf3822c.weweb-preview.io", // Your WeWeb app preview link
  domainSource: "https://40f5cbb5-91ba-4dda-9a39-9d08d52d3b08.weweb-preview.io",
  patterns: [
      {
          pattern: "/r/[^/]+",
          metaDataEndpoint: "https://x1ep-0nkn-l9fv.n2.xano.io/api:biMU4Ny2/recipes/get_single/{recipes_slug}"
      }
      // Add more patterns and their metadata endpoints as needed
  ]
};
