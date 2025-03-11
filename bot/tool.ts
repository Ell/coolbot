import { z } from "zod";

/**
 * Type representing a JSON Schema property definition
 */
type JsonSchemaProperty = {
  type: string;
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
};

/**
 * Type representing a JSON Schema object definition
 */
export type JsonSchema = {
  type: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchemaProperty;
  description?: string;
};

/**
 * Tool Definition that follows the JSON Schema standard
 */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

/**
 * Infer the TypeScript type from a JSON Schema
 * This is a type utility that transforms a JSON Schema into a TypeScript type
 */
export type InferFromSchema<T extends JsonSchema> = T["type"] extends "object"
  ? {
      [K in keyof T["properties"] & string]: T["properties"][K] extends {
        type: "string";
        enum: string[];
      }
        ? T["properties"][K]["enum"][number]
        : T["properties"][K] extends { type: "string" }
        ? string
        : T["properties"][K] extends { type: "number" }
        ? number
        : T["properties"][K] extends { type: "boolean" }
        ? boolean
        : T["properties"][K] extends { type: "array"; items: infer I }
        ? I extends JsonSchemaProperty
          ? InferFromSchema<I & JsonSchema>[]
          : any[]
        : T["properties"][K] extends { type: "object" }
        ? InferFromSchema<T["properties"][K] & JsonSchema>
        : unknown;
    } & (T["required"] extends Array<string>
      ? { [K in T["required"][number]]: unknown }
      : {})
  : T["type"] extends "string"
  ? string
  : T["type"] extends "number"
  ? number
  : T["type"] extends "boolean"
  ? boolean
  : T["type"] extends "array"
  ? T["items"] extends JsonSchemaProperty
    ? InferFromSchema<T["items"] & JsonSchema>[]
    : any[]
  : unknown;

/**
 * Tool Handler
 * A type-safe interface for handling tool requests
 */
export interface ToolHandler<TSchema extends JsonSchema> {
  /**
   * Returns the tool definition for registration with API services
   */
  getToolDefinition(): ToolDefinition;

  /**
   * Handles a tool request with type-checked inputs
   * @param inputs The inputs provided to the tool, type-checked against the schema
   * @returns A promise resolving to the tool execution result
   */
  handle(inputs: InferFromSchema<TSchema>): Promise<unknown>;
}

/**
 * Create a new tool handler with type safety
 * @param name Tool name
 * @param description Tool description
 * @param schema Zod schema defining the input parameters
 * @param handler Function to handle the tool request
 * @returns A ToolHandler instance
 */
export function createTool<T extends z.ZodObject<any>>(
  name: string,
  description: string,
  schema: T,
  handler: (inputs: z.infer<T>) => Promise<unknown>
): ToolHandler<JsonSchema> {
  // Convert Zod schema to JSON Schema
  const jsonSchema = zodToJsonSchema(schema);

  return {
    getToolDefinition(): ToolDefinition {
      return {
        name,
        description,
        input_schema: jsonSchema,
      };
    },

    async handle(inputs: z.infer<T>): Promise<unknown> {
      // Validate inputs against the schema
      const validatedInputs = schema.parse(inputs);
      return handler(validatedInputs);
    },
  };
}

/**
 * Helper function to convert a Zod schema to JSON Schema
 * This is a simplified version that handles basic Zod types
 */
function zodToJsonSchema(schema: z.ZodObject<any>): JsonSchema {
  const shape = schema._def.shape();
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    let zodType = value as z.ZodTypeAny;

    // Handle optional types
    const isOptional = zodType instanceof z.ZodOptional;
    if (isOptional) {
      zodType = (zodType as z.ZodOptional<any>)._def.innerType;
    } else {
      required.push(key);
    }

    // Convert Zod types to JSON Schema types
    if (zodType instanceof z.ZodString) {
      const property: JsonSchemaProperty = { type: "string" };

      // Add description if available
      if ((zodType as any)._def.description) {
        property.description = (zodType as any)._def.description;
      }

      properties[key] = property;
    } else if (zodType instanceof z.ZodEnum) {
      properties[key] = {
        type: "string",
        enum: zodType._def.values,
      };

      // Add description if available
      if ((zodType as any)._def.description) {
        properties[key].description = (zodType as any)._def.description;
      }
    } else if (zodType instanceof z.ZodNumber) {
      properties[key] = { type: "number" };

      // Add description if available
      if ((zodType as any)._def.description) {
        properties[key].description = (zodType as any)._def.description;
      }
    } else if (zodType instanceof z.ZodBoolean) {
      properties[key] = { type: "boolean" };

      // Add description if available
      if ((zodType as any)._def.description) {
        properties[key].description = (zodType as any)._def.description;
      }
    } else if (zodType instanceof z.ZodArray) {
      const itemType = zodType._def.type;
      let itemSchema: JsonSchemaProperty = { type: "string" };

      // Recursively convert array item type if it's a complex type
      if (itemType instanceof z.ZodObject) {
        const nestedSchema = zodToJsonSchema(itemType);
        itemSchema = {
          type: "object",
          properties: nestedSchema.properties,
          required: nestedSchema.required,
        };
      } else if (itemType instanceof z.ZodString) {
        itemSchema = { type: "string" };
      } else if (itemType instanceof z.ZodNumber) {
        itemSchema = { type: "number" };
      } else if (itemType instanceof z.ZodBoolean) {
        itemSchema = { type: "boolean" };
      }

      properties[key] = {
        type: "array",
        items: itemSchema,
      };

      // Add description if available
      if ((zodType as any)._def.description) {
        properties[key].description = (zodType as any)._def.description;
      }
    } else if (zodType instanceof z.ZodObject) {
      const nestedSchema = zodToJsonSchema(zodType);
      properties[key] = {
        type: "object",
        properties: nestedSchema.properties,
        required: nestedSchema.required,
      };

      // Add description if available
      if ((zodType as any)._def.description) {
        properties[key].description = (zodType as any)._def.description;
      }
    }
  }

  return {
    type: "object",
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

/**
 * Example usage:
 *
 * const weatherTool = createTool(
 *   "get_weather",
 *   "Get the current weather in a given location",
 *   z.object({
 *     location: z.string().describe("The city and state, e.g. San Francisco, CA"),
 *     unit: z.enum(["celsius", "fahrenheit"]).optional()
 *       .describe("The unit of temperature, either 'celsius' or 'fahrenheit'")
 *   }),
 *   async (inputs) => {
 *     // Fetch weather data
 *     const { location, unit = "celsius" } = inputs;
 *     return { temperature: 25, unit, conditions: "Sunny" };
 *   }
 * );
 *
 * // Register the tool with an AI service or API
 * const tools = [weatherTool.getToolDefinition()];
 *
 * // Handle the tool request
 * const result = await weatherTool.handle({ location: "San Francisco, CA", unit: "fahrenheit" });
 */
