import { Anthropic as AnthropicSDK } from "@anthropic-ai/sdk";
import { ToolRegistry } from "./toolRegistry";
import toolRegistry from "./toolRegistry";

export interface AnthropicConfig {
  anthropicApiKey: string;
  maxTokens?: number;
  maxRequests?: number;
  model?: string;
  systemPrompt?: string;
  useToolRegistry?: boolean; // Whether to use the default tool registry
  maxResponseLength?: number; // Maximum length of responses
  maxToolAttempts?: number; // Maximum tool execution attempts
  maxHistoryLength?: number; // Maximum number of messages to keep in history
}

// Message structure for chat history
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Default IRC bot system prompt
const DEFAULT_IRC_SYSTEM_PROMPT = `You provide extremely direct IRC responses.

Critical requirements:
1. MAXIMUM 500 CHARACTERS per response. Non-negotiable.
2. Provide ONLY the exact information requested - nothing more.
3. For URLs, webpages, or images, simply provide the URL without description or commentary.
4. NEVER describe the content of links or images you share.
5. NEVER ask follow-up questions or suggest alternatives.
6. NEVER use phrases like "here you go", "hope this helps", or "let me know".
7. Use formal, minimal language with no greetings or sign-offs.
8. Present data in the most compact format possible.
9. No conversational elements whatsoever.
10. For tool results, return ONLY the relevant data point or URL - no explanation.
11. ALWAYS USE AVAILABLE TOOLS when they would help answer a question accurately.
12. NEVER mention that you're using tools - just provide the information as if you know it.

Example response style:
"https://example.com/image.jpg" NOT "Here's an image of a cat: https://example.com/image.jpg. It shows a tabby cat playing with yarn. Let me know if you want more cat images!"

Server Information:
Network: {network}
Channel: {channel}
User: {user}`;

/**
 * Anthropic provides a client for interacting with Anthropic's Claude API
 * with integrated tool support via tool registry, optimized for IRC chat
 */
export class Anthropic {
  private client: AnthropicSDK;
  private config: Required<
    Omit<AnthropicConfig, "systemPrompt" | "useToolRegistry">
  > & {
    systemPrompt: string;
    useToolRegistry: boolean;
    maxResponseLength: number;
    maxToolAttempts: number;
    maxHistoryLength: number;
  };
  private toolRegistry: ToolRegistry;
  private requestCount: number = 0;
  private chatHistory: ChatMessage[] = [];

  /**
   * Create a new Anthropic client with tool registry support
   * @param config The client configuration
   * @param customToolRegistry Optional custom tool registry to use instead of the global singleton
   */
  constructor(config: AnthropicConfig, customToolRegistry?: ToolRegistry) {
    this.config = {
      maxTokens: 1000,
      model: "claude-3-5-sonnet-20240620",
      maxRequests: Infinity,
      systemPrompt: DEFAULT_IRC_SYSTEM_PROMPT,
      useToolRegistry: true,
      maxResponseLength: 500,
      maxToolAttempts: 2,
      maxHistoryLength: 10,
      ...config,
    };

    this.client = new AnthropicSDK({
      apiKey: this.config.anthropicApiKey,
    });

    // Use custom registry if provided, otherwise use global singleton if enabled
    if (customToolRegistry) {
      this.toolRegistry = customToolRegistry;
      console.log("Using custom tool registry");
    } else if (this.config.useToolRegistry) {
      this.toolRegistry = toolRegistry;
      console.log("Using global tool registry singleton");
    } else {
      // Create an empty registry that's not connected to the singleton
      // Pass false to avoid loading any tools or setting up watchers
      this.toolRegistry = new ToolRegistry("", false);
      console.log("Not using any tool registry");
    }

    const tools = this.toolRegistry.getAllTools();
    console.log(`Client initialized with ${tools.length} tools from registry`);
  }

  /**
   * Ensure the response is formatted for IRC (limited to maxResponseLength characters)
   * @param text The response text to format
   * @returns Formatted response suitable for IRC
   * @private
   */
  private formatForIRC(text: string): string {
    // Remove any excessive newlines (IRC usually uses a single line)
    let formatted = text.replace(/\n{2,}/g, " ").replace(/\n/g, " ");

    // Trim any extra whitespace
    formatted = formatted.trim().replace(/\s{2,}/g, " ");

    // Limit response length
    if (formatted.length > this.config.maxResponseLength) {
      formatted =
        formatted.substring(0, this.config.maxResponseLength - 3) + "...";
    }

    return formatted;
  }

