import { Anthropic } from "../bot/anthropic";
import toolRegistry from "../bot/toolRegistry";

/**
 * Example demonstrating the IRC-focused Anthropic client.
 * This shows how to build an IRC bot with Coolbot's Anthropic client that:
 * 1. Automatically formats all responses for IRC (under 500 chars)
 * 2. Provides natural, conversational responses
 * 3. Presents information as if it naturally knows it
 */
async function main() {
  // Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }

  // Set up the tool registry to use tools from the project's root tools directory
  console.log("Initializing data providers from root directory");
  toolRegistry.setToolsDirectory("../tools", true);

  // Note: Data providers are loaded automatically from individual files:
  // - Echo: Text processing
  // - Weather: Location-based weather information
  // - Calculator: Mathematical operations
  console.log("Loading data providers...");

  // Slight delay to ensure data providers are loaded
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const providers = toolRegistry.getAllTools();
  console.log(`Loaded ${providers.length} data providers`);

  // Create the Anthropic client - all output will be IRC formatted (500 char limit)
  console.log("Creating Anthropic client for IRC");
  const client = new Anthropic({
    anthropicApiKey: apiKey,
    maxTokens: 1000,
    maxRequests: 25,
    maxResponseLength: 500, // IRC max message length
    maxToolAttempts: 3, // Allow up to 3 tool attempts in sequence
    maxHistoryLength: 10, // Keep context of the last 10 messages
  });

  /**
   * Process an IRC message and return a natural, conversational response.
   * Responses are automatically formatted to IRC constraints (500 char max).
   */
  async function processIrcMessage(
    message: string,
    username: string = "User"
  ): Promise<void> {
    try {
      console.log(`\n[${username}] ${message}`);
      const response = await client.generateResponse(message);
      console.log(`[Bot] ${response}`);
    } catch (error) {
      console.log(
        "[Bot] Sorry, I encountered an error processing your message."
      );
    }
  }

  // Simulate an IRC conversation
  console.log("=== IRC CONVERSATION ===");

  // Example 1: Simple echo request
  await processIrcMessage('use echo message="Hello, IRC world!"', "Alice");

  // Example 2: Weather information request
  await processIrcMessage("What's the weather like in Tokyo?", "Bob");

  // Example 3: Mathematical calculation
  await processIrcMessage(
    "Calculate 25 * 4 and then echo the result",
    "Charlie"
  );

  // Example 4: Follow-up using conversation context
  await processIrcMessage("What was the temperature in Tokyo?", "Bob");

  // Example 5: Multi-part information request
  await processIrcMessage(
    "Get the weather in New York, calculate the temperature in Fahrenheit, and then echo that information",
    "Dave"
  );

  // Example 6: Location comparison
  await processIrcMessage(
    "What's the temperature difference between Tokyo and London right now?",
    "Frank"
  );

  // Example 7: Comparative analysis
  await processIrcMessage(
    "Which is warmer right now, Paris or Rome, and by how many degrees?",
    "Grace"
  );

  // Example 8: Weather trend analysis
  await processIrcMessage(
    "Is it currently warmer in Miami than the average temperature for this time of year?",
    "Heidi"
  );

  // Example 9: General knowledge question
  await processIrcMessage("What is the IRC protocol used for?", "Eve");

  // Clean up
  console.log("=== END OF CONVERSATION ===");
  client.close();
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}

// Export for potential import elsewhere
export { main };
