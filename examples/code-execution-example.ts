import toolRegistry from "../bot/toolRegistry";
import { Anthropic } from "../bot/anthropic";
import * as dotenv from "dotenv";
import path from "path";

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Make sure this directory matches your config
const toolsDirectory = path.resolve(__dirname, "../tools");

// Check for required API key
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PISTON_API_URL =
  process.env.PISTON_API_URL || "https://emkc.org/api/v2/piston";

if (!ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY is required in .env file");
  process.exit(1);
}

// Import the code-execution tool
import codeExecutionTools from "../tools/code-execution";

/**
 * Main function to demonstrate code execution
 */
async function main() {
  try {
    console.log("Loading tools from directory:", toolsDirectory);

    // Initialize the tool registry
    toolRegistry.setToolsDirectory(toolsDirectory, true);

    // Wait for tools to load
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Get the tools
    const tools = toolRegistry.getAllTools();
    console.log(`Loaded ${tools.length} tools`);

    // Create Anthropic client
    const anthropic = new Anthropic({
      anthropicApiKey: ANTHROPIC_API_KEY as string,
      useToolRegistry: true,
      maxTokens: 4096,
    });

    // Example 1: Execute Python code
    console.log("\n--- Example 1: Execute Python code ---");
    const pythonCode = `
print("Hello from Python!")
for i in range(5):
    print(f"Number: {i}")
print("Square of 7:", 7 * 7)
`;

    console.log("Executing Python code:");
    console.log(pythonCode);
    console.log("Using Piston API URL:", PISTON_API_URL);

    const pythonResult = await anthropic.executeTool("execute_code", {
      language: "python",
      code: pythonCode,
      api_url: PISTON_API_URL,
    });

    console.log("\nResults:");
    console.log("Success:", pythonResult.success);
    console.log("Language:", pythonResult.language);
    console.log("Version:", pythonResult.version);
    console.log("Output:", pythonResult.run?.output);
    console.log("Execution time:", pythonResult.run?.execution_time, "ms");
    console.log("Memory used:", pythonResult.run?.memory_used, "bytes");

    // Example 2: Execute JavaScript code with stdin
    console.log("\n--- Example 2: Execute JavaScript with stdin ---");
    const jsCode = `
const input = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

let name = '';

// Read input from stdin
let data = '';
process.stdin.on('data', chunk => {
  data += chunk;
});

process.stdin.on('end', () => {
  const name = data.trim();
  console.log(\`Hello \${name}! Welcome to JavaScript.\`);
  console.log(\`The current time is \${new Date().toLocaleTimeString()}\`);
  console.log(\`Random number between 1-100: \${Math.floor(Math.random() * 100) + 1}\`);
});
`;

    console.log("Executing JavaScript code with stdin:");
    console.log(jsCode);

    const jsResult = await anthropic.executeTool("execute_code", {
      language: "javascript",
      code: jsCode,
      stdin: "World",
      api_url: PISTON_API_URL,
    });

    console.log("\nResults:");
    console.log("Success:", jsResult.success);
    console.log("Language:", jsResult.language);
    console.log("Version:", jsResult.version);
    console.log("Output:", jsResult.run?.output);
    console.log("Execution time:", jsResult.run?.execution_time, "ms");

    // Example 3: Execute C++ code (compiled language)
    console.log("\n--- Example 3: Execute C++ code (compiled language) ---");
    const cppCode = `
#include <iostream>
#include <vector>
#include <algorithm>

int main() {
    std::cout << "Demonstrating C++ compilation and execution" << std::endl;
    
    // Create a vector of numbers
    std::vector<int> numbers = {5, 2, 8, 1, 9, 3, 7, 4, 6};
    
    // Sort the vector
    std::sort(numbers.begin(), numbers.end());
    
    // Print the sorted vector
    std::cout << "Sorted numbers: ";
    for (const auto& num : numbers) {
        std::cout << num << " ";
    }
    std::cout << std::endl;
    
    // Calculate sum
    int sum = 0;
    for (const auto& num : numbers) {
        sum += num;
    }
    std::cout << "Sum: " << sum << std::endl;
    std::cout << "Average: " << static_cast<double>(sum) / numbers.size() << std::endl;
    
    return 0;
}
`;

    console.log("Executing C++ code:");
    console.log(cppCode);

    const cppResult = await anthropic.executeTool("execute_code", {
      language: "cpp",
      code: cppCode,
      api_url: PISTON_API_URL,
    });

    console.log("\nResults:");
    console.log("Success:", cppResult.success);
    console.log("Language:", cppResult.language);
    console.log("Version:", cppResult.version);

    if (cppResult.compile) {
      console.log(
        "Compile output:",
        cppResult.compile.output || "No compilation output"
      );
      console.log("Compile time:", cppResult.compile.execution_time, "ms");
    }

    console.log("Run output:", cppResult.run?.output);
    console.log("Execution time:", cppResult.run?.execution_time, "ms");

    // Example 4: Get list of supported languages
    console.log("\n--- Example 4: Get list of supported languages ---");

    const languagesResult = await anthropic.executeTool(
      "get_supported_languages",
      {
        api_url: PISTON_API_URL,
      }
    );

    console.log("Supported Languages:");
    if (languagesResult.success && languagesResult.languages) {
      // Display first 5 languages as an example
      const topLanguages = languagesResult.languages.slice(0, 5);
      topLanguages.forEach((lang) => {
        console.log(
          `- ${lang.name} (${lang.versions.length} versions available)`
        );
        console.log(`  Latest version: ${lang.versions[0].version}`);
      });
      console.log(
        `... and ${languagesResult.languages.length - 5} more languages`
      );
      console.log(
        `Total languages supported: ${languagesResult.languages.length}`
      );
    } else {
      console.log("Failed to retrieve languages:", languagesResult.error);
    }
  } catch (error) {
    console.error("Error in example:", error);
  }
}

// Run the main function
main().catch(console.error);
