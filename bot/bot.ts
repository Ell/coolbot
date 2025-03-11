import { resolve } from "path";
import { IRCConnectionManager } from "../irc/manager";
import { IRCConnection } from "../irc/connection";
import type { IRCMessage } from "../irc/message";
import type { IRCServerConfig } from "../irc/config";
import { Config, loadConfig } from "./config";
import { Anthropic } from "./anthropic";
import toolRegistry from "./toolRegistry";

// Default system prompt - direct and terse but friendly
const DEFAULT_SYSTEM_PROMPT = `You're an IRC bot. Provide direct, accurate answers.

Guidelines:
1. Keep ALL responses under 500 characters.
2. Be terse but friendly - no excessive words.
3. Answer directly without mentioning tools or capabilities.
4. Present all information naturally as if you know it.
5. Use simple formatting for IRC.
6. When providing numerical data, be precise.
7. Focus on facts, not opinions.
8. Skip pleasantries and unnecessary context.

Always aim to provide value in as few words as possible.

Server Information:
Network: {network}
Channel: {channel}
User: {user}`;

interface BotOptions {
  configPath: string;
  toolsDir?: string;
  maxResponseLength?: number;
}

export class IrcBot {
  private config!: Config; // Added definite assignment assertion
  private connectionManager: IRCConnectionManager;
  private connections: Map<string, IRCConnection> = new Map();
  private anthropicClients: Map<string, Anthropic> = new Map();
  private isConnected = false;
  private apiKey: string;

  constructor(private options: BotOptions) {
    // Check for API key immediately
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable is required");
    }
    this.apiKey = apiKey;

    // Create the connection manager
    this.connectionManager = new IRCConnectionManager();