  /**
   * Generate a chat-appropriate response to a user message
   * Automatically tries to use tools when needed and ensures responses are chat-friendly
   * @param input The user's message
   * @param serverInfo Optional server information to include in the prompt
   * @param maxRetries Maximum number of retries for overloaded errors
   * @returns A response from Claude, limited to the configured max length
   */
  async generateResponse(
    input: string,
    serverInfo?: {
      network: string;
      channel: string;
      user: string;
    },
    maxRetries: number = 3
  ): Promise<string> {
    // Check if we've hit the request limit
    if (this.requestCount >= this.config.maxRequests) {
      throw new Error("Request limit reached");
    }

    this.requestCount++;

    try {
      // Add user message to history
      this.addToHistory("user", input);

      // Create custom system prompt with server info if provided
      let customSystemPrompt = this.config.systemPrompt;
      if (serverInfo) {
        customSystemPrompt = customSystemPrompt
          .replace("{network}", serverInfo.network)
          .replace("{channel}", serverInfo.channel)
          .replace("{user}", serverInfo.user);
      } else {
        // If no server info is provided, replace placeholders with generic values
        customSystemPrompt = customSystemPrompt
          .replace("{network}", "Unknown Network")
          .replace("{channel}", "Unknown Channel")
          .replace("{user}", "Unknown User");
      }

      // Process message with the LLM, always including all tools
      const response = await this.processMessageWithTools(
        input,
        serverInfo,
        maxRetries
      );

      // Always apply IRC formatting to ensure consistent outputs
      return this.formatForIRC(response);
    } catch (error) {
      console.error("Error generating response:", error);
      return this.formatForIRC(
        "Sorry, I encountered an error processing your request."
      );
    }
  }

  /**
   * Process a message using tools as needed until a final response is ready
   * This method will make multiple API calls if necessary to handle all tool requests
   * @param input The user's message
   * @param serverInfo Optional server information to include in the prompt
   * @param maxRetries Maximum number of retries for overloaded errors
   * @returns A final response from Claude, ready for IRC output
   * @private
   */
  private async processMessageWithTools(
    input: string,
    serverInfo?: {
      network: string;
      channel: string;
      user: string;
    },
    maxRetries: number = 3
  ): Promise<string> {
    // Get all available tools
    const toolDefinitions = this.toolRegistry.getAllToolDefinitions();
    let enhancedSystemPrompt = this.config.systemPrompt;

    // Apply server info to the enhanced system prompt if provided
    if (serverInfo) {
      enhancedSystemPrompt = enhancedSystemPrompt
        .replace("{network}", serverInfo.network)
        .replace("{channel}", serverInfo.channel)
        .replace("{user}", serverInfo.user);
    } else {
      // If no server info is provided, replace placeholders with generic values
      enhancedSystemPrompt = enhancedSystemPrompt
        .replace("{network}", "Unknown Network")
        .replace("{channel}", "Unknown Channel")
        .replace("{user}", "Unknown User");
    }

    // Always enhance the system prompt with the available tools, even if there are none
    enhancedSystemPrompt += "\n\nYou have access to the following tools:\n";

    if (toolDefinitions.length > 0) {
      toolDefinitions.forEach((tool) => {
        enhancedSystemPrompt += `\n- ${tool.name}: ${tool.description}`;
      });
    } else {
      enhancedSystemPrompt += "\n- None available at this time.";
    }

    enhancedSystemPrompt += "\n\nImportant instructions for using tools:";
    enhancedSystemPrompt +=
      "\n1. PROACTIVELY USE tools whenever they would help answer a question accurately.";
    enhancedSystemPrompt += "\n2. Use the most appropriate tool for each task.";
    enhancedSystemPrompt +=
      "\n3. NEVER mention that you used any tools - present all information as if you know it.";
    enhancedSystemPrompt +=
      "\n4. If multiple tools are needed, use them in sequence to build a complete answer.";
    enhancedSystemPrompt +=
      "\n5. ALL responses must remain under 500 characters.";
    enhancedSystemPrompt +=
      '\n6. NEVER say phrases like "I can use a tool" or "Let me check" - just use the tool.';

    // Initial API call with tools always included
    let response = await this.sendRequest(
      input,
      maxRetries,
      enhancedSystemPrompt,
      toolDefinitions // Always pass tools to every request
    );

    let attempts = 0;
    const maxAttempts = this.config.maxToolAttempts * 2; // Multiply to allow for multiple tool usage

    // Keep processing until we have a final response with no more tool usage
    // or until we reach the maximum number of attempts
    while (
      response.content.some((block: any) => block.type === "tool_use") &&
      attempts < maxAttempts
    ) {
      attempts++;
      console.log(
        `Processing tool request (attempt ${attempts}/${maxAttempts})`
      );

      // Process the current response which contains tool usage
      // This will execute the tool and get the next response
      const nextResponse = await this.handleToolResponse(
        response,
        input,
        serverInfo
      );

      // Update the response for the next iteration
      if (typeof nextResponse === "string") {
        // If we got a string response, return it directly
        return nextResponse;
      } else {
        // Otherwise, update the response object for the next iteration
        response = nextResponse;
      }
    }

    // Extract text from response
    let textResponse = "";
    for (const block of response.content) {
      if (block.type === "text") {
        textResponse += block.text;
      }
    }

    // Add assistant response to history
    this.addToHistory("assistant", textResponse);

    return textResponse;
  }

