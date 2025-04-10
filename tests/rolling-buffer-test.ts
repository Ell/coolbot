import { describe, test, expect, beforeAll, afterAll } from "bun:test";
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

describe("Anthropic Client - Rolling Buffer", () => {
  let anthropic: Anthropic;
  const channel = {
    network: "irc.example.com",
    channel: "#test-rolling-buffer",
    user: "test-user",
  };

  beforeAll(async () => {
    // Initialize the tool registry
    toolRegistry.setToolsDirectory(path.resolve(process.cwd(), "tools"), true);
    console.log("Waiting for tools to load...");

    // Wait for tools to load
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Get all tools
    const tools = toolRegistry.getAllTools();
    console.log(`Loaded ${tools.length} tools`);

    // Initialize the Anthropic client
    anthropic = new Anthropic({
      anthropicApiKey: apiKey as string,
      maxTokens: 1000,
      model: "claude-3-5-sonnet-20240620",
      maxResponseLength: 1000, // Allow longer responses for testing
    });

    console.log("Anthropic client initialized");
  });

  afterAll(() => {
    // Clean up resources
    anthropic.close();
  });

  test("should maintain a rolling buffer of 10 messages", async () => {
    console.log("\n=== TESTING ROLLING BUFFER OF 10 MESSAGES ===\n");

    // Send 12 numbered messages to fill and exceed the buffer
    for (let i = 1; i <= 12; i++) {
      const message = `This is message number ${i}`;
      console.log(`Sending: "${message}"`);

      await anthropic.generateResponse(message, channel);

      // Log the current buffer size
      const bufferSize = anthropic.getChannelHistorySize(channel);
      console.log(`Buffer size after message ${i}: ${bufferSize}`);

      // Add expectations based on buffer size
      if (i <= 10) {
        // For the first 10 messages, buffer size should match message count
        expect(bufferSize).toBe(i * 2); // Each message + response = 2 entries
      } else {
        // After 10 messages, buffer should be capped at 20 (10 messages + 10 responses)
        expect(bufferSize).toBe(20);
      }

      // Add a small delay between requests
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Test if the early messages were dropped
    console.log(
      "\nTesting if rolling buffer kept only the most recent messages:"
    );
    console.log("Asking about message #1 (should be forgotten):");
    const response1 = await anthropic.generateResponse(
      "What was message number 1?",
      channel
    );
    console.log(`Response: ${response1}`);

    // Claude might say it doesn't know or recall message #1
    expect(response1.toLowerCase()).not.toContain("message number 1 was");

    console.log("\nAsking about message #12 (should be remembered):");
    const response2 = await anthropic.generateResponse(
      "What was message number 12?",
      channel
    );
    console.log(`Response: ${response2}`);

    // Claude should remember message #12
    expect(response2.toLowerCase()).toContain("12");

    // Get a summary of all channel histories
    const summary = anthropic.getHistorySummary();
    console.log("\nHistory summary for all channels:");
    console.log(JSON.stringify(summary, null, 2));

    // Make sure our test channel is in the history
    const channelKey = `${channel.network.toLowerCase()}/${channel.channel.toLowerCase()}`;
    expect(summary).toHaveProperty(channelKey);
    expect(summary[channelKey]).toBe(20); // 10 messages + 10 responses = 20 entries total
  });
});
