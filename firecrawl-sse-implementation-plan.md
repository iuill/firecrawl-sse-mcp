# SSE 専用 firecrawl-mcp サーバー実装計画

## 1. 概要

現在の firecrawl-mcp-server は StdioServerTransport を使用していますが、これを完全に SSEServerTransport に置き換えて、ブラウザやリモートクライアントからアクセスできるようにします。

## 2. 必要な依存関係

- **Express.js**: SSE エンドポイントを提供するための Web サーバーフレームワーク
- **@modelcontextprotocol/sdk**: 既に依存関係に含まれており、SSEServerTransport を提供
- **cors**: CORS サポートのためのミドルウェア（オプション）

## 3. 実装方針

### 3.1 ファイル構造

```
src/
├── index.ts         # メインエントリーポイント（SSE専用に修正）
└── shared/          # 共通コード
    └── tools.ts     # ツール定義など（既存のツール定義を移動）
```

### 3.2 環境変数

```
FIRECRAWL_API_KEY    # 既存のFirecrawl APIキー
FIRECRAWL_API_URL    # 既存のFirecrawl API URL（オプション）
FIRECRAWL_PORT       # SSEサーバーのポート番号（デフォルト: 3000）
```

### 3.3 SSE サーバーの実装

```typescript
import express from "express";
import cors from "cors";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import dotenv from "dotenv";

dotenv.config();

// 環境変数の設定
const PORT = process.env.FIRECRAWL_PORT || 3000;

// Expressアプリケーションの設定
const app = express();
app.use(cors());
app.use(express.json());

// セッション管理のためのマップ
const transports: { [sessionId: string]: SSEServerTransport } = {};

// MCPサーバーの設定（既存のツール定義などを使用）
const server = new Server(
  { name: "firecrawl-mcp", version: "1.7.0" },
  { capabilities: { tools: {}, logging: {} } }
);

// ツールハンドラーの設定（既存のコードを再利用）
// ...

// SSEエンドポイント
app.get("/sse", async (_, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;

  res.on("close", () => {
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
});
```

### 3.4 既存のコードの再利用

既存の index.ts ファイルから以下の部分を再利用します：

1. ツール定義（SCRAPE_TOOL, MAP_TOOL, CRAWL_TOOL, など）
2. ツールハンドラー（server.setRequestHandler）
3. エラーハンドリングとロギング機能
4. Firecrawl API との連携コード

## 4. package.json の修正

```json
{
  "dependencies": {
    "@mendable/firecrawl-js": "^1.19.0",
    "@modelcontextprotocol/sdk": "^1.4.1",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "express": "^4.18.2",
    "p-queue": "^8.0.1"
  }
}
```

## 5. 使用方法

### 5.1 サーバー側

1. 環境変数を設定（.env ファイルまたはコマンドライン）

   ```
   FIRECRAWL_API_KEY=your-api-key
   FIRECRAWL_PORT=3000
   ```

2. サーバーを起動
   ```
   npm start
   ```

### 5.2 クライアント側

#### Cursor 設定

```json
{
  "mcpServers": {
    "firecrawl-mcp": {
      "url": "http://localhost:3000/sse"
    }
  }
}
```

#### Claude Desktop 設定

```json
{
  "mcpServers": {
    "firecrawl-mcp": {
      "url": "http://localhost:3000/sse"
    }
  }
}
```

## 6. 実装上の注意点

1. 既存のツール定義とハンドラーコードは再利用
2. エラーハンドリングとロギングは既存の実装を踏襲
3. セッション管理は適切に行い、メモリリークを防止
4. クライアントからの接続が切れた場合のクリーンアップ処理を実装
5. 複数クライアントからの同時接続に対応

## 7. 今後の拡張可能性

1. 認証機能の追加（必要に応じて）
2. HTTPS サポート
3. WebSocket サポート（SSE の代替として）
4. クラスタリングによる水平スケーリング
5. Docker コンテナ化

## 8. まとめ

SSE 専用の firecrawl-mcp サーバーを実装することで、ブラウザやリモートクライアントからも firecrawl の機能を利用できるようになります。既存のコードベースを最大限に活用しながら、新しいトランスポート層を追加することで、機能を拡張します。
