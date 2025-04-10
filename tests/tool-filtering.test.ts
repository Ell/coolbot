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

describe("Anthropic Client - Tool Filtering", () => {
  let anthropic: Anthropic;
  const channel = {
    network: "irc.example.com",
    channel: "#test-tools",
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

  test("should respond to tool-relevant queries", async () => {
    // Test just one query that should trigger tool usage and generate a response
    const query = "Calculate 125 * 37";
    console.log(`\nTesting tool query: "${query}"`);
    const response = await anthropic.generateResponse(query, channel);
    console.log(`Response: "${response}"`);

    // Should have a non-empty response
    expect(response.trim().length).toBeGreaterThan(0);
  });

  test("should stay silent for general questions", async () => {
    // Test just one query that shouldn't trigger tool usage
    const query = "Tell me a joke";
    console.log(`\nTesting general query: "${query}"`);
    const response = await anthropic.generateResponse(query, channel);
    console.log(`Response: "${response}"`);

    // Should have an empty response
    expect(response.trim().length).toBe(0);
  });
});
