import FirecrawlApp from "@mendable/firecrawl-js";
import dotenv from "dotenv";

// 環境変数の読み込み (モジュールレベルで実行)
dotenv.config();

// 環境変数の取得
const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL;
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

// APIキーのチェック（クラウドサービスの場合のみ）
// アプリケーション起動時にチェックするため、ここではエラーを発生させない
if (!FIRECRAWL_API_URL && !FIRECRAWL_API_KEY) {
  console.warn(
    "Warning: FIRECRAWL_API_KEY environment variable is not set. This is required for the cloud service."
  );
}

// Firecrawlクライアントの初期化
export const client = new FirecrawlApp({
  apiKey: FIRECRAWL_API_KEY || "", // APIキーがない場合は空文字
  ...(FIRECRAWL_API_URL ? { apiUrl: FIRECRAWL_API_URL } : {}),
});

// リトライと監視の設定
export const CONFIG = {
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
  // API URL も CONFIG に含めておく
  apiUrl: FIRECRAWL_API_URL,
  apiKey: FIRECRAWL_API_KEY, // APIキーもCONFIGに含める
};

// APIキーの存在確認 (ツール側でも利用する可能性があるためエクスポート)
export const hasApiKey = !!CONFIG.apiKey;
export const isSelfHosted = !!CONFIG.apiUrl;

// APIキー必須チェック (クラウド利用時)
export function checkApiKeyRequirement(): void {
  if (!isSelfHosted && !hasApiKey) {
    console.error(
      "Error: FIRECRAWL_API_KEY environment variable is required when using the cloud service."
    );
    // 本番環境ではプロセスを終了させるべき
    // process.exit(1);
  }
}