  /**
   * Send a request to Anthropic with retry logic for overloaded errors
   * @param input The user's message
   * @param maxRetries Maximum number of retries
   * @param customSystemPrompt Optional custom system prompt
   * @param toolDefinitions Optional array of tool definitions to include
   * @param currentRetry Current retry attempt number
   * @returns Anthropic API response
   * @private
   */
  private async sendRequest(
    input: string,
    maxRetries: number = 3,
    customSystemPrompt?: string,
    toolDefinitions?: any[],
    currentRetry: number = 0
  ): Promise<any> {
    try {
      // Get messages from history (which already includes the current user message)
      const messages = this.createMessagesFromHistory();

      const requestOptions: any = {
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: customSystemPrompt || this.config.systemPrompt,
        messages: messages,
      };

      // Convert tool definitions to Claude's expected format if available
      if (toolDefinitions && toolDefinitions.length > 0) {
        // Transform our toolDefinitions to match Claude's expected tool format
        const formattedTools = toolDefinitions.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: {
            ...tool.input_schema,
            // Ensure type is "object" as required by Claude
            type: "object",
          },
        }));

        requestOptions.tools = formattedTools;
      }

      return await this.client.messages.create(requestOptions);
    } catch (error: any) {
      // Check if this is an overloaded error
      if (
        error?.response?.data?.type === "error" &&
        error?.response?.data?.error?.type === "overloaded_error" &&
        currentRetry < maxRetries
      ) {
        console.log(
          `Overloaded error received, retrying after 1 second (attempt ${
            currentRetry + 1
          }/${maxRetries})`
        );
        // Wait for 1 second
        await new Promise((resolve) => setTimeout(resolve, 1000));
        // Retry the request
        return this.sendRequest(
          input,
          maxRetries,
          customSystemPrompt,
          toolDefinitions,
          currentRetry + 1
        );
      }

      // For other errors or if we've exhausted retries, throw the error
      throw error;
    }
  }

  /**
   * Create message array from chat history for the API request
   * @returns Array of message objects for the API
   * @private
   */
  private createMessagesFromHistory(): any[] {
    // If no history, just return an empty array (the latest user message will be added by the caller)
    if (this.chatHistory.length === 0) {
      return [];
    }

    // Convert the chat history to the format expected by the API
    return this.chatHistory.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  /**
   * Add a message to the chat history
   * @param role The role of the message sender
   * @param content The message content
   * @private
   */
  private addToHistory(role: "user" | "assistant", content: string): void {
    this.chatHistory.push({ role, content });

    // Trim history if it exceeds the maximum length
    if (this.chatHistory.length > this.config.maxHistoryLength) {
      // Remove oldest messages to maintain the maximum length
      this.chatHistory = this.chatHistory.slice(
        this.chatHistory.length - this.config.maxHistoryLength
      );
    }
  }

  /**
   * Send a tool result to Anthropic with retry logic for overloaded errors
   * @param messages Array of messages including user input, tool usage, and tool result
   * @param serverInfo Optional server information to include in the prompt
   * @param maxRetries Maximum number of retries
   * @param currentRetry Current retry attempt number
   * @returns Anthropic API response
   * @private
   */
  private async sendToolResultRequest(
    messages: any[],
    serverInfo?: {
      network: string;
      channel: string;
      user: string;
    },
    maxRetries: number = 3,
    currentRetry: number = 0
  ): Promise<any> {
    try {
      // Create a custom system prompt with server info if provided
      let customSystemPrompt = this.config.systemPrompt;
      if (serverInfo) {
        customSystemPrompt = customSystemPrompt
          .replace("{network}", serverInfo.network)
          .replace("{channel}", serverInfo.channel)
          .replace("{user}", serverInfo.user);
      } else {
        // If no server info is provided, replace placeholders with generic values
        customSystemPrompt = customSystemPrompt
          .replace("{network}", "Unknown Network")
          .replace("{channel}", "Unknown Channel")
          .replace("{user}", "Unknown User");
      }

      // Get all tools to include in follow-up requests
      const toolDefinitions = this.toolRegistry.getAllToolDefinitions();

      // Always include tools in every request
      const requestOptions: any = {
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: customSystemPrompt,
        messages: messages,
      };

      // Convert tool definitions to Claude's expected format if available
      if (toolDefinitions && toolDefinitions.length > 0) {
        // Transform our toolDefinitions to match Claude's expected tool format
        const formattedTools = toolDefinitions.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: {
            ...tool.input_schema,
            // Ensure type is "object" as required by Claude
            type: "object",
          },
        }));

        requestOptions.tools = formattedTools;
      }

      return await this.client.messages.create(requestOptions);
    } catch (error: any) {
      // Check if this is an overloaded error
      if (
        error?.response?.data?.type === "error" &&
        error?.response?.data?.error?.type === "overloaded_error" &&
        currentRetry < maxRetries
      ) {
        console.log(
          `Overloaded error received in tool result, retrying after 1 second (attempt ${
            currentRetry + 1
          }/${maxRetries})`
        );
        // Wait for 1 second
        await new Promise((resolve) => setTimeout(resolve, 1000));
        // Retry the request
        return this.sendToolResultRequest(
          messages,
          serverInfo,
          maxRetries,
          currentRetry + 1
        );
      }

      // For other errors or if we've exhausted retries, throw the error
      throw error;
    }
  }

  /**
   * Process a response that uses tools, execute the tools, and continue the conversation
   * @param response Response from Anthropic API
   * @param originalInput Original user input
   * @param serverInfo Optional server information to include in the prompt
   * @param attemptCount Current attempt count
   * @returns Final response text
   * @private
   */
  private async handleToolResponse(
    response: any,
    originalInput: string,
    serverInfo?: {
      network: string;
      channel: string;
      user: string;
    },
    attemptCount: number = 0
  ): Promise<string> {
    try {
      // First, check if we've exceeded the maximum tool attempts
      if (attemptCount >= this.config.maxToolAttempts) {
        return this.formatForIRC(
          `I'm sorry, I don't have that information right now. Could you try asking in a different way?`
        );
      }

      // First look for existing text content
      let textContent = "";
      for (const block of response.content) {
        if (block.type === "text") {
          textContent += block.text;
        }
      }

      // Get the tool use block
      const toolUseBlocks = response.content.filter(
        (block: any) => block.type === "tool_use"
      );

      if (toolUseBlocks.length === 0) {
        if (textContent.length > 0) {
          // Use the text content if available
          const formattedText = this.formatForIRC(textContent);
          this.addToHistory("assistant", formattedText);
          return formattedText;
        }

        return this.formatForIRC(
          "I don't have the information you're looking for right now. Is there something else I can help with?"
        );
      }

      // For this iteration, we'll use just the first tool, though multiple tools can be used in sequence
      const toolUse = toolUseBlocks[0];
      const toolName = toolUse.name;
      const toolInput = toolUse.input;
      const toolId = toolUse.id;

      console.log(`Executing tool ${toolName} with input:`, toolInput);

      // Try to find and execute the tool
      try {
        // Find the tool
        const tool = Array.from(this.toolRegistry.getAllTools()).find(
          (t) => t.getToolDefinition().name === toolName
        );

        if (!tool) {
          console.log(`Tool ${toolName} not found`);
          // Tool not found, fallback to normal response
          return await this.fallbackResponseWithoutTools(
            originalInput,
            `Tool ${toolName} not found`,
            serverInfo
          );
        }

        // Execute the tool
        console.log(`Executing tool ${toolName}`);
        const toolResult = await tool.handle(toolInput);
        console.log(`Tool ${toolName} execution result:`, toolResult);

        // Track this tool use in the chat history
        this.addToHistory(
          "assistant",
          `I used the ${toolName} tool with: ${JSON.stringify(toolInput)}`
        );

        // Send the tool result back to Claude for interpretation
        const messages = this.createMessagesFromHistory();

        // Add the tool use and result
        messages.push({
          role: "assistant",
          content: [
            // Force casting to any to handle the tool_use type which isn't in the TypeScript definitions
            {
              type: "tool_use",
              id: toolId,
              name: toolName,
              input: toolInput,
            } as any,
          ],
        });

        messages.push({
          role: "user",
          content: [
            // Force casting to any to handle the tool_result type which isn't in the TypeScript definitions
            {
              type: "tool_result",
              tool_use_id: toolId,
              content: JSON.stringify(toolResult),
            } as any,
          ],
        });

        // Send the tool result back to Claude for interpretation with retry logic
        console.log("Sending tool result back to Claude");
        const followUpResponse = await this.sendToolResultRequest(
          messages,
          serverInfo
        );

        // Save the tool result messages to our history
        this.addToHistory("user", `Tool result: ${JSON.stringify(toolResult)}`);

        // Check if the response also tries to use tools
        if (
          followUpResponse.content.some(
            (block: any) => block.type === "tool_use"
          )
        ) {
          console.log(
            "Claude wants to use another tool, continuing the sequence"
          );
          // Update our global response object for the loop in processMessageWithTools
          response.content = followUpResponse.content;

          // Recursively try to handle tools, with incremented attempt count
          return await this.handleToolResponse(
            followUpResponse,
            originalInput,
            serverInfo,
            attemptCount + 1
          );
        }

        // Extract text from the follow-up response
        let finalResponse = "";
        for (const block of followUpResponse.content) {
          if (block.type === "text") {
            finalResponse += block.text;
          }
        }

        // If no text found, create a simple response with the tool result
        if (!finalResponse.trim()) {
          // Let Claude generate a response based on the tool result
          // With no assumptions about tool structure or expected format
          let systemPromptWithContext = this.config.systemPrompt;

          // Apply server info to the system prompt if provided
          if (serverInfo) {
            systemPromptWithContext = systemPromptWithContext
              .replace("{network}", serverInfo.network)
              .replace("{channel}", serverInfo.channel)
              .replace("{user}", serverInfo.user);
          } else {
            // If no server info is provided, replace placeholders with generic values
            systemPromptWithContext = systemPromptWithContext
              .replace("{network}", "Unknown Network")
              .replace("{channel}", "Unknown Channel")
              .replace("{user}", "Unknown User");
          }

          // Add context about the tool result
          systemPromptWithContext += `\n\nThe following is the result of a data lookup: ${JSON.stringify(
            toolResult
          )}. 
            Format this information conversationally, as if you naturally know it. 
            Never mention where the information came from.`;

          const fallbackMessages = [
            {
              role: "user" as const,
              content: originalInput,
            },
          ];

          const fallbackResponse = await this.client.messages.create({
            model: this.config.model,
            max_tokens: this.config.maxTokens,
            system: systemPromptWithContext,
            messages: fallbackMessages,
          });

          // Extract text from the response
          for (const block of fallbackResponse.content) {
            if (block.type === "text") {
              finalResponse += block.text;
            }
          }

          // If still no response, use a very generic fallback
          if (!finalResponse.trim()) {
            finalResponse =
              "Here's the information you requested: " +
              JSON.stringify(toolResult);
          }
        }

        // Format for IRC
        finalResponse = this.formatForIRC(finalResponse);

        // Add the assistant's final response to history
        this.addToHistory("assistant", finalResponse);

        return finalResponse;
      } catch (error) {
        console.error(`Error executing tool ${toolName}:`, error);
        // Fall back to a normal response without tools
        return await this.fallbackResponseWithoutTools(
          originalInput,
          `Error executing tool ${toolName}`,
          serverInfo
        );
      }
    } catch (error) {
      console.error("Error handling tool response:", error);
      return this.formatForIRC(
        "I tried to process your request but ran into a technical issue. Could you try again?"
      );
    }
  }

  /**
   * Generate a fallback response when tool execution fails
   * @param originalInput Original user input
   * @param errorReason Reason for falling back
   * @param serverInfo Optional server information to include in the prompt
   * @returns Fallback response
   * @private
   */
  private async fallbackResponseWithoutTools(
    originalInput: string,
    errorReason: string,
    serverInfo?: {
      network: string;
      channel: string;
      user: string;
    }
  ): Promise<string> {
    console.log(`Falling back to response without tools: ${errorReason}`);

    try {
      // Make a simple request without any tool calls
      const fallbackResponse = await this.sendFallbackRequest(
        originalInput,
        serverInfo
      );

      // Extract text from the response
      let response = "";
      for (const block of fallbackResponse.content) {
        if (block.type === "text") {
          response += block.text;
        }
      }

      // Format for IRC
      response = this.formatForIRC(response);

      // Add to history
      this.addToHistory("assistant", response);

      return response;
    } catch (error) {
      console.error("Error in fallback response:", error);
      return "Sorry, I couldn't process your request at this time.";
    }
  }

  /**
   * Send a fallback request to Anthropic with retry logic for overloaded errors
   * @param input The user's message
   * @param serverInfo Optional server information to include in the prompt
   * @param maxRetries Maximum number of retries
   * @param currentRetry Current retry attempt number
   * @returns Anthropic API response
   * @private
   */
  private async sendFallbackRequest(
    input: string,
    serverInfo?: {
      network: string;
      channel: string;
      user: string;
    },
    maxRetries: number = 3,
    currentRetry: number = 0
  ): Promise<any> {
    try {
      // Create a custom system prompt with server info if provided
      let customSystemPrompt = this.config.systemPrompt;
      if (serverInfo) {
        customSystemPrompt = customSystemPrompt
          .replace("{network}", serverInfo.network)
          .replace("{channel}", serverInfo.channel)
          .replace("{user}", serverInfo.user);
      } else {
        // If no server info is provided, replace placeholders with generic values
        customSystemPrompt = customSystemPrompt
          .replace("{network}", "Unknown Network")
          .replace("{channel}", "Unknown Channel")
          .replace("{user}", "Unknown User");
      }

      customSystemPrompt +=
        "\nDo not attempt to use any tools for this message.";

      return await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: customSystemPrompt,
        messages: [
          {
            role: "user",
            content: input,
          },
        ],
      });
    } catch (error: any) {
      // Check if this is an overloaded error
      if (
        error?.response?.data?.type === "error" &&
        error?.response?.data?.error?.type === "overloaded_error" &&
        currentRetry < maxRetries
      ) {
        console.log(
          `Overloaded error received in fallback, retrying after 1 second (attempt ${
            currentRetry + 1
          }/${maxRetries})`
        );
        // Wait for 1 second
        await new Promise((resolve) => setTimeout(resolve, 1000));
        // Retry the request
        return this.sendFallbackRequest(
          input,
          serverInfo,
          maxRetries,
          currentRetry + 1
        );
      }

      // For other errors or if we've exhausted retries, throw the error
      throw error;
    }
  }

  /**
   * Reset the request counter
   */
  resetRequestCount(): void {
    this.requestCount = 0;
  }

  /**
   * Get the current request count
   */
  getRequestCount(): number {
    return this.requestCount;
  }

  /**
   * Replace the tool registry for this client instance
   * @param registry The tool registry to use
   */
  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
    const tools = this.toolRegistry.getAllTools();
    console.log(`Updated client with ${tools.length} tools from registry`);
  }

  /**
   * Get the current tool registry
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /**
   * Execute a tool by name
   * @param toolName Name of the tool to execute
   * @param params Parameters for the tool
   * @returns Result of the tool execution
   * @throws Error if tool not found
   */
  async executeTool(
    toolName: string,
    params: Record<string, any>
  ): Promise<any> {
    try {
      // Find the tool
      const tool = Array.from(this.toolRegistry.getAllTools()).find(
        (t) => t.getToolDefinition().name === toolName
      );

      if (!tool) {
        throw new Error(`Tool ${toolName} not found`);
      }

      // Execute the tool
      return await tool.handle(params);
    } catch (error) {
      console.error(`Error executing tool ${toolName}:`, error);
      throw error;
    }
  }

  /**
   * Close and clean up resources
   * Note: Only closes the custom tool registry, not the global singleton
   */
  close(): void {
    // Only close if we're not using the global singleton
    if (this.toolRegistry !== toolRegistry) {
      this.toolRegistry.close();
    }
  }
}
