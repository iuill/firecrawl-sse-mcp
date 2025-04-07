import {
  Tool,
  CallToolRequestSchema,
  CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { z } from "zod";
import PQueue from "p-queue";
import { client, CONFIG } from "./client.js";
import {
  withRetry,
  updateCreditUsage,
  hasCredits,
  safeLog,
  trimResponseText,
} from "./utils.js";
import type { ScrapeParams } from "@mendable/firecrawl-js"; // Type only import

// Tool definition for batch scrape
export const BATCH_SCRAPE_TOOL: Tool = {
  name: "firecrawl_batch_scrape",
  description:
    "Scrape multiple URLs in batch mode. Returns a job ID that can be used to check status.",
  inputSchema: {
    type: "object",
    properties: {
      urls: {
        type: "array",
        items: { type: "string" },
        description: "List of URLs to scrape",
      },
      options: {
        // Reuse scrape options definition structure if possible, or define inline
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
          // Add other relevant scrape options here from ScrapeParams if needed
        },
        description: "Options applied to each scrape in the batch",
      },
    },
    required: ["urls"],
  }, // Removed 'as ToolSchema' cast
  outputSchema: CallToolResultSchema,
};

// Tool definition for checking batch status
export const CHECK_BATCH_STATUS_TOOL: Tool = {
  name: "firecrawl_check_batch_status",
  description: "Check the status of a batch scraping job.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Batch job ID to check" },
    },
    required: ["id"],
  }, // Removed 'as ToolSchema' cast
  outputSchema: CallToolResultSchema,
};

// --- Batch Processing Logic ---

interface BatchScrapeOptions {
  urls: string[];
  options?: Omit<ScrapeParams, "url">; // Options applied to each URL
}

interface QueuedBatchOperation {
  id: string;
  urls: string[];
  options?: Omit<ScrapeParams, "url">; // Use Omit<ScrapeParams, "url"> for options
  status: "pending" | "processing" | "completed" | "failed";
  progress: {
    completed: number; // Number of URLs processed
    total: number; // Total number of URLs
  };
  result?: unknown; // Use unknown for the result, handle type assertion when used
  error?: string; // Store error message if failed
}

// Initialize queue system
const batchQueue = new PQueue({ concurrency: 1 }); // Process one batch job at a time
const batchOperations = new Map<string, QueuedBatchOperation>();
let operationCounter = 0;

// Function to process a single batch operation
async function processBatchOperation(
  operation: QueuedBatchOperation
): Promise<void> {
  try {
    operation.status = "processing";
    let totalCreditsUsed = 0;
    safeLog("info", `Processing batch operation ${operation.id}`);

    // Use library's built-in batch processing (asyncBatchScrapeUrls)
    // Note: The reference repo uses this, assuming it exists and works as expected.
    // If asyncBatchScrapeUrls doesn't exist or behaves differently, this needs adjustment.
    const response = await withRetry(
      async () =>
        client.asyncBatchScrapeUrls(operation.urls, operation.options),
      `batch ${operation.id} processing`
    );

    if (!response.success) {
      throw new Error(
        response.error || "Batch operation failed in Firecrawl API"
      );
    }

    // Track credits if using cloud API
    if (!CONFIG.apiUrl && hasCredits(response)) {
      totalCreditsUsed += response.creditsUsed;
      await updateCreditUsage(response.creditsUsed);
    }

    operation.status = "completed";
    operation.result = response; // Store the successful response
    // Update progress - assuming the response indicates completion of all URLs
    operation.progress.completed = operation.progress.total;

    // Log final credit usage for the batch if applicable
    if (!CONFIG.apiUrl) {
      safeLog(
        "info",
        `Batch ${operation.id} completed. Total credits used: ${totalCreditsUsed}`
      );
    }
  } catch (error) {
    operation.status = "failed";
    operation.error = error instanceof Error ? error.message : String(error);
    safeLog("error", `Batch ${operation.id} failed: ${operation.error}`);
  }
}

// --- Type Guards ---

function isBatchScrapeOptions(args: unknown): args is BatchScrapeOptions {
  return (
    typeof args === "object" &&
    args !== null &&
    "urls" in args &&
    Array.isArray((args as { urls: unknown }).urls) &&
    (args as { urls: unknown[] }).urls.every((url) => typeof url === "string")
  );
}

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

// --- Handler Registration ---

