import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

/**
 * 获取或初始化带有中文全文分词插件支持的 SQLite 数据库实例
 * @param {string} [customDbPath] 可选自定义数据库路径，默认使用 PROJECT_ROOT/sqlite.db 或环境变量 DB_PATH
 */
export function getDatabase(customDbPath) {
  const dbPath = customDbPath || process.env.DB_PATH || path.join(PROJECT_ROOT, "sqlite.db");

  // 确保数据库文件目录存在
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // 开启 WAL 模式，确保并发读写不锁表
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  // 加载 libsimple 中文全文检索扩展
  const libDir = path.join(PROJECT_ROOT, "lib");
  const platform = process.platform;
  if (platform === "win32") {
    db.loadExtension(path.join(libDir, "simple"));
  } else {
    db.loadExtension(path.join(libDir, "libsimple"));
  }

  // 设置 jieba 词典路径
  const dictPath = path.join(libDir, "dict");
  db.prepare("SELECT jieba_dict(?)").run(dictPath);

  // 初始化主表
  db.exec(`
    CREATE TABLE IF NOT EXISTS twitter_bookmarks (
      id TEXT PRIMARY KEY,
      created_at TEXT,
      full_text TEXT,
      media TEXT,
      screen_name TEXT,
      name TEXT,
      profile_image_url TEXT,
      in_reply_to TEXT,
      retweeted_status TEXT,
      quoted_status TEXT,
      favorite_count INTEGER,
      retweet_count INTEGER,
      bookmark_count INTEGER,
      quote_count INTEGER,
      reply_count INTEGER,
      views_count INTEGER,
      favorited INTEGER,
      retweeted INTEGER,
      bookmarked INTEGER,
      url TEXT
    );
  `);

  // 初始化 FTS5 全文索引表
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS twitter_bookmarks_fts 
    USING fts5(id, full_text, screen_name, name, tokenize = 'simple');
  `);

  return db;
}

/**
 * 中文全文检索书签
 * @param {string} query 检索关键词
 * @param {object} options
 * @param {number} [options.limit=20] 最多返回结果数量
 * @param {boolean} [options.full=false] 是否输出完整原始推文结构（包含媒体、转推等完整 JSON）
 * @param {string} [options.dbPath] 自定义数据库路径
 */
export function searchBookmarks(query, { limit = 20, full = false, dbPath } = {}) {
  if (!query || !query.trim()) {
    return [];
  }

  const db = getDatabase(dbPath);
  try {
    const rows = db.prepare(`
      SELECT tb.*
      FROM twitter_bookmarks_fts fts
      JOIN twitter_bookmarks tb ON fts.id = tb.id
      WHERE fts.full_text MATCH simple_query(?)
      ORDER BY tb.created_at DESC
      LIMIT ?
    `).all(query.trim(), limit);

    return rows.map((row) => {
      if (full) {
        return {
          ...row,
          media: row.media ? JSON.parse(row.media) : [],
          in_reply_to: row.in_reply_to ? JSON.parse(row.in_reply_to) : null,
          retweeted_status: row.retweeted_status ? JSON.parse(row.retweeted_status) : null,
          quoted_status: row.quoted_status ? JSON.parse(row.quoted_status) : null,
          favorited: Boolean(row.favorited),
          retweeted: Boolean(row.retweeted),
          bookmarked: Boolean(row.bookmarked)
        };
      }

      // 紧凑模式：专门为 Agent 上下文优化，去除大量嵌套长 JSON
      let mediaUrls = [];
      try {
        if (row.media) {
          const parsed = JSON.parse(row.media);
          if (Array.isArray(parsed)) {
            mediaUrls = parsed.map((m) => m.original || m.thumbnail || m.url).filter(Boolean);
          }
        }
      } catch (e) {
        // ignore parse error
      }

      return {
        id: row.id,
        author: `${row.name} (@${row.screen_name})`,
        created_at: row.created_at,
        text: row.full_text,
        url: row.url || `https://x.com/${row.screen_name}/status/${row.id}`,
        media: mediaUrls.length > 0 ? mediaUrls : undefined,
        metrics: {
          favorite: row.favorite_count || 0,
          retweet: row.retweet_count || 0,
          views: row.views_count || 0
        }
      };
    });
  } finally {
    db.close();
  }
}

/**
 * 标准化 twitter-web-exporter 导出的 Dexie 原始推文对象
 */
