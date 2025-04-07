import {
  Tool,
  ToolSchema,
  CallToolRequestSchema,
  CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { z } from "zod";
import { client } from "./client.js";
import { withRetry, safeLog, trimResponseText } from "./utils.js";
import type { MapParams } from "@mendable/firecrawl-js"; // Type only import

// Tool definition from the reference repository
export const MAP_TOOL: Tool = {
  name: "firecrawl_map",
  description:
    "Discover URLs from a starting point. Can use both sitemap.xml and HTML link discovery.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Starting URL for URL discovery" },
      search: {
        type: "string",
        description: "Optional search term to filter URLs",
      },
      ignoreSitemap: {
        type: "boolean",
        description: "Skip sitemap.xml discovery and only use HTML links",
      },
      sitemapOnly: {
        type: "boolean",
        description: "Only use sitemap.xml for discovery, ignore HTML links",
      },
      includeSubdomains: {
        type: "boolean",
        description: "Include URLs from subdomains in results",
      },
      limit: {
        type: "number",
        description: "Maximum number of URLs to return",
      },
    },
    required: ["url"],
  }, // Removed 'as ToolSchema' cast
  outputSchema: CallToolResultSchema as any,
};

// Type guard for map arguments
function isMapOptions(args: unknown): args is MapParams & { url: string } {
  return (
    typeof args === "object" &&
    args !== null &&
    "url" in args &&
    typeof (args as { url: unknown }).url === "string"
  );
}

export function registerMapHandler(server: Server) {
  server.setRequestHandler(
    CallToolRequestSchema, // Schema first
    async (
      request: z.infer<typeof CallToolRequestSchema>
    ): Promise<z.infer<typeof CallToolResultSchema>> => {
      const startTime = Date.now();
      const { name, arguments: args } = request.params;

      if (name !== MAP_TOOL.name) {
        // Ignore calls for other tools in this specific handler
        // This assumes the SDK might call this handler even if the name doesn't match,
        // or that we might register this handler more broadly later.
        return {
          content: [
            {
              type: "text",
              text: `Internal error: Map handler received request for ${name}`,
            },
          ],
          isError: true,
          usage: {},
        };
      }

      const context = `map ${isMapOptions(args) ? args.url : "invalid URL"}`;
      safeLog("info", `Handling request for ${name}`);

      if (!isMapOptions(args)) {
        safeLog(
          "error",
          `Invalid arguments for ${name}: ${JSON.stringify(args)}`
        );
        return {
          content: [
            {
              type: "text",
              text: "Invalid arguments: Missing or invalid URL.",
            },
          ],
          isError: true,
          usage: {},
        };
      }

      const { url, ...options } = args;

      try {
        const mapStartTime = Date.now();
        safeLog(
          "info",
          `Starting ${context} with options: ${JSON.stringify(options)}`
        );

        const response = await withRetry(
          () =>
            client.mapUrl(url, {
              ...options,
              // @ts-expect-error Extended API options including origin
              origin: "mcp-server",
            }),
          context
        );

        safeLog(
          "info",
          `${context} completed in ${Date.now() - mapStartTime}ms`
        );

        if ("error" in response) {
          throw new Error(response.error || "Map operation failed");
        }
        if (!response.links || !Array.isArray(response.links)) {
          // Handle cases where links might be missing or not an array
          safeLog("warning", `${context} did not return a valid links array.`);
          return {
            content: [
              {
                type: "text",
                text: "No links found or invalid response from API.",
              },
            ],
            isError: false, // Not necessarily an error, could be no links found
            usage: {},
          };
        }

        safeLog(
          "info",
          `Request for ${name} completed successfully in ${Date.now() - startTime}ms`
        );
        return {
          content: [
            { type: "text", text: trimResponseText(response.links.join("\n")) },
          ],
          isError: false,
          usage: {}, // Map operation typically doesn't consume credits like scrape
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
              text: trimResponseText(`Map operation failed: ${errorMessage}`),
            },
          ],
          isError: true,
          usage: {},
        };
      }
    }
  );
}
