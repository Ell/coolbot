import { z } from "zod";

import { createTool } from "../bot/tool";

// Create a basic math calculator tool
const calculatorTool = createTool(
  "calculator",
  "Perform basic mathematical calculations",
  z.object({
    operation: z
      .enum(["add", "subtract", "multiply", "divide"])
      .describe("The mathematical operation to perform"),
    a: z.number().describe("First operand"),
    b: z.number().describe("Second operand"),
  }),
  async (inputs) => {
    const { operation, a, b } = inputs;

    switch (operation) {
      case "add":
        return { result: a + b };
      case "subtract":
        return { result: a - b };
      case "multiply":
        return { result: a * b };
      case "divide":
        if (b === 0) {
          throw new Error("Division by zero is not allowed");
        }
        return { result: a / b };
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }
);

// Create a unit conversion tool
const unitConversionTool = createTool(
  "convert_units",
  "Convert values between different units of measurement",
  z.object({
    value: z.number().describe("The value to convert"),
    from: z
      .enum(["meters", "feet", "kilometers", "miles", "celsius", "fahrenheit"])
      .describe("The source unit"),
    to: z
      .enum(["meters", "feet", "kilometers", "miles", "celsius", "fahrenheit"])
      .describe("The target unit"),
  }),
  async (inputs) => {
    const { value, from, to } = inputs;

    // Simple conversion factors
    const conversionFactors: Record<string, Record<string, number>> = {
      meters: { feet: 3.28084, kilometers: 0.001, miles: 0.000621371 },
      feet: { meters: 0.3048, kilometers: 0.0003048, miles: 0.000189394 },
      kilometers: { meters: 1000, feet: 3280.84, miles: 0.621371 },
      miles: { meters: 1609.34, feet: 5280, kilometers: 1.60934 },
    };

    // Handle temperature conversions separately
    if (from === "celsius" && to === "fahrenheit") {
      return { result: (value * 9) / 5 + 32, unit: to };
    } else if (from === "fahrenheit" && to === "celsius") {
      return { result: ((value - 32) * 5) / 9, unit: to };
    }

    // Handle distance conversions
    if (from === to) {
      return { result: value, unit: to };
    }

    if (!conversionFactors[from] || !conversionFactors[from][to]) {
      throw new Error(`Conversion from ${from} to ${to} is not supported`);
    }

    const result = value * conversionFactors[from][to];
    return { result, unit: to };
  }
);

// Export a map of tools
export default {
  calculator: calculatorTool,
  converter: unitConversionTool,
};