function normalizeDexieTweet(t) {
  const legacy = t.legacy || {};
  const user = t.core?.user_results?.result || {};
  const userCore = user.core || {};
  const userLegacy = user.legacy || {};
  const screen_name = userCore.screen_name || userLegacy.screen_name || '';
  const name = userCore.name || userLegacy.name || '';
  const profile_image_url = user.avatar?.image_url || userLegacy.profile_image_url_https || '';

  const rawMedia = legacy.extended_entities?.media || legacy.entities?.media || [];
  const media = rawMedia.map((m) => ({
    type: m.type || 'photo',
    url: m.url || m.expanded_url || '',
    thumbnail: m.media_url_https ? m.media_url_https + '?format=jpg&name=thumb' : '',
    original: m.media_url_https ? m.media_url_https + '?format=jpg&name=orig' : ''
  }));

  let created_at = legacy.created_at;
  if (created_at) {
    try {
      const d = new Date(created_at);
      if (!isNaN(d.getTime())) {
        created_at = d.toISOString().replace('T', ' ').slice(0, 19);
      }
    } catch (e) {
      // 保留原始字符串
    }
  }

  return {
    id: String(t.rest_id || t.id),
    created_at: created_at || '',
    full_text: legacy.full_text || t.full_text || '',
    media,
    screen_name,
    name,
    profile_image_url,
    in_reply_to: legacy.in_reply_to_status_id_str || null,
    retweeted_status: legacy.retweeted_status_result || null,
    quoted_status: t.quoted_status_result || null,
    favorite_count: legacy.favorite_count || 0,
    retweet_count: legacy.retweet_count || 0,
    bookmark_count: legacy.bookmark_count || 0,
    quote_count: legacy.quote_count || 0,
    reply_count: legacy.reply_count || 0,
    views_count: t.views?.count ? parseInt(t.views.count, 10) : null,
    favorited: Boolean(legacy.favorited),
    retweeted: Boolean(legacy.retweeted),
    bookmarked: Boolean(legacy.bookmarked),
    url: screen_name && (t.rest_id || t.id) ? `https://x.com/${screen_name}/status/${t.rest_id || t.id}` : ''
  };
}

/**
 * 导入 Twitter 书签（支持 JSON 文件路径或书签对象数组，兼容 Dexie 导出备份与扁平数组）
 * @param {string | Array<object> | object} fileOrBookmarks 文件路径或书签数据
 * @param {object} [options]
 * @param {string} [options.dbPath] 自定义数据库路径
 * @param {function} [options.onProgress] 进度回调 (importedCount, total)
 */
