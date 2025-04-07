#!/usr/bin/env node
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import dotenv from "dotenv";

// 環境変数の読み込み
dotenv.config();

// 環境変数の設定
const PORT = process.env.FIRECRAWL_PORT || 3000;
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL;

// APIキーのチェック（クラウドサービスの場合のみ）
if (!FIRECRAWL_API_URL && !FIRECRAWL_API_KEY) {
  console.error(
    "Error: FIRECRAWL_API_KEY environment variable is required when using the cloud service"
  );
  // process.exit(1); // 開発中はコメントアウト
}

// ロギング関数
function safeLog(
  level:
    | "error"
    | "debug"
    | "info"
    | "notice"
    | "warning"
    | "critical"
    | "alert"
    | "emergency",
  data: any
): void {
  console.error(
    `[${level}] ${typeof data === "object" ? JSON.stringify(data) : data}`
  );
}

// MCPサーバーの設定 (ツールはまだ定義しない)
const server = new Server(
  { name: "firecrawl-mcp", version: "1.0.0" },
  { capabilities: { tools: {}, logging: {} } }
);

// TODO: ツール定義とハンドラーをここに追加 (src/shared/tools.ts からインポート)
// import { tools, registerToolHandlers } from './shared/tools.js';
// server.addTools(tools);
// registerToolHandlers(server);

// Expressアプリケーションの設定
const app = express();
app.use(cors());
app.use(express.json());

// セッション管理のためのマップ
const transports: { [sessionId: string]: SSEServerTransport } = {};

// SSEエンドポイント
app.get("/sse", async (_req: Request, res: Response) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;

  safeLog("info", `New SSE connection established: ${transport.sessionId}`);

  res.on("close", () => {
    safeLog("info", `SSE connection closed: ${transport.sessionId}`);
    delete transports[transport.sessionId];
  });

  await server.connect(transport);
});

// メッセージ受信エンドポイント
app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports[sessionId];

  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("No transport found for sessionId");
  }
});

// ヘルスチェックエンドポイント
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).send("OK");
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`Firecrawl MCP Server running on http://localhost:${PORT}`);
  safeLog(
    "info",
    "Firecrawl MCP Server initialized successfully (basic setup)"
  );
  safeLog("info", `Configuration: API URL: ${FIRECRAWL_API_URL || "default"}`);
});
