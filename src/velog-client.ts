const VELOG_V2_ENDPOINT = "https://v2.velog.io/graphql";
const VELOG_V3_ENDPOINT = "https://v3.velog.io/graphql";

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export class VelogClient {
  private accessToken: string | null;
  private refreshToken: string | null;

  constructor(accessToken?: string, refreshToken?: string) {
    this.accessToken = accessToken ?? null;
    this.refreshToken = refreshToken ?? null;
  }

  private async request<T>(query: string, variables?: Record<string, unknown>, endpoint = VELOG_V2_ENDPOINT): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Origin": "https://velog.io",
    };

    if (this.accessToken) {
      const cookieValue = `access_token=${this.accessToken}${this.refreshToken ? `; refresh_token=${this.refreshToken}` : ""}`;
      // Validate cookie is ByteString-safe (all chars <= 255) for Node.js fetch
      const isByteStringSafe = [...cookieValue].every((ch) => ch.charCodeAt(0) <= 255);
      if (isByteStringSafe) {
        headers["Cookie"] = cookieValue;
      }
    }

    // Extract operationName from query
    const operationMatch = query.match(/(?:query|mutation)\s+(\w+)/);
    const operationName = operationMatch?.[1] ?? undefined;

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ operationName, query, variables }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Velog API error: ${res.status} ${res.statusText} - ${text}`);
    }

    // Explicitly decode as UTF-8 to prevent Korean character corruption (U+FFFD ByteString error)
    const buf = await res.arrayBuffer();
    const decoded = new TextDecoder("utf-8").decode(buf);
    const json = JSON.parse(decoded) as GraphQLResponse<T>;

    if (json.errors?.length) {
      throw new Error(`GraphQL error: ${json.errors.map((e) => e.message).join(", ")}`);
    }

    if (!json.data) {
      throw new Error(`No data returned from Velog API. Raw response: ${JSON.stringify(json)}`);
    }

    return json.data;
  }

  async getUserPosts(username: string, cursor?: string, limit = 20) {
    const query = `
      query Posts($username: String!, $cursor: ID, $limit: Int) {
        posts(username: $username, cursor: $cursor, limit: $limit) {
          id
          title
          short_description
          thumbnail
          url_slug
          released_at
          updated_at
          is_private
          tags
        }
      }
    `;
    const data = await this.request<{ posts: unknown[] }>(query, { username, cursor, limit });
    return data.posts;
  }

  async readPost(username: string, url_slug: string) {
    const query = `
      query ReadPost($username: String!, $url_slug: String!) {
        post(username: $username, url_slug: $url_slug) {
          id
          title
          body
          short_description
          thumbnail
          url_slug
          released_at
          updated_at
          is_private
          is_markdown
          tags
          comments_count
          likes
          series {
            id
            name
          }
          user {
            id
            username
            profile {
              display_name
              thumbnail
            }
          }
          comments {
            id
            text
            created_at
            user {
              username
              profile {
                display_name
              }
            }
          }
          linked_posts {
            previous {
              id
              title
              url_slug
            }
            next {
              id
              title
              url_slug
            }
          }
        }
      }
    `;
    const data = await this.request<{ post: unknown }>(query, { username, url_slug });
    return data.post;
  }

  async writePost(params: {
    title: string;
    body: string;
    tags?: string[];
    is_markdown?: boolean;
    is_temp?: boolean;
    is_private?: boolean;
    url_slug?: string;
    thumbnail?: string;
    series_id?: string;
  }) {
    const query = `
      mutation WritePost($input: WritePostInput!) {
        writePost(input: $input) {
          id
          url_slug
          user {
            id
            username
          }
        }
      }
    `;
    const data = await this.request<{ writePost: unknown }>(query, {
      input: {
        title: params.title,
        body: params.body,
        tags: params.tags ?? [],
        is_markdown: params.is_markdown ?? true,
        is_temp: params.is_temp ?? false,
        is_private: params.is_private ?? false,
        url_slug: params.url_slug ?? "",
        meta: {},
        thumbnail: params.thumbnail ?? null,
        series_id: params.series_id ?? null,
        token: null,
      },
    }, VELOG_V3_ENDPOINT);
    return data.writePost;
  }

  async editPost(params: {
    id: string;
    title?: string;
    body?: string;
    tags?: string[];
    is_markdown?: boolean;
    is_temp?: boolean;
    is_private?: boolean;
    url_slug?: string;
    thumbnail?: string;
    series_id?: string;
  }) {
    const query = `
      mutation EditPost($input: EditPostInput!) {
        editPost(input: $input) {
          id
          url_slug
          user {
            id
            username
          }
        }
      }
    `;
    const data = await this.request<{ editPost: unknown }>(query, {
      input: {
        id: params.id,
        title: params.title,
        body: params.body,
        tags: params.tags ?? [],
        is_markdown: params.is_markdown ?? true,
        is_temp: params.is_temp ?? false,
        is_private: params.is_private ?? false,
        url_slug: params.url_slug ?? "",
        meta: {},
        thumbnail: params.thumbnail ?? null,
        series_id: params.series_id ?? null,
        token: null,
      },
    }, VELOG_V3_ENDPOINT);
    return data.editPost;
  }

  async deletePost(id: string) {
    const query = `
      mutation RemovePost($id: ID!) {
        removePost(id: $id)
      }
    `;
    const data = await this.request<{ removePost: boolean }>(query, { id });
    return data.removePost;
  }

  async getSeriesList(username: string) {
    const query = `
      query UserSeriesList($username: String!) {
        userSeriesList(username: $username) {
          id
          name
          description
          url_slug
          thumbnail
          created_at
          updated_at
          posts_count
        }
      }
    `;
    const data = await this.request<{ userSeriesList: unknown[] }>(query, { username });
    return data.userSeriesList;
  }

  async getTrendingPosts(offset = 0, limit = 20, timeframe = "week") {
    const url = `https://cache.velcdn.com/api/trending-posts?timeframe=${encodeURIComponent(timeframe)}&limit=${limit}&offset=${offset}`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`Velog trending API error: ${res.status} ${res.statusText}`);
    }

    // Explicitly decode as UTF-8 to prevent Korean character corruption
    const buf = await res.arrayBuffer();
    return JSON.parse(new TextDecoder("utf-8").decode(buf));
  }

  async getUserProfile(username: string) {
    const query = `
      query User($username: String!) {
        user(username: $username) {
          id
          username
          profile {
            display_name
            short_bio
            thumbnail
            about
          }
          velog_config {
            title
          }
        }
      }
    `;
    const data = await this.request<{ user: unknown }>(query, { username });
    return data.user;
  }

  async searchPosts(keyword: string, offset = 0, limit = 20, username?: string) {
    const query = `
      query SearchPosts($keyword: String!, $offset: Int, $limit: Int, $username: String) {
        searchPosts(keyword: $keyword, offset: $offset, limit: $limit, username: $username) {
          count
          posts {
            id
            title
            short_description
            thumbnail
            url_slug
            released_at
            tags
            user {
              username
              profile {
                display_name
              }
            }
          }
        }
      }
    `;
    const data = await this.request<{ searchPosts: { count: number; posts: unknown[] } }>(query, {
      keyword,
      offset,
      limit,
      username,
    });
    return data.searchPosts;
  }
}
