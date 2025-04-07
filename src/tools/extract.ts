import {
  Tool,
  CallToolRequestSchema,
  CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { z } from "zod";
import { client, CONFIG } from "./client.js"; // Import CONFIG for isSelfHosted check
import {
  withRetry,
  updateCreditUsage,
  hasCredits,
  safeLog,
  trimResponseText,
} from "./utils.js";
import type { ExtractParams, ExtractResponse } from "@mendable/firecrawl-js"; // Type only import

// Tool definition from the reference repository
export const EXTRACT_TOOL: Tool = {
  name: "firecrawl_extract",
  description:
    "Extract structured information from web pages using LLM. " +
    "Supports both cloud AI and self-hosted LLM extraction.",
  inputSchema: {
    type: "object",
    properties: {
      urls: {
        type: "array",
        items: { type: "string" },
        description: "List of URLs to extract information from",
      },
      prompt: { type: "string", description: "Prompt for the LLM extraction" },
      systemPrompt: {
        type: "string",
        description: "System prompt for LLM extraction",
      },
      schema: {
        type: "object",
        description: "JSON schema for structured data extraction",
      },
      allowExternalLinks: {
        type: "boolean",
        description: "Allow extraction from external links",
      },
      enableWebSearch: {
        type: "boolean",
        description: "Enable web search for additional context",
      },
      includeSubdomains: {
        type: "boolean",
        description: "Include subdomains in extraction",
      },
      // origin is not part of the user-facing schema
    },
    required: ["urls"], // Only URLs are strictly required by the tool definition
  }, // Removed 'as ToolSchema' cast
  outputSchema: CallToolResultSchema,
};

// Type guard for extract arguments
// Define ExtractArgs locally based on inputSchema and ExtractParams
interface ExtractArgs {
  urls: string[];
  prompt?: string;
  systemPrompt?: string;
  schema?: object; // JSON schema is an object
  allowExternalLinks?: boolean;
  enableWebSearch?: boolean;
  includeSubdomains?: boolean;
  // origin?: string; // Internal parameter
}

function isExtractOptions(args: unknown): args is ExtractArgs {
  if (typeof args !== "object" || args === null) return false;
  const { urls } = args as { urls?: unknown };
  return (
    Array.isArray(urls) &&
    urls.every((url): url is string => typeof url === "string")
  );
}

export function registerExtractHandler(server: Server) {
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

      if (name !== EXTRACT_TOOL.name) {
        // Ignore calls for other tools
        return {
          content: [
            {
              type: "text",
              text: `Internal error: Extract handler received request for ${name}`,
            },
          ],
          isError: true,
          usage: {},
        };
      }

      const context = `extract ${isExtractOptions(args) ? args.urls.join(", ") : "invalid URLs"}`;
      safeLog("info", `Handling request for ${name}`);

      if (!isExtractOptions(args)) {
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

      // Check if self-hosted instance supports extraction
      if (CONFIG.apiUrl) {
        // Note: The reference repo checks for 'not supported' error *after* the API call.
        // We could add a preliminary check or warning here if needed, but will follow the repo's pattern for now.
        safeLog(
          "info",
          "Using self-hosted instance for extraction. Ensure LLM support is configured."
        );
      }

      try {
        const extractStartTime = Date.now();
        safeLog(
          "info",
          `Starting ${context} with prompt: ${args.prompt}, schema: ${args.schema ? "provided" : "not provided"}`
        );

        // Prepare parameters for client.extract
        // ExtractParamsを拡張した型を作成
        type ExtendedExtractParams = ExtractParams & {
          __experimental_stream?: boolean;
        };

        const params: ExtendedExtractParams = {
          prompt: args.prompt,
          systemPrompt: args.systemPrompt,
          schema: args.schema,
          allowExternalLinks: args.allowExternalLinks,
          enableWebSearch: args.enableWebSearch,
          includeSubdomains: args.includeSubdomains,
          origin: "mcp-server",
          __experimental_stream: false, // 明示的にストリーム処理を無効化
        };

        // Assuming client.extract exists and works as in the reference repo
        const extractResponse = await withRetry(
          () => client.extract(args.urls, params),
          context
        );

        safeLog(
          "info",
          `${context} completed in ${Date.now() - extractStartTime}ms`
        );

        // Type guard for successful response (adjust based on actual API response structure)
        // The reference repo uses a generic ExtractResponse<T>, assuming 'success' property exists.
        // Define a type for the expected error response structure
        interface ErrorResponse {
          success: false;
          error?: string;
        }
        if (
          !(
            typeof extractResponse === "object" &&
            extractResponse !== null &&
            "success" in extractResponse &&
            extractResponse.success
          )
        ) {
          const errorMsg =
            (extractResponse as ErrorResponse)?.error ||
            "Extraction failed with no specific error message";
          throw new Error(errorMsg);
        }

        const response = extractResponse as ExtractResponse; // Cast to expected successful response type

        // Monitor credits if applicable
        let creditsUsed: number | undefined = undefined;
        if (hasCredits(response)) {
          await updateCreditUsage(response.creditsUsed || 0); // Use 0 if creditsUsed is missing but expected
          creditsUsed = response.creditsUsed;
        }

        // Add warning if present
        if (response.warning) {
          safeLog("warning", `${context} warning: ${response.warning}`);
        }

        safeLog(
          "info",
          `Request for ${name} completed successfully in ${Date.now() - startTime}ms`
        );
        return {
          content: [
            {
              type: "text",
              // Stringify the extracted data for text output
              text: trimResponseText(JSON.stringify(response.data, null, 2)),
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

        // Special handling for self-hosted instance errors as in reference repo
        if (
          CONFIG.apiUrl &&
          errorMessage.toLowerCase().includes("not supported")
        ) {
          safeLog(
            "error",
            `Extraction is not supported by this self-hosted instance: ${CONFIG.apiUrl}`
          );
          errorMessage =
            "Extraction is not supported by this self-hosted instance. Please ensure LLM support is configured.";
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
              text: trimResponseText(`Extraction failed: ${errorMessage}`),
            },
          ],
          isError: true,
          usage: {},
        };
      }
    }
  );
}
