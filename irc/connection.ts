import { EventEmitter } from "events";
import { Socket, connect } from "net";
import { TLSSocket, connect as tlsConnect } from "tls";
import type { IRCServerConfig } from "./config";
import type { IRCMessage } from "./message";
import {
  parseMessage,
  createMessage,
  makeMessage,
  parseMultipleMessages,
} from "./message";

/**
 * Connection state enum
 */
export enum ConnectionState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  REGISTERING = "registering",
  CONNECTED = "connected",
  DISCONNECTING = "disconnecting",
}

/**
 * IRC Connection events
 */
export interface IRCConnectionEvents {
  connecting: () => void;
  connect: () => void;
  registered: () => void;
  disconnecting: () => void;
  disconnect: (reason: string, wasError: boolean) => void;
  reconnecting: (attempt: number, delay: number) => void;
  reconnectFailed: () => void;
  error: (error: Error) => void;
  timeout: () => void;
  message: (message: IRCMessage) => void;
  raw: (data: Uint8Array) => void;
  ping: (server: string) => void;
  privmsg: (
    message: IRCMessage,
    nickname: string,
    hostmask: string,
    target: string,
    content: string
  ) => void;
}

/**
 * IRC Connection class for managing a single IRC server connection
 * It implements EventEmitter to handle various events
 */
export class IRCConnection extends EventEmitter {
  /** Connection configuration */
  private config: IRCServerConfig;

  /** Socket connection */
  private socket: Socket | TLSSocket | null = null;

  /** Current connection state */
  private _state: ConnectionState = ConnectionState.DISCONNECTED;

  /** Buffer for incoming data */
  private buffer: Uint8Array = new Uint8Array(0);

  /** Message queue for rate limiting */
  private messageQueue: Uint8Array[] = [];

  /** Whether the connection is currently processing the message queue */
  private processingQueue = false;

  /** Reconnection state */
  private reconnect = {
    attempts: 0,
    timer: null as ReturnType<typeof setTimeout> | null,
    maxAttempts: 5,
    initialDelay: 1000,
    maxDelay: 300000,
    enabled: true,
  };

  /** Current nickname */
  private currentNickname = "";

  /** Whether the connection has been registered */
  private registered = false;

  /**
   * Create a new IRC Connection
   * @param config Connection configuration
   */
  constructor(config: IRCServerConfig) {
    super();

    // Set default values for optional config properties
    this.config = {
      ...config,
      username: config.username || config.nickname,
      realname: config.realname || config.nickname,
      connectionTimeout: config.connectionTimeout || 10000,
      reconnect: {
        maxAttempts: 5,
        initialDelay: 1000,
        maxDelay: 300000,
        enabled: true,
        ...config.reconnect,
      },
      rateLimit: {
        messages: 10,
        period: 1000,
        ...config.rateLimit,
      },
    };

    // Update reconnect settings from config
    if (config.reconnect) {
      this.reconnect.maxAttempts =
        config.reconnect.maxAttempts ?? this.reconnect.maxAttempts;
      this.reconnect.initialDelay =
        config.reconnect.initialDelay ?? this.reconnect.initialDelay;
      this.reconnect.maxDelay =
        config.reconnect.maxDelay ?? this.reconnect.maxDelay;
      this.reconnect.enabled =
        config.reconnect.enabled ?? this.reconnect.enabled;
    }

    this.currentNickname = config.nickname;
  }

  /**
   * Get the current connection state
   */
  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Get whether the connection is connected
   */
  get connected(): boolean {
    return (
      this._state === ConnectionState.CONNECTED ||
      this._state === ConnectionState.REGISTERING
    );
  }

  /**
   * Get the connection configuration
   */
  get serverConfig(): IRCServerConfig {
    return { ...this.config };
  }

  /**
   * Get the current nickname
   */
  get nickname(): string {
    return this.currentNickname;
  }

