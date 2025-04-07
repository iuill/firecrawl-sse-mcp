#!/usr/bin/env node
import express, { Request, Response } from "express"; // Removed NextFunction as it's unused
import cors from "cors";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import dotenv from "dotenv";
import { safeLog } from "./tools/utils.js"; // Import safeLog from utils
import { checkApiKeyRequirement } from "./tools/client.js"; // Import API key check
import { allTools, registerAllToolHandlers } from "./tools/index.js"; // Import tools and handler registration

// 環境変数の読み込み
dotenv.config();

// 環境変数の設定 (client.ts でも読み込まれるが、ポート番号はこちらで必要)
const PORT = process.env.FIRECRAWL_PORT || 3000;
const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL; // For logging purposes

// --- APIキーのチェック ---
// アプリケーション起動時に必須チェックを実行
checkApiKeyRequirement();

// --- MCPサーバーの設定 ---
const server = new Server(
  // Use version from package.json or define here
  { name: "firecrawl-mcp", version: "1.7.0" }, // Match reference repo version for now
  { capabilities: { tools: {}, logging: {} } } // Capabilities might be implicitly defined by registered tools/handlers
);

// --- ツールとハンドラーの登録 ---
// Register ListTools handler and individual CallTool handlers
registerAllToolHandlers(server);

// --- Expressアプリケーションの設定 ---
const app = express();
app.use(cors()); // Enable CORS for all origins
app.use(express.json()); // Middleware to parse JSON bodies

// セッション管理のためのマップ
const transports: { [sessionId: string]: SSEServerTransport } = {};

// --- SSEエンドポイント (/sse) ---
app.get("/sse", async (_req: Request, res: Response) => {
  // Create a new SSE transport for each connection
  const transport = new SSEServerTransport("/messages", res); // Specify message endpoint path
  transports[transport.sessionId] = transport;

  safeLog("info", `New SSE connection established: ${transport.sessionId}`);

  // Handle client disconnection
  res.on("close", () => {
    safeLog("info", `SSE connection closed: ${transport.sessionId}`);
    delete transports[transport.sessionId];
    // Optionally notify the server about the disconnection if needed
    // server.disconnect(transport); // Or similar method if available
  });

  // Connect the transport to the MCP server
  try {
    await server.connect(transport);
    safeLog("info", `Transport connected for session: ${transport.sessionId}`);
  } catch (error) {
    safeLog(
      "error",
      `Failed to connect transport for session ${transport.sessionId}: ${error instanceof Error ? error.message : String(error)}`
    );
    // Ensure response is closed if connection fails
    if (!res.writableEnded) {
      res.end();
    }
    delete transports[transport.sessionId]; // Clean up failed transport
  }
});

// --- メッセージ受信エンドポイント (/messages) ---
app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports[sessionId];

  if (transport) {
    try {
      // Let the transport handle the incoming message
      await transport.handlePostMessage(req, res);
    } catch (error) {
      safeLog(
        "error",
        `Error handling message for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`
      );
      if (!res.headersSent) {
        res.status(500).send("Error processing message");
      } else if (!res.writableEnded) {
        res.end(); // Ensure response is closed on error
      }
    }
  } else {
    safeLog("warning", `No active transport found for sessionId: ${sessionId}`);
    res.status(404).send("No active session found for sessionId");
  }
});

// --- ヘルスチェックエンドポイント (/health) ---
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).send("OK");
});

// --- サーバー起動 ---
app.listen(PORT, () => {
  // Use console.log for initial startup message, safeLog might depend on server connection
  console.log(`Firecrawl MCP Server (SSE) running on http://localhost:${PORT}`);
  console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
  console.log(`Message endpoint: http://localhost:${PORT}/messages`);
  safeLog("info", "Firecrawl MCP Server initialized successfully (SSE Mode)");
  safeLog(
    "info",
    `Configuration: API URL: ${FIRECRAWL_API_URL || "default (Cloud)"}`
  );
  safeLog(
    "info",
    `Registered Tools: ${allTools.map((t) => t.name).join(", ")}`
  );
});

// Graceful shutdown handling (optional but recommended)
process.on("SIGINT", () => {
  safeLog("info", "SIGINT received, shutting down server...");
  // Perform cleanup, close connections, etc.
  process.exit(0);
});

process.on("SIGTERM", () => {
  safeLog("info", "SIGTERM received, shutting down server...");
  // Perform cleanup
  process.exit(0);
});
