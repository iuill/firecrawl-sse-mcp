#!/usr/bin/env node

import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import dotenv from "dotenv";
import cors from "cors";
import { safeLog } from "./tools/utils.js";
import { checkApiKeyRequirement } from "./tools/client.js";
import { registerScrapeHandler } from "./tools/scrape.js";
import { registerMapHandler } from "./tools/map.js";
import { registerCrawlHandler } from "./tools/crawl.js";
import { registerBatchHandlers } from "./tools/batch.js";
import { registerCrawlStatusHandler } from "./tools/crawlStatus.js";
import { registerSearchHandler } from "./tools/search.js";
import { registerExtractHandler } from "./tools/extract.js";
import { registerDeepResearchHandler } from "./tools/deepResearch.js";
import { registerGenerateLLMsTxtHandler } from "./tools/llmsTxt.js";

// 環境変数の読み込み
dotenv.config();

// 環境変数の設定
const PORT = process.env.FIRECRAWL_PORT || 3006;
const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL;

// --- APIキーのチェック ---
checkApiKeyRequirement();

// --- MCPサーバーの設定 ---
const server = new McpServer({
  name: "firecrawl-mcp",
  version: "1.0.0",
});

// --- Expressアプリケーションの設定 ---
const app = express();
app.use(cors());
app.use(express.json());

// セッション管理のためのマップ
const transports: { [sessionId: string]: SSEServerTransport } = {};

// --- SSEエンドポイント (/sse) ---
app.get("/sse", async (_req: Request, res: Response) => {
  try {
    const transport = new SSEServerTransport("/messages", res);
    transports[transport.sessionId] = transport;

    safeLog("info", `New SSE connection established: ${transport.sessionId}`);

    res.on("close", () => {
      safeLog("info", `SSE connection closed: ${transport.sessionId}`);
      delete transports[transport.sessionId];
    });

    await server.connect(transport);
    safeLog("info", `Transport connected for session: ${transport.sessionId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    safeLog("error", `Failed to connect transport: ${message}`);
    if (!res.writableEnded) {
      res.end();
    }
    if (error instanceof Error && error.stack) {
      safeLog("error", `Stack trace: ${error.stack}`);
    }
  }
});

// --- メッセージ受信エンドポイント (/messages) ---
app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports[sessionId];

  if (transport) {
    try {
      await transport.handlePostMessage(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      safeLog(
        "error",
        `Error handling message for session ${sessionId}: ${message}`
      );
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: { message: "Error processing message" },
        });
      } else if (!res.writableEnded) {
        res.end();
      }
      if (error instanceof Error && error.stack) {
        safeLog("error", `Stack trace: ${error.stack}`);
      }
    }
  } else {
    safeLog("warning", `No active transport found for sessionId: ${sessionId}`);
    res.status(404).json({
      success: false,
      error: { message: "No active session found for sessionId" },
    });
  }
});

// --- ヘルスチェックエンドポイント (/health) ---
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).send("OK");
});

// --- ツールの登録 ---
// 各ツールのハンドラーを登録
// McpServerをServerにキャストして型の問題を解決
const serverAsServer = server as unknown as Server;
registerScrapeHandler(serverAsServer);
registerMapHandler(serverAsServer);
registerCrawlHandler(serverAsServer);
registerBatchHandlers(serverAsServer);
registerCrawlStatusHandler(serverAsServer);
registerSearchHandler(serverAsServer);
registerExtractHandler(serverAsServer);
registerDeepResearchHandler(serverAsServer);
registerGenerateLLMsTxtHandler(serverAsServer);

// --- サーバー起動 ---
async function initializeServer() {
  try {
    app.listen(PORT, () => {
      console.log(`Firecrawl MCP Server running on http://localhost:${PORT}`);
      console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
      console.log(`Message endpoint: http://localhost:${PORT}/messages`);
      safeLog("info", "Firecrawl MCP Server initialized successfully");
      safeLog(
        "info",
        `Configuration: API URL: ${FIRECRAWL_API_URL || "default (Cloud)"}`
      );
      safeLog("info", `Server version: 1.0.0`); // 直接バージョン情報を指定
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Server initialization error: ${message}`);
    if (error instanceof Error && error.stack) {
      console.error(`Stack trace: ${error.stack}`);
    }
    process.exit(1);
  }
}

// サーバー初期化と起動
initializeServer().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Unexpected error during server startup: ${message}`);
  if (error instanceof Error && error.stack) {
    console.error(`Stack trace: ${error.stack}`);
  }
  process.exit(1);
});

// Graceful shutdown handling
process.on("SIGINT", () => {
  safeLog("info", "SIGINT received, shutting down server...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  safeLog("info", "SIGTERM received, shutting down server...");
  process.exit(0);
});
