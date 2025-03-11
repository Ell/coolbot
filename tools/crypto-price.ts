/// <reference types="bun-types" />

import { z } from "zod";
import { createTool } from "../bot/tool";
import axios from "axios";

// Base URL for CoinGecko API
const COINGECKO_API_URL = "https://api.coingecko.com/api/v3";

// Interface for price response
interface PriceResponse {
  [id: string]: {
    usd: number;
    usd_24h_change?: number;
    last_updated_at?: number;
  };
}

// Helper function to get crypto price
async function getCryptoPrice(cryptoId: string): Promise<PriceResponse> {
  try {
    const response = await axios.get(
      `${COINGECKO_API_URL}/simple/price?ids=${cryptoId}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      if (error.response.status === 429) {
        throw new Error("Rate limit exceeded. Please try again later.");
      }
      throw new Error(
        `API error: ${error.response.status} - ${error.response.statusText}`
      );
    }
    throw error;
  }
}

// Helper function to search for a crypto ID
async function searchCrypto(query: string): Promise<any[]> {
  try {
    const response = await axios.get(
      `${COINGECKO_API_URL}/search?query=${encodeURIComponent(query)}`
    );
    return response.data.coins || [];
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      if (error.response.status === 429) {
        throw new Error("Rate limit exceeded. Please try again later.");
      }
      throw new Error(
        `API error: ${error.response.status} - ${error.response.statusText}`
      );
    }
    throw error;
  }
}

/**
 * Tool for getting current cryptocurrency prices in USD
 * Provides direct price data without additional commentary
 */
const cryptoPriceTool = createTool(
  "crypto_price",
  "Get current price of a cryptocurrency in USD (direct factual response only)",
  z.object({
    crypto: z
      .string()
      .describe(
        "The cryptocurrency name or symbol to look up (e.g., bitcoin, eth)"
      ),
  }),
  async (inputs) => {
    const { crypto } = inputs;

    try {
      // First try direct ID lookup
      let priceData = await getCryptoPrice(crypto.toLowerCase());

      // If we didn't get a result, try to search for the crypto
      if (Object.keys(priceData).length === 0) {
        const searchResults = await searchCrypto(crypto);

        if (searchResults.length === 0) {
          return {
            success: false,
            error: `Cryptocurrency '${crypto}' not found.`,
          };
        }

        // Use the top search result
        const topResult = searchResults[0];
        priceData = await getCryptoPrice(topResult.id);

        if (Object.keys(priceData).length === 0) {
          return {
            success: false,
            error: `No price data available for '${crypto}'.`,
          };
        }
      }

      // Format the response
      const cryptoId = Object.keys(priceData)[0];
      const data = priceData[cryptoId];

      return {
        success: true,
        crypto: cryptoId,
        price_usd: data.usd,
        change_24h: data.usd_24h_change,
        last_updated: data.last_updated_at
          ? new Date(data.last_updated_at * 1000).toISOString()
          : new Date().toISOString(),
        message: formatPriceMessage(cryptoId, data),
      };
    } catch (error) {
      return {
        success: false,
        error: `Error getting price data: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
);

/**
 * Tool for getting prices of multiple cryptocurrencies at once
 * Provides direct price data without additional commentary
 */
const multiCryptoPriceTool = createTool(
  "multi_crypto_price",
  "Get current prices of multiple cryptocurrencies in USD (direct factual response only)",
  z.object({
    cryptos: z
      .string()
      .describe(
        "Comma-separated list of cryptocurrency names or symbols (e.g., 'bitcoin,eth,doge')"
      ),
  }),
  async (inputs) => {
    const { cryptos } = inputs;

    try {
      const cryptoList = cryptos
        .split(",")
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);

      if (cryptoList.length === 0) {
        return {
          success: false,
          error: "No cryptocurrencies specified.",
        };
      }

      if (cryptoList.length > 10) {
        return {
          success: false,
          error: "Maximum 10 cryptocurrencies allowed per request.",
        };
      }

      // Build combined ID string for API call
      let idString = cryptoList.join(",");

      // Get price data
      let priceData = await getCryptoPrice(idString);

      // If some weren't found, try to look them up by search
      const missingCryptos = cryptoList.filter((c) => !priceData[c]);
      let additionalData = {};

      if (missingCryptos.length > 0) {
        for (const crypto of missingCryptos) {
          const searchResults = await searchCrypto(crypto);

          if (searchResults.length > 0) {
            const topResult = searchResults[0];
            const additionalPriceData = await getCryptoPrice(topResult.id);

            if (Object.keys(additionalPriceData).length > 0) {
              additionalData = { ...additionalData, ...additionalPriceData };
            }
          }
        }
      }

      // Combine all price data
      priceData = { ...priceData, ...additionalData };

      // If we didn't find any crypto data, return error
      if (Object.keys(priceData).length === 0) {
        return {
          success: false,
          error: "No price data found for requested cryptocurrencies.",
        };
      }

      // Format results
      const results = Object.entries(priceData).map(([id, data]) => ({
        crypto: id,
        price_usd: data.usd,
        change_24h: data.usd_24h_change,
        last_updated: data.last_updated_at
          ? new Date(data.last_updated_at * 1000).toISOString()
          : new Date().toISOString(),
      }));

      return {
        success: true,
        results,
        message: formatMultiplePriceMessage(results),
      };
    } catch (error) {
      return {
        success: false,
        error: `Error getting price data: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
);

/**
 * Format price message for a single cryptocurrency
 */
function formatPriceMessage(
  cryptoId: string,
  data: { usd: number; usd_24h_change?: number }
): string {
  const price = data.usd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

  // Direct format with no extra commentary
  if (data.usd_24h_change !== undefined) {
    const changePrefix = data.usd_24h_change >= 0 ? "+" : "";
    return `${cryptoId.toUpperCase()}: ${price} (${changePrefix}${data.usd_24h_change.toFixed(
      2
    )}% in 24h)`;
  } else {
    return `${cryptoId.toUpperCase()}: ${price}`;
  }
}

/**
 * Format price message for multiple cryptocurrencies
 */
function formatMultiplePriceMessage(
  results: Array<{ crypto: string; price_usd: number; change_24h?: number }>
): string {
  // Direct format with no extra commentary
  return results
    .map((result) => {
      const price = result.price_usd.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      });

      if (result.change_24h !== undefined) {
        const changePrefix = result.change_24h >= 0 ? "+" : "";
        return `${result.crypto.toUpperCase()}: ${price} (${changePrefix}${result.change_24h.toFixed(
          2
        )}% in 24h)`;
      } else {
        return `${result.crypto.toUpperCase()}: ${price}`;
      }
    })
    .join("\n");
}

// Export the tools as a default export object mapping tool names to tools
export default {
  crypto_price: cryptoPriceTool,
  multi_crypto_price: multiCryptoPriceTool,
};
