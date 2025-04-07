import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerScrapingTools } from "./scraping.js";
import { registerCrawlingTools } from "./crawling.js";
import { registerSearchTools } from "./search.js";

/**
 * Firecrawlの全ツールをMCPサーバーに登録する
 * @param server MCPサーバーインスタンス
 * @param apiKey Firecrawl API Key
 * @param apiUrl Firecrawl API URL（オプション）
 */
export function registerAllTools(
  server: McpServer,
  apiKey: string,
  apiUrl?: string
): void {
  console.log("Registering Firecrawl tools...");

  // スクレイピング関連ツールの登録
  registerScrapingTools(server, apiKey, apiUrl);

  // クロール関連ツールの登録
  registerCrawlingTools(server, apiKey, apiUrl);

  // 検索・抽出関連ツールの登録
  registerSearchTools(server, apiKey, apiUrl);

  console.log("All Firecrawl tools registered successfully.");
}
