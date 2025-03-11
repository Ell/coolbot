import { EventEmitter } from "events";
import type { IRCServerConfig } from "./config";
import { IRCConnection } from "./connection";
import type { IRCMessage } from "./message";

/**
 * IRC Connection Manager Events
 */
export interface IRCConnectionManagerEvents {
  connectionAdded: (id: string, connection: IRCConnection) => void;
  connectionRemoved: (id: string) => void;
  connectionError: (id: string, error: Error) => void;
  connectionConnecting: (id: string) => void;
  connectionConnected: (id: string) => void;
  connectionDisconnected: (
    id: string,
    reason: string,
    wasError: boolean
  ) => void;
  connectionReconnecting: (id: string, attempt: number, delay: number) => void;
  connectionReconnectFailed: (id: string) => void;
  message: (id: string, message: IRCMessage) => void;
  privmsg: (
    id: string,
    message: IRCMessage,
    nickname: string,
    hostmask: string,
    target: string,
    content: string
  ) => void;
}

/**
 * IRC Connection Manager
 * Manages multiple IRC server connections
 */
export class IRCConnectionManager extends EventEmitter {
  /** Map of connection ID to connection object */
  private connections: Map<string, IRCConnection> = new Map();

  /** Default configuration options */
  private defaultOptions: Partial<IRCServerConfig> = {
    reconnect: {
      enabled: true,
      maxAttempts: 5,
      initialDelay: 1000,
      maxDelay: 300000,
    },
  };

  /**
   * Create a new connection manager
   * @param defaultOptions Default options for all connections
   */
  constructor(defaultOptions: Partial<IRCServerConfig> = {}) {
    super();
    this.defaultOptions = {
      ...this.defaultOptions,
      ...defaultOptions,
    };
  }

  /**
   * Add a new connection
   * @param id Unique ID for the connection
   * @param config Connection configuration
   * @returns The created connection
   */
  public addConnection(id: string, config: IRCServerConfig): IRCConnection {
    if (this.connections.has(id)) {
      throw new Error(`Connection with ID ${id} already exists`);
    }

    // Merge default options with provided config
    const mergedConfig: IRCServerConfig = {
      ...this.defaultOptions,
      ...config,
      reconnect: {
        ...this.defaultOptions.reconnect,
        ...config.reconnect,
      },
    } as IRCServerConfig;

    // Create the connection
    const connection = new IRCConnection(mergedConfig);

    // Set up event listeners
    this.setupConnectionEventListeners(id, connection);

    // Store the connection
    this.connections.set(id, connection);

    // Emit event
    this.emit("connectionAdded", id, connection);

    return connection;
  }

  /**
   * Get a connection by ID
   * @param id Connection ID
   * @returns The connection, or undefined if not found
   */
  public getConnection(id: string): IRCConnection | undefined {
    return this.connections.get(id);
  }

  /**
   * Remove a connection
   * @param id Connection ID
   * @param disconnect Whether to disconnect the connection
   * @returns Whether the connection was removed
   */
  public removeConnection(id: string, disconnect = true): boolean {
    const connection = this.connections.get(id);

    if (!connection) {
      return false;
    }

    // Disconnect if requested
    if (disconnect && connection.connected) {
      connection
        .disconnect()
        .catch((err) => this.emit("connectionError", id, err));
    }

    // Remove event listeners
    this.removeConnectionEventListeners(connection);

    // Remove from map
    this.connections.delete(id);

    // Emit event
    this.emit("connectionRemoved", id);

    return true;
  }

  /**
   * Get all connection IDs
   * @returns Array of connection IDs
   */
  public getConnectionIds(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Get all connections
   * @returns Map of connection ID to connection
   */
  public getAllConnections(): Map<string, IRCConnection> {
    return new Map(this.connections);
  }

  /**
   * Connect all connections that are not already connected
   * @returns Map of connection ID to promise resolving when connected
   */
  public connectAll(): Map<string, Promise<void>> {
    const promises = new Map<string, Promise<void>>();

    for (const [id, connection] of this.connections) {
      if (!connection.connected) {
        // Wrap the connection promise to handle errors
        const connectionPromise = connection.connect().catch((err) => {
          this.emit("connectionError", id, err);
          console.error(`Connection error for ${id}:`, err.message);
          // Don't rethrow, allow other connections to proceed
          // Just return so the Promise is fulfilled
        });

        promises.set(id, connectionPromise);
      }
    }

    return promises;
  }

  /**
   * Disconnect all connections
   * @param message Optional quit message
   * @returns Map of connection ID to promise resolving when disconnected
   */
  public disconnectAll(message?: string): Map<string, Promise<void>> {
    const promises = new Map<string, Promise<void>>();

    for (const [id, connection] of this.connections) {
      if (connection.connected) {
        // Wrap the disconnection promise to handle errors
        const disconnectionPromise = connection
          .disconnect(message)
          .catch((err) => {
            this.emit("connectionError", id, err);
            console.error(`Disconnection error for ${id}:`, err.message);
            // Don't rethrow, allow other connections to proceed
          });

        promises.set(id, disconnectionPromise);
      }
    }

    return promises;
  }

  /**
   * Send a message to all connections
   * @param command Command to send
   * @param params Parameters for the command
   * @param filter Optional filter function to determine which connections to send to
   */
  public sendToAll(
    command: string,
    params: string[] = [],
    filter?: (connection: IRCConnection) => boolean
  ): void {
    for (const [, connection] of this.connections) {
      if (connection.connected && (!filter || filter(connection))) {
        try {
          connection.send(command, params);
        } catch (err) {
          // Ignore errors
        }
      }
    }
  }

  /**
   * Set up event listeners for a connection
   * @param id Connection ID
   * @param connection Connection object
   * @private
   */
  private setupConnectionEventListeners(
    id: string,
    connection: IRCConnection
  ): void {
    // Forward events with connection ID
    connection.on("connecting", () => {
      this.emit("connectionConnecting", id);
    });

    connection.on("connect", () => {
      this.emit("connectionConnected", id);
    });

    connection.on("disconnect", (reason, wasError) => {
      this.emit("connectionDisconnected", id, reason, wasError);
    });

    connection.on("reconnecting", (attempt, delay) => {
      this.emit("connectionReconnecting", id, attempt, delay);
    });

    connection.on("reconnectFailed", () => {
      this.emit("connectionReconnectFailed", id);
    });

    connection.on("error", (error) => {
      this.emit("connectionError", id, error);
    });

    connection.on("message", (message) => {
      this.emit("message", id, message);
    });

    // Forward the specialized privmsg event with the connection ID
    connection.on("privmsg", (message, nickname, hostmask, target, content) => {
      this.emit("privmsg", id, message, nickname, hostmask, target, content);
    });
  }

  /**
   * Remove event listeners from a connection
   * @param connection Connection object
   * @private
   */
  private removeConnectionEventListeners(connection: IRCConnection): void {
    connection.removeAllListeners();
  }
}
