#!/usr/bin/env node

import { searchBookmarks, importBookmarks, deleteBookmark, getStats } from "../lib/bookmarks-core.js";

function printHelp() {
  console.log(`
Twitter Local Bookmarks CLI (面向 Agent 与本地开发者的数据接口)

用法:
  tb-cli <command> [options]

命令:
  search <query>          全文检索推特书签
    --limit <n>           限制返回条数 (默认 10)
    --full                返回推文的全部原始字段
    --json                以纯 JSON 格式输出 (Agent 推荐)

  import <filePath>       导入由 twitter-web-exporter 导出的 JSON 书签文件
    --json                以 JSON 格式输出结果

  delete <tweetId>        根据推文 ID 从本地库中删除书签
    --json                以 JSON 格式输出结果

  stats                   查看书签库统计信息 (总数、最早/最新推文)
    --json                以 JSON 格式输出结果

  help, -h, --help        显示帮助信息

环境变量:
  DB_PATH                 指定 sqlite.db 路径 (默认使用当前项目根目录的 sqlite.db)
`);
}

function parseArgs(args) {
  const parsed = {
    command: args[0],
    positionals: [],
    flags: {}
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") {
      parsed.flags.json = true;
    } else if (arg === "--full") {
      parsed.flags.full = true;
    } else if (arg === "--limit") {
      parsed.flags.limit = parseInt(args[++i], 10) || 10;
    } else if (arg.startsWith("--limit=")) {
      parsed.flags.limit = parseInt(arg.split("=")[1], 10) || 10;
    } else if (arg === "-h" || arg === "--help") {
      parsed.flags.help = true;
    } else if (!arg.startsWith("-")) {
      parsed.positionals.push(arg);
    }
  }

  return parsed;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    printHelp();
    process.exit(0);
  }

  const { command, positionals, flags } = parseArgs(args);

  if (flags.help || command === "help") {
    printHelp();
    process.exit(0);
  }

  try {
    switch (command) {
      case "search": {
        const query = positionals.join(" ").trim();
        if (!query) {
          console.error("错误: 请提供搜索关键词。例如: tb-cli search \"大模型 Agent\"");
          process.exit(1);
        }
        const results = searchBookmarks(query, {
          limit: flags.limit || 10,
          full: Boolean(flags.full)
        });

        if (flags.json) {
          console.log(JSON.stringify(results, null, 2));
        } else {
          console.log(`\n🔍 找到 ${results.length} 条关于 "${query}" 的推特书签:\n`);
          results.forEach((item, idx) => {
            console.log(`[${idx + 1}] ${item.author} (${item.created_at})`);
            console.log(`🔗 ${item.url}`);
            console.log(`📝 ${item.text.replace(/\n+/g, " ").slice(0, 150)}${item.text.length > 150 ? "..." : ""}`);
            if (item.metrics) {
              console.log(`👍 ${item.metrics.favorite} | 🔁 ${item.metrics.retweet} | 👀 ${item.metrics.views || 0}`);
            }
            console.log("-".repeat(50));
          });
        }
        break;
      }

      case "import": {
        const filePath = positionals[0];
        if (!filePath) {
          console.error("错误: 请提供待导入的 JSON 文件路径。例如: tb-cli import ./bookmarks.json");
          process.exit(1);
        }
        const onProgress = flags.json ? undefined : (curr, total) => {
          process.stdout.write(`\r⏳ 正在写入推文数据: ${curr} / ${total} (${Math.round((curr / total) * 100)}%)...`);
        };
        const res = await importBookmarks(filePath, { onProgress });
        if (!flags.json) {
          console.log(`\n✅ 成功导入 ${res.count} 条书签并已更新全文检索索引！`);
          if (res.backup) {
            console.log(`📦 数据库已自动备份至: ${res.backup}`);
          }
        } else {
          console.log(JSON.stringify(res, null, 2));
        }
        break;
      }

      case "delete": {
        const id = positionals[0];
        if (!id) {
          console.error("错误: 请提供待删除的推文 ID。例如: tb-cli delete 1234567890");
          process.exit(1);
        }
        const res = deleteBookmark(id);
        if (flags.json) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          if (res.deleted) {
            console.log(`🗑️ 已成功删除推文 ID: ${id}`);
          } else {
            console.log(`⚠️ 未找到推文 ID: ${id}（可能不存在）`);
          }
        }
        break;
      }

      case "stats": {
        const stats = getStats();
        if (flags.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log("\n📊 推特书签库状态统计:");
          console.log(`- 书签总数: ${stats.totalBookmarks} 条`);
          console.log(`- 最早推文时间: ${stats.earliestTweet || "无"}`);
          console.log(`- 最新推文时间: ${stats.latestTweet || "无"}\n`);
        }
        break;
      }

      default: {
        console.error(`未知命令: ${command}`);
        printHelp();
        process.exit(1);
      }
    }
  } catch (err) {
    if (flags.json) {
      console.error(JSON.stringify({ error: err.message }));
    } else {
      console.error(`❌ 执行出错: ${err.message}`);
    }
    process.exit(1);
  }
}

main();
