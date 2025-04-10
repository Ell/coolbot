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

  // Define two different channels
  const channel1 = {
    network: "irc.example.com",
    channel: "#test1",
    user: "user1",
  };

  const channel2 = {
    network: "irc.example.com",
    channel: "#test2",
    user: "user2",
  };

  console.log("\n=== TESTING CHANNEL ISOLATION ===\n");

  // First query in channel 1 - establish some context
  console.log(`Channel 1 (${channel1.channel}): "My name is Alice"`);
  let response1 = await anthropic.generateResponse(
    "My name is Alice",
    channel1
  );
  console.log(`Response: ${response1}`);

  // First query in channel 2 - different context
  console.log(`\nChannel 2 (${channel2.channel}): "My name is Bob"`);
  let response2 = await anthropic.generateResponse("My name is Bob", channel2);
  console.log(`Response: ${response2}`);

  // Follow-up in channel 1 - should remember Alice
  console.log(`\nChannel 1 (${channel1.channel}): "What is my name?"`);
  response1 = await anthropic.generateResponse("What is my name?", channel1);
  console.log(`Response: ${response1}`);

  // Follow-up in channel 2 - should remember Bob
  console.log(`\nChannel 2 (${channel2.channel}): "What is my name?"`);
  response2 = await anthropic.generateResponse("What is my name?", channel2);
  console.log(`Response: ${response2}`);

  // Now try querying that would use context from both channels
  console.log(
    `\nChannel 1 (${channel1.channel}): "Who is in the other channel?"`
  );
  response1 = await anthropic.generateResponse(
    "Who is in the other channel?",
    channel1
  );
  console.log(`Response: ${response1}`);

  console.log("\n=== TEST COMPLETED ===");
}

// Run the main function
main().catch(console.error);
