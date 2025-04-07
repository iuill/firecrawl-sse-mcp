import {
  Tool,
  CallToolRequestSchema,
  CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { z } from "zod";
import { client } from "./client.js";
import { withRetry, safeLog, trimResponseText } from "./utils.js";
// Note: Deep research might not have explicit credit usage reporting in the same way as scrape.

// Tool definition from the reference repository
export const DEEP_RESEARCH_TOOL: Tool = {
  name: "firecrawl_deep_research",
  description:
    "Conduct deep research on a query using web crawling, search, and AI analysis.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The query to research" },
      maxDepth: {
        type: "number",
        description: "Maximum depth of research iterations (1-10)",
      },
      timeLimit: {
        type: "number",
        description: "Time limit in seconds (30-300)",
      },
      maxUrls: {
        type: "number",
        description: "Maximum number of URLs to analyze (1-1000)",
      },
      // origin is not part of the user-facing schema
    },
    required: ["query"],
  }, // Removed 'as ToolSchema' cast
  outputSchema: CallToolResultSchema,
};

// Type guard for deep research arguments
interface DeepResearchArgs {
  query: string;
  maxDepth?: number;
  timeLimit?: number;
  maxUrls?: number;
  // origin?: string; // Internal parameter
}

function isDeepResearchOptions(args: unknown): args is DeepResearchArgs {
  return (
    typeof args === "object" &&
    args !== null &&
    "query" in args &&
    typeof (args as { query: unknown }).query === "string"
  );
}

export function registerDeepResearchHandler(server: Server) {
  server.setRequestHandler(
    CallToolRequestSchema, // Schema first
    async (
      request: z.infer<typeof CallToolRequestSchema>
    ): Promise<z.infer<typeof CallToolResultSchema>> => {
      const startTime = Date.now();
      const { name, arguments: args } = request.params;

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

      if (name !== DEEP_RESEARCH_TOOL.name) {
        // Ignore calls for other tools
        return {
          content: [
            {
              type: "text",
              text: `Internal error: Deep research handler received request for ${name}`,
            },
          ],
          isError: true,
          usage: {},
        };
      }

      const context = `deep_research ${isDeepResearchOptions(args) ? args.query : "invalid query"}`;
      safeLog("info", `Handling request for ${name}`);

      if (!isDeepResearchOptions(args)) {
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
        const researchStartTime = Date.now();
        safeLog(
          "info",
          `Starting ${context} with options: ${JSON.stringify(options)}`
        );

        // Assuming client.deepResearch exists and works as in the reference repo
        // Including activity and source callbacks
        const response = await withRetry(
          () =>
            client.deepResearch(
              query,
              {
                maxDepth: options.maxDepth,
                timeLimit: options.timeLimit,
                maxUrls: options.maxUrls,
                // @ts-expect-error Extended API options including origin
                origin: "mcp-server",
              },
              // Activity callback
              (activity) => {
                safeLog(
                  "info",
                  `Research activity: ${activity.message} (Depth: ${activity.depth})`
                );
              },
              // Source callback
              (source) => {
                safeLog(
                  "info",
                  `Research source found: ${source.url}${source.title ? ` - ${source.title}` : ""}`
                );
              }
            ),
          context
        );

        safeLog(
          "info",
          `${context} completed in ${Date.now() - researchStartTime}ms`
        );

        if (!response.success) {
          throw new Error(response.error || "Deep research operation failed");
        }

        // Format the results (focus on finalAnalysis as per reference repo)
        const formattedResponse = {
          finalAnalysis: response.data.finalAnalysis,
          // Optionally include activities and sources if needed, but keep response concise
          // activities: response.data.activities,
          // sources: response.data.sources,
        };

        safeLog(
          "info",
          `Request for ${name} completed successfully in ${Date.now() - startTime}ms`
        );
        return {
          content: [
            {
              type: "text",
              text: trimResponseText(
                formattedResponse.finalAnalysis ||
                  "Deep research completed, but no final analysis was provided."
              ),
            },
          ],
          isError: false,
          usage: {}, // Deep research credit usage might be complex or not reported per call
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
              text: trimResponseText(`Deep research failed: ${errorMessage}`),
            },
          ],
          isError: true,
          usage: {},
        };
      }
    }
  );
}
