import { z } from "zod";
import { createTool } from "../bot/tool";
import axios from "axios";

// Default API endpoint for Piston
const DEFAULT_PISTON_API = "https://emkc.org/api/v2/piston";

// Interface for language runtime
interface LanguageRuntime {
  language: string;
  version: string;
  aliases?: string[];
  runtime?: string;
}

/**
 * Tool for executing code in various languages using the Piston API
 */
const executeCodeTool = createTool(
  "execute_code",
  "Execute code in various programming languages using the Piston API",
  z.object({
    language: z
      .string()
      .describe(
        "Programming language to execute (e.g., python, javascript, c++)"
      ),
    code: z.string().describe("Source code to execute"),
    stdin: z
      .string()
      .optional()
      .describe("Standard input to provide to the program"),
    args: z
      .array(z.string())
      .optional()
      .describe("Command-line arguments to pass to the program"),
    version: z
      .string()
      .optional()
      .describe("Specific language version (defaults to latest)"),
    api_url: z
      .string()
      .optional()
      .describe("Custom Piston API URL (defaults to emkc.org)"),
    compile_timeout: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Compile stage timeout in ms (default: 10000)"),
    run_timeout: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Run stage timeout in ms (default: 3000)"),
    memory_limit: z
      .number()
      .int()
      .optional()
      .describe("Memory limit in bytes (default: no limit)"),
  }),
  async (inputs) => {
    const {
      language,
      code,
      stdin = "",
      args = [],
      version = "*",
      api_url = DEFAULT_PISTON_API,
      compile_timeout = 10000,
      run_timeout = 3000,
      memory_limit = -1,
    } = inputs;

    try {
      // Prepare the request payload
      const payload = {
        language,
        version,
        files: [
          {
            name: `main.${getExtension(language)}`,
            content: code,
          },
        ],
        stdin,
        args,
        compile_timeout,
        run_timeout,
        compile_memory_limit: memory_limit,
        run_memory_limit: memory_limit,
      };

      // Make the API request
      const response = await axios.post(`${api_url}/execute`, payload, {
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "CoolBot-IRC-Bot",
        },
        timeout: compile_timeout + run_timeout + 5000, // Add buffer time for API processing
      });

      const data = response.data;

      // Check if execution was successful
      const runStage = data.run || {};
      const compileStage = data.compile || {};

      // Determine if there were any errors
      const hasCompileError =
        compileStage.code !== undefined && compileStage.code !== 0;
      const hasRunError = runStage.code !== undefined && runStage.code !== 0;
      const hasCompileSignal = compileStage.signal !== null;
      const hasRunSignal = runStage.signal !== null;

      // Format execution results
      const result = {
        success:
          !hasCompileError &&
          !hasRunError &&
          !hasCompileSignal &&
          !hasRunSignal,
        language: data.language,
        version: data.version,
        run: runStage
          ? {
              stdout: runStage.stdout || "",
              stderr: runStage.stderr || "",
              output: runStage.output || runStage.stdout || "",
              exit_code: runStage.code,
              signal: runStage.signal,
              execution_time: runStage.wall_time,
              cpu_time: runStage.cpu_time,
              memory_used: runStage.memory,
            }
          : undefined,
        compile: compileStage
          ? {
              stdout: compileStage.stdout || "",
              stderr: compileStage.stderr || "",
              output: compileStage.output || compileStage.stdout || "",
              exit_code: compileStage.code,
              signal: compileStage.signal,
              execution_time: compileStage.wall_time,
              cpu_time: compileStage.cpu_time,
              memory_used: compileStage.memory,
            }
          : undefined,
      };

      return result;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          // Server responded with error
          return {
            success: false,
            error: `Server returned error ${error.response.status}: ${error.response.statusText}`,
            message: error.response.data?.message || "Unknown error",
            status: error.response.status,
          };
        } else if (error.request) {
          // Request made but no response received
          return {
            success: false,
            error:
              "No response received from the code execution server. It might be down or unreachable.",
          };
        }
      }

      // Generic error handling
      return {
        success: false,
        error: `Failed to execute code: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
);

/**
 * Tool to get available languages on the Piston API
 */
const getLanguagesTool = createTool(
  "get_supported_languages",
  "Get a list of all supported programming languages on the Piston API",
  z.object({
    api_url: z
      .string()
      .optional()
      .describe("Custom Piston API URL (defaults to emkc.org)"),
  }),
  async (inputs) => {
    const { api_url = DEFAULT_PISTON_API } = inputs;

    try {
      const response = await axios.get(`${api_url}/runtimes`, {
        headers: {
          "User-Agent": "CoolBot-IRC-Bot",
        },
        timeout: 5000,
      });

      const languages = response.data as LanguageRuntime[];

      // Group by language name, showing all available versions
      const languageMap = new Map();

      languages.forEach((lang: LanguageRuntime) => {
        if (!languageMap.has(lang.language)) {
          languageMap.set(lang.language, {
            name: lang.language,
            versions: [],
          });
        }

        languageMap.get(lang.language).versions.push({
          version: lang.version,
          aliases: lang.aliases || [],
        });
      });

      return {
        success: true,
        languages: Array.from(languageMap.values()),
        raw_data: languages,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          return {
            success: false,
            error: `Server returned error ${error.response.status}: ${error.response.statusText}`,
            status: error.response.status,
          };
        } else if (error.request) {
          return {
            success: false,
            error:
              "No response received from the code execution server. It might be down or unreachable.",
          };
        }
      }

      return {
        success: false,
        error: `Failed to get supported languages: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
);

/**
 * Helper function to get file extension for a given language
 */
function getExtension(language: string): string {
  const extensionMap: Record<string, string> = {
    python: "py",
    javascript: "js",
    typescript: "ts",
    c: "c",
    cpp: "cpp",
    "c++": "cpp",
    csharp: "cs",
    "c#": "cs",
    java: "java",
    ruby: "rb",
    rust: "rs",
    go: "go",
    php: "php",
    swift: "swift",
    kotlin: "kt",
    scala: "scala",
    perl: "pl",
    r: "r",
    haskell: "hs",
    bash: "sh",
    shell: "sh",
    lua: "lua",
    julia: "jl",
    erlang: "erl",
    elixir: "ex",
    zig: "zig",
    nasm: "asm",
    fortran: "f90",
  };

  // Normalize the language name (lowercase and remove spaces)
  const normalizedLang = language.toLowerCase().replace(/\s+/g, "");

  // Return the extension if found, otherwise use the language name as extension
  return extensionMap[normalizedLang] || normalizedLang;
}

export default {
  executeCode: executeCodeTool,
  getSupportedLanguages: getLanguagesTool,
};
