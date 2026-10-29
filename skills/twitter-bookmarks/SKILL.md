---
name: twitter-bookmarks
description: 在本地 SQLite 数据库中进行推特 (Twitter/X) 书签的中文全文检索、导入与管理。当用户询问推特上收藏的内容、寻找关于某个技术话题/项目/灵感相关的已保存推文、或者需要导入新的推特书签 JSON 文件时使用。触发词："推特书签", "Twitter书签", "推特上收藏过", "找推文", "检索书签", "导入推特书签".
---

# Twitter Local Bookmarks Skill

## 概述

此 Skill 让 Agent 可以直接与本地推特书签库（基于 SQLite FTS5 + `libsimple` 结巴分词）进行交互，**无需任何常驻后台服务或 HTTP 端口**，随调随走。

本项目提供了一个高效的 CLI 工具：`./bin/cli.js`（或 `node /Users/dio/workspace/twitter_local_bookmarks/bin/cli.js`）。

## 何时使用

**适用场景：**
- 用户让你查找推特/X 上收藏过的某个工具、仓库、Prompt 或技术观点（例如：“我记得推特收藏过一个视频生成模型……”）
- 用户让你按主题整理其推特书签知识库
- 用户提供了通过 `twitter-web-exporter` 导出的 JSON 文件，需要导入到本地库中
- 用户需要查询书签库状态统计，或删除某条推文

**不适用场景：**
- 搜索推特线上的实时公开内容（本项目仅检索用户本地已有的离线书签库）

## 常用命令与调用范式

> [!TIP]
> 针对 Agent 消费，推荐始终附加 `--json` 参数，以便获得结构化对象；推荐使用 `--limit 5` 或 `--limit 10` 控制上下文消耗。

### 1. 全文搜索推文书签

```bash
node /Users/dio/workspace/twitter_local_bookmarks/bin/cli.js search "<搜索关键词>" --limit 5 --json
```

**示例：**
```bash
node /Users/dio/workspace/twitter_local_bookmarks/bin/cli.js search "MCP server" --limit 3 --json
```

**返回字段说明：**
- `id`: 推文唯一 ID
- `author`: 作者昵称及用户名（如 `Avi Chawla (@_avichawla)`）
- `created_at`: 推文发布时间
- `text`: 推文正文文本（换行符保留）
- `url`: 推特原文直达链接
- `media`: 媒体资源原图/缩略图 URL 列表（若有）
- `metrics`: 互动数据（点赞 `favorite`、转推 `retweet`、浏览量 `views`）

### 2. 查看书签库统计概览

用于了解书签库规模及时间跨度：
```bash
node /Users/dio/workspace/twitter_local_bookmarks/bin/cli.js stats --json
```

### 3. 导入新的书签文件

当用户导出了新的 `bookmarks.json` 时：
```bash
node /Users/dio/workspace/twitter_local_bookmarks/bin/cli.js import "/path/to/bookmarks.json" --json
```

### 4. 删除指定书签

```bash
node /Users/dio/workspace/twitter_local_bookmarks/bin/cli.js delete "<tweet_id>" --json
```

---

## Agent 回复与处理指南

1. **信息提炼**：检索推文后，直接向用户总结该推文的核心内容与作者，无需将 JSON 原样贴出。
2. **附带链接**：在回答用户时，务必附带推文原链接 `url`，方便用户点击查看原文。
3. **分词建议**：底层使用的是结巴分词（cppjieba），支持自然的中文短语检索，若未检索到，可尝试将长句拆为 1~2 个核心关键词再次查询。
