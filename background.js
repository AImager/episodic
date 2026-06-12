// background.js — Service Worker
// v2: 支持 GitHub 同步 + frontmatter + 分页 + 去重

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "ping") {
    sendResponse({ pong: true });
    return true;
  }
  if (msg.action === "exportChatGPT") {
    exportChatGPT(msg.target).then(r => sendResponse(r))
      .catch(e => { console.error("[ChatGPT]", e); sendResponse({ error: e.message }); });
    return true;
  }
  if (msg.action === "exportGeminiCurrent") {
    exportGeminiCurrent(msg.target).then(r => sendResponse(r))
      .catch(e => { console.error("[Gemini]", e); sendResponse({ error: e.message }); });
    return true;
  }
  if (msg.action === "bookmarkCurrent") {
    bookmarkCurrentPage().then(r => sendResponse(r))
      .catch(e => { console.error("[Bookmark]", e); sendResponse({ error: e.message }); });
    return true;
  }
});

// ─── GitHub 同步 ─────────────────────────────────────────────

async function getGithubConfig() {
  const { githubConfig } = await chrome.storage.local.get("githubConfig");
  if (!githubConfig || !githubConfig.token) {
    throw new Error("未配置 GitHub，请先在扩展设置页填写 Token");
  }
  return githubConfig;
}

// 把文件 commit 到 GitHub。已存在则更新（带 sha），不存在则创建。
async function commitToGithub(cfg, relPath, content, message) {
  const fullPath = `${cfg.path}/${relPath}`.replace(/\/+/g, "/");
  const apiBase = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIPath(fullPath)}`;
  const headers = {
    "Authorization": `Bearer ${cfg.token}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  // 查询是否已存在（拿 sha）
  let sha = null;
  const getResp = await fetch(`${apiBase}?ref=${encodeURIComponent(cfg.branch)}`, { headers });
  if (getResp.ok) {
    const existing = await getResp.json();
    sha = existing.sha;
  } else if (getResp.status !== 404) {
    throw new Error(`GitHub 查询失败 HTTP ${getResp.status}`);
  }

  const body = {
    message: message || `chore: add ${relPath}`,
    content: utf8ToBase64(content),
    branch: cfg.branch,
  };
  if (sha) body.sha = sha;

  const putResp = await fetch(apiBase, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  if (!putResp.ok) {
    const errText = await putResp.text();
    throw new Error(`GitHub 提交失败 HTTP ${putResp.status}: ${errText.slice(0, 120)}`);
  }
  return { updated: !!sha };
}

// 删除 GitHub 上的文件（文件名变化时清理旧文件）。不存在则静默跳过。
async function deleteFromGithub(cfg, relPath, message) {
  const fullPath = `${cfg.path}/${relPath}`.replace(/\/+/g, "/");
  const apiBase = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIPath(fullPath)}`;
  const headers = {
    "Authorization": `Bearer ${cfg.token}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
  };
  const getResp = await fetch(`${apiBase}?ref=${encodeURIComponent(cfg.branch)}`, { headers });
  if (getResp.status === 404) return; // 旧文件已不在，无需删
  if (!getResp.ok) return;            // 查询失败就放弃删除，不阻塞主流程
  const existing = await getResp.json();
  await fetch(apiBase, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ message: message || `chore: remove ${relPath}`, sha: existing.sha, branch: cfg.branch }),
  });
}

function encodeURIPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

// ─── 去重账本 ────────────────────────────────────────────────

async function getLedger() {
  const { importLedger } = await chrome.storage.local.get("importLedger");
  return importLedger || {};
}
async function setLedger(ledger) {
  await chrome.storage.local.set({ importLedger: ledger });
}

// ─── ChatGPT ────────────────────────────────────────────────

