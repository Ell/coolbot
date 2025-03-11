import toolRegistry from "../bot/toolRegistry";
import { Anthropic } from "../bot/anthropic";
import dotenv from "dotenv";
import path from "path";

// Load environment variables from .env file
dotenv.config();

// Make sure this directory matches your config
const toolsDirectory = path.resolve(__dirname, "../tools");

// Get API keys from environment variables
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const PIRATEWEATHER_API_KEY = process.env.PIRATEWEATHER_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Check for required API keys
if (!GOOGLE_API_KEY) {
  console.error(
    "Error: GOOGLE_API_KEY is required. Please set it in your environment variables."
  );
  process.exit(1);
}

if (!PIRATEWEATHER_API_KEY) {
  console.error(
    "Error: PIRATEWEATHER_API_KEY is required. Please set it in your environment variables."
  );
  process.exit(1);
}

if (!ANTHROPIC_API_KEY) {
  console.error(
    "Error: ANTHROPIC_API_KEY is required. Please set it in your environment variables."
  );
  process.exit(1);
}

async function main() {
  console.log("Loading tools from directory:", toolsDirectory);

  // Initialize the tool registry
  toolRegistry.setToolsDirectory(toolsDirectory, true);

  // Wait for tools to load
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Get the tools
  const tools = toolRegistry.getAllTools();
  console.log(`Loaded ${tools.length} tools`);

  // Create an Anthropic client to use for executing tools
  const anthropic = new Anthropic({
    anthropicApiKey: ANTHROPIC_API_KEY as string,
    useToolRegistry: true,
  });

  // Location to look up
  const location = process.argv[2] || "San Francisco, CA";
  console.log(`\nLooking up weather for: ${location}\n`);

  try {
    // Example 1: Using the geolocate tool
    console.log("--- Step 1: Geocoding the location ---");
    const geoResult = await anthropic.executeTool("geolocate", {
      location,
      api_key: GOOGLE_API_KEY,
    });

    console.log("Geocoding result:");
    console.log(`Address: ${geoResult.formatted_address}`);
    console.log(`Coordinates: ${geoResult.latitude}, ${geoResult.longitude}`);
    console.log(`Location type: ${geoResult.location_type}`);
    console.log("\n");

    // Example 2: Using the weather tool with coordinates
    console.log("--- Step 2: Getting weather data for these coordinates ---");
    const weatherResult = await anthropic.executeTool("get_weather", {
      latitude: geoResult.latitude,
      longitude: geoResult.longitude,
      api_key: PIRATEWEATHER_API_KEY,
      units: "us", // or "si" for metric
    });

    console.log("Weather result:");
    if (weatherResult.success) {
      const current = weatherResult.current;
      console.log(`Conditions: ${current.conditions}`);
      console.log(
        `Temperature: ${
          current.temperature.fahrenheit
        }°F / ${current.temperature.celsius.toFixed(1)}°C`
      );
      console.log(`Humidity: ${current.humidity}%`);
      console.log(
        `Wind: ${current.wind_speed.mph} mph / ${current.wind_speed.kph.toFixed(
          1
        )} kph`
      );

      if (weatherResult.daily) {
        console.log(
          `High: ${
            weatherResult.daily.high.fahrenheit
          }°F / ${weatherResult.daily.high.celsius.toFixed(1)}°C`
        );
        console.log(
          `Low: ${
            weatherResult.daily.low.fahrenheit
          }°F / ${weatherResult.daily.low.celsius.toFixed(1)}°C`
        );
      }

      if (weatherResult.hourly_summary) {
        console.log(`Forecast: ${weatherResult.hourly_summary}`);
      }
    } else {
      console.log(`Error: ${weatherResult.error}`);
    }
    console.log("\n");

    // Example 3: Using the combined weather lookup tool
    console.log("--- Step 3: Using the combined weather lookup tool ---");
    const combinedResult = await anthropic.executeTool("weather_lookup", {
      location,
      google_api_key: GOOGLE_API_KEY,
      pirateweather_api_key: PIRATEWEATHER_API_KEY,
      units: "us", // or "si" for metric
    });

    console.log("Combined weather lookup result:");
    if (combinedResult.success) {
      console.log(`Location: ${combinedResult.formatted_address}`);
      console.log(`Conditions: ${combinedResult.current_conditions}`);
      console.log(`Temperature: ${combinedResult.temperature}`);
      console.log(`High/Low: ${combinedResult.high} / ${combinedResult.low}`);
      console.log(`Humidity: ${combinedResult.humidity}`);
      console.log(`Wind: ${combinedResult.wind}`);
      console.log(`Forecast: ${combinedResult.forecast}`);
    } else {
      console.log(`Error: ${combinedResult.error}`);
    }
  } catch (error) {
    console.error("Error executing tools:", error);
  }
}

// Run the main function
main().catch(console.error);
