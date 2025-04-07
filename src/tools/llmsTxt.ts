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
// Assuming GenerateLLMsTextParams and response types might be available or need local definition
// import type { GenerateLLMsTextParams, GenerateLLMsTextResponse } from '@mendable/firecrawl-js';

// Tool definition from the reference repository
export const GENERATE_LLMSTXT_TOOL: Tool = {
  name: "firecrawl_generate_llmstxt",
  description:
    "Generate standardized LLMs.txt file for a given URL, which provides context about how LLMs should interact with the website.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to generate LLMs.txt from" },
      maxUrls: {
        type: "number",
        description: "Maximum number of URLs to process (1-100, default: 10)",
      },
      showFullText: {
        type: "boolean",
        description: "Whether to show the full LLMs-full.txt in the response",
      },
      // __experimental_stream is likely internal and not part of user schema
      // origin is not part of the user-facing schema
    },
    required: ["url"],
  }, // Removed 'as ToolSchema' cast
  outputSchema: CallToolResultSchema as any,
};

// Define local interfaces based on reference repo comments if not exported by library
interface GenerateLLMsTextParams {
  maxUrls?: number;
  showFullText?: boolean;
  __experimental_stream?: boolean; // Keep if needed by client.generateLLMsText
  origin?: string; // Internal parameter
}

// Assuming the response structure based on reference repo handler logic
interface GenerateLLMsTextApiResponse {
  success: boolean;
  data?: {
    llmstxt: string;
    llmsfulltxt?: string;
  };
  error?: string;
  // id might be part of the response if it's async, but handler treats it as sync
}

// Type guard for generate LLMs.txt arguments
interface GenerateLLMsTextArgs {
  url: string;
  maxUrls?: number;
  showFullText?: boolean;
  // origin?: string; // Internal parameter
}

function isGenerateLLMsTextOptions(
  args: unknown
): args is GenerateLLMsTextArgs {
  return (
    typeof args === "object" &&
    args !== null &&
    "url" in args &&
    typeof (args as { url: unknown }).url === "string"
  );
}

export function registerGenerateLLMsTxtHandler(server: Server) {
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

      if (name !== GENERATE_LLMSTXT_TOOL.name) {
        // Ignore calls for other tools
        return {
          content: [
            {
              type: "text",
              text: `Internal error: LLMs.txt handler received request for ${name}`,
            },
          ],
          isError: true,
          usage: {},
        };
      }

      const context = `generate_llmstxt ${isGenerateLLMsTextOptions(args) ? args.url : "invalid URL"}`;
      safeLog("info", `Handling request for ${name}`);

      if (!isGenerateLLMsTextOptions(args)) {
        safeLog(
          "error",
          `Invalid arguments for ${name}: ${JSON.stringify(args)}`
        );
        return {
          content: [
            {
              type: "text",
              text: "Invalid arguments: Missing or invalid 'url'.",
            },
          ],
          isError: true,
          usage: {},
        };
      }

      const { url, ...options } = args;

      try {
        const generateStartTime = Date.now();
        safeLog(
          "info",
          `Starting ${context} with options: ${JSON.stringify(options)}`
        );

        // Prepare parameters for client.generateLLMsText
        const params: GenerateLLMsTextParams = {
          maxUrls: options.maxUrls,
          showFullText: options.showFullText,
          // origin: 'mcp-server', // Keep origin commented out or handle if needed
          origin: "mcp-server",
          // Include __experimental_stream if needed by the client method
        };

        // Assuming client.generateLLMsText exists and works as in the reference repo
        const response = (await withRetry(
          () => client.generateLLMsText(url, params),
          context
        )) as GenerateLLMsTextApiResponse; // Cast to expected response type

        safeLog(
          "info",
          `${context} completed in ${Date.now() - generateStartTime}ms`
        );

        if (!response.success) {
          throw new Error(response.error || "LLMs.txt generation failed");
        }

        // Format the response
        let resultText = "";
        if (response.data) {
          resultText = `LLMs.txt content:\n\n${response.data.llmstxt}`;
          if (args.showFullText && response.data.llmsfulltxt) {
            resultText += `\n\n--- LLMs-full.txt content ---\n\n${response.data.llmsfulltxt}`;
          }
        } else {
          resultText =
            "LLMs.txt generation completed, but no data was returned.";
        }

        safeLog(
          "info",
          `Request for ${name} completed successfully in ${Date.now() - startTime}ms`
        );
        return {
          content: [{ type: "text", text: trimResponseText(resultText) }],
          isError: false,
          usage: {}, // Generation might not have direct credit usage reported
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
                `LLMs.txt generation failed: ${errorMessage}`
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