async function exportChatGPT(target) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs.find(t => t.url?.includes("chatgpt.com"));
  if (!tab) throw new Error("请先切换到 ChatGPT 对话页再点击导出");

  // 从当前页面 URL 提取会话 ID：chatgpt.com/c/<uuid>
  let convId = null;
  try {
    const segs = new URL(tab.url).pathname.split("/").filter(Boolean);
    const ci = segs.indexOf("c");
    if (ci >= 0 && segs[ci + 1]) convId = segs[ci + 1];
  } catch { convId = null; }
  if (!convId) throw new Error("请先打开一个具体的 ChatGPT 对话（URL 形如 /c/xxxx）");

  await chrome.tabs.update(tab.id, { active: true });
  await sleep(800);

  // 拉取当前对话详情
  const detail = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fetchChatGPTDetail,
    args: [convId],
  });
  const raw = detail[0].result;
  if (!raw || raw.error) throw new Error(raw?.error || "获取对话详情失败");

  const md = chatgptToMarkdown(raw);
  const date = raw.create_time ? new Date(raw.create_time * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const title = raw.title || convId;
  const fname = buildFilename({ date, convId, title, idLen: 8 });

  // 账本：按会话ID判断是否导出过，导过则更新（文件名变了先删旧文件）
  const ledger = await getLedger();
  const ledgerKey = `chatgpt:${convId}`;
  const prev = ledger[ledgerKey];
  const isUpdate = !!prev;

  if (target === "github") {
    const cfg = await getGithubConfig();
    if (prev && prev.fname && prev.fname !== fname) {
      await deleteFromGithub(cfg, prev.fname, `chore: rename ChatGPT 「${title}」`);
    }
    await commitToGithub(cfg, fname, md, `chore: ${isUpdate ? "update" : "import"} ChatGPT 「${title}」`);
  } else {
    await downloadText(md, `ai_chat_memory/chatgpt/${fname}`);
  }

  ledger[ledgerKey] = { updatedAt: raw.update_time, fname };
  await setLedger(ledger);

  return { count: 1, skipped: 0, updated: isUpdate };
}

async function fetchChatGPTDetail(convId) {
  try {
    const accountCookie = document.cookie.split(";")
      .find(c => c.trim().startsWith("_account="));
    const accountId = accountCookie ? accountCookie.trim().replace("_account=", "") : "";

    const sessionResp = await fetch("/api/auth/session", { credentials: "include" });
    const session = await sessionResp.json();
    const token = session?.accessToken || "";

    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (accountId) headers["chatgpt-account-id"] = accountId;

    const resp = await fetch(`/backend-api/conversation/${convId}`,
      { credentials: "include", headers });
    if (!resp.ok) return { error: `HTTP ${resp.status}` };
    const data = await resp.json();
    data.conversation_id = convId;
    return data;
  } catch (e) {
    return { error: e.message };
  }
}

function chatgptToMarkdown(raw) {
  const messages = [];
  const mapping = raw.mapping || {};

  function walk(nodeId) {
    const node = mapping[nodeId];
    if (!node) return;
    const msg = node.message;
    if (msg) {
      const role = msg.author?.role;
      const parts = msg.content?.parts || [];
      const content = parts.filter(p => typeof p === "string").join("").trim();
      if (content && (role === "user" || role === "assistant")) {
        messages.push({ role, content });
      }
    }
    for (const childId of node.children || []) walk(childId);
  }
  for (const [id, node] of Object.entries(mapping)) {
    if (!node.parent) { walk(id); break; }
  }

  const created = raw.create_time ? new Date(raw.create_time * 1000) : new Date();
  const fm = buildFrontmatter({
    source: "ChatGPT",
    title: raw.title || "Untitled",
    date: created.toISOString().slice(0, 10),
    convId: raw.conversation_id || "",
  });

  const lines = [fm, `# ${raw.title || "Untitled"}`, ""];
  for (const msg of messages) {
    lines.push(msg.role === "user" ? "## 我的提问：\n" : "## ChatGPT 回答：\n");
    lines.push(msg.content);
    lines.push("\n---\n");
  }
  return lines.join("\n");
}

// ─── Gemini 当前页面 ─────────────────────────────────────────

async function exportGeminiCurrent(target) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs.find(t => t.url?.includes("gemini.google.com"));
  if (!tab) throw new Error("请先切换到 Gemini 标签页再点击导出");

  await chrome.tabs.update(tab.id, { active: true });
  await sleep(1000);

  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: scrapeGeminiPage,
  });

  const data = result[0].result;
  if (!data) throw new Error("抓取失败，请确认 Gemini 页面已加载完成");
  if (data.error) throw new Error(data.error);
  if (!data.messages.length) throw new Error("未找到对话内容，选择器可能需要更新");

  const date = new Date().toISOString().slice(0, 10);
  const fm = buildFrontmatter({
    source: "Gemini",
    title: data.title,
    date,
    convId: data.convId,
  });

  const md = [
    fm,
    `# ${data.title}`,
    "",
    ...data.messages.flatMap(m => [
      m.role === "user" ? "## 我的提问：\n" : "## Gemini 回答：\n",
      m.content,
      "\n---\n",
    ]),
  ].join("\n");

  const fname = buildFilename({ date, convId: data.convId, title: data.title, idLen: 8 });

  // 按会话ID查账本：导出过则更新（文件名变了就先删旧文件）
  const ledger = await getLedger();
  const ledgerKey = `gemini:${data.convId}`;
  const oldFname = ledger[ledgerKey];
  const isUpdate = !!oldFname;

  if (target === "github") {
    const cfg = await getGithubConfig();
    if (oldFname && oldFname !== fname) {
      await deleteFromGithub(cfg, oldFname, `chore: rename Gemini 「${data.title}」`);
    }
    await commitToGithub(cfg, fname, md, `chore: ${isUpdate ? "update" : "import"} Gemini 「${data.title}」`);
  } else {
    await downloadText(md, `ai_chat_memory/gemini/${fname}`);
  }

  ledger[ledgerKey] = fname;
  await setLedger(ledger);

  return { count: 1, skipped: 0, updated: isUpdate };
}