export function importBookmarks(fileOrBookmarks, { dbPath, onProgress } = {}) {
  let rawData;
  if (typeof fileOrBookmarks === "string") {
    if (!fs.existsSync(fileOrBookmarks)) {
      throw new Error(`文件不存在: ${fileOrBookmarks}`);
    }
    const raw = fs.readFileSync(fileOrBookmarks, "utf-8");
    rawData = JSON.parse(raw);
  } else {
    rawData = fileOrBookmarks;
  }

  let bookmarks = [];

  // 判断数据格式：1. 扁平数组
  if (Array.isArray(rawData)) {
    bookmarks = rawData;
  } 
  // 2. Dexie IndexedDB 导出备份格式
  else if (rawData && typeof rawData === "object") {
    if (rawData.formatName === "dexie" && Array.isArray(rawData.data?.data)) {
      const tweetsTable = rawData.data.data.find((d) => d.tableName === "tweets");
      if (tweetsTable && Array.isArray(tweetsTable.rows)) {
        bookmarks = tweetsTable.rows.map(normalizeDexieTweet);
      }
    } else if (Array.isArray(rawData.bookmarks)) {
      bookmarks = rawData.bookmarks;
    } else if (Array.isArray(rawData.tweets)) {
      bookmarks = rawData.tweets;
    }
  }

  // 过滤掉无效或脏数据
  bookmarks = bookmarks.filter((item) => item && (item.id || item.rest_id));

  if (bookmarks.length === 0) {
    return { success: true, count: 0, message: "没有待导入的书签" };
  }

  const db = getDatabase(dbPath);
  try {
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO twitter_bookmarks (
        id, created_at, full_text, media, screen_name, name, profile_image_url,
        in_reply_to, retweeted_status, quoted_status, favorite_count, retweet_count,
        bookmark_count, quote_count, reply_count, views_count, favorited, retweeted,
        bookmarked, url
      ) VALUES (
        @id, @created_at, @full_text, @media, @screen_name, @name, @profile_image_url,
        @in_reply_to, @retweeted_status, @quoted_status, @favorite_count, @retweet_count,
        @bookmark_count, @quote_count, @reply_count, @views_count, @favorited, @retweeted,
        @bookmarked, @url
      )
    `);

    // 分批事务插入，默认每批 2000 条，提升性能并减少内存压力
    const BATCH_SIZE = 2000;
    const batchTransaction = db.transaction((batch) => {
      for (const item of batch) {
        insertStmt.run({
          id: String(item.id || item.rest_id),
          created_at: item.created_at || "",
          full_text: item.full_text || "",
          media: typeof item.media === "string" ? item.media : JSON.stringify(item.media || []),
          screen_name: item.screen_name || "",
          name: item.name || "",
          profile_image_url: item.profile_image_url || "",
          in_reply_to: typeof item.in_reply_to === "string" ? item.in_reply_to : JSON.stringify(item.in_reply_to || null),
          retweeted_status: typeof item.retweeted_status === "string" ? item.retweeted_status : JSON.stringify(item.retweeted_status || null),
          quoted_status: typeof item.quoted_status === "string" ? item.quoted_status : JSON.stringify(item.quoted_status || null),
          favorite_count: item.favorite_count || 0,
          retweet_count: item.retweet_count || 0,
          bookmark_count: item.bookmark_count || 0,
          quote_count: item.quote_count || 0,
          reply_count: item.reply_count || 0,
          views_count: item.views_count || 0,
          favorited: item.favorited ? 1 : 0,
          retweeted: item.retweeted ? 1 : 0,
          bookmarked: item.bookmarked ? 1 : 0,
          url: item.url || (item.screen_name && (item.id || item.rest_id) ? `https://x.com/${item.screen_name}/status/${item.id || item.rest_id}` : "")
        });
      }
    });

    for (let i = 0; i < bookmarks.length; i += BATCH_SIZE) {
      const batch = bookmarks.slice(i, i + BATCH_SIZE);
      batchTransaction(batch);
      if (onProgress) {
        onProgress(Math.min(i + BATCH_SIZE, bookmarks.length), bookmarks.length);
      }
    }

    // 重建 FTS 全文索引表以保证一致性（过滤掉非数字推文 ID 的历史残留脏行）
    db.exec(`DELETE FROM twitter_bookmarks_fts;`);
    db.exec(`
      INSERT INTO twitter_bookmarks_fts(id, full_text, screen_name, name)
      SELECT id, full_text, screen_name, name 
      FROM twitter_bookmarks 
      WHERE id GLOB '[0-9]*';
    `);

    return { success: true, count: bookmarks.length };
  } finally {
    db.close();
  }
}

/**
 * 删除指定 ID 的书签
 * @param {string} id 推文 ID
 * @param {object} [options]
 * @param {string} [options.dbPath] 自定义数据库路径
 */
export function deleteBookmark(id, { dbPath } = {}) {
  if (!id) {
    throw new Error("必须提供待删除的推文 ID");
  }

  const db = getDatabase(dbPath);
  try {
    const deleteMain = db.prepare("DELETE FROM twitter_bookmarks WHERE id = ?").run(String(id));
    db.prepare("DELETE FROM twitter_bookmarks_fts WHERE id = ?").run(String(id));

    return {
      success: true,
      deleted: deleteMain.changes > 0,
      id: String(id)
    };
  } finally {
    db.close();
  }
}

/**
 * 获取书签库统计概览
 * @param {object} [options]
 * @param {string} [options.dbPath] 自定义数据库路径
 */
export function getStats({ dbPath } = {}) {
  const db = getDatabase(dbPath);
  try {
    const totalRow = db.prepare("SELECT count(*) as count FROM twitter_bookmarks").get();
    const timeRangeRow = db.prepare(`
      SELECT 
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM twitter_bookmarks 
      WHERE created_at IS NOT NULL AND created_at != ''
    `).get();

    return {
      totalBookmarks: totalRow ? totalRow.count : 0,
      earliestTweet: timeRangeRow?.earliest || null,
      latestTweet: timeRangeRow?.latest || null
    };
  } finally {
    db.close();
  }
}
