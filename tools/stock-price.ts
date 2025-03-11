import { createTool } from "../bot/tool";
import yahooFinance from "yahoo-finance2";
import { z } from "zod";

/**
 * Tool to look up current stock prices using Yahoo Finance
 */
const stockPriceTool = createTool(
  "stock_price",
  "Look up current stock prices by ticker symbol",
  z.object({
    ticker: z.union([
      z.string().describe("Stock ticker symbol (e.g., 'AAPL')"),
      z.array(z.string()).describe("Array of stock ticker symbols"),
    ]),
  }),
  async (inputs) => {
    try {
      const { ticker } = inputs;

      // Handle both single ticker and array of tickers
      const tickers = Array.isArray(ticker) ? ticker : [ticker];

      if (tickers.length === 0) {
        return "Please provide at least one stock ticker symbol.";
      }

      // Process each ticker and get the price
      const results = await Promise.all(
        tickers.map(async (symbol) => {
          try {
            const quote = await yahooFinance.quote(symbol);
            if (!quote || !quote.regularMarketPrice) {
              return `Stock '${symbol}' not found.`;
            }

            return {
              symbol: quote.symbol,
              price: quote.regularMarketPrice,
              currency: quote.currency || "USD",
            };
          } catch (error) {
            return `Stock '${symbol}' not found.`;
          }
        })
      );

      // Format the response
      if (results.length === 1) {
        const result = results[0];
        if (typeof result === "string") {
          return result;
        }
        return `${result.symbol}: ${result.price} ${result.currency}`;
      } else {
        // Multiple tickers
        const formattedResults = results.map((result) => {
          if (typeof result === "string") {
            return result;
          }
          return `${result.symbol}: ${result.price} ${result.currency}`;
        });

        return formattedResults.join("\n");
      }
    } catch (error) {
      console.error("Error in stock price lookup:", error);
      return "An error occurred while looking up stock prices.";
    }
  }
);

// Export the tool
export default {
  stock_price: stockPriceTool,
};
