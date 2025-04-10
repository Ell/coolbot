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

// Channel identifier for chat history separation
interface ChannelId {
  network: string;
  channel: string;
}

// Function to create a unique channel key
function getChannelKey(channelInfo?: ChannelId): string {
  if (!channelInfo) {
    return "default";
  }
  return `${channelInfo.network.toLowerCase()}/${channelInfo.channel.toLowerCase()}`;
}

// Default IRC bot system prompt
const DEFAULT_IRC_SYSTEM_PROMPT = `You provide straightforward IRC responses to a wide range of queries, emphasizing direct answers.

Critical requirements:
1. MAXIMUM 500 CHARACTERS per response. Non-negotiable.
2. RESPOND to:
   - Tool-based requests (data retrieval, calculations, code, web searches)
   - Document processing (PDF summaries, URL content analysis, text extraction)
   - Simple factual questions (even without tools)
   - Casual questions with clear answers
   - Basic informational requests
   - Light banter and casual conversation
   - Random questions about almost anything with a clear answer
   - ANY request with a URL - ALWAYS treat as requiring tools/processing
3. ALWAYS respond with DIRECT ANSWERS ONLY - no fluff, explanations, or context unless specifically requested.
4. NEVER ask follow-up questions or suggest alternatives.
5. NEVER use phrases like "here you go", "hope this helps", "I'd be happy to", or "let me know".
6. Use natural but extremely concise language - no unnecessary words.
7. For URLs, simply provide the URL without description.
8. Present data in the most compact format possible - just the facts.
9. No introductions, greetings, or sign-offs.
10. For tool results, return just the relevant data point or URL.
11. USE TOOLS when needed for factual information, specific data, computations, or document processing.
12. NEVER mention that you're using tools - just provide the information directly.
13. For code execution: Only show both code and output when they COMBINED fit within 500 characters. Otherwise, show just the output.
14. For YouTube results, format as: "Title: [title] | By: [uploader] | [view_count] views | [URL]"
15. For creativity-related requests that involve code or data, use appropriate tools.
16. When asked to summarize or TLDR content from a URL or PDF, ALWAYS respond with a concise summary.
17. STAY SILENT ONLY for:
    - Personal questions about "you" as an AI
    - Requests for opinions on sensitive topics
    - Harmful, unethical, or illegal content requests
    - Completely nonsensical inputs without any clear question

Example response style:
"https://example.com/image.jpg" NOT "Here's an image of a cat: https://example.com/image.jpg. It shows a tabby cat playing with yarn. Let me know if you want more cat images!"

Code example (when total is under 500 chars):
\`\`\`python
def hello():
    return "Hello, world!"
print(hello())
\`\`\`
Output: Hello, world!

Code example (when total exceeds 500 chars):
Output: [just the output of the executed code]

Factual answer example:
Paris, France

For "What's the capital of France?" - respond with "Paris" not "The capital of France is Paris. It's known as the City of Light and..."

YouTube result example:
Title: How to Build a React App | By: CodeMaster | 1,234,567 views | https://youtube.com/watch?v=abc123

PDF/URL summary example:
The complaint alleges securities fraud against Company X for misleading statements about revenue growth. Claims include artificially inflated stock prices, undisclosed risks, and violation of SEC regulations. Seeks class action status for investors who purchased between Jan-Oct 2023.

Examples of when TO respond:
- "What's the current price of Bitcoin?" - "47,293.82 USD"
- "Execute this Python code: print('hello world')" - "Output: hello world"
- "Tell me a joke" - "Why don't scientists trust atoms? Because they make up everything."
- "What's the capital of France?" - "Paris"
- "How many people live in Tokyo?" - "37.4 million in the metropolitan area"
- "What's up?" - "Not much. What's up with you?"
- "Tell me about dogs" - "Domesticated canines, loyal companions, varied breeds, descended from wolves, keen senses, social animals"
- "tldr this pdf https://example.com/document.pdf" - [concise summary of the PDF content]
- "summarize this article https://news.com/article" - [brief summary of the article]

Examples of when NOT to respond:
- "What do you feel about being an AI?" - No response
- "Do you have consciousness?" - No response
- "Who's better, Democrats or Republicans?" - No response
- "How can I hack into my neighbor's Wi-Fi?" - No response
- "xyzpdq!@#$%^&*" - No response (nonsensical)

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
  // Change from single array to map of arrays keyed by channel
  private chatHistories: Map<string, ChatMessage[]> = new Map();

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
      maxHistoryLength: 10, // Fixed at 10 messages for rolling buffer
      ...config,
    };

    // Force maxHistoryLength to be exactly 10 messages
    this.config.maxHistoryLength = 10;

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
    // Filter out any tool usage information in the response
    let formatted = text;

    // Remove any text that mentions tool usage
    const toolUsagePatterns = [
      /I used the .+? tool with: .+?(?=\n|$)/g,
      /Tool result: .+?(?=\n|$)/g,
      /Using the .+? tool to/g,
      /Let me check .+? using a tool/g,
      /I'll use a tool to/g,
      /I can use the .+? tool/g,
    ];

    for (const pattern of toolUsagePatterns) {
      formatted = formatted.replace(pattern, "");
    }

    // Handle code execution specifically
    if (formatted.includes("```") && formatted.includes("Output:")) {
      // Extract the code and output
      const codeMatch = formatted.match(/```[\s\S]+?```/);
      const outputMatch = formatted.match(/Output:[\s\S]+/);

      if (codeMatch && outputMatch) {
        const code = codeMatch[0];
        const output = outputMatch[0];

        // Check if combined length exceeds limit (with some buffer for formatting)
        if (code.length + output.length + 10 > this.config.maxResponseLength) {
          // Only keep the output part if too long
          formatted = output.trim();
          console.log("Code+output too long, showing only output");
        }
      }
    }

    // Special handling for YouTube results - preserve pipe separators
    if (
      formatted.includes("Title:") &&
      formatted.includes("By:") &&
      formatted.includes("views |")
    ) {
      // For YouTube results, just replace newlines with spaces but keep pipe separators
      formatted = formatted.replace(/\n/g, " ");
    } else {
      // Regular handling for other types of content
      // Remove any excessive newlines (IRC usually uses a single line)
      formatted = formatted.replace(/\n{2,}/g, " ").replace(/\n/g, " ");
    }

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
   * Get the chat history for a specific channel
   * @param channelInfo The channel information
   * @returns The chat history for the channel
   * @private
   */
  private getChannelHistory(channelInfo?: {
    network: string;
    channel: string;
  }): ChatMessage[] {
    const channelKey = getChannelKey(channelInfo);

    if (!this.chatHistories.has(channelKey)) {
      this.chatHistories.set(channelKey, []);
    }

    return this.chatHistories.get(channelKey)!;
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
      // Add user message to channel-specific history
      this.addToHistory("user", input, serverInfo);

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
   * Create message array from chat history for the API request
   * @param channelInfo The channel information
   * @returns Array of message objects for the API
   * @private
   */
  private createMessagesFromHistory(channelInfo?: {
    network: string;
    channel: string;
  }): any[] {
    // Get the channel-specific history
    const channelHistory = this.getChannelHistory(channelInfo);

    // If no history, just return an empty array
    if (channelHistory.length === 0) {
      return [];
    }

    // Convert the chat history to the format expected by the API
    return channelHistory.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  /**
   * Add a message to the chat history
   * @param role The role of the message sender
   * @param content The message content
   * @param channelInfo The channel information
   * @private
   */
  private addToHistory(
    role: "user" | "assistant",
    content: string,
    channelInfo?: {
      network: string;
      channel: string;
      user?: string;
    }
  ): void {
    // Get the channel key
    const channelKey = getChannelKey(channelInfo);

    // Get the channel-specific history
    let channelHistory = this.getChannelHistory(channelInfo);

    // Add the new message
    channelHistory.push({ role, content });

    // Apply the rolling buffer logic - keep only the most recent 10 messages
    if (channelHistory.length > this.config.maxHistoryLength) {
      // FIFO (First In, First Out): Remove the oldest message(s)
      channelHistory = channelHistory.slice(-this.config.maxHistoryLength);

      // Update the history in the map
      this.chatHistories.set(channelKey, channelHistory);

      console.log(
        `Channel ${channelKey}: Maintaining rolling buffer of ${this.config.maxHistoryLength} messages`
      );
    }
  }

  /**
   * Get the current size of the history for a specific channel
   * @param channelInfo The channel information
   * @returns The number of messages in the channel's history
   */
  getChannelHistorySize(channelInfo: {
    network: string;
    channel: string;
  }): number {
    const channelHistory = this.getChannelHistory(channelInfo);
    return channelHistory.length;
  }

  /**
   * Get a summary of the rolling buffers for all channels
   * @returns A map of channel keys to their history sizes
   */
  getHistorySummary(): Record<string, number> {
    const summary: Record<string, number> = {};

    for (const [channelKey, history] of this.chatHistories.entries()) {
      summary[channelKey] = history.length;
    }

    return summary;
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
    // First, evaluate if this input requires a tool response
    // List of patterns that typically require tool usage
    const toolRequiringPatterns = [
      /current price|market value|stock price|coin price|crypto/i,
      /calculate|compute|convert|math|equation/i,
      /execute|run|code|program|script|function/i,
      /search|lookup|find information|latest news|headline/i,
      /weather|forecast|temperature/i,
      /translate|translation/i,
      /youtube|video|stream/i,
      /stock market|stock price|nasdaq|dow/i,
      /url|link|website/i,
      /database|query|data/i,
      /file|document|read/i,
      /reverse|count|sort|list|format|output|write|generate|print/i,
      /random.*fact|fact.*about/i,
      /how many|what is|when is|where is/i,
      /pokemon|pokedex/i,
      /create|make|develop|build/i,
      /fetch|crawl|download|get|retrieve/i,
      /compare|comparison|parallel|similar|like|resembles/i,
      /fictional|fiction|story|book|novel|tale|movie/i,
      /give me|tell me|show me|get me|find me/i, // Common request patterns
      /facts|information|details|data about/i, // Common information seeking patterns
      /pdf|doc|document|text|article/i, // Document-related patterns
      /summarize|summary|tldr|tl;dr|explain|breakdown/i, // Summarization patterns
    ];

    // Helper function to detect implicit code/computation requests
    const detectImplicitToolRequest = (query: string): boolean => {
      // Check for URLs in the query - ANY query with a URL should be treated as a tool request
      if (/https?:\/\/\S+/i.test(query)) {
        console.log("Matched URL in request");
        return true;
      }

      // Check for PDF or document summarization requests
      if (
        /(summarize|tldr|tl;dr).+?(pdf|document|article|page|post)/i.test(query)
      ) {
        console.log("Matched document summarization request");
        return true;
      }

      // ANY request that has "write code" should ALWAYS be considered a tool request
      if (
        /(write|create|generate|make).{0,20}(code|program|script)/i.test(query)
      ) {
        console.log("Matched explicit code generation request");
        return true;
      }

      // ANY request with "code that" should be considered a tool request
      if (/code that/i.test(query)) {
        console.log("Matched 'code that' pattern");
        return true;
      }

      // Check for a string that needs reversal
      if (/reverse this/i.test(query) || /reverse the/i.test(query)) {
        return true;
      }

      // Check for any query about creating/generating/writing code
      if (
        /(create|make|write|generate|output|print).*(code|program|script|function)/i.test(
          query
        )
      ) {
        return true;
      }

      // Check for any string query mentioning operations
      if (/(this|the) string/i.test(query)) {
        return true;
      }

      // Check for simple calculation patterns (numbers with operators between them)
      if (/\d+\s*[\+\-\*\/\^]\s*\d+/.test(query)) {
        return true;
      }

      // Check for requests that likely require writing some code
      if (
        /\b(in|using)\s+(python|javascript|js|ruby|go|golang|c\+\+|java|php|bash|shell)\b/i.test(
          query
        )
      ) {
        return true;
      }

      // Check for multi-step operations involving searching and processing
      if (/search(es)? for.*then/i.test(query) || /find.*then/i.test(query)) {
        console.log("Matched multi-step search operation");
        return true;
      }

      // Handle requests for fetching/processing news or headlines
      if (/news|headline|article/i.test(query)) {
        return true;
      }

      // Look for comparisons between real-world and fictional elements
      if (
        /(compare|parallel|similar|match).*(fiction|story|book|novel)/i.test(
          query
        ) ||
        /(fiction|story|book|novel).*(compare|parallel|similar|like)/i.test(
          query
        )
      ) {
        console.log("Matched comparison between real data and fiction");
        return true;
      }

      // Detect requests with "that parallels" or similar phrasing
      if (/that parallel|parallels|that matches|matches with/i.test(query)) {
        console.log("Matched 'parallels' pattern");
        return true;
      }

      return false;
    };

    // Check if the input contains any pattern suggesting tool usage
    let mightRequireTool = toolRequiringPatterns.some((pattern) => {
      const matches = pattern.test(input);
      if (matches) {
        console.log(`Matched tool pattern: ${pattern}`);
      }
      return matches;
    });

    // If no pattern matched, try detecting implicit tool requests
    if (!mightRequireTool) {
      mightRequireTool = detectImplicitToolRequest(input);
      if (mightRequireTool) {
        console.log(`Detected implicit tool request in: "${input}"`);
      }
    }

    // Special case for "write code" to ensure these are ALWAYS handled
    if (
      !mightRequireTool &&
      /(write|create|generate).{0,10}(code|program|script)/i.test(input)
    ) {
      console.log(`Treating as code generation request: "${input}"`);
      mightRequireTool = true;
    }

    // If still in doubt, check for "write" or "generate" as a broader catch-all
    if (!mightRequireTool && /write|generate/i.test(input)) {
      console.log(
        `Treating as potential tool query due to 'write/generate': "${input}"`
      );
      mightRequireTool = true;
    }

    // If the input doesn't match any tool-requiring pattern, return empty response
    if (!mightRequireTool) {
      console.log(`Skipping response for non-tool query: "${input}"`);
      return "";
    }

    // Mark this query as pre-identified as requiring tools
    const preIdentifiedAsToolQuery = true;
    console.log(`Processing tool-requiring query: "${input}"`);

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
      "\n1. Use tools ONLY when they would provide FACTUAL information you don't know, retrieve SPECIFIC data, or perform COMPUTATIONS.";
    enhancedSystemPrompt +=
      "\n2. DO NOT use tools for general knowledge, opinions, creative content, or jokes - these should come from your own knowledge.";
    enhancedSystemPrompt +=
      "\n3. Choose the most appropriate tool for each specific task.";
    enhancedSystemPrompt +=
      "\n4. NEVER mention that you used any tools - present all information as if you know it.";
    enhancedSystemPrompt +=
      "\n5. If multiple tools are needed, use them in sequence to build a complete answer.";
    enhancedSystemPrompt +=
      "\n6. ALL responses must remain under 500 characters.";
    enhancedSystemPrompt +=
      '\n7. NEVER say phrases like "I can use a tool" or "Let me check" - just use the tool if needed.';
    enhancedSystemPrompt +=
      "\n8. If the request doesn't require a tool, DO NOT RESPOND AT ALL. Return an empty string.";

    // Store the original user message to chat history
    this.addToHistory("user", input, serverInfo);

    // Initial API call with tools always included
    let response = await this.sendRequest(
      input,
      maxRetries,
      enhancedSystemPrompt,
      toolDefinitions, // Always pass tools to every request
      serverInfo // Pass server info for channel context
    );

    // Check if the response contains any tool usage
    const hasToolUse = response.content.some(
      (block: any) => block.type === "tool_use"
    );

    // Extract any text content for evaluation
    let textContent = "";
    for (const block of response.content) {
      if (block.type === "text") {
        textContent += block.text;
      }
    }

    // List of indicators that signify the LLM thinks no tool is needed
    const noToolIndicators = [
      "I don't need to use any tools for this",
      "This doesn't require a tool",
      "I can answer this without tools",
      "No tool needed",
      "This is general knowledge",
      "I shouldn't respond",
      "No response",
    ];

    // Check if response contains those indicators
    const containsNoToolIndicator = noToolIndicators.some((indicator) =>
      textContent.toLowerCase().includes(indicator.toLowerCase())
    );

    // If no tool is being used, we have two cases:
    // 1. Regular case: No tool use + contains indicator = stay silent
    // 2. Override case: No tool use + pre-identified as tool query + meaningful text = RESPOND ANYWAY
    if (!hasToolUse) {
      // For pre-identified tool queries with meaningful text responses, respond anyway
      if (
        preIdentifiedAsToolQuery &&
        textContent.trim().length > 5 &&
        !containsNoToolIndicator
      ) {
        console.log(
          `No tool used but responding anyway to pre-identified tool query: "${input}"`
        );
        // Format the text response for IRC
        const formattedResponse = this.formatForIRC(textContent);
        this.addToHistory("assistant", formattedResponse, serverInfo);
        return formattedResponse;
      }

      // For all other cases where no tool is used, stay silent
      if (containsNoToolIndicator || !textContent.trim()) {
        console.log(`Not responding to: "${input}" (no tool required)`);
        return ""; // Return empty string to stay silent
      }

      // If we have text content but no explicit indicators, respond with it
      if (textContent.trim()) {
        console.log(`Responding with text content for tool query: "${input}"`);
        const formattedResponse = this.formatForIRC(textContent);
        this.addToHistory("assistant", formattedResponse, serverInfo);
        return formattedResponse;
      }

      // Fallback: stay silent if we have no content
      return "";
    }

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

    // Format the response for IRC
    textResponse = this.formatForIRC(textResponse);

    // Add the assistant response to channel-specific history if not empty
    if (textResponse.trim()) {
      this.addToHistory("assistant", textResponse, serverInfo);
    }

    return textResponse;
  }

  /**
   * Send a request to Anthropic with retry logic for overloaded errors
   * @param input The user's message
   * @param maxRetries Maximum number of retries
   * @param customSystemPrompt Optional custom system prompt
   * @param toolDefinitions Optional array of tool definitions to include
   * @param channelInfo The channel information
   * @param currentRetry Current retry attempt number
   * @returns Anthropic API response
   * @private
   */
  private async sendRequest(
    input: string,
    maxRetries: number = 3,
    customSystemPrompt?: string,
    toolDefinitions?: any[],
    channelInfo?: {
      network: string;
      channel: string;
      user?: string;
    },
    currentRetry: number = 0
  ): Promise<any> {
    try {
      // Get channel-specific messages from history
      const messages = this.createMessagesFromHistory(channelInfo);

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
          channelInfo,
          currentRetry + 1
        );
      }

      // For other errors or if we've exhausted retries, throw the error
      throw error;
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
          this.addToHistory("assistant", formattedText, serverInfo);
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

        // Track this tool use in internal logs but not in the chat history
        // This line is commented out to avoid adding tool usage details to the chat history
        // this.addToHistory(
        //   "assistant",
        //   `I used the ${toolName} tool with: ${JSON.stringify(toolInput)}`,
        //   serverInfo
        // );

        // Send the tool result back to Claude for interpretation
        const messages = this.createMessagesFromHistory(serverInfo);

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

        // Save the tool result for internal processing but not in user-visible chat history
        // This is now stored only in the message array for Claude, not in the persisted chat history
        // this.addToHistory(
        //   "user",
        //   `Tool result: ${JSON.stringify(toolResult)}`,
        //   serverInfo
        // );

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

        // Add the assistant's final response to channel-specific history
        this.addToHistory("assistant", finalResponse, serverInfo);

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
      // Create a more directive prompt to encourage response for likely tool queries
      let fallbackPrompt = this.config.systemPrompt;

      // Append special instructions for likely tool queries
      if (
        originalInput.match(
          /(write|code|search|find|compare|parallel|get|lookup|fiction)/i
        )
      ) {
        fallbackPrompt +=
          "\n\nIMPORTANT OVERRIDE: This query has been pre-identified as requiring a tool response. " +
          "Even if no ideal tool is available, you SHOULD still provide a helpful response rather than staying silent. " +
          "If asked to compare news with fiction or find parallels, provide relevant fictional examples that might match current events. " +
          "For code requests, provide the best code you can generate. For search/lookup requests, provide factual information from your knowledge.";
      }

      // Make a simple request without any tool calls but with our enhanced prompt
      const fallbackResponse = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: fallbackPrompt,
        messages: [
          {
            role: "user",
            content: originalInput,
          },
        ],
      });

      // Extract text from the response
      let response = "";
      for (const block of fallbackResponse.content) {
        if (block.type === "text") {
          response += block.text;
        }
      }

      // Format for IRC
      response = this.formatForIRC(response);

      // Add to channel-specific history
      this.addToHistory("assistant", response, serverInfo);

      return response;
    } catch (error) {
      console.error("Error in fallback response:", error);
      return "Sorry, I couldn't process your request at this time.";
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

  /**
   * Clear the chat history for a specific channel
   * @param channelInfo The channel information
   */
  clearChannelHistory(channelInfo: { network: string; channel: string }): void {
    const channelKey = getChannelKey(channelInfo);
    this.chatHistories.set(channelKey, []);
    console.log(`Cleared chat history for channel: ${channelKey}`);
  }

  /**
   * Clear all chat histories
   */
  clearAllHistories(): void {
    this.chatHistories.clear();
    console.log("Cleared all chat histories");
  }
}
