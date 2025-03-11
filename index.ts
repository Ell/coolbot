#!/usr/bin/env node

import { createBotFromArgs, IrcBot } from "./bot/bot";
import { resolve } from "path";
import { promises as fs } from "fs";

// Banner
const BANNER = `
 ██████╗ ██████╗  ██████╗ ██╗     ██████╗  ██████╗ ████████╗
██╔════╝██╔═══██╗██╔═══██╗██║     ██╔══██╗██╔═══██╗╚══██╔══╝
██║     ██║   ██║██║   ██║██║     ██████╔╝██║   ██║   ██║   
██║     ██║   ██║██║   ██║██║     ██╔══██╗██║   ██║   ██║   
╚██████╗╚██████╔╝╚██████╔╝███████╗██████╔╝╚██████╔╝   ██║   
 ╚═════╝ ╚═════╝  ╚═════╝ ╚══════╝╚═════╝  ╚═════╝    ╚═╝   
                                                             
 A Cool Chatbot
`;

/**
 * Print usage information
 */
function printUsage() {
  console.log(BANNER);
  console.log("\nUsage:");
  console.log("  npm start -- [config_path]");
  console.log("  npx ts-node index.ts [config_path]");
  console.log("\nArguments:");
  console.log("  config_path  Path to config file (default: ./config.json)");
  console.log("\nEnvironment Variables:");
  console.log("  ANTHROPIC_API_KEY  Required API key for Anthropic Claude API");
  console.log("\nExamples:");
  console.log("  npm start");
  console.log("  npm start -- ./my-config.json");
  console.log("  npx ts-node index.ts ./configs/production.json");
}

/**
 * Main function
 */
async function main() {
  // Print banner
  console.log(BANNER);

  // Check for help flag
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  // Check for Anthropic API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required");
    console.error("Please set it before running the bot:");
    console.error("  export ANTHROPIC_API_KEY=your-api-key");
    process.exit(1);
  }

  // Get config path from command line or use default
  const configPath = process.argv[2] || "./config.json";
  const absoluteConfigPath = resolve(process.cwd(), configPath);

  // Check if config file exists
  try {
    await fs.access(absoluteConfigPath);
  } catch (error) {
    console.error(`Error: Could not find config file at ${absoluteConfigPath}`);
    console.error(`Please create a config file or specify the correct path.`);
    console.error(`See config.json.example for a sample configuration.`);
    process.exit(1);
  }

  console.log(`Using configuration from: ${absoluteConfigPath}`);

  // Create the bot
  let bot: IrcBot;
  try {
    bot = await createBotFromArgs();
  } catch (error) {
    console.error("Failed to initialize bot:", error);
    process.exit(1);
  }

  // Connect to servers
  try {
    await bot.connect();
    console.log("Bot is now running. Press Ctrl+C to stop.");
  } catch (error) {
    console.error("Failed to connect to servers:", error);
    process.exit(1);
  }

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await bot.disconnect();
    console.log("Goodbye!");
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nReceived SIGTERM, shutting down...");
    await bot.disconnect();
    process.exit(0);
  });
}

// Run the main function
if (require.main === module) {
  main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
}