// 注入页面执行：滚动加载全部历史 + 抓取
async function scrapeGeminiPage() {
  try {
    const scroller = document.querySelector('infinite-scroller.chat-history')
                  || document.querySelector('infinite-scroller');
    if (!scroller) return { error: "找不到滚动容器" };

    scroller.scrollTop = scroller.scrollHeight;
    await new Promise(r => setTimeout(r, 800));

    await new Promise(resolve => {
      let lastHeight = 0, stableCount = 0;
      const timer = setInterval(() => {
        scroller.scrollTop = 0;
        const h = scroller.scrollHeight;
        if (h === lastHeight) {
          if (++stableCount >= 4) { clearInterval(timer); resolve(); }
        } else { stableCount = 0; lastHeight = h; }
      }, 800);
      setTimeout(() => { clearInterval(timer); resolve(); }, 30000);
    });

    await new Promise(r => setTimeout(r, 500));
    const selectors = {
      user: [".user-query-bubble-with-background", "user-query .query-text", ".human-turn p", "[data-role='user'] p"],
      model: ["message-content .markdown", ".model-response-text", ".response-content", "[data-role='model'] p"],
    };
    function findAll(list) {
      for (const sel of list) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) return Array.from(els);
      }
      return [];
    }
    const userEls = findAll(selectors.user);
    const modelEls = findAll(selectors.model);
    const messages = [];
    const maxLen = Math.max(userEls.length, modelEls.length);
    for (let i = 0; i < maxLen; i++) {
      if (userEls[i]) messages.push({ role: "user", content: userEls[i].innerText.trim() });
      if (modelEls[i]) messages.push({ role: "assistant", content: modelEls[i].innerText.trim() });
    }

    // 标题多级降级：document.title（最可靠）→ 侧边栏选中项 → 第一句提问
    let title = "";
    // 首选：document.title，去掉尾部 " - Google Gemini" / " - Gemini" / " | Gemini"
    const dt = (document.title || "").replace(/\s*[-|]\s*(Google\s+)?Gemini\s*$/i, "").trim();
    if (dt && dt !== "Gemini" && dt !== "Google Gemini") title = dt;
    // 兜底1：侧边栏选中项
    if (!title) {
      const titleSelectors = [
        '[aria-current="true"]',
        '[aria-current="page"]',
        '.conversation-title.selected',
        '.conversation.selected .conversation-title',
        '.chat-history-list [aria-selected="true"]',
      ];
      for (const sel of titleSelectors) {
        const el = document.querySelector(sel);
        const t = el?.innerText?.split('\n')[0].trim();
        if (t && t !== "Google Gemini" && t !== "Gemini") { title = t; break; }
      }
    }
    // 兜底2：第一句用户提问
    if (!title) {
      title = userEls[0]?.innerText.trim().slice(0, 50) || "Untitled";
    }

    // 从 URL 提取真实会话 ID（末尾路径段），列表页则兜底为 base64 哈希
    let convId;
    try {
      const segs = new URL(location.href).pathname.split("/").filter(Boolean);
      const last = segs[segs.length - 1];
      convId = (last && last !== "app") ? last : null;
    } catch { convId = null; }
    if (!convId) {
      convId = btoa(unescape(encodeURIComponent(location.href))).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
    }

    return { title, convId, messages };
  } catch (e) {
    return { error: e.message };
  }
}

// ─── 收藏（指针/索引，落到正交的「收藏」目录，不进对话存档） ──────────

