import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import FirecrawlApp, { type ScrapeParams } from "@mendable/firecrawl-js";
import { z } from "zod";
import PQueue from "p-queue"; // バッチ処理のために追加

// バッチ操作のインターフェース（mendableai/firecrawl-mcp-serverから参照）
// Define the options schema separately for clarity and type inference
const BATCH_SCRAPE_OPTIONS_SCHEMA = z
  .object({
    formats: z
      .array(
        z.enum([
          "markdown",
          "html",
          "rawHtml",
          "content",
          "links",
          "screenshot",
          "screenshot@fullPage",
          "json",
          "compare",
          "extract",
        ])
      )
      .optional(),
    onlyMainContent: z.boolean().optional(),
    includeTags: z.array(z.string()).optional(),
    excludeTags: z.array(z.string()).optional(),
    waitFor: z.number().optional(),
    timeout: z.number().optional(),
    actions: z
      .array(
        z.object({
          type: z.enum([
            "wait",
            "click",
            "screenshot",
            "write",
            "press",
            "scroll",
            "scrape",
            "executeJavascript",
          ]),
          selector: z.string().optional(),
          milliseconds: z.number().optional(),
          text: z.string().optional(),
          key: z.string().optional(),
          direction: z.enum(["up", "down"]).optional(),
          script: z.string().optional(),
          fullPage: z.boolean().optional(),
        })
      )
      .optional(),
    extract: z
      .object({
        schema: z.any().optional(), // Use z.any() to bypass strict schema check for now
        systemPrompt: z.string().optional(),
        prompt: z.string().optional(),
      })
      .optional(),
    mobile: z.boolean().optional(),
    skipTlsVerification: z.boolean().optional(),
    removeBase64Images: z.boolean().optional(),
    location: z
      .object({
        country: z.string().optional(),
        languages: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .optional();

// バッチ操作のインターフェース（mendableai/firecrawl-mcp-serverから参照）
interface QueuedBatchOperation {
  id: string;
  urls: string[];
  options?: z.infer<typeof BATCH_SCRAPE_OPTIONS_SCHEMA>; // Infer type from Zod schema
  status: "pending" | "processing" | "completed" | "failed";
  progress: {
    completed: number;
    total: number;
  };
  result?: unknown; // Use unknown instead of any
  error?: string;
}

// バッチ処理キューと操作管理マップ（mendableai/firecrawl-mcp-serverから参照）
const batchQueue = new PQueue({ concurrency: 1 });
const batchOperations = new Map<string, QueuedBatchOperation>();
let operationCounter = 0;

// バッチ操作処理関数（mendableai/firecrawl-mcp-serverから参照）
async function processBatchOperation(
  operation: QueuedBatchOperation,
  client: FirecrawlApp // Firecrawlクライアントを引数で受け取る
): Promise<void> {
  try {
    operation.status = "processing";
    // ライブラリのバッチ処理を使用 (optionsを型アサーション)
    const response = await client.asyncBatchScrapeUrls(
      operation.urls,
      operation.options as Omit<ScrapeParams, "url"> | undefined
    );

    if (!response.success) {
      throw new Error(response.error || "Batch operation failed");
    }

    operation.status = "completed";
    operation.result = response;
    // 完了ログなどは必要に応じて追加
  } catch (error) {
    operation.status = "failed";
    operation.error = error instanceof Error ? error.message : String(error);
    // エラーログなどは必要に応じて追加
  }
}

/**
 * スクレイピング関連ツールを登録する
 * @param server MCPサーバーインスタンス
 * @param apiKey Firecrawl API Key
 * @param apiUrl Firecrawl API URL（オプション）
 */
export function registerScrapingTools(
  server: McpServer,
  apiKey: string,
  apiUrl?: string
): void {
  // Firecrawlクライアントの初期化
  const client = new FirecrawlApp({
    apiKey,
    ...(apiUrl ? { apiUrl } : {}),
  });

  // --- firecrawl_scrape ---
  const SCRAPE_TOOL_SCHEMA = {
    url: z.string().describe("The URL to scrape"),
    formats: z
      .array(
        // Use enum values from ScrapeParams['formats']
        z.enum([
          "markdown",
          "html",
          "rawHtml",
          "content", // Added from ScrapeParams type
          "links",
          "screenshot",
          "screenshot@fullPage",
          "json", // Added from ScrapeParams type
          "compare", // Added from ScrapeParams type
          "extract", // Keep extract if it's still relevant or defined elsewhere
        ])
      )
      .optional() // デフォルトは後でハンドラで処理
      .describe("Content formats to extract (default: ['markdown'])"),
    onlyMainContent: z
      .boolean()
      .optional()
      .describe(
        "Extract only the main content, filtering out navigation, footers, etc."
      ),
    includeTags: z
      .array(z.string())
      .optional()
      .describe("HTML tags to specifically include in extraction"),
    excludeTags: z
      .array(z.string())
      .optional()
      .describe("HTML tags to exclude from extraction"),
    waitFor: z
      .number()
      .optional()
      .describe("Time in milliseconds to wait for dynamic content to load"),
    timeout: z
      .number()
      .optional()
      .describe("Maximum time in milliseconds to wait for the page to load"),
    actions: z
      .array(
        z.object({
          type: z.enum([
            "wait",
            "click",
            "screenshot",
            "write",
            "press",
            "scroll",
            "scrape",
            "executeJavascript",
          ]),
          selector: z.string().optional(),
          milliseconds: z.number().optional(),
          text: z.string().optional(),
          key: z.string().optional(),
          direction: z.enum(["up", "down"]).optional(),
          script: z.string().optional(),
          fullPage: z.boolean().optional(),
        })
      )
      .optional()
      .describe("List of actions to perform before scraping"),
    extract: z
      .object({
        schema: z.any().optional(), // Use z.any() to bypass strict schema check for now
        systemPrompt: z.string().optional(),
        prompt: z.string().optional(),
      })
      .optional()
      .describe("Configuration for structured data extraction"),
    mobile: z.boolean().optional().describe("Use mobile viewport"),
    skipTlsVerification: z
      .boolean()
      .optional()
      .describe("Skip TLS certificate verification"),
    removeBase64Images: z
      .boolean()
      .optional()
      .describe("Remove base64 encoded images from output"),
    location: z
      .object({
        country: z.string().optional(),
        languages: z.array(z.string()).optional(),
      })
      .optional()
      .describe("Location settings for scraping"),
  };

  server.tool(
    "firecrawl_scrape",
    "Scrape a single webpage with advanced options for content extraction. Supports various formats including markdown, HTML, and screenshots. Can execute custom actions like clicking or scrolling before scraping.",
    SCRAPE_TOOL_SCHEMA,
    async (args) => {
      const { url, ...options } = args;
      // formatsが未指定の場合のデフォルト処理
      const effectiveFormats = options.formats?.length
        ? options.formats
        : ["markdown"];

      try {
        const response = await client.scrapeUrl(url, {
          ...options,
          formats: effectiveFormats as ScrapeParams["formats"], // 型キャストを追加
          // origin: "mcp-server", // Remove origin as it's not in ScrapeParams type
        } as ScrapeParams); // Cast the entire options object

        if ("success" in response && !response.success) {
          throw new Error(response.error || "Scraping failed");
        }

        // 結果のフォーマット処理
        const contentParts = [];
        if (effectiveFormats.includes("markdown") && response.markdown) {
          contentParts.push(`## Markdown Content\n\n${response.markdown}`);
        }
        if (effectiveFormats.includes("html") && response.html) {
          contentParts.push(`## HTML Content\n\n${response.html}`);
        }
        if (effectiveFormats.includes("rawHtml") && response.rawHtml) {
          contentParts.push(`## Raw HTML Content\n\n${response.rawHtml}`);
        }
        if (effectiveFormats.includes("links") && response.links) {
          contentParts.push(`## Links\n\n${response.links.join("\n")}`);
        }
        if (effectiveFormats.includes("screenshot") && response.screenshot) {
          // スクリーンショットはテキストではないため、別の方法で扱うか、URLなどを返す
          contentParts.push(
            `## Screenshot\n\n(Screenshot data is available but not displayed as text)`
          );
        }
        if (effectiveFormats.includes("extract") && response.extract) {
          contentParts.push(
            `## Extracted Data\n\n${JSON.stringify(response.extract, null, 2)}`
          );
        }

        return {
          content: [
            {
              type: "text",
              text: contentParts.join("\n\n---\n\n") || "No content available",
            },
          ],
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

  // --- firecrawl_batch_scrape ---
  // Define the options schema separately for clarity and type inference
  const BATCH_SCRAPE_OPTIONS_SCHEMA = z
    .object({
      formats: z
        .array(
          z.enum([
            "markdown",
            "html",
            "rawHtml",
            "content",
            "links",
            "screenshot",
            "screenshot@fullPage",
            "json",
            "compare",
            "extract",
          ])
        )
        .optional(),
      onlyMainContent: z.boolean().optional(),
      includeTags: z.array(z.string()).optional(),
      excludeTags: z.array(z.string()).optional(),
      waitFor: z.number().optional(),
      timeout: z.number().optional(),
      actions: z
        .array(
          z.object({
            type: z.enum([
              "wait",
              "click",
              "screenshot",
              "write",
              "press",
              "scroll",
              "scrape",
              "executeJavascript",
            ]),
            selector: z.string().optional(),
            milliseconds: z.number().optional(),
            text: z.string().optional(),
            key: z.string().optional(),
            direction: z.enum(["up", "down"]).optional(),
            script: z.string().optional(),
            fullPage: z.boolean().optional(),
          })
        )
        .optional(),
      extract: z
        .object({
          schema: z.any().optional(), // Use z.any() to bypass strict schema check for now
          systemPrompt: z.string().optional(),
          prompt: z.string().optional(),
        })
        .optional(),
      mobile: z.boolean().optional(),
      skipTlsVerification: z.boolean().optional(),
      removeBase64Images: z.boolean().optional(),
      location: z
        .object({
          country: z.string().optional(),
          languages: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional();

  const BATCH_SCRAPE_TOOL_SCHEMA = {
    urls: z.array(z.string()).describe("List of URLs to scrape"),
    options: BATCH_SCRAPE_OPTIONS_SCHEMA,
  };

  server.tool(
    "firecrawl_batch_scrape",
    "Scrape multiple URLs in batch mode. Returns a job ID that can be used to check status.",
    BATCH_SCRAPE_TOOL_SCHEMA,
    async ({ urls, options }) => {
      try {
        const operationId = `batch_${++operationCounter}`;
        const operation: QueuedBatchOperation = {
          id: operationId,
          urls: urls,
          options: options,
          status: "pending",
          progress: { completed: 0, total: urls.length },
        };
        batchOperations.set(operationId, operation);

        // キューに追加（非同期で実行される）
        batchQueue.add(() => processBatchOperation(operation, client));

        console.log(
          `Queued batch operation ${operationId} with ${urls.length} URLs`
        );
        return {
          content: [
            {
              type: "text",
              text: `Batch operation queued with ID: ${operationId}. Use firecrawl_check_batch_status to check progress.`,
            },
          ],
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

  // --- firecrawl_check_batch_status ---
  const CHECK_BATCH_STATUS_TOOL_SCHEMA = {
    id: z.string().describe("Batch job ID to check"),
  };

  server.tool(
    "firecrawl_check_batch_status",
    "Check the status of a batch scraping job.",
    CHECK_BATCH_STATUS_TOOL_SCHEMA,
    async ({ id }) => {
      const operation = batchOperations.get(id);

      if (!operation) {
        return {
          content: [
            {
              type: "text",
              text: `No batch operation found with ID: ${id}`,
            },
          ],
          isError: true,
        };
      }

      // mendableai/firecrawl-mcp-serverの実装を参考にステータス情報を返す
      // 結果が大きい場合があるので、JSON.stringifyの代わりに一部情報のみ表示するなどの工夫が必要な場合がある
      const status = `Batch Status:
ID: ${operation.id}
Status: ${operation.status}
Progress: ${operation.progress.completed}/${operation.progress.total}
${operation.error ? `Error: ${operation.error}` : ""}
${operation.result ? `Result available (use specific tool to view details if needed)` : ""}`;

      return {
        content: [{ type: "text", text: status }],
        isError: operation.status === "failed", // エラー状態ならisErrorをtrueに
      };
    }
  );
}
