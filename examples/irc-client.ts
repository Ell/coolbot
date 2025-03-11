/**
 * IRC Client Example
 *
 * This file demonstrates how to use the IRC connection module to create a simple IRC client.
 */

import { IRCConnection } from "../irc/connection";
import { IRCConnectionManager } from "../irc/manager";
import type { IRCServerConfig } from "../irc/config";

/**
 * Run a single connection example
 */
async function runSingleConnection(): Promise<void> {
  console.log("==== Single Connection Example ====");

  const config: IRCServerConfig = {
    host: "irc.libera.chat",
    port: 6667,
    secure: false,
    nickname: "coolbot_" + Math.floor(Math.random() * 1000),
    username: "coolbot",
    realname: "Cool IRC Bot",
    autoJoinChannels: ["#test"],
    reconnect: {
      enabled: true,
      maxAttempts: 5,
      initialDelay: 1000,
    },
  };

  const connection = new IRCConnection(config);

  // Setup event handlers
  connection.on("connect", () => {
    console.log("Connected to IRC server");
  });

  connection.on("registered", () => {
    console.log("Registered with server, ready to chat!");
  });

  // Using the new privmsg event for chat messages
  connection.on("privmsg", (message, nickname, hostmask, target, content) => {
    console.log(`[${target}] ${nickname} (${hostmask}): ${content}`);

    // Respond to commands
    if (content.startsWith("!ping")) {
      connection.sendMessage(target, "Pong!");
    }
  });

  // Still keep the message handler for other messages
  connection.on("message", (message) => {
    // Log other interesting messages (JOIN, PART, etc.)
    if (message.command !== "PRIVMSG" && message.command !== "PING") {
      console.log(
        `Raw message: ${message.command} ${message.params.join(" ")}`
      );
    }
  });

  connection.on("error", (error) => {
    console.error("Connection error:", error.message);
  });

  connection.on("disconnect", (reason, wasError) => {
    console.log(`Disconnected: ${reason} (error: ${wasError})`);
  });

  // Connect to server
  try {
    await connection.connect();
    console.log("Connection established successfully");

    // Run for 60 seconds
    await new Promise((resolve) => setTimeout(resolve, 60000));

    // Disconnect
    await connection.disconnect("Example complete");
  } catch (error) {
    console.error("Error in single connection example:", error);
  }
}

/**
 * Run a connection manager example with multiple networks
 */
async function runMultipleConnections(): Promise<void> {
  console.log("==== Multiple Connections Example ====");

  const manager = new IRCConnectionManager({
    reconnect: {
      enabled: true,
      maxAttempts: 5,
      initialDelay: 1000,
    },
  });

  // Log all interesting events
  manager.on("connectionConnecting", (id) =>
    console.log(`[${id}] Connecting...`)
  );
  manager.on("connectionConnected", (id) => console.log(`[${id}] Connected`));
  manager.on("connectionDisconnected", (id, reason) =>
    console.log(`[${id}] Disconnected: ${reason}`)
  );
  manager.on("connectionError", (id, error) =>
    console.error(`[${id}] Error:`, error.message)
  );
  manager.on("connectionReconnecting", (id, attempt) =>
    console.log(`[${id}] Reconnecting, attempt ${attempt}`)
  );

  // Add IRC networks
  manager.addConnection("libera", {
    host: "irc.libera.chat",
    port: 6667,
    secure: false,
    nickname: "coolbot_" + Math.floor(Math.random() * 1000),
    autoJoinChannels: ["#test"],
  });

  manager.addConnection("oftc", {
    host: "irc.oftc.net",
    port: 6667,
    secure: false,
    nickname: "coolbot_" + Math.floor(Math.random() * 1000),
    autoJoinChannels: ["#test"],
  });

  // Use the new privmsg handler for chat messages
  manager.on("privmsg", (id, message, nickname, hostmask, target, content) => {
    console.log(`[${id}] [${target}] ${nickname} (${hostmask}): ${content}`);

    // Respond to commands on any network
    if (content.startsWith("!ping")) {
      const connection = manager.getConnection(id);
      if (connection) {
        connection.sendMessage(target, `Pong from ${id}!`);
      }
    }
  });

  // Keep the general message handler for other message types
  manager.on("message", (id, message) => {
    // Only log non-PRIVMSG, non-PING messages
    if (message.command !== "PRIVMSG" && message.command !== "PING") {
      console.log(`[${id}] ${message.command} ${message.params.join(" ")}`);
    }
  });

  // Connect to all networks
  try {
    const promises = manager.connectAll();
    console.log(`Connecting to ${promises.size} IRC networks...`);

    // Run for 60 seconds
    await new Promise((resolve) => setTimeout(resolve, 60000));

    // Disconnect from all networks
    console.log("Disconnecting from all networks...");
    await Promise.all(manager.disconnectAll("Example complete").values());

    console.log("All connections closed");
  } catch (error) {
    console.error("Error in multiple connections example:", error);
  }
}

/**
 * Main function to run the examples
 */
async function main(): Promise<void> {
  try {
    // Run both examples
    // await runSingleConnection();
    console.log("\n");
    await runMultipleConnections();
  } catch (error) {
    console.error("Unhandled error:", error);
  }
}

// Run the main function when this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}
