#!/usr/bin/env node

import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import dotenv from "dotenv";
import { registerAllTools } from "./tools/index.js"; // Import tool registration function
// 環境変数の読み込み
dotenv.config();

// 環境変数の設定
const PORT = process.env.FIRECRAWL_PORT || 3006;
const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL;
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

// --- MCPサーバーの設定 ---
const server = new McpServer({
  name: "firecrawl-mcp",
  version: "1.0.0",
});

// --- Expressアプリケーションの設定 ---
const app = express();

// セッション管理のためのマップ
const transports: { [sessionId: string]: SSEServerTransport } = {};

// --- SSEエンドポイント (/sse) ---
app.get("/sse", async (_req: Request, res: Response) => {
  try {
    const transport = new SSEServerTransport("/messages", res);
    transports[transport.sessionId] = transport;

    console.log(`SSE接続確立: sessionId=${transport.sessionId}`);

    res.on("close", () => {
      console.log(`SSE接続終了: sessionId=${transport.sessionId}`);
      delete transports[transport.sessionId];
    });

    await server.connect(transport);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("SSE接続確立エラー:", message);
    if (error instanceof Error && error.stack) {
      console.error("Stack trace:", error.stack);
    }
    // レスポンスがまだ送信されていない場合のみエラーレスポンスを送信
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: { message: "Failed to establish SSE connection" },
      });
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("メッセージ処理エラー:", message);
      if (error instanceof Error && error.stack) {
        console.error("Stack trace:", error.stack);
      }
      // レスポンスがまだ送信されていない場合のみエラーレスポンスを送信
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: { message: "Error processing message" },
        });
      }
    }
  } else {
    res.status(400).json({
      success: false,
      error: { message: "No transport found for sessionId" },
    });
  }
});

// --- サーバー起動 ---
async function initializeServer() {
  try {
    // Check for required API key
    if (!FIRECRAWL_API_KEY) {
      console.error(
        "Error: FIRECRAWL_API_KEY environment variable is required."
      );
      process.exit(1);
    }

    // Register tools
    console.log("Registering Firecrawl tools...");
    registerAllTools(server, FIRECRAWL_API_KEY, FIRECRAWL_API_URL);
    console.log("Firecrawl tools registered.");

    // Start the Express server
    app.listen(PORT, () => {
      console.log(`Firecrawl MCP Server running on http://localhost:${PORT}`);
      console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
      console.log(`Message endpoint: http://localhost:${PORT}/messages`);
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
