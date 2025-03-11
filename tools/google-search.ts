import { createTool } from "../bot/tool";
import { z } from "zod";
import fetch from "node-fetch";

/**
 * TypeScript version of the Python api_get function
 * Performs a Google Custom Search API request
 */
async function apiGet(
  query: string,
  isImage: boolean = false,
  num: number = 1
) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error("GOOGLE_API_KEY is not set");
  }

  // Construct the base URL with parameters
  const url = new URL("https://www.googleapis.com/customsearch/v1");

  // Add search engine ID (cx) and other parameters
  url.searchParams.append("cx", "007629729846476161907:ud5nlxktgcw");
  url.searchParams.append("fields", "items(title,link,snippet)");
  url.searchParams.append("safe", "off");
  url.searchParams.append("nfpr", "1");

  // Add image search parameter if needed
  if (isImage) {
    url.searchParams.append("searchType", "image");
  }

  // Add API key, query, and num parameters
  url.searchParams.append("key", key);
  url.searchParams.append("q", query);
  url.searchParams.append("num", num.toString());

  // Send the request
  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(
      `Error searching Google: ${response.status} ${response.statusText}`
    );
  }

  // Parse and return the JSON response
  return (await response.json()) as any;
}

/**
 * Check if an image URL is valid and accessible
 * @param url The image URL to check
 * @returns true if the URL is valid and accessible, false otherwise
 */
async function isImageUrlValid(url: string): Promise<boolean> {
  try {
    // Attempt to make a HEAD request to the URL
    const response = await fetch(url, {
      method: "HEAD",
      timeout: 5000, // 5 second timeout
    });

    // Check if the response is OK and the content type is an image
    if (response.ok) {
      const contentType = response.headers.get("content-type");
      return contentType ? contentType.startsWith("image/") : false;
    }

    return false;
  } catch (error) {
    console.log(`Error validating image URL ${url}: ${error}`);
    return false;
  }
}

// Tool for regular Google search - returns first result URL
const googleSearchTool = createTool(
  "google_search",
  "Search Google and get the URL of the first result",
  z.object({
    query: z.string().describe("The search query to look up on Google"),
    num_results: z
      .number()
      .optional()
      .describe("Number of results to fetch (default: 1)"),
  }),
  async (inputs) => {
    try {
      const { query, num_results = 1 } = inputs;

      // Get search results
      const data = await apiGet(query, false, num_results);

      // Check if results exist
      if (!data.items || data.items.length === 0) {
        return "No results found for your query.";
      }

      // Return just the URL of the first result
      return data.items[0].link;
    } catch (error) {
      console.error("Error in Google search:", error);
      return `Error searching Google: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  }
);

// Tool for Google image search - returns first working image URL
const googleImageSearchTool = createTool(
  "google_image_search",
  "Search Google Images and get the URL of the first valid image result, with up to 5 attempts",
  z.object({
    query: z.string().describe("The search query to look up on Google Images"),
    num_results: z
      .number()
      .optional()
      .describe(
        "Number of results to fetch (default: 10 to try multiple images if needed)"
      ),
  }),
  async (inputs) => {
    try {
      const { query, num_results = 10 } = inputs;

      // Ensure we fetch at least 5 results for retry attempts
      const fetchCount = Math.max(num_results, 5);

      // Get image search results
      const data = await apiGet(query, true, fetchCount);

      // Check if results exist
      if (!data.items || data.items.length === 0) {
        return "No image results found for your query.";
      }

      // Try up to 5 image URLs or until we find a valid one
      const MAX_ATTEMPTS = 5;
      const attempts = Math.min(MAX_ATTEMPTS, data.items.length);

      for (let i = 0; i < attempts; i++) {
        const imageUrl = data.items[i].link;
        console.log(`Checking image URL ${i + 1}/${attempts}: ${imageUrl}`);

        // Verify the image URL is valid
        const isValid = await isImageUrlValid(imageUrl);

        if (isValid) {
          console.log(`Found valid image URL: ${imageUrl}`);
          return imageUrl;
        } else {
          console.log(`Image URL is not valid, trying next result...`);
        }
      }

      // If we've tried all available URLs and none worked
      return "Could not find a valid image URL after 5 attempts. Please try a different search query.";
    } catch (error) {
      console.error("Error in Google image search:", error);
      return `Error searching Google Images: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  }
);

// Export the tools
export default {
  google_search: googleSearchTool,
  google_image_search: googleImageSearchTool,
};
