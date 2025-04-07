# SSE 対応 firecrawl-mcp サーバー実装例

この文書では、SSE 対応の firecrawl-mcp サーバーの実装例を示します。

## 1. 必要なパッケージのインストール

```bash
npm install express cors @modelcontextprotocol/sdk @mendable/firecrawl-js dotenv p-queue
```

## 2. ディレクトリ構造

```
src/
├── index.ts         # メインエントリーポイント
└── shared/          # 共通コード
    └── tools.ts     # ツール定義
```

## 3. コード例

### 3.1 src/index.ts

```typescript
#!/usr/bin/env node
import express from "express";
import cors from "cors";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  Tool,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import FirecrawlApp, {
  type ScrapeParams,
  type MapParams,
  type CrawlParams,
  type FirecrawlDocument,
} from "@mendable/firecrawl-js";
import PQueue from "p-queue";
import dotenv from "dotenv";

// 環境変数の読み込み
dotenv.config();

// 環境変数の設定
const PORT = process.env.FIRECRAWL_PORT || 3000;
const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL;
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

// APIキーのチェック（クラウドサービスの場合のみ）
if (!FIRECRAWL_API_URL && !FIRECRAWL_API_KEY) {
  console.error(
    "Error: FIRECRAWL_API_KEY environment variable is required when using the cloud service"
  );
  process.exit(1);
}

// Firecrawlクライアントの初期化
const client = new FirecrawlApp({
  apiKey: FIRECRAWL_API_KEY || "",
  ...(FIRECRAWL_API_URL ? { apiUrl: FIRECRAWL_API_URL } : {}),
});

// リトライと監視の設定
const CONFIG = {
  retry: {
    maxAttempts: Number(process.env.FIRECRAWL_RETRY_MAX_ATTEMPTS) || 3,
    initialDelay: Number(process.env.FIRECRAWL_RETRY_INITIAL_DELAY) || 1000,
    maxDelay: Number(process.env.FIRECRAWL_RETRY_MAX_DELAY) || 10000,
    backoffFactor: Number(process.env.FIRECRAWL_RETRY_BACKOFF_FACTOR) || 2,
  },
  credit: {
    warningThreshold:
      Number(process.env.FIRECRAWL_CREDIT_WARNING_THRESHOLD) || 1000,
    criticalThreshold:
      Number(process.env.FIRECRAWL_CREDIT_CRITICAL_THRESHOLD) || 100,
  },
};

// クレジット使用量の追跡
interface CreditUsage {
  total: number;
  lastCheck: number;
}

const creditUsage: CreditUsage = {
  total: 0,
  lastCheck: Date.now(),
};

// ユーティリティ関数
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// リトライロジック
async function withRetry<T>(
  operation: () => Promise<T>,
  context: string,
  attempt = 1
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const isRateLimit =
      error instanceof Error &&
      (error.message.includes("rate limit") || error.message.includes("429"));
    if (isRateLimit && attempt < CONFIG.retry.maxAttempts) {
      const delayMs = Math.min(
        CONFIG.retry.initialDelay *
          Math.pow(CONFIG.retry.backoffFactor, attempt - 1),
        CONFIG.retry.maxDelay
      );
      safeLog(
        "warning",
        `Rate limit hit for ${context}. Attempt ${attempt}/${CONFIG.retry.maxAttempts}. Retrying in ${delayMs}ms`
      );
      await delay(delayMs);
      return withRetry(operation, context, attempt + 1);
    }
    throw error;
  }
}

// クレジット使用量の更新
async function updateCreditUsage(creditsUsed: number): Promise<void> {
  creditUsage.total += creditsUsed;
  safeLog("info", `Credit usage: ${creditUsage.total} credits used total`);

  if (creditUsage.total >= CONFIG.credit.criticalThreshold) {
    safeLog("error", `CRITICAL: Credit usage has reached ${creditUsage.total}`);
  } else if (creditUsage.total >= CONFIG.credit.warningThreshold) {
    safeLog(
      "warning",
      `WARNING: Credit usage has reached ${creditUsage.total}`
    );
  }
}

// バッチ操作の管理
interface QueuedBatchOperation {
  id: string;
  urls: string[];
  options?: any;
  status: "pending" | "processing" | "completed" | "failed";
  progress: {
    completed: number;
    total: number;
  };
  result?: any;
  error?: string;
}

// キューシステムの初期化
const batchQueue = new PQueue({ concurrency: 1 });
const batchOperations = new Map<string, QueuedBatchOperation>();
let operationCounter = 0;

// バッチ操作の処理
async function processBatchOperation(
  operation: QueuedBatchOperation
): Promise<void> {
  try {
    operation.status = "processing";
    let totalCreditsUsed = 0;

    // ライブラリのバッチ処理機能を使用
    const response = await withRetry(
      async () =>
        client.asyncBatchScrapeUrls(operation.urls, operation.options),
      `batch ${operation.id} processing`
    );

    if (!response.success) {
      throw new Error(response.error || "Batch operation failed");
    }

    // クラウドAPIを使用している場合のクレジット追跡
    if (!FIRECRAWL_API_URL && hasCredits(response)) {
      totalCreditsUsed += response.creditsUsed;
      await updateCreditUsage(response.creditsUsed);
    }

    operation.status = "completed";
    operation.result = response;

    // バッチのクレジット使用量の最終ログ
    if (!FIRECRAWL_API_URL) {
      safeLog(
        "info",
        `Batch ${operation.id} completed. Total credits used: ${totalCreditsUsed}`
      );
    }
  } catch (error) {
    operation.status = "failed";
    operation.error = error instanceof Error ? error.message : String(error);
    safeLog("error", `Batch ${operation.id} failed: ${operation.error}`);
  }
}

// クレジット使用量のチェック
function hasCredits(response: any): response is { creditsUsed: number } {
  return "creditsUsed" in response && typeof response.creditsUsed === "number";
}

// レスポンステキストのトリミング
function trimResponseText(text: string): string {
  return text.trim();
}

// ツール定義
// 注: ここに既存のツール定義（SCRAPE_TOOL, MAP_TOOL, CRAWL_TOOL, など）を追加

// MCPサーバーの設定
const server = new Server(
  { name: "firecrawl-mcp", version: "1.7.0" },
  { capabilities: { tools: {}, logging: {} } }
);

// ツールハンドラーの設定
// 注: ここに既存のツールハンドラーを追加

// Expressアプリケーションの設定
const app = express();
app.use(cors());
app.use(express.json());

// セッション管理のためのマップ
const transports: { [sessionId: string]: SSEServerTransport } = {};

// SSEエンドポイント
app.get("/sse", async (_, res) => {
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
app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports[sessionId];

  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("No transport found for sessionId");
  }
});

// ヘルスチェックエンドポイント
app.get("/health", (_, res) => {
  res.status(200).send("OK");
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`Firecrawl MCP Server running on http://localhost:${PORT}`);
  safeLog("info", "Firecrawl MCP Server initialized successfully");
  safeLog("info", `Configuration: API URL: ${FIRECRAWL_API_URL || "default"}`);
});
```

### 3.2 .env ファイル

```
# Firecrawl API設定
FIRECRAWL_API_KEY=your-api-key
# FIRECRAWL_API_URL=https://firecrawl.your-domain.com  # 自己ホスト型インスタンスの場合

