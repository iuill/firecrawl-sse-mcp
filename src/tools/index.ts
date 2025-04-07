import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { SCRAPE_TOOL, registerScrapeHandler } from "./scrape.js";
import { MAP_TOOL, registerMapHandler } from "./map.js";
import { CRAWL_TOOL, registerCrawlHandler } from "./crawl.js";
import {
  BATCH_SCRAPE_TOOL,
  CHECK_BATCH_STATUS_TOOL,
  registerBatchHandlers,
} from "./batch.js";
import {
  CHECK_CRAWL_STATUS_TOOL,
  registerCrawlStatusHandler,
} from "./crawlStatus.js";
import { SEARCH_TOOL, registerSearchHandler } from "./search.js";
import { EXTRACT_TOOL, registerExtractHandler } from "./extract.js";
import {
  DEEP_RESEARCH_TOOL,
  registerDeepResearchHandler,
} from "./deepResearch.js";
import {
  GENERATE_LLMSTXT_TOOL,
  registerGenerateLLMsTxtHandler,
} from "./llmsTxt.js";

// すべてのツール定義を配列にまとめる
export const allTools = [
  SCRAPE_TOOL,
  MAP_TOOL,
  CRAWL_TOOL,
  BATCH_SCRAPE_TOOL,
  CHECK_BATCH_STATUS_TOOL,
  CHECK_CRAWL_STATUS_TOOL,
  SEARCH_TOOL,
  EXTRACT_TOOL,
  DEEP_RESEARCH_TOOL,
  GENERATE_LLMSTXT_TOOL,
];

// すべてのハンドラーを登録する関数
export function registerAllToolHandlers(server: Server) {
  // ListTools ハンドラー (参照リポジトリの実装に合わせる)
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools,
  }));

  // 各ツールの CallTool ハンドラーを登録
  // 注意: 現在の実装では、各 register 関数が CallToolRequestSchema に対して setRequestHandler を呼び出しています。
  // これは、同じスキーマに対して複数のハンドラーを登録することになり、意図しない挙動を引き起こす可能性があります。
  // 本来は、CallToolRequestSchema に対する単一のハンドラー内で、tool name に基づいて処理を分岐させるべきです。
  // ここでは、参照リポジトリの構造を踏襲しつつ、各ツールファイルでハンドラーを登録する形を維持します。
  // SDK の挙動によっては、後で単一ハンドラーに統合する必要があるかもしれません。
  registerScrapeHandler(server);
  registerMapHandler(server);
  registerCrawlHandler(server);
  registerBatchHandlers(server); // batch.ts で2つのハンドラーが登録される
  registerCrawlStatusHandler(server);
  registerSearchHandler(server);
  registerExtractHandler(server);
  registerDeepResearchHandler(server);
  registerGenerateLLMsTxtHandler(server);

  // TODO: CallToolRequestSchema に対する単一のハンドラーを実装し、
  //       その中で tool name に基づいて各ツールのロジックを呼び出すようにリファクタリングする。
  // server.setRequestHandler(CallToolRequestSchema, async (request) => {
  //   const { name, arguments: args } = request.params;
  //   switch (name) {
  //     case SCRAPE_TOOL.name:
  //       // scrape ロジック呼び出し
  //       break;
  //     case MAP_TOOL.name:
  //       // map ロジック呼び出し
  //       break;
  //     // ... 他のツール
  //     default:
  //       // 未知のツールエラー
  //   }
  // });
}
