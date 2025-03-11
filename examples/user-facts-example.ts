import toolRegistry from "../bot/toolRegistry";
import { Anthropic } from "../bot/anthropic";
import * as dotenv from "dotenv";
import path from "path";

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Make sure this directory matches your config
const toolsDirectory = path.resolve(__dirname, "../tools");

// Check for required API key
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY is required in .env file");
  process.exit(1);
}

// Import the user-facts tool
import userFacts from "../tools/user-facts";

/**
 * Main function to demonstrate user facts storage and retrieval
 */
async function main() {
  try {
    console.log("Loading tools from directory:", toolsDirectory);

    // Initialize the tool registry
    toolRegistry.setToolsDirectory(toolsDirectory, true);

    // Wait for tools to load
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Get the tools
    const tools = toolRegistry.getAllTools();
    console.log(`Loaded ${tools.length} tools`);

    // Create Anthropic client
    const anthropic = new Anthropic({
      anthropicApiKey: ANTHROPIC_API_KEY as string,
      useToolRegistry: true,
      maxTokens: 1024,
    });

    // Example 1: Remember facts about users
    console.log("\n--- Example 1: Remember facts about users ---");

    const sampleFacts = [
      { username: "alice", fact: "is a software engineer" },
      { username: "bob", fact: "loves pizza with pineapple" },
      { username: "charlie", fact: "has three dogs" },
      { username: "alice", fact: "speaks French fluently" },
      { username: "dave", fact: "is training for a marathon" },
      { username: "bob", fact: "plays guitar in a band" },
    ];

    for (const { username, fact } of sampleFacts) {
      console.log(`Remembering that ${username} ${fact}...`);

      const result = await anthropic.executeTool("remember_fact", {
        username,
        fact,
        network: "example",
        channel: "#demo",
        created_by: "example-script",
      });

      console.log(
        `Result: ${result.success ? "✓" : "✗"} ${
          result.message || result.error
        }`
      );
    }

    // Example 2: Look up facts about a specific user
    console.log("\n--- Example 2: Look up facts about a specific user ---");

    const aliceResult = await anthropic.executeTool("lookup_fact", {
      username: "alice",
      network: "example",
      channel: "#demo",
    });

    console.log(`Looking up facts about alice...`);
    console.log(
      `Result: ${aliceResult.success ? "✓" : "✗"} ${
        aliceResult.message || aliceResult.error
      }`
    );

    if (aliceResult.success && aliceResult.facts) {
      console.log(`Found ${aliceResult.total_facts} facts:`);
      for (const fact of aliceResult.facts) {
        console.log(
          `- ${fact.username} ${fact.fact} (added on ${new Date(
            fact.created_at
          ).toLocaleString()})`
        );
      }
    }

    // Example 3: Search for a specific fact
    console.log("\n--- Example 3: Search for a specific fact ---");

    const searchResult = await anthropic.executeTool("lookup_fact", {
      username: "bob",
      query: "pizza",
      network: "example",
      channel: "#demo",
    });

    console.log(`Searching bob's facts for "pizza"...`);
    console.log(
      `Result: ${searchResult.success ? "✓" : "✗"} ${
        searchResult.message || searchResult.error
      }`
    );

    if (searchResult.success && searchResult.facts) {
      console.log(`Found ${searchResult.facts.length} matching facts:`);
      for (const fact of searchResult.facts) {
        console.log(`- ${fact.username} ${fact.fact}`);
      }
    }

    // Example 4: Get random facts
    console.log("\n--- Example 4: Get random facts ---");

    const randomResult = await anthropic.executeTool("random_facts", {
      network: "example",
      channel: "#demo",
      limit: 3,
    });

    console.log(`Getting random facts...`);
    console.log(
      `Result: ${randomResult.success ? "✓" : "✗"} ${
        randomResult.message || randomResult.error
      }`
    );

    if (randomResult.success && randomResult.facts) {
      console.log(`Retrieved ${randomResult.facts.length} random facts:`);
      for (const fact of randomResult.facts) {
        console.log(`- ${fact.username} ${fact.fact}`);
      }
    }
  } catch (error) {
    console.error("Error in example:", error);
  }
}

// Run the main function
main().catch(console.error);
