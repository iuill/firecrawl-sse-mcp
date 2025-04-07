import {
  Tool,
  CallToolRequestSchema,
  CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { z } from "zod";
import { client } from "./client.js";
import {
  withRetry,
  updateCreditUsage,
  hasCredits,
  safeLog,
  trimResponseText,
} from "./utils.js";
// Removed incorrect import: import type { SearchOptions } from "@mendable/firecrawl-js";

// Tool definition from the reference repository
export const SEARCH_TOOL: Tool = {
  name: "firecrawl_search",
  description:
    "Search and retrieve content from web pages with optional scraping. " +
    "Returns SERP results by default (url, title, description) or full page content when scrapeOptions are provided.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query string" },
      limit: {
        type: "number",
        description: "Maximum number of results to return (default: 5)",
      },
      lang: {
        type: "string",
        description: "Language code for search results (default: en)",
      },
      country: {
        type: "string",
        description: "Country code for search results (default: us)",
      },
      tbs: { type: "string", description: "Time-based search filter" },
      filter: { type: "string", description: "Search filter" },
      location: {
        type: "object",
        properties: {
          country: {
            type: "string",
            description: "Country code for geolocation",
          },
          languages: {
            type: "array",
            items: { type: "string" },
            description: "Language codes for content",
          },
        },
        description: "Location settings for search",
      },
      scrapeOptions: {
        type: "object",
        properties: {
          formats: {
            type: "array",
            items: { type: "string", enum: ["markdown", "html", "rawHtml"] },
            description: "Content formats to extract from search results",
          },
          onlyMainContent: {
            type: "boolean",
            description: "Extract only the main content from results",
          },
          waitFor: {
            type: "number",
            description: "Time in milliseconds to wait for dynamic content",
          },
          // Add other relevant scrape options if needed
        },
        description: "Options for scraping search results",
      },
    },
    required: ["query"],
  }, // Removed 'as ToolSchema' cast
  outputSchema: CallToolResultSchema,
};

// Define SearchOptions locally based on the inputSchema
interface SearchOptions {
  query: string;
  limit?: number;
  lang?: string;
  country?: string;
  tbs?: string;
  filter?: string;
  location?: {
    country?: string;
    languages?: string[];
  };
  scrapeOptions?: {
    formats?: string[];
    onlyMainContent?: boolean;
    waitFor?: number;
    // Add other scrape options if needed from schema
  };
  // Add origin if used internally
  origin?: string;
}

// Type guard for search arguments
// Use the locally defined SearchOptions interface
function isSearchOptions(args: unknown): args is SearchOptions {
  return (
    typeof args === "object" &&
    args !== null &&
    "query" in args &&
    typeof (args as { query: unknown }).query === "string"
  );
}

export function registerSearchHandler(server: Server) {
  server.setRequestHandler(
    CallToolRequestSchema, // Schema first
    async (
      request: z.infer<typeof CallToolRequestSchema>
    ): Promise<z.infer<typeof CallToolResultSchema>> => {
      const startTime = Date.now();
      const { name, arguments: args } = request.params;

      // Check if arguments exist
      if (args === undefined) {
        safeLog("error", `No arguments provided for tool ${name}`);
        return {
          content: [
            {
              type: "text",
              text: `Error: No arguments provided for tool ${name}`,
            },
          ],
          isError: true,
          usage: {},
        };
      }

      if (name !== SEARCH_TOOL.name) {
        // Ignore calls for other tools
        return {
          content: [
            {
              type: "text",
              text: `Internal error: Search handler received request for ${name}`,
            },
          ],
          isError: true,
          usage: {},
        };
      }

      // Safely initialize context after checking args
      const context = `search ${isSearchOptions(args) ? args.query : "invalid query"}`;
      safeLog("info", `Handling request for ${name}`);

      if (!isSearchOptions(args)) {
        safeLog(
          "error",
          `Invalid arguments for ${name}: ${JSON.stringify(args)}`
        );
        return {
          content: [
            {
              type: "text",
              text: "Invalid arguments: Missing or invalid 'query'.",
            },
          ],
          isError: true,
          usage: {},
        };
      }

      const { query, ...options } = args;

      try {
        const searchStartTime = Date.now();
        safeLog(
          "info",
          `Starting ${context} with options: ${JSON.stringify(options)}`
        );

        const response = await withRetry(
          // Remove @ts-expect-error if origin is handled or removed
          () =>
            client.search(query, { ...options /*, origin: 'mcp-server' */ }), // Keep origin commented out for now
          context
        );

        safeLog(
          "info",
          `${context} completed in ${Date.now() - searchStartTime}ms`
        );

        if (!response.success) {
          throw new Error(response.error || "Search operation failed");
        }

        // Monitor credits if applicable
        let creditsUsed: number | undefined = undefined;
        if (hasCredits(response)) {
          await updateCreditUsage(response.creditsUsed);
          creditsUsed = response.creditsUsed;
        }

        // Define a type for the search result item
        interface SearchResultItem {
          url: string;
          title?: string;
          description?: string;
          markdown?: string;
          html?: string;
          rawHtml?: string;
          // Add other potential fields if known
        }

        // Format the results
        const results = (response.data as SearchResultItem[]) // Assert the type of response.data
          .map((result: SearchResultItem) => {
            let resultString = `URL: ${result.url}\nTitle: ${result.title || "No title"}\nDescription: ${result.description || "No description"}`;
            // Include scraped content if available (markdown is preferred if present)
            if (result.markdown) {
              resultString += `\n\nContent (Markdown):\n${result.markdown}`;
            } else if (result.html) {
              // Fallback to HTML if markdown not present but HTML is
              resultString += `\n\nContent (HTML):\n${result.html}`;
            } else if (result.rawHtml) {
              // Fallback to Raw HTML
              resultString += `\n\nContent (Raw HTML):\n${result.rawHtml}`;
            }
            return resultString;
          })
          .join("\n\n---\n\n");

        safeLog(
          "info",
          `Request for ${name} completed successfully in ${Date.now() - startTime}ms`
        );
        return {
          content: [
            {
              type: "text",
              text: trimResponseText(results || "No results found."),
            },
          ],
          isError: false,
          usage: {
            credits: creditsUsed,
          },
        };
      } catch (error) {
        let errorMessage = "An unknown error occurred";
        if (error instanceof Error) {
          errorMessage = error.message;
        } else if (typeof error === "string") {
          errorMessage = error;
        } else {
          try {
            errorMessage = JSON.stringify(error);
          } catch {
            /* Ignore */
          }
        }
        safeLog("error", `Error during ${context}: ${errorMessage}`);
        safeLog(
          "error",
          `Request for ${name} failed after ${Date.now() - startTime}ms`
        );
        return {
          content: [
            {
              type: "text",
              text: trimResponseText(
                `Search operation failed: ${errorMessage}`
              ),
            },
          ],
          isError: true,
          usage: {},
        };
      }
    }
  );
}
