import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import FirecrawlApp, {
  type ExtractParams,
  type ExtractResponse,
  type GenerateLLMsTextParams,
} from "@mendable/firecrawl-js";
import { z } from "zod";

// Define base types for tool arguments
interface SearchArgs {
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
    formats?: Array<"markdown" | "html" | "rawHtml">;
    onlyMainContent?: boolean;
    waitFor?: number;
  };
}

interface ExtractArgs {
  urls: string[];
  prompt?: string;
  systemPrompt?: string;
  schema?: Record<string, unknown>;
  allowExternalLinks?: boolean;
  enableWebSearch?: boolean;
  includeSubdomains?: boolean;
}

interface DeepResearchArgs {
  query: string;
  maxDepth?: number;
  timeLimit?: number;
  maxUrls?: number;
}

interface GenerateLLMsTextArgs {
  url: string;
  maxUrls?: number;
  showFullText?: boolean;
}

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
    async (args: SearchArgs) => {
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
            // 型アノテーションを削除して型推論に任せる
            (result) => `URL: ${result.url || "No URL"}
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
      .record(z.string(), z.unknown()) // Use unknown instead of any for better type safety
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
    async (args: ExtractArgs) => {
      const { urls, ...options } = args;
      try {
        // Log if using self-hosted instance if needed

        const extractResponse = await client.extract(urls, {
          ...options,
          // origin: "mcp-server", // Remove origin if not supported
        } as ExtractParams); // Cast options

        if (!("success" in extractResponse) || !extractResponse.success) {
          // Handle potential error structure difference if needed
          let errorMsg = "Extraction failed";
          const unknownResponse = extractResponse as unknown; // Cast to unknown for safe access
          if (
            unknownResponse &&
            typeof unknownResponse === "object" &&
            "error" in unknownResponse &&
            typeof unknownResponse.error === "string"
          ) {
            errorMsg = unknownResponse.error;
          }
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
  // Research phases enum for progress tracking
  enum ResearchPhase {
    SEARCH = "Search Phase",
    DATA_COLLECTION = "Data Collection Phase",
    ANALYSIS = "AI Analysis Phase",
    REPORT = "Report Generation Phase",
    COMPLETED = "Completion Phase",
    POST_PROCESSING = "Post Processing Phase",
  }

  // Progress detail interface for detailed status updates
  interface ProgressDetail {
    phase: ResearchPhase;
    progress: number; // Progress percentage (0-100)
    message: string;
    timestamp?: string; // タイムスタンプを追加
  }

  const DEEP_RESEARCH_TOOL_SCHEMA = {
    query: z.string().describe("The query to research"),
    maxDepth: z
      .number()
      .optional()
      .describe(
        "Maximum depth of research iterations (1-10). Lower values (2-3) are recommended for faster results and to avoid timeouts. Higher values provide more comprehensive research but significantly increase processing time."
      ),
    timeLimit: z
      .number()
      .optional()
      .describe(
        "Time limit in seconds for the entire process including search, data collection, and AI analysis. Recommended: 600-900 seconds (10-15 minutes) for general queries. For complex topics, consider 1200-1800 seconds (20-30 minutes). Note that even after 'Research activity completed' message appears, additional processing time is needed. Default: 600"
      ),
    maxUrls: z
      .number()
      .optional()
      .describe(
        "Maximum number of URLs to analyze (1-1000). Recommended: 10-30 for quick research, 30-50 for comprehensive research. Values above 50 may lead to timeouts. Higher values require significantly longer processing time, especially during post-completion processing."
      ),
  };

  server.tool(
    "firecrawl_deep_research",
    "Conduct deep research on a query using web crawling, search, and AI analysis.",
    DEEP_RESEARCH_TOOL_SCHEMA,
    async (args: DeepResearchArgs) => {
      const { query, ...options } = args;
      console.log(
        `Starting deep research for query: "${query}" with options:`,
        options
      );
      const startTime = Date.now();

      try {
        // client.deepResearch might not exist or have different signature
        // Assuming it exists and matches the schema for now
        // Need to verify the actual method signature in firecrawl-js
        // Using 'any' cast as a temporary workaround if the method is not typed
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response = await (client as any).deepResearch(
          query,
          {
            ...options,
            // origin: "mcp-server", // Remove origin if not supported
          } as DeepResearchParams, // Cast options
          // Add callbacks if supported by the actual method
          (activity: any) => {
            const timestamp = new Date().toISOString();
            // Determine the current phase based on activity message
            let phase = ResearchPhase.SEARCH;
            let isPhaseStart = false;
            let isPhaseComplete = false;

            // フェーズの開始を検出
            if (
              activity.message.includes("starting") ||
              activity.message.includes("begin")
            ) {
              isPhaseStart = true;
            }

            // フェーズの完了を検出
            if (
              activity.message.includes("completed") ||
              activity.message.includes("finished") ||
              activity.message.includes("done") ||
              (activity.progress && activity.progress >= 100)
            ) {
              isPhaseComplete = true;
            }

            // 特定のフェーズを検出
            if (activity.message.includes("collecting")) {
              phase = ResearchPhase.DATA_COLLECTION;
            } else if (activity.message.includes("analyzing")) {
              phase = ResearchPhase.ANALYSIS;
            } else if (activity.message.includes("generating")) {
              phase = ResearchPhase.REPORT;
            }

            // "Research activity completed"メッセージを検出
            if (
              activity.message.includes("completed") &&
              !activity.message.includes("collecting") &&
              !activity.message.includes("analyzing") &&
              !activity.message.includes("generating")
            ) {
              phase = ResearchPhase.COMPLETED;
              console.log(
                `[${timestamp}] IMPORTANT: Research activity marked as completed, but post-processing is still ongoing. This may take additional time.`
              );
            }

            // Create progress detail
            const progress: ProgressDetail = {
              phase,
              progress: activity.progress || 0,
              message: `${phase}: ${activity.message}`,
              timestamp,
            };

            // フェーズの開始または完了時に詳細なログを出力
            if (isPhaseStart) {
              console.log(
                `[${timestamp}] PHASE START: ${phase} has started. Elapsed time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`
              );
            }

            if (isPhaseComplete) {
              console.log(
                `[${timestamp}] PHASE COMPLETE: ${phase} has completed. Elapsed time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`
              );
            }

            // 通常の進捗ログ
            console.log(
              `[${timestamp}] Research progress: ${JSON.stringify(progress)}`
            );

            // 完了フェーズの場合、追加の情報を提供
            if (phase === ResearchPhase.COMPLETED) {
              console.log(
                `[${timestamp}] POST-COMPLETION: Now processing final results. This may take several minutes depending on the amount of data collected.`
              );
              console.log(
                `[${timestamp}] POST-COMPLETION: Total elapsed time so far: ${((Date.now() - startTime) / 1000).toFixed(1)}s`
              );
            }
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (source: any) => {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] Research source: ${source.url}`);
          }
        );

        // 最終的な完了ログ
        const endTime = Date.now();
        const totalTime = ((endTime - startTime) / 1000).toFixed(1);
        console.log(
          `[${new Date().toISOString()}] FINAL COMPLETION: Deep research process fully completed. Total time: ${totalTime}s`
        );

        // レスポンスデータの詳細ログ
        console.log(
          `[${new Date().toISOString()}] RESPONSE_DEBUG: Received raw response from deepResearch API`
        );
        console.log(
          `[${new Date().toISOString()}] RESPONSE_DEBUG: Response success status: ${response.success}`
        );

        // レスポンスデータの構造と大きさを確認
        const responseDataKeys = Object.keys(response.data || {});
        console.log(
          `[${new Date().toISOString()}] RESPONSE_DEBUG: Response data keys: ${JSON.stringify(responseDataKeys)}`
        );

        // finalAnalysisの存在確認とサイズ確認
        const hasFinalAnalysis =
          response.data && "finalAnalysis" in response.data;
        const finalAnalysisSize = hasFinalAnalysis
          ? Buffer.from(String(response.data.finalAnalysis)).length
          : 0;
        console.log(
          `[${new Date().toISOString()}] RESPONSE_DEBUG: Final analysis exists: ${hasFinalAnalysis}, Size: ${finalAnalysisSize} bytes`
        );

        if (!response.success) {
          console.log(
            `[${new Date().toISOString()}] RESPONSE_ERROR: Research failed with error: ${response.error || "Unknown error"}`
          );
          throw new Error(response.error || "Deep research failed");
        }

        console.log(
          `[${new Date().toISOString()}] POST_PROCESSING: Formatting response data`
        );

        // データ整形前の詳細ログ
        console.log(
          `[${new Date().toISOString()}] RESPONSE_DEBUG: Starting to format final analysis data`
        );

        const formattedResponse = {
          finalAnalysis: response.data.finalAnalysis,
          // activities: response.data.activities, // Include if needed
          // sources: response.data.sources, // Include if needed
        };

        // データ整形後の詳細ログ
        console.log(
          `[${new Date().toISOString()}] RESPONSE_DEBUG: Formatted response object created`
        );

        // 整形されたデータのサイズを確認
        const formattedResponseSize = Buffer.from(
          JSON.stringify(formattedResponse)
        ).length;
        console.log(
          `[${new Date().toISOString()}] RESPONSE_DEBUG: Formatted response size: ${formattedResponseSize} bytes`
        );

        console.log(
          `[${new Date().toISOString()}] POST_PROCESSING: Response formatting complete`
        );

        // 最終レスポンスオブジェクトのサイズを確認
        const finalResponseSize = Buffer.from(
          JSON.stringify({
            content: [
              {
                type: "text",
                text: formattedResponse.finalAnalysis,
              },
            ],
            isError: false,
          })
        ).length;
        console.log(
          `[${new Date().toISOString()}] RESPONSE_DEBUG: Final response object size: ${finalResponseSize} bytes`
        );

        // 送信直前の詳細ログ
        console.log(
          `[${new Date().toISOString()}] RESPONSE_DEBUG: About to send response to client. Response type: object, isError: false`
        );

        console.log(
          `[${new Date().toISOString()}] COMPLETE: Returning final research results to client`
        );

        // 送信試行ログ
        console.log(
          `[${new Date().toISOString()}] RESPONSE_DEBUG: Attempting to send response to client...`
        );

        // 送信完了ログ（returnの直前に配置）
        console.log(
          `[${new Date().toISOString()}] RESPONSE_DEBUG: Executing return statement`
        );

        // 直接オブジェクトを返す
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
    async (args: GenerateLLMsTextArgs) => {
      const { url, ...params } = args;
      try {
        // client.generateLLMsText might not exist or have different signature
        // Assuming it exists and matches the schema for now
        // Need to verify the actual method signature in firecrawl-js
        // Using 'any' cast as a temporary workaround if the method is not typed
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
