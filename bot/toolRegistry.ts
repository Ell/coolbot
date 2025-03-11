import { watch } from "chokidar";
import { resolve, join, basename, dirname } from "path";
import type { ToolHandler, ToolDefinition } from "./tool";

// Type for the tool map expected from each tool file
export type ToolMap = Record<string, ToolHandler<any>>;

// Extended tool definition with source information for registry management
interface ExtendedToolDefinition extends ToolDefinition {
  _source?: string; // Stores information about which file provided the tool
}

/**
 * Tool Registry that manages and validates tools from the tools directory
 */
export class ToolRegistry {
  private tools: Map<string, ToolHandler<any>> = new Map();
  private watcher: ReturnType<typeof watch>;
  private toolsDir: string;

  /**
   * Create a new ToolRegistry
   * @param toolsDir Path to the tools directory (relative or absolute)
   * @param shouldLoadTools Whether to load tools and set up watchers
   */
  constructor(toolsDir: string = "./tools", shouldLoadTools: boolean = true) {
    this.toolsDir = resolve(process.cwd(), toolsDir);

    if (shouldLoadTools) {
      this.watcher = this.setupWatcher();
      this.loadAllTools();
    } else {
      // Create an empty watcher that does nothing
      this.watcher = { close: () => {} } as any;
      console.log("Tool loading disabled for this registry");
    }
  }

  /**
   * Get all registered tools
   * @returns Array of tool handlers
   */
  getAllTools(): ToolHandler<any>[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get all tool definitions for registration with APIs
   * @returns Array of tool definitions
   */
  getAllToolDefinitions(): ToolDefinition[] {
    return this.getAllTools().map((tool) => tool.getToolDefinition());
  }

  /**
   * Get a specific tool by name
   * @param name Tool name
   * @returns The tool handler or undefined if not found
   */
  getTool(name: string): ToolHandler<any> | undefined {
    return this.tools.get(name);
  }

  /**
   * Set up the file watcher for the tools directory
   * @returns The chokidar watcher instance
   */
  private setupWatcher() {
    console.log(`Setting up watcher for tools directory: ${this.toolsDir}`);

    const watcher = watch(join(this.toolsDir, "**/*.{ts,js}"), {
      ignored: [
        /(^|[\/\\])\../, // Ignore dotfiles
        "**/node_modules/**", // Ignore node_modules
        "**/*test*.*", // Ignore test files
        "**/*spec*.*", // Ignore spec files
        "**/example*.*", // Ignore example files
      ],
      persistent: true,
      ignoreInitial: true,
    });

    watcher
      .on("add", (path: string) => {
        console.log(`Tool file added: ${path}`);
        this.loadToolFile(path);
      })
      .on("change", (path: string) => {
        console.log(`Tool file changed: ${path}`);
        this.loadToolFile(path, true);
      })
      .on("unlink", (path: string) => {
        console.log(`Tool file removed: ${path}`);
        this.removeToolFile(path);
      })
      .on("error", (err: unknown) => {
        console.error(`Watcher error:`, err);
      });

    return watcher;
  }

  /**
   * Load all tools from the tools directory
   */
  private async loadAllTools() {
    try {
      // Use Node.js fs module to load all files
      const { readdir, stat } = await import("fs/promises");

      const loadDir = async (dir: string) => {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const path = join(dir, entry.name);

          // Skip files or directories that should be ignored
          const lowerName = entry.name.toLowerCase();
          if (
            lowerName.startsWith(".") ||
            lowerName.includes("node_modules") ||
            lowerName.includes("test") ||
            lowerName.includes("spec") ||
            lowerName.includes("example")
          ) {
            continue;
          }

          if (entry.isDirectory()) {
            // Recursively load tools from subdirectories
            await loadDir(path);
          } else if (
            entry.isFile() &&
            (lowerName.endsWith(".ts") || lowerName.endsWith(".js"))
          ) {
            // Load tool files only
            await this.loadToolFile(path);
          }
        }
      };

      await loadDir(this.toolsDir);
      console.log(
        `Loaded ${this.tools.size} tools from directory: ${this.toolsDir}`
      );
    } catch (error) {
      console.error(
        `Failed to load tools from directory: ${this.toolsDir}`,
        error
      );
    }
  }

  /**
   * Load a specific tool file
   * @param path Path to the tool file
   * @param isReload Whether this is a reload of an existing file
   */
  private async loadToolFile(path: string, isReload: boolean = false) {
    try {
      // Skip core files from the bot directory
      const lowerPath = path.toLowerCase();
      if (
        lowerPath.includes("anthropic.ts") ||
        lowerPath.includes("tool.ts") ||
        lowerPath.includes("toolregistry.ts")
      ) {
        return;
      }

      // Clear the require cache to ensure we get the latest version
      if (isReload) {
        this.clearRequireCache(path);
      }

      // Dynamically import the tool file
      const toolModule = await import(path);

      // Get the default export which should be a tool map
      const toolMap = toolModule.default;

      // Validate the tool map
      if (!toolMap || typeof toolMap !== "object") {
        console.error(
          `Invalid tool file: ${path}. Default export should be an object mapping tool names to tools.`
        );
        return;
      }

      // Register or update each tool in the map
      let loadedTools = 0;
      for (const [name, tool] of Object.entries(toolMap)) {
        // Validate that the tool is a ToolHandler
        if (!this.isValidToolHandler(tool)) {
          console.error(
            `Invalid tool "${name}" in file ${path}. Tool must implement the ToolHandler interface.`
          );
          continue;
        }

        // Register the tool
        this.registerTool(name, tool);
        loadedTools++;
      }

      console.log(
        `${isReload ? "Reloaded" : "Loaded"} ${loadedTools} tools from ${path}`
      );
    } catch (error) {
      console.error(`Failed to load tool file: ${path}`, error);
    }
  }