  /**
   * Connect to the IRC server
   */
  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connected) {
        return reject(new Error("Already connected"));
      }

      this._setState(ConnectionState.CONNECTING);

      // Create connection (secure or not)
      try {
        const options = {
          host: this.config.host,
          port: this.config.port,
          timeout: this.config.connectionTimeout,
        };

        this.socket = this.config.secure
          ? tlsConnect(options)
          : connect(options);

        // Set up socket event handlers
        this.socket.on("connect", () => this.handleConnect());
        this.socket.on("data", (data) => this.handleData(data));
        this.socket.on("error", (err) => this.handleError(err));
        this.socket.on("close", () => this.handleClose());
        this.socket.on("timeout", () => this.handleTimeout());

        // Set up one-time event handler for the connect event
        this.once("connect", () => resolve());
        this.once("error", (err) => reject(err));
      } catch (error) {
        this._setState(ConnectionState.DISCONNECTED);
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the IRC server
   * @param message Optional quit message
   */
  public disconnect(message = "Client disconnected"): Promise<void> {
    return new Promise((resolve) => {
      if (!this.connected || !this.socket) {
        this._setState(ConnectionState.DISCONNECTED);
        return resolve();
      }

      this._setState(ConnectionState.DISCONNECTING);

      // Send QUIT command if we're connected
      if (this.registered) {
        this.send("QUIT", [message]);
      }

      // Set up a timeout to force-close the connection
      const timeout = setTimeout(() => {
        if (this.socket) {
          this.socket.destroy();
        }
      }, 3000);

      this.once("disconnect", () => {
        clearTimeout(timeout);
        resolve();
      });

      // Try to end the socket
      if (this.socket && !this.socket.destroyed) {
        this.socket.end();
      }
    });
  }

  /**
   * Send a raw message to the IRC server
   * @param command Command to send
   * @param params Parameters for the command
   * @param tags Optional message tags
   */
  public send(
    command: string,
    params: string[] = [],
    tags: Map<string, string | true> = new Map()
  ): void {
    if (!this.connected || !this.socket) {
      throw new Error("Not connected");
    }

    const message = makeMessage(command, params, null, tags);
    const data = createMessage(message);

    this.enqueueMessage(data);
  }

  /**
   * Send a private message to a user or channel
   * @param target User or channel to send to
   * @param message Message to send
   */
  public sendMessage(target: string, message: string): void {
    this.send("PRIVMSG", [target, message]);
  }

  /**
   * Join a channel
   * @param channel Channel to join
   * @param key Optional channel key
   */
  public join(channel: string, key?: string): void {
    const params = key ? [channel, key] : [channel];
    this.send("JOIN", params);
  }

  /**
   * Leave a channel
   * @param channel Channel to leave
   * @param reason Optional reason
   */
  public part(channel: string, reason?: string): void {
    const params = reason ? [channel, reason] : [channel];
    this.send("PART", params);
  }

  /**
   * Set a new nickname
   * @param nickname New nickname
   */
  public setNick(nickname: string): void {
    this.send("NICK", [nickname]);
    this.currentNickname = nickname;
  }

  /**
   * Update the connection state
   * @param state New state
   * @private
   */
  private _setState(state: ConnectionState): void {
    this._state = state;
  }

  /**
   * Handle connection established
   * @private
   */
  private handleConnect(): void {
    this._setState(ConnectionState.REGISTERING);
    this.emit("connect");

    // Reset the reconnection attempts
    this.reconnect.attempts = 0;

    // Register with the server
    this.register();
  }

  /**
   * Handle incoming data
   * @param data Raw socket data
   * @private
   */
  private handleData(data: Buffer): void {
    try {
      // Convert Buffer to Uint8Array
      const uint8Data = new Uint8Array(data);

      // Append to existing buffer
      const newBuffer = new Uint8Array(this.buffer.length + uint8Data.length);
      newBuffer.set(this.buffer);
      newBuffer.set(uint8Data, this.buffer.length);
      this.buffer = newBuffer;

      // Emit raw data event
      this.emit("raw", uint8Data);

      // Check if we have a complete message (ends with \r\n)
      const bufferAsString = new TextDecoder().decode(this.buffer);
      if (bufferAsString.includes("\r\n")) {
        // Parse messages
        const messages = parseMultipleMessages(this.buffer);

        // Clear buffer
        this.buffer = new Uint8Array(0);

        // Process each message
        for (const message of messages) {
          this.handleMessage(message);
        }
      }
    } catch (error) {
      // If there's an error handling the data, log it but don't kill the connection
      console.error("Error handling incoming data:", error);
    }
  }

  /**
   * Handle a parsed IRC message
   * @param message Parsed IRC message
   * @private
   */
  private handleMessage(message: IRCMessage): void {
    // Emit the message event
    this.emit("message", message);

    // Handle specific commands
    switch (message.command) {
      case "PING":
        this.handlePing(message);
        break;

      case "PRIVMSG":
        // Handle PRIVMSG specially
        if (message.params.length >= 2) {
          const [target, content] = message.params;

          // Parse the source into nickname and hostmask
          let nickname = "",
            hostmask = "";
          if (message.source) {
            const sourceParts = message.source.split("!");
            nickname = sourceParts[0];
            hostmask = sourceParts.length > 1 ? sourceParts[1] : "";
          }

          // Emit the specialized privmsg event
          this.emit("privmsg", message, nickname, hostmask, target, content);
        }
        break;

      case "ERROR":
        // Handle error messages from the server
        const errorMsg =
          message.params.length > 0 ? message.params[0] : "Unknown error";
        this.emit("error", new Error(`Server error: ${errorMsg}`));
        break;

      case "001":
        // RPL_WELCOME - we're registered
        this.registered = true;
        this._setState(ConnectionState.CONNECTED);
        this.emit("registered");

        // Auto-join channels if configured
        if (
          this.config.autoJoinChannels &&
          this.config.autoJoinChannels.length > 0
        ) {
          for (const channel of this.config.autoJoinChannels) {
            this.join(channel);
          }
        }
        break;

      case "433":
        // ERR_NICKNAMEINUSE - nickname already in use
        this.handleNicknameInUse();
        break;
    }
  }

  /**
   * Handle errors
   * @param error Error that occurred
   * @private
   */
  private handleError(error: Error): void {
    this.emit("error", error);

    // Close the connection if it's still open
    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy();
    }

    // Handle reconnection if enabled
    if (
      this.reconnect.enabled &&
      this._state !== ConnectionState.DISCONNECTING
    ) {
      this.attemptReconnect();
    } else {
      this._setState(ConnectionState.DISCONNECTED);
      this.emit("disconnect", error.message, true);
    }
  }

  /**
   * Handle connection closure
   * @private
   */
  private handleClose(): void {
    const wasConnected = this.connected;

    // Socket is closed, clear it
    this.socket = null;
    this.registered = false;

    // Only attempt to reconnect if we were previously connected and not disconnecting intentionally
    if (
      wasConnected &&
      this._state !== ConnectionState.DISCONNECTING &&
      this.reconnect.enabled
    ) {
      this.attemptReconnect();
    } else {
      this._setState(ConnectionState.DISCONNECTED);
      this.emit("disconnect", "Connection closed", false);
    }
  }

  /**
   * Handle connection timeout
   * @private
   */
  private handleTimeout(): void {
    this.emit("timeout");

    // Close the connection
    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy();
    }

    // Attempt to reconnect if enabled
    if (this.reconnect.enabled) {
      this.attemptReconnect();
    } else {
      this._setState(ConnectionState.DISCONNECTED);
      this.emit("disconnect", "Connection timeout", true);
    }
  }

  /**
   * Handle PING messages
   * @param message PING message
   * @private
   */
  private handlePing(message: IRCMessage): void {
    // Respond with PONG
    try {
      const server =
        message.params.length > 0 ? message.params[0] : this.config.host;
      this.send("PONG", [server]);

      // Emit ping event
      this.emit("ping", server);
    } catch (error) {
      // In case of any errors, try to send a basic PONG to keep the connection alive
      try {
        this.send("PONG", [this.config.host]);
      } catch {
        // If that fails too, there's not much we can do
        console.error("Failed to respond to PING message");
      }
    }
  }

  /**
   * Handle nickname already in use
   * @private
   */
  private handleNicknameInUse(): void {
    // Try alternative nicknames if available
    if (
      this.config.alternateNicknames &&
      this.config.alternateNicknames.length > 0
    ) {
      const nextNick = this.config.alternateNicknames.shift();
      if (nextNick) {
        this.config.alternateNicknames.push(this.currentNickname); // Move current to the end
        this.setNick(nextNick);
        return;
      }
    }

    // Generate a random nickname
    const randomNick = `${this.config.nickname}_${Math.floor(
      Math.random() * 10000
    )}`;
    this.setNick(randomNick);
  }

  /**
   * Register with the server
   * @private
   */
  private register(): void {
    // If a password is provided, send it first
    if (this.config.password) {
      this.send("PASS", [this.config.password]);
    }

    // Send NICK and USER commands
    this.send("NICK", [this.currentNickname]);
    this.send("USER", [
      this.config.username || this.currentNickname,
      "0",
      "*",
      this.config.realname || this.currentNickname,
    ]);

    // If SASL is configured, perform SASL authentication
    if (this.config.sasl) {
      this.send("CAP", ["LS", "302"]);
    }
  }

  /**
   * Attempt to reconnect with exponential backoff
   * @private
   */
  private attemptReconnect(): void {
    // Increment attempts counter
    this.reconnect.attempts++;

    // If we've reached the maximum number of attempts, give up
    if (this.reconnect.attempts > this.reconnect.maxAttempts) {
      this._setState(ConnectionState.DISCONNECTED);
      this.emit("reconnectFailed");
      this.emit("disconnect", "Reconnection failed", false);
      return;
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.reconnect.initialDelay * Math.pow(2, this.reconnect.attempts - 1),
      this.reconnect.maxDelay
    );

    // Emit reconnecting event
    this.emit("reconnecting", this.reconnect.attempts, delay);

    // Set a timer to reconnect
    if (this.reconnect.timer) {
      clearTimeout(this.reconnect.timer);
    }

    this.reconnect.timer = setTimeout(() => {
      this.reconnect.timer = null;
      this.connect().catch((err) => {
        // If connection fails, try again
        this.handleError(err);
      });
    }, delay);
  }

  /**
   * Enqueue a message to be sent, respecting rate limits
   * @param data Message data to send
   * @private
   */
  private enqueueMessage(data: Uint8Array): void {
    // Add to the queue
    this.messageQueue.push(data);

    // Start processing the queue if not already processing
    if (!this.processingQueue) {
      this.processMessageQueue();
    }
  }

  /**
   * Process the message queue, respecting rate limits
   * @private
   */
  private processMessageQueue(): void {
    this.processingQueue = true;

    // If the queue is empty, we're done
    if (this.messageQueue.length === 0) {
      this.processingQueue = false;
      return;
    }

    // Get the next message
    const data = this.messageQueue.shift();

    // Send the message if we have a socket
    if (this.socket && !this.socket.destroyed && data) {
      this.socket.write(Buffer.from(data));
    }

    // Calculate delay before sending the next message based on rate limits
    const delay = this.config.rateLimit
      ? this.config.rateLimit.period / this.config.rateLimit.messages
      : 100;

    // Set a timer to process the next message
    setTimeout(() => this.processMessageQueue(), delay);
  }
}
