/**
 * IRCv3 Message Type and Parser/Creator
 * Specification: https://ircv3.net/specs/extensions/message-tags.html
 */

/**
 * IRCMessage represents a parsed IRC message according to IRCv3 specs
 */
export interface IRCMessage {
  tags: Map<string, string | true>;
  source: string | null;
  command: string;
  params: string[];
  raw?: Uint8Array;
}

/**
 * Parse raw bytes into an IRCMessage
 * @param data Raw bytes of the IRC message
 * @returns Parsed IRCMessage
 */
export function parseMessage(data: Uint8Array): IRCMessage {
  // Store the raw message for debugging purposes
  const raw = data;

  // Convert bytes to string and trim the trailing \r\n
  let str = new TextDecoder().decode(data);
  str = str.replace(/\r\n$/, "");

  // Initialize message properties
  const message: IRCMessage = {
    tags: new Map<string, string | true>(),
    source: null,
    command: "",
    params: [],
    raw,
  };

  let position = 0;
  let nextSpace = -1;

  // Parse tags if message starts with '@'
  if (str[position] === "@") {
    nextSpace = str.indexOf(" ", position);

    if (nextSpace === -1) {
      throw new Error("Malformed IRC message: No space after tags");
    }

    // Extract tag string
    const tagStr = str.substring(position + 1, nextSpace);
    const tagPairs = tagStr.split(";");

    for (const pair of tagPairs) {
      const [key, value] = pair.includes("=")
        ? pair.split("=", 2)
        : [pair, true as true];

      // Handle escaped values in tag values
      if (typeof value === "string") {
        const unescapedValue = value
          .replace(/\\:/g, ";")
          .replace(/\\s/g, " ")
          .replace(/\\\\/g, "\\")
          .replace(/\\r/g, "\r")
          .replace(/\\n/g, "\n");

        message.tags.set(key, unescapedValue);
      } else {
        message.tags.set(key, value);
      }
    }

    position = nextSpace + 1;
  }

  // Skip any leading spaces
  while (position < str.length && str[position] === " ") {
    position++;
  }

  // Parse source/prefix if message has one (starts with ':')
  if (str[position] === ":") {
    nextSpace = str.indexOf(" ", position);

    if (nextSpace === -1) {
      // No space after source - treat the rest as the command
      // Instead of throwing an error, we'll treat this as a message with just a command
      message.command = str.substring(position + 1);
      return message;
    }

    message.source = str.substring(position + 1, nextSpace);
    position = nextSpace + 1;

    // Skip any additional spaces
    while (position < str.length && str[position] === " ") {
      position++;
    }
  }

  // Parse command
  nextSpace = str.indexOf(" ", position);

  if (nextSpace === -1) {
    // No parameters, command is the rest of the message
    if (position < str.length) {
      message.command = str.substring(position);
    }
    return message;
  }

  message.command = str.substring(position, nextSpace);
  position = nextSpace + 1;

  // Skip any additional spaces
  while (position < str.length && str[position] === " ") {
    position++;
  }

  // Parse parameters
  while (position < str.length) {
    // Check if this is the last parameter (starts with ':')
    if (str[position] === ":") {
      message.params.push(str.substring(position + 1));
      break;
    }

    nextSpace = str.indexOf(" ", position);

    if (nextSpace === -1) {
      // No more spaces, the rest is the last parameter
      message.params.push(str.substring(position));
      break;
    }

    message.params.push(str.substring(position, nextSpace));
    position = nextSpace + 1;

    // Skip any additional spaces
    while (position < str.length && str[position] === " ") {
      position++;
    }
  }

  return message;
}

/**
 * Create raw bytes from an IRCMessage
 * @param message IRC message to convert to bytes
 * @returns Byte representation of the IRC message
 */
export function createMessage(message: IRCMessage): Uint8Array {
  let str = "";

  // Add tags if present
  if (message.tags.size > 0) {
    const tagParts: string[] = [];

    message.tags.forEach((value, key) => {
      if (value === true) {
        tagParts.push(key);
      } else {
        // Escape special characters in tag values
        const escapedValue = (value as string)
          .replace(/\\/g, "\\\\")
          .replace(/;/g, "\\:")
          .replace(/ /g, "\\s")
          .replace(/\r/g, "\\r")
          .replace(/\n/g, "\\n");

        tagParts.push(`${key}=${escapedValue}`);
      }
    });

    str += "@" + tagParts.join(";") + " ";
  }

  // Add source if present
  if (message.source) {
    str += ":" + message.source + " ";
  }

  // Add command (required)
  str += message.command;

  // Add parameters
  if (message.params.length > 0) {
    for (let i = 0; i < message.params.length - 1; i++) {
      str += " " + message.params[i];
    }

    // Add the last parameter with a colon prefix if it contains spaces or is empty
    const lastParam = message.params[message.params.length - 1];
    if (lastParam.includes(" ") || lastParam === "") {
      str += " :" + lastParam;
    } else {
      str += " " + lastParam;
    }
  }

  // Add the trailing CRLF as per IRC spec
  str += "\r\n";

  // Convert to bytes
  return new TextEncoder().encode(str);
}

/**
 * Create a new IRC message with the provided parameters
 * @param command The IRC command
 * @param params Array of parameters for the command
 * @param source Optional source/prefix
 * @param tags Optional map of tags
 * @returns A new IRCMessage object
 */
export function makeMessage(
  command: string,
  params: string[] = [],
  source: string | null = null,
  tags: Map<string, string | true> = new Map()
): IRCMessage {
  return {
    command,
    params,
    source,
    tags,
  };
}

/**
 * Parses multiple IRC messages from a single buffer
 * @param data Buffer containing one or more IRC messages
 * @returns Array of parsed IRC messages
 */
export function parseMultipleMessages(data: Uint8Array): IRCMessage[] {
  const messages: IRCMessage[] = [];
  const text = new TextDecoder().decode(data);

  // Split the buffer by \r\n
  const lines = text.split("\r\n");

  // Process each non-empty line
  for (const line of lines) {
    if (line.trim() === "") continue;

    // Add the \r\n back for parseMessage, which will then trim it
    const messageData = new TextEncoder().encode(line + "\r\n");
    try {
      const message = parseMessage(messageData);
      messages.push(message);
    } catch (error) {
      console.error(`Error parsing message: ${line}`, error);
      // Create a minimal message to avoid losing data
      const errorMessage = {
        tags: new Map<string, string | true>(),
        source: null,
        command: "UNKNOWN",
        params: [line], // Store the original line as a parameter
        raw: messageData,
      };
      messages.push(errorMessage);
    }
  }

  return messages;
}