  /**
   * Remove tools from a specific file
   * @param path Path to the tool file
   */
  private removeToolFile(path: string) {
    try {
      // Get the file name without extension
      const fileName = basename(path).replace(/\.[^/.]+$/, "");
      const dirName = basename(dirname(path));

      // Create a file identifier that includes both directory and filename
      // This helps avoid collisions when files have the same name in different dirs
      const fileId = `${dirName}/${fileName}`;

      // Remove all tools associated with this file
      const toolsToRemove: string[] = [];

      for (const [toolName, tool] of this.tools.entries()) {
        const toolDef = tool.getToolDefinition() as ExtendedToolDefinition;
        const toolSource = toolDef._source;

        if (toolSource && toolSource === fileId) {
          toolsToRemove.push(toolName);
        }
      }

      for (const name of toolsToRemove) {
        this.tools.delete(name);
        console.log(`Removed tool: ${name}`);
      }

      console.log(`Removed ${toolsToRemove.length} tools from ${path}`);
    } catch (error) {
      console.error(`Failed to remove tool file: ${path}`, error);
    }
  }

  /**
   * Register a tool in the registry
   * @param name Tool name
   * @param tool Tool handler
   */
  private registerTool(name: string, tool: ToolHandler<any>) {
    try {
      const toolDef = tool.getToolDefinition() as ExtendedToolDefinition;

      // Store file source information to help with tool removal
      const fileName = basename(toolDef.name);
      const dirName = basename(this.toolsDir);
      toolDef._source = `${dirName}/${fileName}`;

      // Use the tool's name as the key in the map
      const toolName = toolDef.name;

      // Check if the tool is already registered
      if (this.tools.has(toolName)) {
        console.log(`Tool ${toolName} is already registered, updating`);
      }

      this.tools.set(toolName, tool);
      console.log(`Registered tool: ${toolName}`);
    } catch (error) {
      console.error(`Failed to register tool ${name}:`, error);
    }
  }

  /**
   * Check if an object is a valid ToolHandler
   * @param obj Object to check
   * @returns True if the object is a valid ToolHandler
   */
  private isValidToolHandler(obj: any): obj is ToolHandler<any> {
    return (
      obj &&
      typeof obj === "object" &&
      typeof obj.getToolDefinition === "function" &&
      typeof obj.handle === "function"
    );
  }

  /**
   * Clear the require cache for a module
   * @param path Module path
   */
  private clearRequireCache(path: string) {
    try {
      const resolvedPath = require.resolve(path);
      delete require.cache[resolvedPath];
    } catch (error) {
      console.error(`Failed to clear require cache for: ${path}`, error);
    }
  }

  /**
   * Register a tool manually
   * @param name Name of the tool
   * @param tool The tool to register
   */
  registerToolManually(name: string, tool: any): void {
    // Verify the tool implements the necessary interface
    if (!this.isValidToolHandler(tool)) {
      console.error(
        `Invalid tool ${name}. Tool must implement the ToolHandler interface.`
      );
      return;
    }

    // Modify the tool definition to include the provided name
    const toolDef = tool.getToolDefinition();
    const originalName = toolDef.name;
    toolDef.name = name;

    // Add to the tools map
    this.tools.set(name, tool);
    console.log(
      `Manually registered tool: ${name} (original name: ${originalName})`
    );
  }

  /**
   * Set the tools directory and reload tools
   * @param toolsDir The new tools directory
   * @param shouldLoadTools Whether to load tools and set up watchers
   */
  setToolsDirectory(toolsDir: string, shouldLoadTools: boolean = true): void {
    // Close the existing watcher
    if (this.watcher) {
      this.watcher.close();
    }

    // Clear existing tools
    this.tools.clear();

    // Update the tools directory - use process.cwd() instead of __dirname
    // This resolves paths relative to the current working directory
    // rather than relative to the script's directory
    this.toolsDir = resolve(process.cwd(), toolsDir);
    console.log(`Tool registry directory set to: ${this.toolsDir}`);

    if (shouldLoadTools) {
      // Setup new watcher and load tools
      this.watcher = this.setupWatcher();
      this.loadAllTools();
    } else {
      // Create an empty watcher that does nothing
      this.watcher = { close: () => {} } as any;
      console.log("Tool loading disabled for this registry");
    }
  }

  /**
   * Clean up resources (stop watcher)
   */
  public close() {
    this.watcher.close();
    console.log("Tool registry watcher closed");
  }
}

// Create and export a singleton instance
const toolRegistry = new ToolRegistry();
export default toolRegistry;
