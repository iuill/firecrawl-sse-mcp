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
  safeLog,
  trimResponseText,
  formatResults,
} from "./utils.js"; // formatResults をインポート
import type { FirecrawlDocument } from "@mendable/firecrawl-js"; // 型のみインポート

// Tool definition from the reference repository
export const CHECK_CRAWL_STATUS_TOOL: Tool = {
  name: "firecrawl_check_crawl_status",
  description: "Check the status of a crawl job.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Crawl job ID to check" },
    },
    required: ["id"],
  }, // Removed 'as ToolSchema' cast
  outputSchema: CallToolResultSchema as any,
};

// Type guard for status check arguments
interface StatusCheckOptions {
  id: string;
}

function isStatusCheckOptions(args: unknown): args is StatusCheckOptions {
  return (
    typeof args === "object" &&
    args !== null &&
    "id" in args &&
    typeof (args as { id: unknown }).id === "string"
  );
}

export function registerCrawlStatusHandler(server: Server) {
  server.setRequestHandler(
    CallToolRequestSchema, // Schema first
    async (
      request: z.infer<typeof CallToolRequestSchema>
    ): Promise<z.infer<typeof CallToolResultSchema>> => {
      const startTime = Date.now();
      const { name, arguments: args } = request.params;

      if (name !== CHECK_CRAWL_STATUS_TOOL.name) {
        // Ignore calls for other tools
        return {
          content: [
            {
              type: "text",
              text: `Internal error: Crawl status handler received request for ${name}`,
            },
          ],
          isError: true,
          usage: {},
        };
      }

      const context = `check_crawl_status ${isStatusCheckOptions(args) ? args.id : "invalid ID"}`;
      safeLog("info", `Handling request for ${name}`);

      if (!isStatusCheckOptions(args)) {
        safeLog(
          "error",
          `Invalid arguments for ${name}: ${JSON.stringify(args)}`
        );
        return {
          content: [
            {
              type: "text",
              text: "Invalid arguments: Missing or invalid 'id'.",
            },
          ],
          isError: true,
          usage: {},
        };
      }

      try {
        const checkStartTime = Date.now();
        safeLog("info", `Starting ${context}`);

        // Assuming client.checkCrawlStatus exists and works as in the reference repo
        const response = await withRetry(
          () => client.checkCrawlStatus(args.id),
          context
        );

        safeLog(
          "info",
          `${context} completed in ${Date.now() - checkStartTime}ms`
        );

        if (!response.success) {
          // Handle potential failure in checking status
          throw new Error(response.error || "Failed to check crawl status");
        }

        // Format the status message including results if available
        const status = `Crawl Job ID: ${args.id}\nStatus: ${response.status}\nProgress: ${response.completed}/${response.total} pages crawled\nCredits Used: ${response.creditsUsed ?? "N/A"}\nExpires At: ${response.expiresAt ?? "N/A"}`;

        let resultsText = "";
        if (response.data && response.data.length > 0) {
          // Format results using the utility function
          resultsText = `\n\nResults Summary:\n${formatResults(response.data as FirecrawlDocument[])}`;
        } else if (response.status === "completed") {
          resultsText = "\n\nNo data returned for completed crawl.";
        }

        safeLog(
          "info",
          `Request for ${name} (ID: ${args.id}) completed successfully in ${Date.now() - startTime}ms`
        );
        return {
          content: [
            { type: "text", text: trimResponseText(status + resultsText) },
          ],
          isError: false,
          usage: {
            credits: response.creditsUsed, // Include credits used if available
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
                `Check crawl status failed: ${errorMessage}`
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
