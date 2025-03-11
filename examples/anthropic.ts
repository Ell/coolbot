import { z } from "zod";

import { Anthropic } from "../bot/anthropic";
import { createTool } from "../bot/tool";
import toolRegistry from "../bot/toolRegistry";

/**
 * Main function that demonstrates using the new chat-aware Anthropic client with tools
 */
async function main() {
  // Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }

  // Configure the singleton tool registry
  console.log("Configuring tool registry with tools directory: ../tools");
  // Instead of using configureToolRegistry, directly set the tools directory
  toolRegistry.setToolsDirectory("../tools");

  // Create a basic echo tool
  const echoTool = createTool(
    "echo",
    "Repeats back the message that was sent to it",
    z.object({
      message: z.string().describe("The message to echo back"),
    }),
    async (inputs: { message: string }) => {
      const now = new Date();
      return {
        echoed_message: inputs.message,
        timestamp: now.toISOString(),
      };
    }
  );

  // Register the tool manually
  console.log("Registering echo tool with registry");
  toolRegistry.registerToolManually("echo", echoTool);

  // Create an Anthropic client using the singleton tool registry
  console.log("Creating Anthropic client");
  const client = new Anthropic({
    anthropicApiKey: apiKey,
    maxTokens: 1000,
    maxRequests: 10,
    maxResponseLength: 500, // IRC max message length
  });

  // Demonstrate tool usage in a chat context
  try {
    // First message in the conversation
    console.log("\n--- First message ---");
    const response1 = await client.generateResponse(
      'Can you use the echo tool to repeat "Hello, IRC world!"?'
    );
    console.log("Response:", response1);

    // Second message showing follow-up chat
    console.log("\n--- Follow-up message ---");
    const response2 = await client.generateResponse(
      "What time was shown in the previous echo?"
    );
    console.log("Response:", response2);

    // Third message to demonstrate response without tool usage
    console.log("\n--- Message without tool usage ---");
    const response3 = await client.generateResponse(
      "Tell me briefly about IRC protocol"
    );
    console.log("Response:", response3);

    // Fourth message to demonstrate response length limit
    console.log("\n--- Message testing length limits ---");
    const response4 = await client.generateResponse(
      "Write a lengthy explanation about the history of IRC and all its features"
    );
    console.log("Response:", response4);
    console.log("Response length:", response4.length);
  } catch (error) {
    console.error("Error in Anthropic client:", error);
  }

  // Example of a client not using the tool registry
  console.log("\n--- Client without tool registry ---");
  const clientWithoutTools = new Anthropic({
    anthropicApiKey: apiKey,
    useToolRegistry: false,
  });

  try {
    const noToolResponse = await clientWithoutTools.generateResponse(
      "What are the benefits of IRC bots?"
    );
    console.log("Response without tools:", noToolResponse);
  } catch (error) {
    console.error("Error in client without tools:", error);
  } finally {
    // Close the non-singleton client (singleton registry doesn't need to be closed)
    clientWithoutTools.close();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch((err) => console.error("Error in main:", err));
}
