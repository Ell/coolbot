import { z } from "zod";
import { createTool } from "../bot/tool";
import axios from "axios";

// API URLs
const GEOCODING_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const PIRATEWEATHER_URL = "https://api.pirateweather.net/forecast/";

// Helper functions for unit conversion
function fToC(tempF: number): number {
  return ((tempF - 32) * 5) / 9;
}

function mphToKph(mph: number): number {
  return mph * 1.609;
}

// Geocoding tool
const geolocateTool = createTool(
  "geolocate",
  "Convert a location name to geographic coordinates using Google Maps API",
  z.object({
    location: z
      .string()
      .describe("The location to geocode, e.g. 'New York, NY'"),
  }),
  async (inputs) => {
    const { location } = inputs;

    const api_key = process.env.GOOGLE_API_KEY;
    const pirateweather_api_key = process.env.PIRATEWEATHER_API_KEY;

    if (!api_key || !pirateweather_api_key) {
      return {
        success: false,
        error: "Missing API keys",
      };
    }

    try {
      const response = await axios.get(GEOCODING_URL, {
        params: {
          address: location,
          key: api_key,
        },
      });

      const data = response.data;

      if (data.status !== "OK" || !data.results || data.results.length === 0) {
        return {
          success: false,
          error: `Failed to geocode location: ${
            data.status || "No results found"
          }`,
        };
      }

      const result = data.results[0];
      const { lat, lng } = result.geometry.location;

      return {
        success: true,
        formatted_address: result.formatted_address,
        latitude: lat,
        longitude: lng,
        location_type: result.geometry.location_type,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to geocode location: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
);

// Weather tool using PirateWeather
const weatherTool = createTool(
  "get_weather",
  "Get the current weather for a location using PirateWeather API",
  z.object({
    latitude: z.number().describe("Latitude coordinate"),
    longitude: z.number().describe("Longitude coordinate"),
    units: z
      .enum(["us", "si"])
      .optional()
      .describe("Units system: 'us' for Fahrenheit, 'si' for Celsius"),
  }),
  async (inputs) => {
    const { latitude, longitude, units = "us" } = inputs;

    const api_key = process.env.PIRATEWEATHER_API_KEY;
    if (!api_key) {
      return {
        success: false,
        error: "Missing API keys",
      };
    }

    try {
      const url = `${PIRATEWEATHER_URL}${api_key}/${latitude},${longitude}`;
      const response = await axios.get(url, {
        params: { units },
      });

      const data = response.data;

      if (!data || !data.currently) {
        return {
          success: false,
          error: "Failed to get weather data",
        };
      }

      const current = data.currently;
      const forecast = data.daily?.data?.[0];

      if (units === "us") {
        return {
          success: true,
          location: { latitude, longitude },
          current: {
            temperature: {
              fahrenheit: current.temperature,
              celsius: fToC(current.temperature),
            },
            conditions: current.summary,
            humidity: Math.round(current.humidity * 100),
            wind_speed: {
              mph: current.windSpeed,
              kph: mphToKph(current.windSpeed),
            },
            icon: current.icon,
          },
          daily: forecast
            ? {
                high: {
                  fahrenheit: forecast.temperatureHigh,
                  celsius: fToC(forecast.temperatureHigh),
                },
                low: {
                  fahrenheit: forecast.temperatureLow,
                  celsius: fToC(forecast.temperatureLow),
                },
              }
            : undefined,
          hourly_summary: data.hourly?.summary,
          timestamp: new Date().toISOString(),
        };
      } else {
        // If using SI units, the API already returns values in metric
        return {
          success: true,
          location: { latitude, longitude },
          current: {
            temperature: {
              celsius: current.temperature,
              fahrenheit: (current.temperature * 9) / 5 + 32,
            },
            conditions: current.summary,
            humidity: Math.round(current.humidity * 100),
            wind_speed: {
              kph: current.windSpeed,
              mph: current.windSpeed / 1.609,
            },
            icon: current.icon,
          },
          daily: forecast
            ? {
                high: {
                  celsius: forecast.temperatureHigh,
                  fahrenheit: (forecast.temperatureHigh * 9) / 5 + 32,
                },
                low: {
                  celsius: forecast.temperatureLow,
                  fahrenheit: (forecast.temperatureLow * 9) / 5 + 32,
                },
              }
            : undefined,
          hourly_summary: data.hourly?.summary,
          timestamp: new Date().toISOString(),
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to get weather data: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
);

// Combined weather lookup tool - combines geocoding and weather lookup
const weatherLookupTool = createTool(
  "weather_lookup",
  "Get weather for a location name (combines geocoding and weather lookup)",
  z.object({
    location: z
      .string()
      .describe("The location to get weather for, e.g. 'San Francisco, CA'"),
    units: z
      .enum(["us", "si"])
      .optional()
      .describe("Units system: 'us' for Fahrenheit, 'si' for Celsius"),
  }),
  async (inputs) => {
    const { location, units = "us" } = inputs;

    const google_api_key = process.env.GOOGLE_API_KEY;
    const pirateweather_api_key = process.env.PIRATEWEATHER_API_KEY;
    if (!google_api_key || !pirateweather_api_key) {
      return {
        success: false,
        error: "Missing API keys",
      };
    }

    try {
      // First, geocode the location
      const geoResponse = await axios.get(GEOCODING_URL, {
        params: {
          address: location,
          key: google_api_key,
        },
      });

      const geoData = geoResponse.data;

      if (
        geoData.status !== "OK" ||
        !geoData.results ||
        geoData.results.length === 0
      ) {
        return {
          success: false,
          error: `Failed to geocode location: ${
            geoData.status || "No results found"
          }`,
        };
      }

      const result = geoData.results[0];
      const { lat, lng } = result.geometry.location;
      const formattedAddress = result.formatted_address;

      // Now get the weather data
      const weatherUrl = `${PIRATEWEATHER_URL}${pirateweather_api_key}/${lat},${lng}`;
      const weatherResponse = await axios.get(weatherUrl, {
        params: { units },
      });

      const weatherData = weatherResponse.data;

      if (!weatherData || !weatherData.currently) {
        return {
          success: false,
          error: "Failed to get weather data",
        };
      }

      const current = weatherData.currently;
      const forecast = weatherData.daily?.data?.[0];

      // Format the result in a human-readable format for IRC
      const temp =
        units === "us"
          ? `${current.temperature.toFixed(1)}°F/${fToC(
              current.temperature
            ).toFixed(1)}°C`
          : `${current.temperature.toFixed(1)}°C/${(
              (current.temperature * 9) / 5 +
              32
            ).toFixed(1)}°F`;

      const high = forecast
        ? units === "us"
          ? `${forecast.temperatureHigh.toFixed(1)}°F/${fToC(
              forecast.temperatureHigh
            ).toFixed(1)}°C`
          : `${forecast.temperatureHigh.toFixed(1)}°C/${(
              (forecast.temperatureHigh * 9) / 5 +
              32
            ).toFixed(1)}°F`
        : "N/A";

      const low = forecast
        ? units === "us"
          ? `${forecast.temperatureLow.toFixed(1)}°F/${fToC(
              forecast.temperatureLow
            ).toFixed(1)}°C`
          : `${forecast.temperatureLow.toFixed(1)}°C/${(
              (forecast.temperatureLow * 9) / 5 +
              32
            ).toFixed(1)}°F`
        : "N/A";

      const windSpeed =
        units === "us"
          ? `${current.windSpeed.toFixed(1)}mph/${mphToKph(
              current.windSpeed
            ).toFixed(1)}kph`
          : `${current.windSpeed.toFixed(1)}kph/${(
              current.windSpeed / 1.609
            ).toFixed(1)}mph`;

      return {
        success: true,
        formatted_address: formattedAddress,
        current_conditions: current.summary,
        temperature: temp,
        high: high,
        low: low,
        humidity: `${Math.round(current.humidity * 100)}%`,
        wind: windSpeed,
        forecast: weatherData.hourly?.summary || "No forecast available",
        raw_data: {
          location: {
            latitude: lat,
            longitude: lng,
            address: formattedAddress,
          },
          current,
          daily: forecast,
          hourly_summary: weatherData.hourly?.summary,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Weather lookup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
);

// Export all tools
export default {
  geolocate: geolocateTool,
  weather: weatherTool,
  weatherLookup: weatherLookupTool,
};
