import { createTool } from "../bot/tool";
import { z } from "zod";

// Echo tool - simply repeats back a message
const echoTool = createTool(
  "echo",
  "Repeats back the message that was sent to it",
  z.object({
    message: z.string().describe("The message to echo back"),
  }),
  async (inputs: { message: string }) => {
    const now = new Date();
    return {
      echoed_message: inputs.message,
      timestamp: now.toISOString(),
    };
  }
);

// Export the tool as the default export
export default {
  echo: echoTool,
};