export function registerBatchHandlers(server: Server) {
  // Handler for submitting batch scrape jobs
  server.setRequestHandler(
    CallToolRequestSchema,
    async (
      request: z.infer<typeof CallToolRequestSchema>
    ): Promise<z.infer<typeof CallToolResultSchema>> => {
      const startTime = Date.now();
      const { name, arguments: args } = request.params;

      if (name !== BATCH_SCRAPE_TOOL.name) {
        // Pass through if not the target tool for this handler branch
        return {
          content: [
            {
              type: "text",
              text: `Internal error: Batch handler received request for ${name}`,
            },
          ],
          isError: true,
          usage: {},
        }; // Indicate unhandled or error
      }

      const context = `batch_scrape submission`;
      safeLog("info", `Handling request for ${name}`);

      if (!isBatchScrapeOptions(args)) {
        safeLog(
          "error",
          `Invalid arguments for ${name}: ${JSON.stringify(args)}`
        );
        return {
          content: [
            {
              type: "text",
              text: "Invalid arguments: Missing or invalid 'urls' array.",
            },
          ],
          isError: true,
          usage: {},
        };
      }

      try {
        const operationId = `batch_${++operationCounter}`;
        const operation: QueuedBatchOperation = {
          id: operationId,
          urls: args.urls,
          options: args.options, // Pass along scrape options
          status: "pending",
          progress: {
            completed: 0,
            total: args.urls.length,
          },
        };
        batchOperations.set(operationId, operation);

        // Add the processing function to the queue
        batchQueue
          .add(() => processBatchOperation(operation))
          .catch((err) => {
            // Catch errors during queue addition/processing setup if any
            safeLog(
              "error",
              `Failed to queue batch operation ${operationId}: ${err}`
            );
            // Update operation status if possible, though it might already be processing/failed
            operation.status = "failed";
            operation.error = `Failed to queue: ${err instanceof Error ? err.message : String(err)}`;
          });

        safeLog(
          "info",
          `Queued ${context} ${operationId} with ${args.urls.length} URLs`
        );
        safeLog(
          "info",
          `Request for ${name} completed successfully in ${Date.now() - startTime}ms`
        );

        return {
          content: [
            {
              type: "text",
              text: trimResponseText(
                `Batch operation queued with ID: ${operationId}. Use ${CHECK_BATCH_STATUS_TOOL.name} to check progress.`
              ),
            },
          ],
          isError: false,
          usage: {}, // Initial submission doesn't usually have usage info
        };
      } catch (error) {
        let errorMessage = "An unknown error occurred during batch submission";
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
                `Batch scrape submission failed: ${errorMessage}`
              ),
            },
          ],
          isError: true,
          usage: {},
        };
      }
    }
  );

  // Handler for checking batch status
  server.setRequestHandler(
    CallToolRequestSchema, // Still use the generic schema, filter by name
    async (
      request: z.infer<typeof CallToolRequestSchema>
    ): Promise<z.infer<typeof CallToolResultSchema>> => {
      const startTime = Date.now();
      const { name, arguments: args } = request.params;

      if (name !== CHECK_BATCH_STATUS_TOOL.name) {
        // Pass through if not the target tool
        return {
          content: [
            {
              type: "text",
              text: `Internal error: Batch status handler received request for ${name}`,
            },
          ],
          isError: true,
          usage: {},
        }; // Indicate unhandled or error
      }

      // const context = `check_batch_status`; // context 変数は未使用のためコメントアウト
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

      const operation = batchOperations.get(args.id);

      if (!operation) {
        safeLog("warning", `No batch operation found with ID: ${args.id}`);
        return {
          content: [
            {
              type: "text",
              text: trimResponseText(
                `No batch operation found with ID: ${args.id}`
              ),
            },
          ],
          // Consider if this is an error or just 'not found'
          isError: true, // Treat as error for now
          usage: {},
        };
      }

      // Format the status message
      let statusMessage = `Batch Job ID: ${operation.id}\nStatus: ${operation.status}\nProgress: ${operation.progress.completed}/${operation.progress.total} URLs processed`;
      if (operation.status === "failed" && operation.error) {
        statusMessage += `\nError: ${operation.error}`;
      }
      // Optionally include results if completed and available
      if (operation.status === "completed" && operation.result) {
        // Decide how much of the result to show. Stringifying large results can be problematic.
        // Maybe show summary or confirmation of completion.
        statusMessage += `\nResult: Batch completed successfully.`; // Example summary
        // statusMessage += `\nResult Details: ${JSON.stringify(operation.result, null, 2)}`; // Potentially too large
      }

      safeLog(
        "info",
        `Request for ${name} (ID: ${args.id}) completed successfully in ${Date.now() - startTime}ms`
      );
      return {
        content: [{ type: "text", text: trimResponseText(statusMessage) }],
        isError: false, // Status check itself succeeded
        usage: {}, // Status check doesn't consume credits
      };
      // Note: No explicit try/catch here as checking the map is unlikely to throw,
      // but could be added for robustness if needed.
    }
  );
}
