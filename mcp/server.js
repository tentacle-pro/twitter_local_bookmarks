#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  searchBookmarks,
  importBookmarks,
  deleteBookmark,
  getStats,
} from "../lib/bookmarks-core.js";

const server = new Server(
  {
    name: "twitter-local-bookmarks",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 注册所有可用工具
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_twitter_bookmarks",
        description:
          "在本地推特书签库中进行中文/英文全文检索。适合用于查找用户保存的推文、推特上的技术教程、讨论、开源项目、资讯与灵感。支持结巴分词中文搜索。",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "搜索关键词，支持短语或多个词语组合",
            },
            limit: {
              type: "number",
              description: "返回的最大推文数量（默认为 10，最多 50）",
              default: 10,
            },
            full: {
              type: "boolean",
              description: "是否返回完整的原始字段（默认 false，紧凑模式节省 Token）",
              default: false,
            },
          },
          required: ["query"],
        },
      },
      {
        name: "get_twitter_bookmark_stats",
        description:
          "获取本地推特书签库的总体统计信息（包含已收录书签总数、最早和最新推文时间）。",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "import_twitter_bookmarks",
        description:
          "将由 twitter-web-exporter 导出的 JSON 格式推特书签文件导入到本地数据库，并自动更新中文全文检索索引。",
        inputSchema: {
          type: "object",
          properties: {
            filePath: {
              type: "string",
              description: "待导入的 JSON 文件的本地绝对或相对路径",
            },
          },
          required: ["filePath"],
        },
      },
      {
        name: "delete_twitter_bookmark",
        description: "根据推文 ID 从本地书签数据库和全文索引中删除指定书签。",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "推文 ID (tweet id)",
            },
          },
          required: ["id"],
        },
      },
    ],
  };
});

// 处理工具调用
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "search_twitter_bookmarks": {
        const query = args?.query || "";
        const limit = Math.min(Math.max(Number(args?.limit) || 10, 1), 50);
        const full = Boolean(args?.full);

        const results = searchBookmarks(query, { limit, full });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  query,
                  total_matched: results.length,
                  results,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "get_twitter_bookmark_stats": {
        const stats = getStats();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(stats, null, 2),
            },
          ],
        };
      }

      case "import_twitter_bookmarks": {
        const filePath = args?.filePath;
        if (!filePath) {
          throw new Error("filePath 不能为空");
        }
        const result = await importBookmarks(filePath);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "delete_twitter_bookmark": {
        const id = args?.id;
        if (!id) {
          throw new Error("推文 id 不能为空");
        }
        const result = deleteBookmark(id);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`未知的 MCP 工具: ${name}`);
    }
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `操作失败: ${error.message}`,
        },
      ],
    };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Twitter Local Bookmarks MCP Server running on stdio");
}

run().catch((err) => {
  console.error("MCP Server 启动失败:", err);
  process.exit(1);
});
