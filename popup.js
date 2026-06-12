const btn = document.getElementById("exportBtn");
const geminiBtn = document.getElementById("geminiBtn");
const bookmarkBtn = document.getElementById("bookmarkBtn");
const statusEl = document.getElementById("status");
const settingsLink = document.getElementById("settingsLink");

function setStatus(msg, type = "info") {
  statusEl.textContent = msg;
  statusEl.className = `status-${type}`;
}

function getTarget() {
  return document.querySelector('input[name="target"]:checked').value;
}

function targetLabel(target) {
  return target === "github" ? "GitHub 仓库" : "本地 Downloads";
}

settingsLink.addEventListener("click", () => chrome.runtime.openOptionsPage());

btn.addEventListener("click", async () => {
  const target = getTarget();
  btn.disabled = true;
  geminiBtn.disabled = true;
  setStatus("导出中...", "info");
  try {
    const r = await sendMessage("exportChatGPT", target);
    const verb = r.updated ? "已更新" : "已保存";
    setStatus(`完成，${verb}到${targetLabel(target)}`, "ok");
  } catch (e) {
    setStatus(`失败：${e.message}`, "error");
  } finally {
    btn.disabled = false;
    geminiBtn.disabled = false;
  }
});

geminiBtn.addEventListener("click", async () => {
  const target = getTarget();
  btn.disabled = true;
  geminiBtn.disabled = true;
  setStatus("导出中...", "info");
  try {
    const r = await sendMessage("exportGeminiCurrent", target);
    const verb = r.updated ? "已更新" : "已保存";
    setStatus(`完成，${verb}到${targetLabel(target)}`, "ok");
  } catch (e) {
    setStatus(`失败：${e.message}`, "error");
  } finally {
    btn.disabled = false;
    geminiBtn.disabled = false;
  }
});

bookmarkBtn.addEventListener("click", async () => {
  btn.disabled = true;
  geminiBtn.disabled = true;
  bookmarkBtn.disabled = true;
  setStatus("收藏中...", "info");
  try {
    const r = await sendMessage("bookmarkCurrent", null);
    if (r.skipped) setStatus(`已收藏过：${r.title}`, "ok");
    else setStatus(`已收藏到 GitHub：${r.title}`, "ok");
  } catch (e) {
    setStatus(`失败：${e.message}`, "error");
  } finally {
    btn.disabled = false;
    geminiBtn.disabled = false;
    bookmarkBtn.disabled = false;
  }
});

function sendMessage(action, target) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("超时，请检查扩展权限")), 120000);
    chrome.runtime.sendMessage({ action, target }, response => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (!response) { reject(new Error("background 无响应")); return; }
      if (response.error) reject(new Error(response.error));
      else resolve(response);
    });
  });
}
