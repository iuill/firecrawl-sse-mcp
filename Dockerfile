# --- ベースステージ ---
# イメージサイズを小さくするため、公式のNode.js Alpineイメージを使用
FROM node:23-alpine AS base

# コンテナ内の作業ディレクトリを設定
WORKDIR /app

# セキュリティのため、非ルートユーザーとグループを作成
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# --- ビルドステージ ---
# このステージでは、すべての依存関係（開発用を含む）をインストールし、アプリをビルドします
FROM base AS build

# package.json と package-lock.json をコピー
COPY --chown=appuser:appgroup package*.json ./

# すべての依存関係（ビルドに必要なdevDependenciesを含む）をインストール
# package-lock.json に基づいた再現可能なインストールのために npm ci を使用
RUN npm ci

# 残りのアプリケーションソースコードをコピー
COPY --chown=appuser:appgroup . .

# TypeScriptアプリケーションをビルド
RUN npm run build

# --- プロダクションステージ ---
# このステージでは、最終的な軽量の本番イメージを作成します
FROM base AS production

WORKDIR /app

# 本番用の依存関係をインストールするために package.json と package-lock.json をコピー
COPY --chown=appuser:appgroup package*.json ./

# 本番用の依存関係のみをインストール
RUN npm ci --only=production

# ビルドステージからビルドされたアプリケーション成果物をコピー
COPY --chown=appuser:appgroup --from=build /app/dist ./dist

# 実行時に必要な他のファイル（例: .env.example）をコピー
# 注意: 実際の .env ファイルは、直接コピーするのではなく、シークレットやボリュームマウントで管理する必要があります。
# COPY --chown=appuser:appgroup .env.example .env.example

# 非ルートユーザーに切り替え
USER appuser

# アプリケーションポートを公開（デフォルトは3000、PORT環境変数で上書き可能）
EXPOSE ${PORT:-3004}

# アプリケーションを実行するコマンドを定義
# npm start よりも node を直接使用する方が若干効率的
CMD ["node", "dist/index.js"]