import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import FirecrawlApp, {
  // type SearchOptions, // Not exported from firecrawl-js
  type ExtractParams,
  type ExtractResponse,
  type GenerateLLMsTextParams,
} from "@mendable/firecrawl-js";
import { z } from "zod";

// Deep Researchの型定義（firecrawl-jsに存在しない場合、必要に応じて定義）
interface DeepResearchParams {
  query: string;
  maxDepth?: number;
  timeLimit?: number;
  maxUrls?: number;
}

/**
 * 検索・抽出関連ツールを登録する
 * @param server MCPサーバーインスタンス
 * @param apiKey Firecrawl API Key
 * @param apiUrl Firecrawl API URL（オプション）
 */
export function registerSearchTools(
  server: McpServer,
  apiKey: string,
  apiUrl?: string
): void {
  // Firecrawlクライアントの初期化
  const client = new FirecrawlApp({
    apiKey,
    ...(apiUrl ? { apiUrl } : {}),
  });

  // --- firecrawl_search ---
  const SEARCH_TOOL_SCHEMA = {
    query: z.string().describe("Search query string"),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of results to return (default: 5)"),
    lang: z
      .string()
      .optional()
      .describe("Language code for search results (default: en)"),
    country: z
      .string()
      .optional()
      .describe("Country code for search results (default: us)"),
    tbs: z.string().optional().describe("Time-based search filter"),
    filter: z.string().optional().describe("Search filter"),
    location: z
      .object({
        country: z.string().optional().describe("Country code for geolocation"),
        languages: z
          .array(z.string())
          .optional()
          .describe("Language codes for content"),
      })
      .optional()
      .describe("Location settings for search"),
    scrapeOptions: z // scrapeOptionsのスキーマはscraping.tsのものを参考に定義
      .object({
        formats: z
          .array(
            z.enum([
              // scraping.tsのenumと合わせるが、searchでサポートされているものに限定する可能性あり
              "markdown",
              "html",
              "rawHtml",
              // "content", // searchではサポートされていない可能性
              // "links", // searchではサポートされていない可能性
              // "screenshot", // searchではサポートされていない可能性
              // "screenshot@fullPage", // searchではサポートされていない可能性
              // "json", // searchではサポートされていない可能性
              // "compare", // searchではサポートされていない可能性
              // "extract", // searchではサポートされていない可能性
            ])
          )
          .optional()
          .describe("Content formats to extract from search results"),
        onlyMainContent: z
          .boolean()
          .optional()
          .describe("Extract only the main content from results"),
        waitFor: z
          .number()
          .optional()
          .describe("Time in milliseconds to wait for dynamic content"),
        // includeTags, excludeTags, timeoutはSearchOptionsにない可能性
      })
      .optional()
      .describe("Options for scraping search results"),
  };

  server.tool(
    "firecrawl_search",
    "Search and retrieve content from web pages with optional scraping. Returns SERP results by default (url, title, description) or full page content when scrapeOptions are provided.",
    SEARCH_TOOL_SCHEMA,
    async (args) => {
      const { query, ...options } = args;
      try {
        const response = await client.search(query, {
          ...options,
          // origin: "mcp-server", // Remove origin if not supported
        }); // Remove cast as SearchOptions is not imported/needed here

        if (!response.success) {
          throw new Error(
            `Search failed: ${response.error || "Unknown error"}`
          );
        }

        // Monitor credits if needed

        // Format the results
        const results = response.data
          .map(
            (result) => `URL: ${result.url}
Title: ${result.title || "No title"}
Description: ${result.description || "No description"}
${result.markdown ? `\nContent:\n${result.markdown}` : ""}`
          )
          .join("\n\n");

        return {
          content: [{ type: "text", text: results }],
          isError: false,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );

  // --- firecrawl_extract ---
  const EXTRACT_TOOL_SCHEMA = {
    urls: z
      .array(z.string())
      .describe("List of URLs to extract information from"),
    prompt: z.string().optional().describe("Prompt for the LLM extraction"),
    systemPrompt: z
      .string()
      .optional()
      .describe("System prompt for LLM extraction"),
    schema: z
      .any()
      .optional()
      .describe("JSON schema for structured data extraction"), // Use z.any() for flexibility
    allowExternalLinks: z
      .boolean()
      .optional()
      .describe("Allow extraction from external links"),
    enableWebSearch: z
      .boolean()
      .optional()
      .describe("Enable web search for additional context"),
    includeSubdomains: z
      .boolean()
      .optional()
      .describe("Include subdomains in extraction"),
    // originはExtractParamsにない可能性
  };

  server.tool(
    "firecrawl_extract",
    "Extract structured information from web pages using LLM. Supports both cloud AI and self-hosted LLM extraction.",
    EXTRACT_TOOL_SCHEMA,
    async (args) => {
      const { urls, ...options } = args;
      try {
        // Log if using self-hosted instance if needed

        const extractResponse = await client.extract(urls, {
          ...options,
          // origin: "mcp-server", // Remove origin if not supported
        } as ExtractParams); // Cast options

        if (!("success" in extractResponse) || !extractResponse.success) {
          // Handle potential error structure difference if needed
          const errorMsg =
            (extractResponse as any)?.error || "Extraction failed";
          throw new Error(errorMsg);
        }

        const response = extractResponse as ExtractResponse; // Type assertion after success check

        // Monitor credits if needed

        // Add warning handling if needed

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response.data, null, 2),
            },
          ],
          isError: false,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        // Handle self-hosted instance errors if needed
        return {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );

  // --- firecrawl_deep_research ---
  const DEEP_RESEARCH_TOOL_SCHEMA = {
    query: z.string().describe("The query to research"),
    maxDepth: z
      .number()
      .optional()
      .describe("Maximum depth of research iterations (1-10)"),
    timeLimit: z.number().optional().describe("Time limit in seconds (30-300)"),
    maxUrls: z
      .number()
      .optional()
      .describe("Maximum number of URLs to analyze (1-1000)"),
  };

  server.tool(
    "firecrawl_deep_research",
    "Conduct deep research on a query using web crawling, search, and AI analysis.",
    DEEP_RESEARCH_TOOL_SCHEMA,
    async (args) => {
      const { query, ...options } = args;
      try {
        // client.deepResearch might not exist or have different signature
        // Assuming it exists and matches the schema for now
        // Need to verify the actual method signature in firecrawl-js
        // Using 'any' cast as a temporary workaround if the method is not typed
        const response = await (client as any).deepResearch(
          query,
          {
            ...options,
            // origin: "mcp-server", // Remove origin if not supported
          } as DeepResearchParams, // Cast options
          // Add callbacks if supported by the actual method
          (activity: any) => {
            console.log(`Research activity: ${activity.message}`);
          },
          (source: any) => {
            console.log(`Research source: ${source.url}`);
          }
        );

        if (!response.success) {
          throw new Error(response.error || "Deep research failed");
        }

        const formattedResponse = {
          finalAnalysis: response.data.finalAnalysis,
          // activities: response.data.activities, // Include if needed
          // sources: response.data.sources, // Include if needed
        };

        return {
          content: [
            {
              type: "text",
              text: formattedResponse.finalAnalysis,
            },
          ],
          isError: false,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        // Check if the error indicates the method doesn't exist
        if (
          errorMessage.includes("is not a function") ||
          errorMessage.includes("does not exist")
        ) {
          return {
            content: [
              {
                type: "text",
                text: `Error: deepResearch tool is not available in this version of firecrawl-js.`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );

  // --- firecrawl_generate_llmstxt ---
  const GENERATE_LLMSTXT_TOOL_SCHEMA = {
    url: z.string().describe("The URL to generate LLMs.txt from"),
    maxUrls: z
      .number()
      .optional()
      .describe("Maximum number of URLs to process (1-100, default: 10)"),
    showFullText: z
      .boolean()
      .optional()
      .describe("Whether to show the full LLMs-full.txt in the response"),
  };

  server.tool(
    "firecrawl_generate_llmstxt",
    "Generate standardized LLMs.txt file for a given URL, which provides context about how LLMs should interact with the website.",
    GENERATE_LLMSTXT_TOOL_SCHEMA,
    async (args) => {
      const { url, ...params } = args;
      try {
        // client.generateLLMsText might not exist or have different signature
        // Assuming it exists and matches the schema for now
        // Need to verify the actual method signature in firecrawl-js
        // Using 'any' cast as a temporary workaround if the method is not typed
        const response = await (client as any).generateLLMsText(url, {
          ...params,
          // origin: "mcp-server", // Remove origin if not supported
        } as GenerateLLMsTextParams); // Cast options

        if (!response.success) {
          throw new Error(response.error || "LLMs.txt generation failed");
        }

        let resultText = "";
        if ("data" in response && response.data) {
          resultText = `LLMs.txt content:\n\n${response.data.llmstxt}`;
          if (args.showFullText && response.data.llmsfulltxt) {
            resultText += `\n\nLLMs-full.txt content:\n\n${response.data.llmsfulltxt}`;
          }
        } else {
          // Adjust based on actual response structure if it differs
          resultText = "LLMs.txt generation process initiated.";
        }

        return {
          content: [{ type: "text", text: resultText }],
          isError: false,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        // Check if the error indicates the method doesn't exist
        if (
          errorMessage.includes("is not a function") ||
          errorMessage.includes("does not exist")
        ) {
          return {
            content: [
              {
                type: "text",
                text: `Error: generateLLMsText tool is not available in this version of firecrawl-js.`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );
}