# サーバー設定
FIRECRAWL_PORT=3000

# リトライ設定
FIRECRAWL_RETRY_MAX_ATTEMPTS=3
FIRECRAWL_RETRY_INITIAL_DELAY=1000
FIRECRAWL_RETRY_MAX_DELAY=10000
FIRECRAWL_RETRY_BACKOFF_FACTOR=2

# クレジット監視
FIRECRAWL_CREDIT_WARNING_THRESHOLD=1000
FIRECRAWL_CREDIT_CRITICAL_THRESHOLD=100
```

### 3.3 package.json の修正

```json
{
  "name": "firecrawl-mcp",
  "version": "1.7.2",
  "description": "MCP server for Firecrawl web scraping integration with SSE support. Supports both cloud and self-hosted instances.",
  "type": "module",
  "bin": {
    "firecrawl-mcp": "dist/index.js"
  },
  "files": ["dist"],
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "build": "tsc && node -e \"require('fs').chmodSync('dist/index.js', '755')\"",
    "test": "node --experimental-vm-modules node_modules/jest/bin/jest.js",
    "start": "node dist/index.js",
    "lint": "eslint src/**/*.ts",
    "lint:fix": "eslint src/**/*.ts --fix",
    "format": "prettier --write .",
    "prepare": "npm run build",
    "publish": "npm run build && npm publish"
  },
  "license": "MIT",
  "dependencies": {
    "@mendable/firecrawl-js": "^1.19.0",
    "@modelcontextprotocol/sdk": "^1.4.1",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "express": "^4.18.2",
    "p-queue": "^8.0.1",
    "shx": "^0.3.4"
  },
  "devDependencies": {
    "@jest/globals": "^29.7.0",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.14",
    "@types/node": "^20.10.5",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^8.56.0",
    "eslint-config-prettier": "^9.1.0",
    "jest": "^29.7.0",
    "jest-mock-extended": "^4.0.0-beta1",
    "prettier": "^3.1.1",
    "ts-jest": "^29.1.1",
    "typescript": "^5.3.3"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "keywords": [
    "mcp",
    "firecrawl",
    "web-scraping",
    "crawler",
    "content-extraction",
    "sse"
  ]
}
```

## 4. クライアント設定例

### 4.1 Cursor 設定

```json
{
  "mcpServers": {
    "firecrawl-mcp": {
      "url": "http://localhost:3000/sse"
    }
  }
}
```

### 4.2 Claude Desktop 設定

```json
{
  "mcpServers": {
    "firecrawl-mcp": {
      "url": "http://localhost:3000/sse"
    }
  }
}
```

## 5. 実装のポイント

1. **既存コードの再利用**: 既存のツール定義とハンドラーコードを再利用することで、機能の一貫性を保ちます。

2. **エラーハンドリング**: リトライロジックとエラーロギングを実装して、安定した動作を確保します。

3. **セッション管理**: クライアントの接続と切断を適切に管理し、メモリリークを防止します。

4. **環境変数**: 設定を環境変数で柔軟に変更できるようにします。

5. **クレジット監視**: クラウド API を使用する場合、クレジット使用量を監視します。

## 6. デプロイ方法

### 6.1 ローカル実行

```bash
# 依存関係のインストール
npm install

# ビルド
npm run build

# 実行
npm start
```

### 6.2 Docker 実行

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
```

```bash
# Dockerイメージのビルド
docker build -t firecrawl-mcp-sse .

# Dockerコンテナの実行
docker run -p 3000:3000 -e FIRECRAWL_API_KEY=your-api-key firecrawl-mcp-sse
```

## 7. まとめ

この実装例では、SSE 対応の firecrawl-mcp サーバーを構築する方法を示しました。既存のコードベースを最大限に活用しながら、新しいトランスポート層を追加することで、ブラウザやリモートクライアントからも firecrawl の機能を利用できるようになります。
