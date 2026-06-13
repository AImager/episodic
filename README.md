# episodic

把 ChatGPT / Gemini 的对话一键导出为 Markdown，同步到你的 GitHub 知识库仓库；也能一键收藏任意网页（存指针）。

## 功能

- **导出当前对话**：ChatGPT / Gemini 都是导出当前打开的那个对话，转 Markdown
- **两种去向**：
  - 同步到 GitHub —— 直接 commit 到仓库指定目录
  - 下载到本地 —— 存到 `Downloads/ai_chat_memory/`
- **去重 & 更新**：以会话 ID 为唯一键，导出过的对话再次导出时**原地更新**同一个文件；标题变化导致文件名改变时，自动删除旧文件，不留重复
- **统一文件名**：`日期_会话ID_标题.md`（如 `20260612_921ba0166c3a3b09_互联网中台业务与战略思考.md`），按日期天然排序
- **frontmatter**：导出的 md 自带 `type/source/title/date/status` 等元数据，适配知识库管线
- **一键收藏（v2.2+）**：点「⭐ 收藏当前页面」把任意网页存成一条指针（日期/标题/描述/来源/链接），按年追加到收藏目录下的 `YYYY.md` 表格里。描述取页面自报的 meta（`og:description`），按 URL **跨年去重**，已收藏过不重复。**这是纯指针归档，落点和对话存档隔离，不参与知识提炼**——就是个同步到 GitHub 的电子收藏夹。

## 安装

1. Chrome → `chrome://extensions`
2. 打开右上角「开发者模式」
3. 「加载已解压的扩展程序」→ 选择本目录

## 配置 GitHub 同步

点扩展图标 → 「⚙ GitHub 同步设置」，填写：

| 字段 | 说明 | 示例 |
|------|------|------|
| Token | fine-grained PAT | `github_pat_...` |
| Owner | 用户名/组织 | `AImager` |
| Repo | 仓库名 | `note` |
| Branch | 分支 | `main` |
| 对话存档路径 | 导出对话的投递目录 | `对话存档` |
| 收藏路径 | 一键收藏的落点目录（按年归档为 `YYYY.md`） | `收藏` |

### 生成最小权限 Token

1. 打开 [GitHub → Fine-grained tokens](https://github.com/settings/tokens?type=beta)
2. 「Generate new token」
3. **Repository access** → `Only select repositories` → 只勾选笔记仓库
4. **Permissions** → Repository permissions → `Contents` 设为 **Read and write**
5. 生成后复制 `github_pat_...` 填入设置页，点「测试连接」验证

> Token 仅存于本浏览器 `chrome.storage.local`，不上传任何第三方。

## 使用

1. 打开一个**具体的对话**页面：
   - ChatGPT：URL 形如 `chatgpt.com/c/xxxx`
   - Gemini：URL 形如 `gemini.google.com/app/xxxx`
2. 点扩展图标
3. 选择去向（GitHub / 本地）
4. 点对应平台的导出按钮
5. GitHub 模式下，导出完成后在 vault 里 `git pull` 即可

> 同一对话再次导出会原地更新，不会产生重复文件。

### 收藏任意网页（v2.2+）

1. 在桌面 Chrome 里打开任意想收藏的网页
2. 点扩展图标 → 「⭐ 收藏当前页面（存指针）」
3. 一条记录（日期/标题/描述/来源/链接）按年追加到收藏目录的 `YYYY.md`，`git pull` 即进 vault

> 这是**纯指针归档**——只存链接+页面自报的描述，不存正文，落在独立的收藏目录（默认 `收藏/`，可在设置页改），按年分卷为 `2026.md`/`2027.md`，和对话存档（要提炼的真原料）隔离。描述取页面 `og:description`/`meta description`，拿不到就留空（**不做 AI 总结**，刻意保持零成本、不提炼）。同一链接**跨年去重**，收过不重复。定位就是个同步到 GitHub 的电子收藏夹，不参与知识提炼。设计动机见 [CHANGELOG.md](./CHANGELOG.md)。

## 导出后的处理流程

文件落到 `对话存档/` 后，frontmatter 里 `status: raw`、`topic: 未分类`。
后续在 Obsidian 里：
1. 确认主题，把文件移到对应目录（如 `职场观察/`），更新 `topic`
2. 需要沉淀的，让 AI 提炼成案例/原则，更新 `status: structured` 和 `derived: [...]`

## 文件结构

```
manifest.json    扩展配置
background.js     核心：导出逻辑 + GitHub 同步 + 收藏（按年归档）
popup.html/js     弹窗：去向选择 + 导出按钮 + 收藏按钮
options.html/js   设置页：GitHub 配置 + 对话存档/收藏路径 + 测试连接
CHANGELOG.md      版本历史与需求动机
icons/            图标（书签缎带，含矢量源 icon.svg）
```

## 已知限制

- **只导当前对话**：两个平台都只导出当前打开的对话，不做批量
- **选择器依赖前端结构**：Gemini 改版可能导致抓取失效，需更新选择器
- **ChatGPT 依赖登录态**：通过页面 session 拿 token，需在已登录的标签页操作
- **收藏够不到手机 app**：浏览器扩展只能收桌面浏览器里打开的网页，手机 app（知乎/抖音/B站等）内的内容抓不到

## 版本

完整版本历史与每版的需求动机见 [CHANGELOG.md](./CHANGELOG.md)。当前版本 **v2.3.0**（收藏路径可配置 + 按年归档 + 描述列）。
