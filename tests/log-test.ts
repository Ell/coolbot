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

// Use a subclass to track tool usage
class TrackingAnthropic extends Anthropic {
  public toolUseCount = 0;

  // Override the handleToolResponse method to track usage
  protected async handleToolResponse(
    response: any,
    originalInput: string,
    serverInfo?: {
      network: string;
      channel: string;
      user: string;
    },
    attemptCount: number = 0
  ): Promise<any> {
    // Increment the tool use count
    this.toolUseCount++;
    console.log(`Tool usage detected! Count: ${this.toolUseCount}`);

    // Call the parent method
    return super.handleToolResponse(
      response,
      originalInput,
      serverInfo,
      attemptCount
    );
  }

  // Reset the tool use count
  public resetToolUseCount(): void {
    this.toolUseCount = 0;
  }
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

  // Initialize the Anthropic client with tracking
  const anthropic = new TrackingAnthropic({
    anthropicApiKey: apiKey as string,
    maxTokens: 1000,
    model: "claude-3-5-sonnet-20240620",
    maxResponseLength: 1000, // Allow longer responses for testing
  });

  console.log("Anthropic client initialized");

  // Test both tool and non-tool queries
  const testQueries = [
    // Should use tool
    "What's the price of Bitcoin?",

    // Shouldn't use tool
    "Tell me a random joke",

    // Should use tool
    "Search for a YouTube video about TypeScript",

    // Shouldn't use tool
    "What is the capital of France?",
  ];

  // Run the tests
  for (const query of testQueries) {
    console.log(`\n\nTesting query: "${query}"`);

    // Reset the tool use count for this query
    anthropic.resetToolUseCount();

    try {
      const response = await anthropic.generateResponse(query);
      console.log("Response:");
      console.log("=".repeat(50));
      console.log(response);
      console.log("=".repeat(50));
      console.log(`Used tools: ${anthropic.toolUseCount > 0 ? "YES" : "NO"}`);
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
