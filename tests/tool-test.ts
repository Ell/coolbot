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
    anthropicApiKey: apiKey,
    maxTokens: 1000,
    model: "claude-3-5-sonnet-20240620",
    maxResponseLength: 1000, // Allow longer responses for testing
  });

  console.log("Anthropic client initialized");

  // Test queries that should use tools
  const testQueries = [
    "What's the price of Bitcoin?",
    "Search for a YouTube video about TypeScript",
    "What's the weather in New York?",
    "Write a hello world program in Python and run it",
  ];

  // Run the tests
  for (const query of testQueries) {
    console.log(`\n\nTesting query: "${query}"`);
    try {
      const response = await anthropic.generateResponse(query);
      console.log("Response:");
      console.log("=".repeat(50));
      console.log(response);
      console.log("=".repeat(50));
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
