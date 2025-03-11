/**
 * IRC Connection Configuration
 */

/**
 * IRCServerConfig interface defines the configuration needed to connect to an IRC server
 */
export interface IRCServerConfig {
  /** Server hostname or IP address */
  host: string;

  /** Server port number */
  port: number;

  /** Whether to use SSL/TLS */
  secure: boolean;

  /** Nickname to use */
  nickname: string;

  /** Alternative nicknames to try if the primary one is taken */
  alternateNicknames?: string[];

  /** Username for the connection */
  username?: string;

  /** Real name to display */
  realname?: string;

  /** Server password, if required */
  password?: string;

  /** Channels to auto-join on connect */
  autoJoinChannels?: string[];

  /** SASL authentication credentials */
  sasl?: {
    username: string;
    password: string;
  };

  /** Reconnection options */
  reconnect?: {
    /** Maximum number of reconnection attempts (default: 5) */
    maxAttempts?: number;

    /** Initial delay in milliseconds before reconnecting (default: 1000) */
    initialDelay?: number;

    /** Maximum delay in milliseconds before reconnecting (default: 300000 - 5 minutes) */
    maxDelay?: number;

    /** Whether reconnection should be enabled (default: true) */
    enabled?: boolean;
  };

  /** Connection timeout in milliseconds (default: 10000 - 10 seconds) */
  connectionTimeout?: number;

  /** Rate limiting settings */
  rateLimit?: {
    /** Messages per time period (default: 10) */
    messages: number;

    /** Time period in milliseconds (default: 1000) */
    period: number;
  };
}