// 读取 GitHub 上某文件的解码内容与 sha，不存在返回 null
async function readGithubFile(cfg, fullPath) {
  const apiBase = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIPath(fullPath)}`;
  const headers = {
    "Authorization": `Bearer ${cfg.token}`,
    "Accept": "application/vnd.github+json",
  };
  const resp = await fetch(`${apiBase}?ref=${encodeURIComponent(cfg.branch)}`, { headers });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`GitHub 读取失败 HTTP ${resp.status}`);
  const data = await resp.json();
  return { content: base64ToUtf8(data.content.replace(/\n/g, "")), sha: data.sha };
}

const BOOKMARK_DIR = "收藏";
const BOOKMARK_INDEX = "README.md";

function bookmarkIndexHeader() {
  return [
    "---",
    "type: readme",
    "title: 收藏",
    "---",
    "",
    "# 收藏",
    "",
    "> 浏览器一键收藏的指针/索引，**与认知三层正交、不参与提炼推演**——就是个电子收藏夹。",
    "> 用没用得到不重要，链接失效也不补。要提炼的真原料在 [[../对话存档/README.md|对话存档]]，别混。",
    "",
    "| 日期 | 标题 | 来源 | 链接 |",
    "|------|------|------|------|",
    "",
  ].join("\n");
}

async function bookmarkCurrentPage() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !tab.url) throw new Error("拿不到当前标签页");
  const url = tab.url;
  if (!/^https?:\/\//.test(url)) throw new Error("只能收藏 http(s) 网页");

  const title = (tab.title || url).replace(/\|/g, "丨").trim(); // 转义竖线，避免破坏表格
  const date = new Date().toISOString().slice(0, 10);
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { host = ""; }

  const cfg = await getGithubConfig();
  const indexPath = `${BOOKMARK_DIR}/${BOOKMARK_INDEX}`;
  const existing = await readGithubFile(cfg, indexPath);

  let content = existing ? existing.content : bookmarkIndexHeader();
  // 按 URL 去重：已存在则不重复追加
  if (content.includes(`](${url})`)) {
    return { count: 0, skipped: 1, updated: false, title };
  }

  const row = `| ${date} | ${title} | ${host} | [打开](${url}) |`;
  // 追加到文件末尾（表格之后），保证以换行收尾
  content = content.replace(/\s*$/, "") + "\n" + row + "\n";

  // 直接 PUT（带 sha 更新或新建）
  await commitToGithubAbsolute(cfg, indexPath, content, `chore: bookmark 「${title}」`, existing?.sha || null);
  return { count: 1, skipped: 0, updated: !!existing, title };
}

// 用绝对仓库路径提交（不拼 cfg.path 前缀），用于收藏目录
async function commitToGithubAbsolute(cfg, fullPath, content, message, sha) {
  const apiBase = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIPath(fullPath)}`;
  const headers = {
    "Authorization": `Bearer ${cfg.token}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
  };
  const body = { message, content: utf8ToBase64(content), branch: cfg.branch };
  if (sha) body.sha = sha;
  const resp = await fetch(apiBase, { method: "PUT", headers, body: JSON.stringify(body) });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`GitHub 提交失败 HTTP ${resp.status}: ${errText.slice(0, 120)}`);
  }
}

// ─── frontmatter ─────────────────────────────────────────────

function buildFrontmatter({ source, title, date, convId }) {
  // 用单引号包裹 title，转义内部单引号，避免 YAML 解析问题
  const safeTitle = String(title).replace(/'/g, "''");
  return [
    "---",
    "type: conversation",
    `source: ${source}`,
    `model: ${source}`,
    `title: '${safeTitle}'`,
    `date: ${date}`,
    "status: raw",
    "derived: []",
    `session_id: ${convId}`,
    "---",
    "",
  ].join("\n");
}

// ─── 工具函数 ────────────────────────────────────────────────

function sanitize(str) {
  return String(str).replace(/[^\w一-龥\s-]/g, "").trim().replace(/\s+/g, "_").slice(0, 50) || "untitled";
}

// 文件名格式：YYYYMMDD-会话ID-标题.md（连字符分隔，与 archive_session.py 对齐）
// 如 20260612-921ba016-互联网中台业务与战略思考.md
// idLen: 会话ID截取长度，传 0 或不传表示用完整ID
function buildFilename({ date, convId, title, idLen = 0 }) {
  const ymd = String(date).replace(/-/g, "").slice(0, 8); // 2026-06-12 → 20260612
  // 清理 convId 中的特殊字符（含连字符，避免与分隔符混淆）
  let id = String(convId || "").replace(/[^\w一-龥]/g, "");
  if (idLen > 0) id = id.slice(0, idLen);
  id = id || "noid";
  return `${ymd}-${id}-${sanitize(title)}.md`;
}


function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function utf8ToBase64(str) { return btoa(unescape(encodeURIComponent(str))); }

function base64ToUtf8(b64) { return decodeURIComponent(escape(atob(b64))); }

async function downloadText(content, filename) {
  const url = `data:text/markdown;charset=utf-8;base64,${utf8ToBase64(content)}`;
  await chrome.downloads.download({ url, filename, conflictAction: "overwrite", saveAs: false });
}