    // Set up event listeners
    this.setupManagerEventListeners();
  }

  /**
   * Initialize the bot with the provided configuration
   */
  async initialize(): Promise<void> {
    try {
      // Load and validate configuration
      this.config = await loadConfig(this.options.configPath);

      // Set up tool registry
      if (this.options.toolsDir) {
        console.log(
          `Setting up tool registry with directory: ${this.options.toolsDir}`
        );
        toolRegistry.setToolsDirectory(this.options.toolsDir, true);

        // Wait for tools to load
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const tools = toolRegistry.getAllTools();
        console.log(`Loaded ${tools.length} tools from directory`);
      }

      // Create Anthropic clients and IRC connections for each server
      for (const [network, ircConfig] of Object.entries(this.config.irc)) {
        try {
          // Create Anthropic client
          this.anthropicClients.set(
            network,
            new Anthropic({
              anthropicApiKey: this.apiKey,
              maxResponseLength: this.options.maxResponseLength || 500,
              maxToolAttempts: 3,
              maxHistoryLength: 15,
            })
          );

          // Convert our config format to IRCServerConfig format
          const serverConfig: IRCServerConfig = {
            host: ircConfig.host,
            port: ircConfig.port,
            secure: ircConfig.port === 6697 || ircConfig.port === 7000, // Fixed duplicate port check
            nickname: ircConfig.nicknames[0],
            alternateNicknames: ircConfig.nicknames.slice(1),
            username: ircConfig.username || ircConfig.nicknames[0],
            realname: ircConfig.realname || ircConfig.nicknames[0],
            password: ircConfig.password,
            autoJoinChannels: this.extractChannels(ircConfig.channels),
            sasl: ircConfig.sasl,
            rateLimit: ircConfig.rateLimit,
            reconnect: {
              enabled: true,
              maxAttempts: 10,
              initialDelay: 2000,
              maxDelay: 300000,
            },
          };

          // Add the connection to the manager
          const connection = this.connectionManager.addConnection(
            network,
            serverConfig
          );
          this.connections.set(network, connection);
          console.log(
            `Added connection for ${network} (${serverConfig.host}:${serverConfig.port})`
          );
        } catch (error) {
          console.error(`Error setting up network ${network}:`, error);
        }
      }
    } catch (error) {
      console.error("Error initializing bot:", error);
      throw error;
    }
  }

  /**
   * Extract channel names from config
   */
  private extractChannels(channels: any[]): string[] {
    const result: string[] = [];

    for (const channel of channels) {
      if (typeof channel === "string") {
        result.push(channel);
      } else if (typeof channel === "object") {
        // Get the first key as the channel name
        const channelName = Object.keys(channel)[0];
        const channelConfig = channel[channelName];

        // Only add if autoJoin is not explicitly false
        if (!channelConfig || channelConfig.autoJoin !== false) {
          result.push(channelName);
        }
      }
    }

    return result;
  }

  /**
   * Set up event listeners for the connection manager
   */
  private setupManagerEventListeners(): void {
    // Listen for private messages
    this.connectionManager.on("privmsg", this.handleIrcMessage.bind(this));

    // Handle connection events
    this.connectionManager.on("connectionConnected", (id) => {
      console.log(`Connected to ${id}`);
    });

    this.connectionManager.on("connectionRegistered", (id) => {
      console.log(`Registered with ${id}`);
    });

    this.connectionManager.on(
      "connectionDisconnected",
      (id, reason, wasError) => {
        console.log(
          `Disconnected from ${id}: ${reason}${wasError ? " (error)" : ""}`
        );
      }
    );

    this.connectionManager.on("connectionError", (id, error) => {
      console.error(`Error on ${id}:`, error);
    });

    this.connectionManager.on(
      "connectionReconnecting",
      (id, attempt, delay) => {
        console.log(
          `Reconnecting to ${id} (attempt ${attempt}, delay ${delay}ms)`
        );
      }
    );

    this.connectionManager.on("connectionReconnectFailed", (id) => {
      console.error(`Failed to reconnect to ${id} after multiple attempts`);
    });
  }

  /**
   * Handle an IRC message
   */
  private async handleIrcMessage(
    networkId: string,
    message: IRCMessage,
    nickname: string,
    hostmask: string,
    target: string,
    content: string
  ): Promise<void> {
    try {
      // Validate inputs
      if (!networkId || !message || !nickname || !target || !content) {
        console.warn("Received incomplete IRC message:", {
          networkId,
          nickname,
          target,
          content,
        });
        return;
      }

      // Get the connection for this network
      const connection = this.connections.get(networkId);
      if (!connection) {
        console.warn(`No connection found for network ${networkId}`);
        return;
      }

      // Ignore messages from the bot itself
      if (nickname === connection.nickname) return;

      // Check if this is a channel (starts with # or &) or a direct message
      const isChannel = target.startsWith("#") || target.startsWith("&");
      const isPrivateMessage = !isChannel;
      const responseTarget = isPrivateMessage ? nickname : target;

      // Process message content
      let messageContent = content.trim();

      // For channel messages, check if the bot is being addressed
      if (isChannel) {
        const words = messageContent.split(/\s+/);
        const firstWord = words[0].toLowerCase();
        const botNick = connection.nickname.toLowerCase();

        // Check if addressed directly: "botname: message" or "botname, message" or "botname message"
        if (
          firstWord === botNick ||
          firstWord === `${botNick}:` ||
          firstWord === `${botNick},`
        ) {
          // Remove the bot's name from the message
          messageContent = words.slice(1).join(" ").trim();
        } else if (
          words.length > 1 &&
          firstWord.startsWith(`${botNick}`) &&
          (firstWord.endsWith(":") || firstWord.endsWith(","))
        ) {
          // Handle case where there's no space: "botname: message"
          messageContent = words.slice(1).join(" ").trim();
        } else {
          // Not addressed to the bot
          return;
        }
      }

      // Skip empty messages
      if (!messageContent) {
        console.log(`[${networkId}] Received empty message from ${nickname}`);
        return;
      }

      // Process the message with Anthropic
      const anthropicClient = this.anthropicClients.get(networkId);
      if (!anthropicClient) {
        console.error(`No Anthropic client found for network ${networkId}`);
        return;
      }

      console.log(`[${networkId}] ${nickname}: ${messageContent}`);
      const response = await anthropicClient.generateResponse(messageContent, {
        network: networkId,
        channel: target,
        user: nickname,
      });

      // Ensure the response is not empty
      if (!response) {
        console.warn(
          `[${networkId}] Empty response generated for message: ${messageContent}`
        );
        connection.sendMessage(
          responseTarget,
          "Sorry, I couldn't generate a response."
        );
        return;
      }

      // Send the response
      connection.sendMessage(responseTarget, response);
      console.log(
        `[${networkId}] ${connection.nickname} => ${responseTarget}: ${response}`
      );
    } catch (error) {
      console.error("Error processing message:", error);
    }
  }

  /**
   * Connect to all IRC servers defined in the configuration
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      console.warn("Bot is already connected");
      return;
    }

    try {
      console.log("Connecting to all IRC servers...");

      // Connect all IRC connections
      const connectionPromises = this.connectionManager.connectAll();

      // Wait for all connections to be established or fail
      const results = await Promise.allSettled(connectionPromises.values());

      // Log connection results
      let successCount = 0;
      for (const result of results) {
        if (result.status === "fulfilled") {
          successCount++;
        }
      }

      console.log(
        `Connected to ${successCount}/${connectionPromises.size} IRC servers`
      );

      this.isConnected = successCount > 0;
    } catch (error) {
      console.error("Error connecting to IRC servers:", error);
      throw error;
    }
  }

  /**
   * Disconnect from all IRC servers
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      console.log("Disconnecting from all IRC servers...");

      // Disconnect all IRC connections
      const disconnectionPromises =
        this.connectionManager.disconnectAll("Shutting down");
      await Promise.allSettled(disconnectionPromises.values());

      // Close all Anthropic clients
      for (const anthropicClient of this.anthropicClients.values()) {
        anthropicClient.close();
      }

      this.anthropicClients.clear();
      this.isConnected = false;

      console.log("Successfully disconnected from all servers");
    } catch (error) {
      console.error("Error during disconnect:", error);
    }
  }
}

/**
 * Create and initialize a bot from command-line arguments
 */
export async function createBotFromArgs(): Promise<IrcBot> {
  // Get config path from command line or use default
  const configPath = process.argv[2] || "./config.json";
  const absoluteConfigPath = resolve(process.cwd(), configPath);

  // Create the bot
  const bot = new IrcBot({
    configPath: absoluteConfigPath,
    toolsDir: "./tools",
    maxResponseLength: 500,
  });

  // Initialize the bot
  await bot.initialize();

  return bot;
}

// Export for potential import elsewhere
export default IrcBot;
