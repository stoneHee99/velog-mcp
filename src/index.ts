import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VelogClient } from "./velog-client.js";
import { loadTokens, loginAndExtractTokens } from "./auth.js";

// Load tokens: env vars > saved file
function resolveTokens() {
  const envAccess = process.env.VELOG_ACCESS_TOKEN;
  const envRefresh = process.env.VELOG_REFRESH_TOKEN;
  if (envAccess) {
    return { accessToken: envAccess, refreshToken: envRefresh };
  }
  const saved = loadTokens();
  if (saved) {
    return { accessToken: saved.accessToken, refreshToken: saved.refreshToken };
  }
  return { accessToken: undefined, refreshToken: undefined };
}

let tokens = resolveTokens();
let client = new VelogClient(tokens.accessToken, tokens.refreshToken);

const server = new McpServer({
  name: "velog-mcp",
  version: "0.1.0",
});

// ── Auth tool ──

server.tool(
  "login",
  "Open a browser to log in to Velog and save authentication tokens",
  {},
  async () => {
    try {
      const result = await loginAndExtractTokens();
      tokens = { accessToken: result.accessToken, refreshToken: result.refreshToken };
      client = new VelogClient(tokens.accessToken, tokens.refreshToken);
      return {
        content: [{ type: "text", text: `Login successful! Tokens saved. (access_token expires in ~1 day, refresh_token in ~30 days)` }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Login failed: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

// ── Read tools (no auth required) ──

server.tool(
  "get_user_posts",
  "Get a list of posts by a Velog user",
  {
    username: z.string().describe("Velog username"),
    cursor: z.string().optional().describe("Cursor for pagination (post ID)"),
    limit: z.number().min(1).max(100).default(20).describe("Number of posts to fetch"),
  },
  async ({ username, cursor, limit }) => {
    const posts = await client.getUserPosts(username, cursor, limit);
    return { content: [{ type: "text", text: JSON.stringify(posts, null, 2) }] };
  },
);

server.tool(
  "read_post",
  "Read a specific Velog post with full content, comments, and metadata",
  {
    username: z.string().describe("Velog username"),
    url_slug: z.string().describe("Post URL slug"),
  },
  async ({ username, url_slug }) => {
    const post = await client.readPost(username, url_slug);
    return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
  },
);

server.tool(
  "get_trending_posts",
  "Get trending posts from Velog",
  {
    offset: z.number().min(0).default(0).describe("Offset for pagination"),
    limit: z.number().min(1).max(100).default(20).describe("Number of posts to fetch"),
    timeframe: z
      .enum(["day", "week", "month"])
      .default("week")
      .describe("Timeframe for trending"),
  },
  async ({ offset, limit, timeframe }) => {
    const posts = await client.getTrendingPosts(offset, limit, timeframe);
    return { content: [{ type: "text", text: JSON.stringify(posts, null, 2) }] };
  },
);

server.tool(
  "get_user_profile",
  "Get a Velog user's profile information",
  {
    username: z.string().describe("Velog username"),
  },
  async ({ username }) => {
    const profile = await client.getUserProfile(username);
    return { content: [{ type: "text", text: JSON.stringify(profile, null, 2) }] };
  },
);

server.tool(
  "get_series_list",
  "Get a user's series list on Velog",
  {
    username: z.string().describe("Velog username"),
  },
  async ({ username }) => {
    const series = await client.getSeriesList(username);
    return { content: [{ type: "text", text: JSON.stringify(series, null, 2) }] };
  },
);

server.tool(
  "search_posts",
  "Search for posts on Velog by keyword",
  {
    keyword: z.string().describe("Search keyword"),
    offset: z.number().min(0).default(0).describe("Offset for pagination"),
    limit: z.number().min(1).max(100).default(20).describe("Number of results"),
    username: z.string().optional().describe("Filter by username"),
  },
  async ({ keyword, offset, limit, username }) => {
    const results = await client.searchPosts(keyword, offset, limit, username);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  },
);

// ── Write tools (auth required) ──

function requireAuth() {
  if (!tokens.accessToken) {
    return {
      content: [{ type: "text" as const, text: "Not authenticated. Please run the 'login' tool first to open a browser and log in." }],
      isError: true as const,
    };
  }
  return null;
}

server.tool(
  "write_post",
  "Create a new post on Velog (requires authentication)",
  {
    title: z.string().describe("Post title"),
    body: z.string().describe("Post body (markdown)"),
    tags: z.array(z.string()).optional().describe("Tags for the post"),
    is_private: z.boolean().default(false).describe("Whether the post is private"),
    url_slug: z.string().optional().describe("Custom URL slug"),
    series_id: z.string().optional().describe("Series ID to add the post to"),
  },
  async ({ title, body, tags, is_private, url_slug, series_id }) => {
    const authError = requireAuth();
    if (authError) return authError;
    // url_slug is required by Velog API; auto-generate from title if not provided
    const slug = url_slug ?? title.replace(/[^a-zA-Z0-9가-힣\s-]/g, "").replace(/\s+/g, "-").toLowerCase();
    const post = await client.writePost({ title, body, tags, is_private, url_slug: slug, series_id });
    return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
  },
);

server.tool(
  "edit_post",
  "Edit an existing post on Velog (requires authentication)",
  {
    id: z.string().describe("Post ID to edit"),
    title: z.string().optional().describe("New title"),
    body: z.string().optional().describe("New body (markdown)"),
    tags: z.array(z.string()).optional().describe("New tags"),
    is_private: z.boolean().optional().describe("Whether the post is private"),
    url_slug: z.string().optional().describe("New URL slug"),
    series_id: z.string().optional().describe("Series ID"),
  },
  async ({ id, title, body, tags, is_private, url_slug, series_id }) => {
    const authError = requireAuth();
    if (authError) return authError;
    const post = await client.editPost({ id, title, body, tags, is_private, url_slug, series_id });
    return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
  },
);

server.tool(
  "delete_post",
  "Delete a post on Velog (requires authentication)",
  {
    id: z.string().describe("Post ID to delete"),
  },
  async ({ id }) => {
    const authError = requireAuth();
    if (authError) return authError;
    const result = await client.deletePost(id);
    return { content: [{ type: "text", text: result ? "Post deleted successfully." : "Failed to delete post." }] };
  },
);

// ── Start server ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const authStatus = tokens.accessToken ? "authenticated" : "not authenticated (use 'login' tool)";
  console.error(`Velog MCP server running on stdio (${authStatus})`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
