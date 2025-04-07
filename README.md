# Firecrawl MCP Server

このリポジトリは、[Model Context Protocol (MCP)](https://github.com/anthropics/model-context-protocol) を使用して、[Firecrawl](https://firecrawl.dev/) ウェブスクレイピングAPIをAIアシスタントに統合するためのサーバーを提供します。

## 機能

- **ウェブスクレイピング**: URLからHTMLコンテンツを抽出
- **ウェブクローリング**: 複数のページを自動的に巡回
- **データ抽出**: 構造化データの抽出
- **検索**: ウェブ上の情報検索
- **バッチ処理**: 複数のURLを一括処理
- **深層リサーチ**: 複雑なリサーチタスクの自動化

## 前提条件

- Node.js 18.0.0以上
- Docker (コンテナ化して実行する場合)
- Firecrawl APIキー (https://firecrawl.dev/ から取得可能)

## セットアップ

### 環境変数の設定

`.env.example` ファイルを `.env` にコピーし、必要な環境変数を設定します:

```bash
cp .env.example .env
```

`.env` ファイルを編集して、少なくとも以下の項目を設定してください:

```
FIRECRAWL_API_KEY=your-api-key-here
FIRECRAWL_PORT=3006
```

### 直接実行

```bash
# 依存関係のインストール
npm install

# ビルド
npm run build

# サーバーの起動
npm start
```

### Docker を使用した実行

リポジトリに含まれる便利なスクリプトを使用して、Dockerコンテナとしてサーバーを実行できます:

```bash
# スクリプトに実行権限を付与
chmod +x scripts/firecrawl-mcp.sh

# Dockerイメージのビルド
./scripts/firecrawl-mcp.sh build

# コンテナの起動
./scripts/firecrawl-mcp.sh start

# ログの表示
./scripts/firecrawl-mcp.sh logs

# コンテナの停止
./scripts/firecrawl-mcp.sh stop

# コンテナとイメージの削除
./scripts/firecrawl-mcp.sh delete
```

## 使用方法

サーバーが起動すると、以下のエンドポイントが利用可能になります:

- SSE接続: `http://localhost:3006/sse`
- ヘルスチェック: `http://localhost:3006/health`

## 利用可能なツール

このMCPサーバーは以下のツールを提供します:

1. `scrape` - 単一URLからHTMLコンテンツを抽出
2. `map` - 複数のURLからデータを抽出し、マッピング
3. `crawl` - 指定したURLから始めて、リンクを辿ってクローリング
4. `batch_scrape` - 複数のURLを一括でスクレイピング
5. `check_batch_status` - バッチジョブのステータスを確認
6. `check_crawl_status` - クロールジョブのステータスを確認
7. `search` - ウェブ上の情報を検索
8. `extract` - HTMLから構造化データを抽出
9. `deep_research` - 複雑なリサーチタスクを自動化
10. `generate_llmstxt` - LLMs.txtファイルを生成

## トラブルシューティング

- **APIキーエラー**: `.env` ファイルに有効なFirecrawl APIキーが設定されていることを確認してください。
- **ポートの競合**: `FIRECRAWL_PORT` 環境変数を変更して、別のポートを使用してください。
- **接続エラー**: ファイアウォールやネットワーク設定を確認してください。

## ライセンス

MIT

## Roo Code (Cline) への接続方法

Firecrawl MCPサーバーをRoo Code（Cline）に接続するには、以下の手順に従ってください：

### 1. MCPサーバーの起動

まず、上記の手順に従ってFirecrawl MCPサーバーを起動します：

```bash
# Dockerを使用する場合
./scripts/firecrawl-mcp.sh build
./scripts/firecrawl-mcp.sh start

# または直接実行する場合
npm install
npm run build
npm start
```

サーバーが `http://localhost:3006` で実行されていることを確認してください。

### 2. Clineの設定ファイルを編集

Clineの設定ファイル（通常は `~/.cline/config.json`）を編集して、Firecrawl MCPサーバーを追加します：

```json
{
  "mcpServers": {
    "firecrawl-sse-mcp-server-local": {
      "url": "http://localhost:${PORT}/sse"
    }
  }
}
```

### 3. Clineを再起動

設定を適用するために、Clineを再起動します。

### 4. 接続の確認

Clineで新しいチャットを開始し、以下のようなプロンプトを入力して接続を確認します：

```
Firecrawlを使って、https://example.com のコンテンツをスクレイピングしてください。
```

Clineが正常にFirecrawl MCPサーバーに接続され、ウェブスクレイピング機能が利用可能になります。
