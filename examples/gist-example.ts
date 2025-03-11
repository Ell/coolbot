import toolRegistry from "../bot/toolRegistry";
import { Anthropic } from "../bot/anthropic";
import dotenv from "dotenv";
import path from "path";

// Load environment variables from .env file
dotenv.config();

// Make sure this directory matches your config
const toolsDirectory = path.resolve(__dirname, "../tools");

// Get API key from environment variables
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Check for required API key
if (!ANTHROPIC_API_KEY) {
  console.error(
    "Error: ANTHROPIC_API_KEY is required. Please set it in your environment variables."
  );
  process.exit(1);
}

async function main() {
  console.log("Loading tools from directory:", toolsDirectory);

  // Initialize the tool registry
  toolRegistry.setToolsDirectory(toolsDirectory, true);

  // Wait for tools to load
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Get the tools
  const tools = toolRegistry.getAllTools();
  console.log(`Loaded ${tools.length} tools`);

  // Create an Anthropic client to use for executing tools
  const anthropic = new Anthropic({
    anthropicApiKey: ANTHROPIC_API_KEY as string,
    useToolRegistry: true,
  });

  // Get Gist URL from command line args or use a default example
  const gistUrl =
    process.argv[2] || "https://gist.github.com/octocat/6cad326836d38bd3a7ae";
  console.log(`\nFetching GitHub Gist: ${gistUrl}\n`);

  try {
    // Example 1: Fetch content of a Gist
    console.log("--- Example 1: Fetching Gist content ---");
    const gistResult = await anthropic.executeTool("fetch_gist", {
      url: gistUrl,
      max_size_kb: 100,
    });

    if (gistResult.success) {
      console.log("Gist content successfully fetched!");
      console.log(`URL: ${gistResult.url}`);
      console.log(`Raw URL: ${gistResult.raw_url}`);
      console.log(`Size: ${gistResult.size_kb} KB`);

      if (gistResult.description) {
        console.log(`Description: ${gistResult.description}`);
      }

      if (gistResult.is_multi_file) {
        console.log(
          `Multi-file gist with ${gistResult.filenames.length} files:`
        );
        console.log(gistResult.filenames);
      }

      // Show content preview (first 200 chars)
      const contentPreview =
        gistResult.content.length > 200
          ? gistResult.content.substring(0, 200) + "..."
          : gistResult.content;

      console.log("\nContent preview:");
      console.log("----------------");
      console.log(contentPreview);
      console.log("----------------");
    } else {
      console.log("Failed to fetch Gist:");
      console.log(gistResult.error);
    }

    console.log("\n");

    // Example 2: Extract Gist ID for listing files
    let gistId = "";
    const gistIdMatch = gistUrl.match(/\/([a-f0-9]+)(?:\/|$)/);
    if (gistIdMatch && gistIdMatch[1]) {
      gistId = gistIdMatch[1];
    } else {
      gistId = gistUrl; // Assume the user passed just the ID
    }

    // Example 2: List files in a multi-file Gist
    console.log("--- Example 2: Listing files in Gist ---");
    const listResult = await anthropic.executeTool("list_gist_files", {
      gist_id: gistId,
    });

    if (listResult.success) {
      console.log(`Gist ID: ${listResult.gist_id}`);

      if (listResult.description) {
        console.log(`Description: ${listResult.description}`);
      }

      console.log(`Owner: ${listResult.owner}`);
      console.log(
        `Created: ${new Date(listResult.created_at).toLocaleString()}`
      );
      console.log(
        `Updated: ${new Date(listResult.updated_at).toLocaleString()}`
      );
      console.log(`\nFiles (${listResult.file_count}):`);

      // Display file information
      listResult.files.forEach((file, index) => {
        console.log(`\n${index + 1}. ${file.filename}`);
        console.log(`   Language: ${file.language || "Unknown"}`);
        console.log(`   Size: ${file.size} bytes`);
        console.log(`   Type: ${file.type}`);
        console.log(`   Raw URL: ${file.raw_url}`);
      });
    } else {
      console.log("Failed to list Gist files:");
      console.log(listResult.error);
    }
  } catch (error) {
    console.error("Error executing tools:", error);
  }
}

// Run the main function
main().catch(console.error);
