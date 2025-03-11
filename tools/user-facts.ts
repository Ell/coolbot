/// <reference types="bun-types" />

import { Database } from "bun:sqlite";
import { z } from "zod";
import { createTool } from "../bot/tool";
import path from "path";
import fs from "fs";

// Ensure the data directory exists
const dataDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize SQLite database
const dbPath = path.join(dataDir, "user-facts.db");
const db = new Database(dbPath);

// Create tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS user_facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT NOT NULL,
    channel TEXT NOT NULL,
    username TEXT NOT NULL,
    fact TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT
  );
  
  CREATE INDEX IF NOT EXISTS idx_user_facts_username ON user_facts(username);
  CREATE INDEX IF NOT EXISTS idx_user_facts_network_channel ON user_facts(network, channel);
`);

// Prepare statements for better performance
const addFactStmt = db.prepare(`
  INSERT INTO user_facts (network, channel, username, fact, created_by)
  VALUES (?, ?, ?, ?, ?)
`);

const getFactsForUserStmt = db.prepare(`
  SELECT * FROM user_facts 
  WHERE username = ? AND (network = ? OR network = '*') AND (channel = ? OR channel = '*')
  ORDER BY created_at DESC
`);

const searchFactsStmt = db.prepare(`
  SELECT * FROM user_facts 
  WHERE username = ? AND fact LIKE ? AND (network = ? OR network = '*') AND (channel = ? OR channel = '*')
  ORDER BY created_at DESC
`);

const getRandomFactsStmt = db.prepare(`
  SELECT * FROM user_facts 
  WHERE (network = ? OR network = '*') AND (channel = ? OR channel = '*')
  ORDER BY RANDOM() 
  LIMIT ?
`);

/**
 * Tool for remembering facts about users
 */
const rememberFactTool = createTool(
  "remember_fact",
  "Remember a fact about a user",
  z.object({
    username: z.string().describe("The username to associate the fact with"),
    fact: z.string().describe("The fact to remember about the user"),
    network: z
      .string()
      .optional()
      .describe("IRC network (defaults to all networks)"),
    channel: z
      .string()
      .optional()
      .describe("IRC channel (defaults to all channels)"),
    created_by: z
      .string()
      .optional()
      .describe("Username of the person creating the fact"),
  }),
  async (inputs) => {
    const {
      username,
      fact,
      network = "*",
      channel = "*",
      created_by = null,
    } = inputs;

    try {
      // Trim inputs to avoid whitespace issues
      const trimmedUsername = username.trim().toLowerCase();
      const trimmedFact = fact.trim();

      // Skip empty facts
      if (!trimmedFact) {
        return {
          success: false,
          error: "Cannot remember empty facts",
        };
      }

      // Add the fact to the database
      const result = addFactStmt.run(
        network,
        channel,
        trimmedUsername,
        trimmedFact,
        created_by
      );

      // Check if the insert was successful
      if (result && result.lastInsertRowid) {
        return {
          success: true,
          username: trimmedUsername,
          fact: trimmedFact,
          message: `Remembered that ${trimmedUsername} ${trimmedFact}`,
          id: result.lastInsertRowid,
        };
      } else {
        return {
          success: false,
          error: "Failed to store the fact in the database",
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Error remembering fact: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
);

/**
 * Tool for looking up facts about users
 */
const lookupFactTool = createTool(
  "lookup_fact",
  "Look up facts about a user",
  z.object({
    username: z.string().describe("The username to look up facts for"),
    query: z
      .string()
      .optional()
      .describe("Specific fact to search for (optional)"),
    network: z
      .string()
      .optional()
      .describe("IRC network (defaults to all networks)"),
    channel: z
      .string()
      .optional()
      .describe("IRC channel (defaults to all channels)"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of facts to return"),
  }),
  async (inputs) => {
    const { username, query, network = "*", channel = "*", limit = 5 } = inputs;

    try {
      // Trim inputs to avoid whitespace issues
      const trimmedUsername = username.trim().toLowerCase();

      let facts;

      if (query) {
        // If a specific query is provided, search for it
        facts = searchFactsStmt.all(
          trimmedUsername,
          `%${query}%`,
          network,
          channel
        );
      } else {
        // Otherwise get all facts for the user
        facts = getFactsForUserStmt.all(trimmedUsername, network, channel);
      }

      if (facts.length > 0) {
        return {
          success: true,
          username: trimmedUsername,
          facts: facts.slice(0, limit),
          total_facts: facts.length,
          message: formatFactsForDisplay(
            trimmedUsername,
            facts.slice(0, limit)
          ),
        };
      } else {
        return {
          success: false,
          username: trimmedUsername,
          message: `I don't know anything about ${trimmedUsername}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Error looking up facts: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
);

/**
 * Tool for retrieving random facts
 */
const randomFactsTool = createTool(
  "random_facts",
  "Get random facts about users",
  z.object({
    network: z
      .string()
      .optional()
      .describe("IRC network (defaults to all networks)"),
    channel: z
      .string()
      .optional()
      .describe("IRC channel (defaults to all channels)"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of facts to return"),
  }),
  async (inputs) => {
    const { network = "*", channel = "*", limit = 5 } = inputs;

    try {
      // Get random facts from the database
      const facts = getRandomFactsStmt.all(network, channel, limit);

      if (facts.length > 0) {
        return {
          success: true,
          facts: facts,
          total_facts: facts.length,
          message: formatRandomFactsForDisplay(facts),
        };
      } else {
        return {
          success: false,
          message: "No facts found in the database",
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Error getting random facts: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
);

/**
 * Format facts for display in IRC messages
 */
function formatFactsForDisplay(username: string, facts: any[]): string {
  if (facts.length === 0) return `I don't know anything about ${username}`;

  return facts
    .map((fact, index) => `${index + 1}. ${username} ${fact.fact}`)
    .join("\n");
}

/**
 * Format random facts for display in IRC messages
 */
function formatRandomFactsForDisplay(facts: any[]): string {
  if (facts.length === 0) return "No facts found";

  return facts.map((fact) => `${fact.username} ${fact.fact}`).join("\n");
}

// Cleanup function that should be called when the process exits
function closeDatabase() {
  db.close();
}

// Close the database when the process exits
process.on("exit", () => {
  closeDatabase();
});

// Export the tools as a default export object mapping tool names to tools
export default {
  remember_fact: rememberFactTool,
  lookup_fact: lookupFactTool,
  random_facts: randomFactsTool,
};
