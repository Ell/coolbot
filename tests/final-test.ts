import { Anthropic } from "../bot/anthropic";
import toolRegistry from "../bot/toolRegistry";
import path from "path";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Make sure we have the API key
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY environment variable is not set");
  process.exit(1);
}

async function main() {
  // Initialize the tool registry
  toolRegistry.setToolsDirectory(path.resolve(process.cwd(), "tools"), true);
  console.log("Waiting for tools to load...");

  // Wait a bit for tools to load
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Get all tools
  const tools = toolRegistry.getAllTools();
  console.log(`Loaded ${tools.length} tools`);

  // Initialize the Anthropic client
  const anthropic = new Anthropic({
    anthropicApiKey: apiKey as string,
    maxTokens: 1000,
    model: "claude-3-5-sonnet-20240620",
    maxResponseLength: 1000, // Allow longer responses for testing
  });

  console.log("Anthropic client initialized");

  // Test pairs of similar queries - one should use tools, one shouldn't
  const testQueries = [
    // Should use tool - factual data
    "What's the current price of Bitcoin?",

    // Shouldn't use tool - general knowledge
    "What is Bitcoin?",

    // Should use tool - specific search
    "Search for a YouTube video about TypeScript",

    // Shouldn't use tool - creative content
    "Tell me a joke about programming",
  ];

  // Run the tests
  for (const query of testQueries) {
    console.log(`\n\nTesting query: "${query}"`);

    try {
      console.time(`Query time: ${query}`);
      const response = await anthropic.generateResponse(query);
      console.timeEnd(`Query time: ${query}`);

      console.log("Response:");
      console.log("=".repeat(50));
      console.log(response);
      console.log("=".repeat(50));

      // Infer tool usage - responses that come quickly likely didn't use tools
      // This is imperfect but gives us an idea
    } catch (error) {
      console.error(`Error with query "${query}":`, error);
    }

    // Add a small delay between requests
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("\nTests completed");
}

// Run the main function
main().catch(console.error);
