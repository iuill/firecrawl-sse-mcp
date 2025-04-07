import {
  Tool,
  ToolSchema, // Changed from ToolInputSchema
  CallToolRequestSchema,
  CallToolResultSchema, // Changed from CallToolResponseSchema
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
import type { ScrapeParams } from "@mendable/firecrawl-js"; // Type only import

// Tool definition from the reference repository
export const SCRAPE_TOOL: Tool = {
  name: "firecrawl_scrape",
  description:
    "Scrape a single webpage with advanced options for content extraction. " +
    "Supports various formats including markdown, HTML, and screenshots. " +
    "Can execute custom actions like clicking or scrolling before scraping.",
  inputSchema: {
    // Changed from input_schema
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to scrape" },
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
        default: ["markdown"],
        description: "Content formats to extract (default: ['markdown'])",
      },
      onlyMainContent: {
        type: "boolean",
        description:
          "Extract only the main content, filtering out navigation, footers, etc.",
      },
      includeTags: {
        type: "array",
        items: { type: "string" },
        description: "HTML tags to specifically include in extraction",
      },
      excludeTags: {
        type: "array",
        items: { type: "string" },
        description: "HTML tags to exclude from extraction",
      },
      waitFor: {
        type: "number",
        description: "Time in milliseconds to wait for dynamic content to load",
      },
      timeout: {
        type: "number",
        description:
          "Maximum time in milliseconds to wait for the page to load",
      },
      actions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: [
                "wait",
                "click",
                "screenshot",
                "write",
                "press",
                "scroll",
                "scrape",
                "executeJavascript",
              ],
              description: "Type of action to perform",
            },
            selector: {
              type: "string",
              description: "CSS selector for the target element",
            },
            milliseconds: {
              type: "number",
              description: "Time to wait in milliseconds (for wait action)",
            },
            text: {
              type: "string",
              description: "Text to write (for write action)",
            },
            key: {
              type: "string",
              description: "Key to press (for press action)",
            },
            direction: {
              type: "string",
              enum: ["up", "down"],
              description: "Scroll direction",
            },
            script: {
              type: "string",
              description: "JavaScript code to execute",
            },
            fullPage: {
              type: "boolean",
              description: "Take full page screenshot",
            },
          },
          required: ["type"],
        },
        description: "List of actions to perform before scraping",
      },
      extract: {
        type: "object",
        properties: {
          schema: {
            type: "object",
            description: "Schema for structured data extraction",
          },
          systemPrompt: {
            type: "string",
            description: "System prompt for LLM extraction",
          },
          prompt: {
            type: "string",
            description: "User prompt for LLM extraction",
          },
        },
        description: "Configuration for structured data extraction",
      },
      mobile: { type: "boolean", description: "Use mobile viewport" },
      skipTlsVerification: {
        type: "boolean",
        description: "Skip TLS certificate verification",
      },
      removeBase64Images: {
        type: "boolean",
        description: "Remove base64 encoded images from output",
      },
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
        description: "Location settings for scraping",
      },
    },
    required: ["url"],
  }, // Removed 'as ToolSchema' cast
  // Output schema based on CallToolResultSchema
  outputSchema: CallToolResultSchema as any, // Keep cast for outputSchema for now
};

// Type guard for scrape arguments
function isScrapeOptions(
  args: unknown
): args is ScrapeParams & { url: string } {
  return (
    typeof args === "object" &&
    args !== null &&
    "url" in args &&
    typeof (args as { url: unknown }).url === "string"
  );
}

