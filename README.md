# 在本地搜索从推特导出的书签 (Twitter Local Bookmarks)

书签是用 [twitter-web-exporter](https://github.com/prinsss/twitter-web-exporter) 导出的 JSON 格式文件，本项目将它导入到本地的 SQLite 数据库文件中，配合 `libsimple`（结巴分词扩展）实现高性能中文全文检索。

本项目不仅提供 Web 前端界面，还专门支持 **无守护进程/无常驻端口** 的 **Agent Skills** 与 **MCP (Model Context Protocol)** 接入方式，可作为各类 AI 智能体的私有推特知识库数据源。

---

## 🤖 面向 AI 智能体接入（无常驻、零端口占用）

因为底层基于嵌入式 SQLite，无需启动长驻容器或开放端口，随调随走。

### 方式 A：标准 MCP Server（推荐）

适用于 Claude Desktop、Cursor、Cline、Gemini CLI、Windsurf 等支持 MCP 的客户端。

#### 客户端配置示例：

在各客户端的 MCP 配置文件（如 `claude_desktop_config.json` 或 `mcpServers`）中加入：

```json
{
  "mcpServers": {
    "twitter-bookmarks": {
      "command": "node",
      "args": ["/Users/dio/workspace/twitter_local_bookmarks/mcp/server.js"],
      "env": {
        "DB_PATH": "/Users/dio/workspace/twitter_local_bookmarks/sqlite.db"
      }
    }
  }
}
```

> **优势**：当 Agent 加载了大量技能时，可在宿主客户端中按需勾选或临时关闭该 MCP 服务，极大节省上下文 Token 预算。

#### 提供的 MCP 工具：
- `search_twitter_bookmarks`: 中文/英文全文检索书签（可限制返回数量 `limit`）
- `get_twitter_bookmark_stats`: 查看书签库收录总数及时间跨度
- `import_twitter_bookmarks`: 导入本地 JSON 文件到数据库
- `delete_twitter_bookmark`: 根据 ID 删除书签

---

### 方式 B：Agent Skill + `tb-agent`

适用于原生支持 Agent Skills 规范的 AI Coding Agent，以及任何能执行 shell 的宿主。

本仓库不再维护第二份技能定义——权威版本是 Obsidian vault 里的
`.agents/skills/twitter-bookmarks/SKILL.md`（沙箱感知，直接指向 `bin/tb-agent`）。
仓库这边只保留可执行入口，避免两份文档漂移：

```bash
# 全文检索推文（--json 专门优化了数据体积，去除冗余嵌套）
node ./bin/tb-agent search "Agent" --limit 5 --json

# 查看书签库状态
node ./bin/tb-agent stats --json

# 导入书签文件（需要库目录写权限；沙箱内会返回退出码 4 并给出手动命令）
node ./bin/tb-agent import /path/to/bookmarks.json --json

# 删除指定 ID 的书签（同上，需要写权限）
node ./bin/tb-agent delete 1911790193885032829 --json
```

> 为什么不是 `bin/cli.js`：见下一节的沙箱说明。`bin/cli.js` 仍是底层实现，
> `tb-agent` 只是替它选库路径、加写入保护。

---

### 🛡️ Agent 用法（沙箱安全与只读快照适配）

在受限文件沙箱（如 Claude Code seatbelt、DSH、只读容器等）中运行时，沙箱通常只允许向 `/tmp` 或当前工作目录写入，禁止向仓库根目录写入。由于 SQLite 在即使只读打开时也需要在库文件旁创建临时索引与日志（`-shm`/`-wal`），直接调用 `node bin/cli.js` 会触发 `unable to open database file` 错误。

为此，项目提供了专为智能体调用的包装入口 **`bin/tb-agent`**：

#### 工作机制
1. **自动探测权限**：在仓库根目录创建临时探针文件；可写时直接操作真库 `sqlite.db`。
2. **只读快照隔离**：当检测到仓库只读（或设置了 `TB_FORCE_SNAPSHOT=1`）时，`search` 与 `stats` 自动从源库同步快照到 `${TMPDIR:-/tmp}/twitter-bookmarks-ro/sqlite.db`（仅当源库更新时刷新，原子重命名写入），避免锁库与沙箱报错。
3. **写入安全保护**：沙箱环境下严禁对快照执行写操作；调用 `import` 或 `delete` 时会立即拦截并在 stderr 输出可直接复制的手动执行命令，返回退出码 `4`。
4. **纯净标准输出**：stdout 仅输出命令结果（`--json` 下保证可被 `JSON.parse` 直接解析），所有诊断与提示信息走 stderr。

#### 沙箱内调用示例
```bash
# 智能体检索推文（推荐加 --json 与 --limit）
node /path/to/twitter_local_bookmarks/bin/tb-agent search "MCP" --limit 5 --json

# 查看统计信息
node /path/to/twitter_local_bookmarks/bin/tb-agent stats --json

# 强制测试只读快照分支
TB_FORCE_SNAPSHOT=1 node /path/to/twitter_local_bookmarks/bin/tb-agent search "Obsidian" --limit 1 --json
```

**退出码约定**：
- `0`: 成功
- `2`: 用法错误（如无参数调用）
- `3`: 快照创建/复制失败
- `4`: 无写权限（在只读环境中尝试 import 或 delete）

---

## 🌐 网页端 UI 运行（适合人类直观翻阅）

### 方式一：Docker 运行

```bash
# 本地构建并运行
./build_docker.sh
./run_docker.sh

# 或直接拉取预构建镜像
# 查看 Docker Hub: https://hub.docker.com/r/candozhou/twitter-local-bookmarks
```

### 方式二：本地 Node/pnpm 开发运行

```bash
# 安装依赖
pnpm install

# 启动开发环境
pnpm dev

# 编译并以生产模式启动
pnpm build
pnpm start
```
