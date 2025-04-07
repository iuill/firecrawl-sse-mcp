import {
  Tool,
  ToolSchema,
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
import type { CrawlParams } from "@mendable/firecrawl-js"; // Type only import

// Tool definition from the reference repository
export const CRAWL_TOOL: Tool = {
  name: "firecrawl_crawl",
  description:
    "Start an asynchronous crawl of multiple pages from a starting URL. " +
    "Supports depth control, path filtering, and webhook notifications.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Starting URL for the crawl" },
      excludePaths: {
        type: "array",
        items: { type: "string" },
        description: "URL paths to exclude from crawling",
      },
      includePaths: {
        type: "array",
        items: { type: "string" },
        description: "Only crawl these URL paths",
      },
      maxDepth: { type: "number", description: "Maximum link depth to crawl" },
      ignoreSitemap: {
        type: "boolean",
        description: "Skip sitemap.xml discovery",
      },
      limit: {
        type: "number",
        description: "Maximum number of pages to crawl",
      },
      allowBackwardLinks: {
        type: "boolean",
        description: "Allow crawling links that point to parent directories",
      },
      allowExternalLinks: {
        type: "boolean",
        description: "Allow crawling links to external domains",
      },
      webhook: {
        oneOf: [
          {
            type: "string",
            description: "Webhook URL to notify when crawl is complete",
          },
          {
            type: "object",
            properties: {
              url: { type: "string", description: "Webhook URL" },
              headers: {
                type: "object",
                description: "Custom headers for webhook requests",
              },
            },
            required: ["url"],
          },
        ],
      },
      deduplicateSimilarURLs: {
        type: "boolean",
        description: "Remove similar URLs during crawl",
      },
      ignoreQueryParameters: {
        type: "boolean",
        description: "Ignore query parameters when comparing URLs",
      },
      scrapeOptions: {
        type: "object",
        properties: {
          formats: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "markdown",
                "html",
                "rawHtml",
                "screenshot",
                "links",
                "screenshot@fullPage",
                "extract",
              ],
            },
          },
          onlyMainContent: { type: "boolean" },
          includeTags: { type: "array", items: { type: "string" } },
          excludeTags: { type: "array", items: { type: "string" } },
          waitFor: { type: "number" },
        },
        description: "Options for scraping each page",
      },
    },
    required: ["url"],
  }, // Removed 'as ToolSchema' cast
  outputSchema: CallToolResultSchema as any,
};

// Type guard for crawl arguments
function isCrawlOptions(args: unknown): args is CrawlParams & { url: string } {
  return (
    typeof args === "object" &&
    args !== null &&
    "url" in args &&
    typeof (args as { url: unknown }).url === "string"
  );
}

export function registerCrawlHandler(server: Server) {
  server.setRequestHandler(
    CallToolRequestSchema, // Schema first
    async (
      request: z.infer<typeof CallToolRequestSchema>
    ): Promise<z.infer<typeof CallToolResultSchema>> => {
      const startTime = Date.now();
      const { name, arguments: args } = request.params;

      if (name !== CRAWL_TOOL.name) {
        // Ignore calls for other tools
        return {
          content: [
            {
              type: "text",
              text: `Internal error: Crawl handler received request for ${name}`,
            },
          ],
          isError: true,
          usage: {},
        };
      }

      const context = `crawl ${isCrawlOptions(args) ? args.url : "invalid URL"}`;
      safeLog("info", `Handling request for ${name}`);

      if (!isCrawlOptions(args)) {
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
        const crawlStartTime = Date.now();
        safeLog(
          "info",
          `Starting ${context} with options: ${JSON.stringify(options)}`
        );

        const response = await withRetry(
          // @ts-expect-error Extended API options including origin
          () => client.asyncCrawlUrl(url, { ...options, origin: "mcp-server" }),
          context
        );

        safeLog(
          "info",
          `${context} started successfully in ${Date.now() - crawlStartTime}ms`
        );

        if (!response.success) {
          // Handle potential failure in starting the crawl
          throw new Error(response.error || "Failed to start crawl job");
        }

        // Monitor credits if applicable (though asyncCrawlUrl might not return credits directly)
        if (hasCredits(response)) {
          await updateCreditUsage(response.creditsUsed);
        }

        safeLog(
          "info",
          `Request for ${name} completed successfully in ${Date.now() - startTime}ms`
        );
        return {
          content: [
            {
              type: "text",
              text: trimResponseText(
                `Started crawl for ${url} with job ID: ${response.id}. Use firecrawl_check_crawl_status to check progress.`
              ),
            },
          ],
          isError: false,
          usage: {
            // Credits might be returned by check_crawl_status instead
            credits: hasCredits(response) ? response.creditsUsed : undefined,
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
              text: trimResponseText(`Crawl operation failed: ${errorMessage}`),
            },
          ],
          isError: true,
          usage: {},
        };
      }
    }
  );
}
