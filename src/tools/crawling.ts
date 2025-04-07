import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import FirecrawlApp, {
  type MapParams,
  type CrawlParams,
  type FirecrawlDocument,
} from "@mendable/firecrawl-js";
import { z } from "zod";

/**
 * クロール関連ツールを登録する
 * @param server MCPサーバーインスタンス
 * @param apiKey Firecrawl API Key
 * @param apiUrl Firecrawl API URL（オプション）
 */
export function registerCrawlingTools(
  server: McpServer,
  apiKey: string,
  apiUrl?: string
): void {
  // Firecrawlクライアントの初期化
  const client = new FirecrawlApp({
    apiKey,
    ...(apiUrl ? { apiUrl } : {}),
  });

  // --- firecrawl_map ---
  const MAP_TOOL_SCHEMA = {
    url: z.string().describe("Starting URL for URL discovery"),
    search: z
      .string()
      .optional()
      .describe("Optional search term to filter URLs"),
    ignoreSitemap: z
      .boolean()
      .optional()
      .describe("Skip sitemap.xml discovery and only use HTML links"),
    sitemapOnly: z
      .boolean()
      .optional()
      .describe("Only use sitemap.xml for discovery, ignore HTML links"),
    includeSubdomains: z
      .boolean()
      .optional()
      .describe("Include URLs from subdomains in results"),
    limit: z.number().optional().describe("Maximum number of URLs to return"),
  };

  server.tool(
    "firecrawl_map",
    "Discover URLs from a starting point. Can use both sitemap.xml and HTML link discovery.",
    MAP_TOOL_SCHEMA,
    async (args) => {
      const { url, ...options } = args;
      try {
        const response = await client.mapUrl(url, {
          ...options,
          // origin: "mcp-server", // Remove origin if not supported
        } as MapParams); // Cast options

        if ("error" in response) {
          throw new Error(response.error);
        }
        if (!response.links) {
          throw new Error("No links received from Firecrawl API");
        }

        return {
          content: [{ type: "text", text: response.links.join("\n") }],
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

  // --- firecrawl_crawl ---
  const CRAWL_TOOL_SCHEMA = {
    url: z.string().describe("Starting URL for the crawl"),
    excludePaths: z
      .array(z.string())
      .optional()
      .describe("URL paths to exclude from crawling"),
    includePaths: z
      .array(z.string())
      .optional()
      .describe("Only crawl these URL paths"),
    maxDepth: z.number().optional().describe("Maximum link depth to crawl"),
    ignoreSitemap: z
      .boolean()
      .optional()
      .describe("Skip sitemap.xml discovery"),
    limit: z.number().optional().describe("Maximum number of pages to crawl"),
    allowBackwardLinks: z
      .boolean()
      .optional()
      .describe("Allow crawling links that point to parent directories"),
    allowExternalLinks: z
      .boolean()
      .optional()
      .describe("Allow crawling links to external domains"),
    webhook: z
      .union([
        z
          .string()
          .url()
          .describe("Webhook URL to notify when crawl is complete"),
        z.object({
          url: z.string().url().describe("Webhook URL"),
          headers: z
            .record(z.string())
            .optional()
            .describe("Custom headers for webhook requests"),
        }),
      ])
      .optional(),
    deduplicateSimilarURLs: z
      .boolean()
      .optional()
      .describe("Remove similar URLs during crawl"),
    ignoreQueryParameters: z
      .boolean()
      .optional()
      .describe("Ignore query parameters when comparing URLs"),
    scrapeOptions: z // scrapeOptionsのスキーマはscraping.tsのものを参考に定義
      .object({
        formats: z
          .array(
            z.enum([
              // scraping.tsのenumと合わせる
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
      })
      .optional()
      .describe("Options for scraping each page"),
  };

  server.tool(
    "firecrawl_crawl",
    "Start an asynchronous crawl of multiple pages from a starting URL. Supports depth control, path filtering, and webhook notifications.",
    CRAWL_TOOL_SCHEMA,
    async (args) => {
      const { url, ...options } = args;
      try {
        const response = await client.asyncCrawlUrl(url, {
          ...options,
          // origin: "mcp-server", // Remove origin if not supported
        } as CrawlParams); // Cast options

        if (!response.success) {
          throw new Error(response.error);
        }

        // Monitor credits if needed (similar logic as in mendableai/firecrawl-mcp-server)

        return {
          content: [
            {
              type: "text",
              text: `Started crawl for ${url} with job ID: ${response.id}`,
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

  // --- firecrawl_check_crawl_status ---
  const CHECK_CRAWL_STATUS_TOOL_SCHEMA = {
    id: z.string().describe("Crawl job ID to check"),
  };

  // Helper function to format results (from mendableai/firecrawl-mcp-server)
  function formatResults(data: FirecrawlDocument[]): string {
    return data
      .map((doc) => {
        const content = doc.markdown || doc.html || doc.rawHtml || "No content";
        return `URL: ${doc.url || "Unknown URL"}
Content: ${content.substring(0, 100)}${content.length > 100 ? "..." : ""}
${doc.metadata?.title ? `Title: ${doc.metadata.title}` : ""}`;
      })
      .join("\n\n");
  }

  server.tool(
    "firecrawl_check_crawl_status",
    "Check the status of a crawl job.",
    CHECK_CRAWL_STATUS_TOOL_SCHEMA,
    async ({ id }) => {
      try {
        const response = await client.checkCrawlStatus(id);

        if (!response.success) {
          throw new Error(response.error);
        }

        const status = `Crawl Status:
Status: ${response.status}
Progress: ${response.completed}/${response.total}
Credits Used: ${response.creditsUsed ?? "N/A"}
Expires At: ${response.expiresAt ?? "N/A"}
${response.data && response.data.length > 0 ? "\nResults:\n" + formatResults(response.data) : ""}`;

        return {
          content: [{ type: "text", text: status }],
          isError: false, // Consider adding error check based on response.status if needed
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
}
