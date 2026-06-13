// options.js — 设置页逻辑

const fields = ["token", "owner", "repo", "branch", "path", "bookmarkPath"];
const defaults = { owner: "AImager", repo: "note", branch: "main", path: "对话存档", bookmarkPath: "收藏" };

const statusEl = document.getElementById("status");

function setStatus(msg, ok = true) {
  statusEl.textContent = msg;
  statusEl.className = ok ? "ok" : "err";
  setTimeout(() => { statusEl.className = ""; statusEl.textContent = ""; }, 4000);
}

// 载入已保存的配置
chrome.storage.local.get("githubConfig", ({ githubConfig }) => {
  const cfg = githubConfig || {};
  for (const f of fields) {
    document.getElementById(f).value = cfg[f] ?? defaults[f] ?? "";
  }
});

document.getElementById("save").addEventListener("click", () => {
  const cfg = {};
  for (const f of fields) cfg[f] = document.getElementById(f).value.trim();

  if (!cfg.token) { setStatus("请填写 Token", false); return; }
  if (!cfg.owner || !cfg.repo) { setStatus("请填写 Owner 和 Repo", false); return; }
  cfg.branch = cfg.branch || "main";
  cfg.path = (cfg.path || "对话存档").replace(/^\/+|\/+$/g, "");
  cfg.bookmarkPath = (cfg.bookmarkPath || "收藏").replace(/^\/+|\/+$/g, "");

  chrome.storage.local.set({ githubConfig: cfg }, () => setStatus("已保存"));
});

document.getElementById("test").addEventListener("click", async () => {
  const token = document.getElementById("token").value.trim();
  const owner = document.getElementById("owner").value.trim();
  const repo = document.getElementById("repo").value.trim();

  if (!token || !owner || !repo) { setStatus("请先填写 Token / Owner / Repo", false); return; }

  setStatus("测试中...", true);
  try {
    const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
      },
    });
    if (resp.ok) {
      const data = await resp.json();
      setStatus(`连接成功：${data.full_name}`);
    } else {
      setStatus(`失败：HTTP ${resp.status}（检查 token 权限）`, false);
    }
  } catch (e) {
    setStatus(`失败：${e.message}`, false);
  }
});