export function registerScrapeHandler(server: Server) {
  // Use the pattern from the reference repo: Schema first, then handler.
  // The handler will need to check the tool name internally.
  server.setRequestHandler(
    CallToolRequestSchema, // Schema first
    async (
      request: z.infer<typeof CallToolRequestSchema>
    ): Promise<z.infer<typeof CallToolResultSchema>> => {
      // Type the request based on the schema
      const startTime = Date.now(); // Declare startTime here

      // Request is already validated by the SDK if schema is provided first.
      const { name, arguments: args } = request.params; // Get name and args

      // Check if this handler is for the scrape tool
      if (name !== SCRAPE_TOOL.name) {
        // This handler should only process scrape requests.
        safeLog(
          "warning",
          `Scrape handler received request for unexpected tool: ${name}`
        );
        return {
          content: [
            {
              type: "text",
              text: `Internal error: Scrape handler received request for ${name}`,
            },
          ],
          isError: true,
          usage: {},
        };
      }

      let context = `scrape ${isScrapeOptions(args) ? args.url : "invalid URL"}`;
      safeLog("info", `Handling request for ${name}`); // Use name variable

      if (!isScrapeOptions(args)) {
        safeLog(
          "error",
          `Invalid arguments for ${name}: ${JSON.stringify(args)}` // Use name variable
        );
        // Return type should match CallToolResultSchema
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
        const scrapeStartTime = Date.now();
        // Re-assign context if needed based on validated args inside try
        context = `scrape ${args.url}`; // Ensure context uses the validated URL
        safeLog(
          "info",
          `Starting ${context} with options: ${JSON.stringify(options)}`
        );

        const paramsWithOptions: ScrapeParams = {
          ...options,
          // origin is not part of ScrapeParams, handle potential extension if needed
          // origin: 'mcp-server',
        };

        const response = await withRetry(
          () => client.scrapeUrl(url, paramsWithOptions),
          context
        );

        safeLog(
          "info",
          `${context} completed in ${Date.now() - scrapeStartTime}ms`
        );

        if ("success" in response && !response.success) {
          throw new Error(
            response.error || "Scraping failed with no specific error message"
          );
        }

        // Format content based on requested formats
        const contentParts: string[] = [];
        let requestedFormats = options.formats || ["markdown"]; // Default to markdown if not specified
        if (requestedFormats.length === 0) requestedFormats = ["markdown"]; // Ensure default if empty array

        if (requestedFormats.includes("markdown") && response.markdown) {
          contentParts.push(`## Markdown Content\n\n${response.markdown}`);
        }
        if (requestedFormats.includes("html") && response.html) {
          contentParts.push(`## HTML Content\n\n${response.html}`);
        }
        if (requestedFormats.includes("rawHtml") && response.rawHtml) {
          contentParts.push(`## Raw HTML Content\n\n${response.rawHtml}`);
        }
        if (requestedFormats.includes("links") && response.links) {
          contentParts.push(`## Links\n\n${response.links.join("\n")}`);
        }
        if (requestedFormats.includes("screenshot") && response.screenshot) {
          // Indicate screenshot presence, don't include base64 in text response
          contentParts.push(
            `## Screenshot\n\n[Screenshot data included in response]`
          );
        }
        if (
          requestedFormats.includes("screenshot@fullPage") &&
          response.screenshot
        ) {
          // Indicate screenshot presence, don't include base64 in text response
          contentParts.push(
            `## Full Page Screenshot\n\n[Screenshot data included in response]`
          );
        }
        if (requestedFormats.includes("extract") && response.extract) {
          contentParts.push(
            `## Extracted Data\n\n${JSON.stringify(response.extract, null, 2)}`
          );
        }

        const combinedContent =
          contentParts.join("\n\n---\n\n") ||
          "No content available for the requested formats.";

        // Handle credits
        let creditsUsed: number | undefined = undefined;
        if (hasCredits(response)) {
          await updateCreditUsage(response.creditsUsed);
          creditsUsed = response.creditsUsed;
        }

        // Add warning if present
        if (response.warning) {
          safeLog("warning", `${context} warning: ${response.warning}`);
          // Optionally include warning in the response text
          // combinedContent += `\n\n**Warning:** ${response.warning}`;
        }

        safeLog(
          "info",
          `Request for ${name} completed successfully in ${Date.now() - startTime}ms` // Use name variable
        );
        // Return type should match CallToolResultSchema
        return {
          content: [
            { type: "text", text: trimResponseText(combinedContent) },
            ...(response.screenshot
              ? [
                  {
                    type: "image" as const, // Explicitly set as literal type
                    mimeType: "image/png", // Changed from media_type
                    data: response.screenshot,
                  },
                ]
              : []),
          ],
          isError: false,
          usage: {
            credits: creditsUsed,
            // Add other usage metrics if available
          }, // Correctly close the usage object
        }; // Correctly close the return object
      } catch (error) {
        // Safely get error message from unknown type
        let errorMessage = "An unknown error occurred";
        if (error instanceof Error) {
          // Access message safely after type check
          errorMessage = error.message;
        } else if (typeof error === "string") {
          errorMessage = error;
        } else {
          try {
            errorMessage = JSON.stringify(error);
          } catch {
            // Ignore stringify errors
          }
        }
        safeLog("error", `Error during ${context}: ${errorMessage}`);
        safeLog(
          "error",
          `Request for ${name} failed after ${Date.now() - startTime}ms` // Use name variable, startTime should be accessible here
        );
        // Return type should match CallToolResultSchema
        return {
          content: [
            {
              type: "text",
              text: trimResponseText(`Scraping failed: ${errorMessage}`),
            },
          ],
          isError: true,
          usage: {},
        };
      }
    }
  );
}
