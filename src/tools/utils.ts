import { CONFIG, isSelfHosted } from "./client.js";
import type { FirecrawlDocument } from "@mendable/firecrawl-js"; // 型のみインポート

// クレジット使用量の追跡
interface CreditUsage {
  total: number;
  lastCheck: number;
}

export const creditUsage: CreditUsage = {
  total: 0,
  lastCheck: Date.now(),
};

// ユーティリティ関数: 遅延
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ロギング関数 (シンプルなコンソール出力)
export function safeLog(
  level:
    | "error"
    | "debug"
    | "info"
    | "notice"
    | "warning"
    | "critical"
    | "alert"
    | "emergency",
  data: unknown
): void {
  const timestamp = new Date().toISOString();
  console.error(
    `[${timestamp}] [${level.toUpperCase()}] ${
      typeof data === "object" ? JSON.stringify(data) : data
    }`
  );
}

// ユーティリティ関数: リトライロジック
export async function withRetry<T>(
  operation: () => Promise<T>,
  context: string,
  attempt = 1
): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    // Catch error as unknown
    // Define a type for potential Axios-like errors
    interface AxiosError {
      response?: {
        status?: number;
      };
    }
    const isRateLimit =
      (error instanceof Error &&
        (error.message.includes("rate limit") ||
          error.message.includes("429"))) ||
      (typeof error === "object" &&
        error !== null &&
        (error as AxiosError).response?.status === 429); // Check Axios-like error structure

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
    // その他のエラーもログに出力
    if (!(error instanceof Error && isRateLimit)) {
      safeLog(
        "error",
        `Error during ${context} (attempt ${attempt}): ${error instanceof Error ? error.message : String(error)}`
      );
    }
    throw error; // リトライ上限を超えた場合やレートリミット以外のエラーは再スロー
  }
}

// ユーティリティ関数: クレジット使用量の更新
export async function updateCreditUsage(creditsUsed: number): Promise<void> {
  // セルフホストの場合はクレジットを追跡しない
  if (isSelfHosted) {
    return;
  }
  creditUsage.total += creditsUsed;
  safeLog(
    "info",
    `Credit usage update: +${creditsUsed}, Total: ${creditUsage.total}`
  );

  if (creditUsage.total >= CONFIG.credit.criticalThreshold) {
    safeLog(
      "critical",
      `CRITICAL: Credit usage threshold reached: ${creditUsage.total} / ${CONFIG.credit.criticalThreshold}`
    );
  } else if (creditUsage.total >= CONFIG.credit.warningThreshold) {
    safeLog(
      "warning",
      `WARNING: Credit usage threshold reached: ${creditUsage.total} / ${CONFIG.credit.warningThreshold}`
    );
  }
}

// ユーティリティ関数: レスポンスにクレジット情報が含まれるかチェック
export function hasCredits(
  response: unknown
): response is { creditsUsed: number } {
  return (
    typeof response === "object" &&
    response !== null &&
    "creditsUsed" in response &&
    typeof response.creditsUsed === "number"
  );
}

// ユーティリティ関数: レスポンステキストのトリミング
export function trimResponseText(text: string | undefined | null): string {
  // null や undefined の場合は空文字を返す
  return typeof text === "string" ? text.trim() : "";
}

// ヘルパー関数: クロール結果のフォーマット (check_crawl_status で使用)
export function formatResults(data: FirecrawlDocument[]): string {
  if (!Array.isArray(data)) {
    return "Invalid results data";
  }
  return data
    .map((doc) => {
      const content = doc.markdown || doc.html || doc.rawHtml || "No content";
      // コンテンツが長すぎる場合は切り詰める
      const truncatedContent =
        content.length > 200 ? content.substring(0, 200) + "..." : content;
      const title = doc.metadata?.title ? `Title: ${doc.metadata.title}` : "";
      return `URL: ${doc.url || "Unknown URL"}\n${title}\nContent Snippet: ${truncatedContent}`;
    })
    .join("\n\n---\n\n");
}
