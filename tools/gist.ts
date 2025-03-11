import { z } from "zod";
import { createTool } from "../bot/tool";
import axios from "axios";

/**
 * Convert a GitHub Gist URL to its raw content URL
 * @param url The GitHub Gist URL
 * @returns The raw content URL
 */
function convertToRawGistUrl(url: string): {
  rawUrl: string;
  fileId: string | null;
} {
  try {
    // Parse the URL to extract key components
    const gistUrlPattern =
      /^https?:\/\/gist\.github\.com\/([^\/]+)\/([a-f0-9]+)(?:\/([a-f0-9]+))?/;
    const rawGistUrlPattern =
      /^https?:\/\/gist\.githubusercontent\.com\/([^\/]+)\/([a-f0-9]+)\/raw(?:\/([a-f0-9]+))?/;

    // If it's already a raw URL, return it
    if (rawGistUrlPattern.test(url)) {
      const match = url.match(rawGistUrlPattern);
      if (match) {
        return { rawUrl: url, fileId: match[3] || null };
      }
    }

    // Check if it's a valid Gist URL
    const match = url.match(gistUrlPattern);
    if (!match) {
      throw new Error("Invalid GitHub Gist URL format");
    }

    const [, username, gistId, fileId] = match;

    // If fileId is provided, construct URL to that specific file
    if (fileId) {
      return {
        rawUrl: `https://gist.githubusercontent.com/${username}/${gistId}/raw/${fileId}`,
        fileId,
      };
    }

    // Otherwise, return URL to the entire gist
    return {
      rawUrl: `https://gist.githubusercontent.com/${username}/${gistId}/raw`,
      fileId: null,
    };
  } catch (error) {
    throw new Error(
      `Failed to parse Gist URL: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Fetch GitHub Gist content
 */
const fetchGistTool = createTool(
  "fetch_gist",
  "Fetch the content of a GitHub Gist from its URL",
  z.object({
    url: z.string().describe("The GitHub Gist URL to fetch content from"),
    max_size_kb: z
      .number()
      .int()
      .positive()
      .default(100)
      .optional()
      .describe("Maximum size to fetch in KB (default: 100, max: 1000)"),
  }),
  async (inputs) => {
    const { url, max_size_kb = 100 } = inputs;

    // Ensure the max size is within reasonable limits
    const maxSize = Math.min(max_size_kb, 1000) * 1024; // Convert to bytes, cap at 1MB

    try {
      // Convert the URL to a raw content URL
      const { rawUrl, fileId } = convertToRawGistUrl(url);

      // Fetch the metadata first if we need to handle a multi-file gist
      let filenames: string[] = [];
      let isMultiFile = false;

      if (!fileId) {
        try {
          // Extract the gist ID from the URL
          const gistIdMatch = url.match(/\/([a-f0-9]+)(?:\/|$)/);
          if (gistIdMatch && gistIdMatch[1]) {
            const gistId = gistIdMatch[1];
            const metadataUrl = `https://api.github.com/gists/${gistId}`;
            const metadataResponse = await axios.get(metadataUrl);

            if (metadataResponse.data && metadataResponse.data.files) {
              isMultiFile = Object.keys(metadataResponse.data.files).length > 1;
              filenames = Object.keys(metadataResponse.data.files);
            }
          }
        } catch (error) {
          // If we can't get metadata, just proceed with the raw URL
          console.warn("Could not fetch Gist metadata:", error);
        }
      }

      // Fetch the content
      const response = await axios.get(rawUrl, {
        headers: {
          Accept: "text/plain,application/vnd.github.v3.raw",
          "User-Agent": "CoolBot-IRC-Bot",
        },
        maxContentLength: maxSize,
        responseType: "text",
      });

      // Check content size
      const contentSize = response.data.length;
      if (contentSize > maxSize) {
        return {
          success: false,
          error: `Gist content is too large (${Math.round(
            contentSize / 1024
          )}KB). Maximum allowed is ${max_size_kb}KB.`,
        };
      }

      // Extract description if available
      let description = "";
      if (response.headers["x-gist-description"]) {
        description = response.headers["x-gist-description"];
      }

      // Return the content
      return {
        success: true,
        url: url,
        raw_url: rawUrl,
        content: response.data,
        size_bytes: contentSize,
        size_kb: Math.round((contentSize / 1024) * 10) / 10,
        is_multi_file: isMultiFile,
        filenames: isMultiFile ? filenames : [],
        description: description || undefined,
      };
    } catch (error) {
      // Handle axios errors specially to provide better feedback
      if (axios.isAxiosError(error)) {
        if (error.response) {
          // Server responded with a status code outside of 2xx range
          return {
            success: false,
            error: `Server returned error ${error.response.status}: ${error.response.statusText}`,
            status: error.response.status,
          };
        } else if (error.request) {
          // Request was made but no response was received
          return {
            success: false,
            error:
              "No response received from GitHub. The server might be down or the URL is invalid.",
          };
        }
      }

      // Generic error handling
      return {
        success: false,
        error: `Failed to fetch Gist content: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
);

/**
 * List files in a multi-file GitHub Gist
 */
const listGistFilesTool = createTool(
  "list_gist_files",
  "List all files in a multi-file GitHub Gist",
  z.object({
    gist_id: z.string().describe("The GitHub Gist ID to fetch file list from"),
  }),
  async (inputs) => {
    const { gist_id } = inputs;

    try {
      // Clean the gist ID (in case a full URL was provided)
      const cleanGistId = gist_id
        .replace(/^https?:\/\/gist\.github\.com\/[^\/]+\//, "")
        .replace(/\/.+$/, "");

      // Fetch the gist metadata
      const metadataUrl = `https://api.github.com/gists/${cleanGistId}`;
      const response = await axios.get(metadataUrl, {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "CoolBot-IRC-Bot",
        },
      });

      if (!response.data || !response.data.files) {
        return {
          success: false,
          error: "No files found in the Gist or invalid Gist ID",
        };
      }

      // Extract file information
      const files = Object.entries(response.data.files).map(
        ([filename, fileData]: [string, any]) => ({
          filename,
          language: fileData.language,
          size: fileData.size,
          raw_url: fileData.raw_url,
          type: fileData.type,
        })
      );

      return {
        success: true,
        gist_id: cleanGistId,
        description: response.data.description || undefined,
        owner: response.data.owner ? response.data.owner.login : "anonymous",
        created_at: response.data.created_at,
        updated_at: response.data.updated_at,
        file_count: files.length,
        files,
      };
    } catch (error) {
      // Handle axios errors
      if (axios.isAxiosError(error)) {
        if (error.response) {
          return {
            success: false,
            error: `Server returned error ${error.response.status}: ${error.response.statusText}`,
            status: error.response.status,
          };
        } else if (error.request) {
          return {
            success: false,
            error:
              "No response received from GitHub API. The server might be down.",
          };
        }
      }

      return {
        success: false,
        error: `Failed to list Gist files: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
);

export default {
  fetchGist: fetchGistTool,
  listGistFiles: listGistFilesTool,
};
