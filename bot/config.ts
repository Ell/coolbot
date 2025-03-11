import { readFile } from "fs/promises";

import { z } from "zod";

// Define Zod schemas
const IRCChannelConfigSchema = z.object({
  key: z.string().optional(),
  autoJoin: z.boolean().optional(),
  ignoredNicks: z.array(z.string()).optional(),
  commandBlacklist: z.array(z.string()).optional(),
});

// Channel entry can be either a string or an object with channel configurations
const ChannelEntrySchema = z.record(z.string(), IRCChannelConfigSchema);
const ChannelSchema = z.union([z.string(), ChannelEntrySchema]);

const IRCConfigSchema = z.object({
  host: z.string(),
  port: z.number().int().positive(),
  nicknames: z.array(z.string()).min(1),
  username: z.string().optional(),
  realname: z.string().optional(),
  password: z.string().optional(),
  sasl: z
    .object({
      username: z.string(),
      password: z.string(),
    })
    .optional(),
  rateLimit: z
    .object({
      messages: z.number().int().positive(),
      period: z.number().int().positive(),
    })
    .optional(),
  channels: z.array(ChannelSchema),
});

// Tools configuration schema
const ToolsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  directory: z.string().default("./tools"),
});

// Bot configuration schema
const BotConfigSchema = z.object({
  maxResponseLength: z.number().int().positive().default(500),
  maxHistoryLength: z.number().int().positive().default(15),
  maxToolAttempts: z.number().int().positive().default(3),
});

const ConfigSchema = z.object({
  irc: z.record(z.string(), IRCConfigSchema),
  tools: ToolsConfigSchema.optional(),
  bot: BotConfigSchema.optional(),
});

// Export TypeScript types derived from the Zod schemas
export type IRCChannelConfig = z.infer<typeof IRCChannelConfigSchema>;
export type IRCConfig = z.infer<typeof IRCConfigSchema>;
export type ToolsConfig = z.infer<typeof ToolsConfigSchema>;
export type BotConfig = z.infer<typeof BotConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

/**
 * Load and validate a configuration file
 * @param filePath Path to the configuration JSON file
 * @returns Validated configuration object
 */
export async function loadConfig(filePath: string): Promise<Config> {
  try {
    // Read the file
    const fileContent = await readFile(filePath, "utf-8");

    // Parse the JSON
    const jsonData = JSON.parse(fileContent);

    // Validate against our schema
    const result = ConfigSchema.parse(jsonData);

    return result;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("Configuration validation failed:");
      console.error(error.format());
    } else {
      console.error("Error loading configuration:", error);
    }
    throw error;
  }
}

/**
 * Validate a configuration object
 * @param config Configuration object to validate
 * @returns Validated configuration object
 */
export function validateConfig(config: unknown): Config {
  return ConfigSchema.parse(config);
}
