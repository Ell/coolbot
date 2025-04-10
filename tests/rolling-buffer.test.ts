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

  test("should maintain a buffer of messages", async () => {
    console.log("\n=== TESTING BUFFER BEHAVIOR ===\n");

    // Send just 2 messages to test basic buffer functionality
    for (let i = 1; i <= 2; i++) {
      const message = `This is message number ${i}`;
      console.log(`Sending: "${message}"`);

      await anthropic.generateResponse(message, channel);

      // Log the current buffer size
      const bufferSize = anthropic.getChannelHistorySize(channel);
      console.log(`Buffer size after message ${i}: ${bufferSize}`);

      // Verify buffer size is increasing
      expect(bufferSize).toBeGreaterThan(0);
    }

    // Get a summary of all channel histories
    const summary = anthropic.getHistorySummary();
    console.log("\nHistory summary for all channels:");
    console.log(JSON.stringify(summary, null, 2));

    // Check if any key in summary includes our channel name
    const channelName = channel.channel.toLowerCase();
    const hasMatchingChannel = Object.keys(summary).some((key) =>
      key.includes(channelName)
    );
    expect(hasMatchingChannel).toBe(true);
  });
});
