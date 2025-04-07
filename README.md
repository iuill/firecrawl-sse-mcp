# Firecrawl MCP Server (SSE)

This is an MCP (Model Context Protocol) server that integrates with the Firecrawl API for web scraping and crawling, using SSE (Server-Sent Events) for communication.

## Features

- Provides Firecrawl's `scrape`, `crawl`, and `map` functionalities as MCP tools.
- Uses SSE for communication, allowing connections from browsers and remote clients.
- Supports both Firecrawl cloud service and self-hosted instances.
- Includes retry logic and optional credit usage monitoring.

## Setup

1.  **Clone the repository (or create the project structure).**
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Create a `.env` file** based on `.env.example` and add your Firecrawl API key:
    ```
    FIRECRAWL_API_KEY=your-api-key
    # Optionally set FIRECRAWL_API_URL for self-hosted instances
    # Optionally configure FIRECRAWL_PORT (default: 3000)
    ```
4.  **Build the project:**
    ```bash
    npm run build
    ```

## Usage

1.  **Start the server:**
    ```bash
    npm start
    ```
    The server will be running on `http://localhost:3000` (or the port specified in `.env`).

2.  **Configure your MCP client** (e.g., Cursor, Claude Desktop) to connect to the server's SSE endpoint: `http://localhost:3000/sse`

    **Example Cursor `settings.json`:**
    ```json
    {
      "mcpServers": {
        "firecrawl-mcp": {
          "url": "http://localhost:3000/sse"
        }
      }
    }
    ```

## Available Tools

- `scrape`: Scrapes a single URL.
- `crawl`: Crawls a website starting from a given URL.
- `map`: (If implemented) Maps the structure of a website.

## Environment Variables

- `FIRECRAWL_API_KEY`: (Required if not self-hosting) Your Firecrawl API key.
- `FIRECRAWL_API_URL`: (Optional) URL of your self-hosted Firecrawl instance.
- `FIRECRAWL_PORT`: (Optional) Port for the MCP server (default: 3000).
- `FIRECRAWL_RETRY_MAX_ATTEMPTS`: (Optional) Max retry attempts for API calls.
- `FIRECRAWL_RETRY_INITIAL_DELAY`: (Optional) Initial delay for retries (ms).
- `FIRECRAWL_RETRY_MAX_DELAY`: (Optional) Max delay for retries (ms).
- `FIRECRAWL_RETRY_BACKOFF_FACTOR`: (Optional) Backoff factor for retries.
- `FIRECRAWL_CREDIT_WARNING_THRESHOLD`: (Optional) Credit usage warning threshold.
- `FIRECRAWL_CREDIT_CRITICAL_THRESHOLD`: (Optional) Credit usage critical threshold.