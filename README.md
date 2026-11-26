# superlight-notion

轻量网页应用：笔记仍放在 Notion 里，这里用来更快地阅读，并做一点点文字编辑。登录默认走 Notion OAuth（公开连接），访问令牌只保存在服务器端的加密会话里，浏览器 JavaScript 拿不到密钥。

渲染层使用 MIT 许可的 [react-notion-x](https://github.com/NotionX/react-notion-x)（含 `notion-compat`，用于对接官方 API 读取私人笔记）。版权与许可证全文见 [`THIRD_PARTY_NOTICES`](./THIRD_PARTY_NOTICES)。

## 项目定位（What it is）

这是一个超轻量的 Notion 前端与代理框架（lightweight Notion frontend / proxy）。官方 Notion 客户端内存占用太重，尤其是在同一台机器上同时运行 AI Agent、而 Agent 本身也需要大量内存的场景下，这个问题会更明显。

日常用法也因此不同：主要是人类阅读笔记，以及口述或指挥 AI Agent 去改笔记，而不是长时间待在官方 Notion 里重度手写。superlight-notion 只保留阅读、少量文字编辑和代理所需的接口，避免把页面和进程做重。

## 能做什么、不做什么

**可以：** 阅读已分享给集成的页面；修改段落、标题 1–3、列表、引用、待办的文字；勾选待办；在当前块后面插入新段落；删除一个块；用快捷键做加粗 / 斜体 / 行内代码 / 链接。

**不做：** 拖动排序、数据库单元格编辑、表格编辑、分栏编辑、同步块编辑、评论、多人实时协作、上传图片或文件。完整块编辑器库（BlockNote、TipTap、Lexical 等）也不会引入，以免把页面变重。

不支持的块会显示占位说明，并提供「在 Notion 中打开」的链接。`PageView` 目前把 `Collection`、`Equation`、`Modal`、`Pdf` 映射为 `UnsupportedBlock`。

## 硬性限制（Hard limitations）

下面这些限制来自 Notion 官方 API 和当前实现，需要坦诚面对，无法靠前端“看起来很快”来绕过。

- **速率限制（Rate limits）**：Notion 官方按 60 秒时间窗口给每个连接分配预算。普通套餐（Free / Plus）每个连接每 60 秒 180 次请求（平均 3 req/s）；Business / Enterprise 每 60 秒 600 次（平均 10 req/s）。这 60 秒预算允许突发使用，不必均匀发送。超限时返回 HTTP 429 和 `rate_limited`，并在 `Retry-After` 响应头里给出等待秒数。数据源查询（data source query）另有约 3 req/s 的单独限流，并且整个工作区的所有连接还共用工作区级限额。本项目在收到真实 429 时才会按 `Retry-After` 退避重试，不再人为预限流。
- **服务端缓存 TTL 为 120 秒**：采用 Worker 内存 Map + 可选 KV（`PAGE_CACHE`）+ Cloudflare Edge Cache API。缓存未命中或过期后会全量重新拉取，没有局部增量刷新。编辑、新增或删除成功后会显式清除对应缓存。浏览器响应头带 `cache-control: no-store`，前端本身不缓存页面正文。
- **嵌套容器无法批量拉取**：官方 API 的 `blocks.children.list` 不会内嵌子孙块，也没有一次拉取多个父块子节点的批量接口。因此每一个带 `has_children: true` 的嵌套容器（如 `callout`、`toggle`、`column_list`、`column`、缩进列表等）都需要一次额外的 `blocks.children.list`。同级最多 100 个块，超过会翻页再多一次请求。
- **数据库视图目前跳过渲染**：`notion-compat` 遇到 `child_database` 会直接跳过，`collection` 相关字段为空，前端 `Collection` 显示为不支持块。若后续按传统 `GET /v1/databases` + `POST /v1/databases/query`（或 `data_sources/query`）实现，每个视图至少需要 2 次请求；若改用 Views API，则为 2 + 可见行数，或再配合一次批量查询。
- **页面引用（`link_to_page`）**：在默认 `notion-compat` 下，每条约增加 2 次浅元数据请求（`blocks.retrieve` + `pages.retrieve`），并可能继续爬祖先。当前精简拉取器已把它压到最多 1 次 `pages.retrieve`；段落里的 `@mention` 因 `rich_text.plain_text` 已带标题，已完全跳过抓取。

## 人类与 AI Agent 最佳实践（Best-practice usage guide）

为了让首开更快、也更省速率预算，写笔记时请优先选择“平铺结构”：

- 优先使用平铺的 `paragraph` 段落与简单列表，少用嵌套容器。
- 给 AI Agent 写笔记时有两种推荐模式：**严格模式（Strict mode）**完全不使用 `callout`、`toggle`、`column_list`、`column` 等嵌套容器，保证整页首开只需 2 次 Notion API 请求（`pages.retrieve` + `blocks.children.list`）；**宽松模式（Relaxed mode）**仅在必要处少量使用容器。详细规则见下方「Agent 写作规则」。
- 避免过深的页面层级嵌套。在默认 `notion-compat` 中，每深一层会多出 2 次祖先链面包屑请求。最新优化已移除向上爬查，但浅层结构依然更清爽、更易维护。
- 单页同级块尽量控制在 100 个以内，避免触发 `blocks.children.list` 翻页（每 100 块一次请求）。
- 侧边栏在 OAuth 模式下走 `POST /v1/search`（`filter.object = page`），`page_size` 为 100。授权页面在 100 个以内时，一次请求即可拿到完整嵌套目录树（含 `parent.page_id`），由前端拼成可折叠树，不必按层级逐层请求。

## 近期核心优化记录（Recent optimizations）

- [`f6c9b78`](https://github.com/DYD-Tech/superlight-notion/commit/f6c9b78)：用 429-only 退避重试取代硬编码 333ms 预限流。请求默认全速发出，只有 Notion 真正返回 HTTP 429 时才解析 `Retry-After`（或按 500ms / 1000ms / 2000ms 退避）并最多重试 3 次。
- [`f807506`](https://github.com/DYD-Tech/superlight-notion/commit/f807506)：去掉 `NotionCompatAPI.getPage` 与 `resolvePage` 之间对根页面 `pages.retrieve`、`blocks.retrieve`、`blocks.children.list` 的 3 次重复请求。
- [`dbdfbd7`](https://github.com/DYD-Tech/superlight-notion/commit/dbdfbd7)：换成精简页面拉取器（直接使用 `notion-compat` 的 `convertPage`，不再走完整 `getPage`）：
  - 移除无用的祖先链爬查（前端 `PageView` 已设置 `disableHeader`，不显示面包屑）
  - 移除多余的 `blocks.retrieve`（平铺页首开只需 2 次请求）
  - 跳过 `child_page` 和 `@mention` 的多余抓取（标题已在父级 `children` 列表或 `rich_text.plain_text` 中）
  - `link_to_page` 最多一次 `pages.retrieve`，失败时优雅降级
  - 对 `toggle` 与可折叠标题（如工作台的 3 个折叠 `heading_2`）改为点击展开时懒加载（`GET /api/block/:id/children`）
  - 侧边栏搜索改为 `page_size: 100`
  - 当存在 `waitUntil` 时，不再多余地 `await cache.set(...)`

## Notion 块类型速查表（Block-Type Reference）

下面按官方 API 类型对照 `notion-compat` 的 `convertBlock`（`node_modules/notion-compat/build/index.mjs`）以及 `src/components/PageView.tsx` 的组件映射整理。

**读法：** 所谓「0 次额外请求」，是指块数据已经包含在父级（通常是页面根）那一次 `blocks.children.list` 的 `results` 里，无需再单独请求。只要该块 `has_children: true` 且不是被懒加载跳过的折叠块，就会再加 1 次 `blocks.children.list`。

### 推荐使用的平铺块（RECOMMENDED / Flat blocks）

这些叶子块（leaf）或无子块的块，直接来自父级 `blocks.children.list`，**0 次额外请求**。严格模式应只使用这一类，并且不要给它们加缩进子块。

| 官方 API 类型 | 渲染说明 | 请求成本 | `notion-compat` / `PageView` 备注 |
| --- | --- | --- | --- |
| `paragraph` | 普通段落；Shift+Enter 的软换行仍属于同一块 | 0 次额外请求 | 映射为 `text`，可原地编辑 |
| `heading_1` | 一级标题（不可折叠时） | 0 次额外请求 | 映射为 `header` |
| `heading_2` | 二级标题（不可折叠时） | 0 次额外请求 | 映射为 `sub_header` |
| `heading_3` | 三级标题（不可折叠时） | 0 次额外请求 | 映射为 `sub_sub_header` |
| `heading_4` | 四级标题 | 0 次额外请求 | `convertBlock` 映射为 `header_4`；官方笔记里较少出现 |
| `bulleted_list_item` | 无嵌套子项的无序列表项 | 0 次额外请求 | 映射为 `bulleted_list`；可编辑 |
| `numbered_list_item` | 无嵌套子项的有序列表项 | 0 次额外请求 | 映射为 `numbered_list`；可编辑 |
| `to_do` | 无嵌套子项的待办 | 0 次额外请求 | 可编辑文字并勾选 |
| `quote` | 无嵌套子块的引用 | 0 次额外请求 | 类型名保持 `quote`；可编辑 |
| `code` | 代码块 | 0 次额外请求 | 按需懒加载 `react-notion-x` 的 `Code` 组件 |
| `divider` | 分隔线 | 0 次额外请求 | 原样渲染 |
| `equation` | 块级公式 | 0 次额外请求 | `convertBlock` 会转换表达式；但 `PageView` 把 `Equation` 映射为 `UnsupportedBlock` |
| `file` | 文件附件 | 0 次额外请求 | `convertBlock` 有对应分支，渲染能力有限 |
| `pdf` | PDF 预览 | 0 次额外请求 | `convertBlock` 会设置高度；但 `PageView` 把 `Pdf` 映射为 `UnsupportedBlock` |
| `image` | 图片（经 `/api/img` 代理） | 0 次额外请求 | 支持外链或 Notion 文件 URL |
| `video` | 视频 / Loom 等 | 0 次额外请求 | `convertBlock` 处理部分来源 |
| `audio` | 音频 | 0 次额外请求 | **未在 `convertBlock` 中显式处理**，会保留官方类型名，渲染可能不完整 |
| `embed` | 通用嵌入（Twitter、Figma、Spotify 等） | 0 次额外请求 | 按域名映射为 `tweet` / `maps` / `figma` 等 |
| `bookmark` | 书签预览 | 0 次额外请求 | 使用 `bookmark.url` |
| `link_preview` | 链接预览 | 0 次额外请求 | **未在 `convertBlock` 中显式处理**，渲染可能不完整 |
| `synced_block` | 作为叶子 / 无子块的同步块引用 | 0 次额外请求 | 无源时映射为 `transclusion_container`，有 `synced_from` 时映射为 `transclusion_reference` |
| `template` | 模板按钮 | 0 次额外请求 | `convertBlock` 仅 `break`，几乎不转换结构 |
| `breadcrumb` | 面包屑（本应用标题栏已关闭） | 0 次额外请求 | 前端 `disableHeader`，页面头部面包屑不展示 |
| `table_of_contents` | 目录 | 0 次额外请求 | 由 `react-notion-x` 根据已加载块生成 |
| `link_to_page` | 页面引用（只取标题，不拉正文） | 最多 +1 次 `pages.retrieve` | 映射为 `alias`；同一目标会去重；失败则降级。`@mention` 已跳过，不占请求 |

另外，`PageView` 还将 `Modal` 映射为 `UnsupportedBlock`（弹层类块当前不支持）。

### 不推荐 / 慎用的容器与嵌套块（NOT RECOMMENDED）

这类块会在每个实例上额外触发请求，或被跳过而不渲染。宽松模式可以少量使用，但不要堆叠。

| 官方 API 类型 | 渲染说明 | 请求成本 | `notion-compat` / `PageView` 备注 |
| --- | --- | --- | --- |
| `column_list` | 分栏容器 | 每个实例 +1 次 `blocks.children.list` | 用于拿到其中的 `column` |
| `column` | 单个分栏 | 每个实例 +1 次（若栏内还有带子块的容器，会继续 +1） | 与 `column_list` 成对出现 |
| `toggle` | 折叠列表 | 首开 0 次额外请求（懒加载）；展开时 +1 次 `blocks.children.list` | 点击 `<details>` 后走 `GET /api/block/:id/children` |
| `heading_1` / `heading_2` / `heading_3`（`is_toggleable: true`） | 可折叠标题 | 同上：首开懒加载，展开 +1 次 | 拉取器会补上 `format.toggleable`，让 `react-notion-x` 渲染为 `<details>` |
| `callout` | 提示框 | 无子块时 0 次；有子块时每个实例 +1 次 | `convertBlock` 原样保留 `callout` |
| `quote` / `paragraph` / 各类 list / `to_do`（`has_children: true`） | 带缩进子块的段落或列表 | 每个实例 +1 次 | 任何 `has_children: true` 的非懒加载块都会再拉子节点 |
| `table` | 简单表格 | +1 次以拉取 `table_row` 子块 | `convertBlock` 处理列数 / 表头格式 |
| `table_row` | 表格行 | 由父级 `table` 的 children 列表返回 | 不应单独作为顶层块使用 |
| `child_page` | 子页面链接 | 0 次额外请求（标题已在父级 children 中）；打开它是另一次页面加载 | 映射为 `page`；不再为它调用 `pages.retrieve` |
| `child_database` | 子数据库 / 数据库视图 | 当前跳过，0 次请求；若日后用 query API 实现，每个视图至少 +2 次 | `notion-compat` 直接 `break` 且 `collection` 为空；`PageView` 的 `Collection` 映射为 `UnsupportedBlock` |
| `synced_block`（有子块） | 带内容的同步块容器 | 每个实例 +1 次 | 与叶子形态相对；无批量接口 |

### Agent 写作规则（Agent Writing Rules）

- **严格模式（Strict mode）**：只允许使用上一节「推荐使用的平铺块」，并且不要产生任何 `has_children: true` 的嵌套子块（不要缩进列表、不要把段落塞进 callout）。这样整页首开只需 2 次 Notion API 请求：`pages.retrieve` + `blocks.children.list`。
- **宽松模式（Relaxed mode）**：允许少量使用容器块，但建议每页容器总数不超过 3 个、嵌套深度不超过 1 层。需要折叠的长内容，优先用 `toggle` 或可折叠标题（已支持点击展开懒加载），而不是一上来就用多层 `column_list` + `callout`。

## 准备 Notion（OAuth 公开连接）

1. 打开开发者门户：[notion.so/profile/integrations](https://www.notion.so/profile/integrations)（旧地址 [notion.so/my-integrations](https://www.notion.so/my-integrations) 一般会跳转到这里）。需要先登录 Notion。
2. 新建连接（New integration / New connection）。
3. 填写：
   - **名称**：例如 `superlight-notion`
   - **Authentication method / 验证方式**：选择 **OAuth**（公开连接 / public connection），不要选内部集成的 API key
   - **Redirect URI / 重定向 URI**（本地开发）：`http://localhost:8788/api/oauth/callback`
   - **Installable in / 可安装范围**：选 Any workspace（或按需要限制工作区）。这项创建后通常不能改
   - **Capabilities / 能力**：勾选读取内容、更新内容、插入内容
4. 创建后，在同一页的 Configuration 里复制 **OAuth client ID** 和 **OAuth client secret**。不必提交到 Notion 模板市场即可开始授权。
5. 第一次在应用里点「用 Notion 登录」时，Notion 会弹出页面选择器，勾选你愿意分享的页面。之后要增加页面，再走一遍授权即可。

关于本地 `http://localhost`：官方授权文档里的示例用的是 `https://` 域名，没有单独写死「禁止本地 http」。开发者后台一般可以添加 `http://localhost:端口/路径`，而且必须和授权请求里的 `redirect_uri` **完全一致**（`localhost` 和 `127.0.0.1` 不算同一个地址）。如果后台拒绝保存 http 地址，再用 HTTPS 隧道（例如 Cloudflare Tunnel）填一个 `https://.../api/oauth/callback`。

## 本地开发

需要 Node.js 18+（建议 22 或 24）和 [pnpm](https://pnpm.io/)。

```bash
pnpm install
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars`（不要提交这个文件）：

```
NOTION_OAUTH_CLIENT_ID=你的 client id
NOTION_OAUTH_CLIENT_SECRET=你的 client secret
NOTION_OAUTH_REDIRECT_URI=http://localhost:8788/api/oauth/callback
SESSION_SECRET=请换成足够长的随机字符串
```

`SESSION_SECRET` 用来签发 state cookie，并用 AES-GCM 加密会话（里面有 access token，可选的 refresh token，以及工作区名称和 bot id）。可以用下面这行生成：

```bash
openssl rand -base64 32
```

访问令牌只存放在 HttpOnly 的加密 Cookie 里，接口响应里不会返回 token。

如果上面这些 OAuth 变量都没有配置，才会启用可选的开发回退：`NOTION_TOKEN` + `APP_PASSWORD`（以及可选的 `NOTION_ROOT_PAGE_ID`）。正式使用请走 OAuth。

启动本地环境（Wrangler 会跑 `functions/` 里的 Pages Functions，并把前端请求代理给 Vite）：

```bash
pnpm dev
```

然后打开终端里提示的地址（通常是 `http://localhost:8788`），点「用 Notion 登录」。

常用命令：

```bash
pnpm typecheck
pnpm test
pnpm build
```

`pnpm build` 会把前端打进 `dist/`。再用 `pnpm preview` 可以在本地用 Wrangler 预览「静态资源 + Functions」，同样会读取 `.dev.vars`。

## 部署到 Cloudflare Pages（先不要部署，仅说明步骤）

1. 把代码放到 Git 仓库（GitHub / GitLab 等），或使用 `wrangler pages deploy` 直接上传 `dist/`。
2. 在 Cloudflare Dashboard 创建 Pages 项目，构建配置：
   - **Framework preset:** 无 / 或 Vite
   - **Build command:** `pnpm install && pnpm build`
   - **Build output directory:** `dist`
   - **Root directory:** 仓库根目录
3. 在项目设置里配置兼容性：
   - Compatibility date：建议 `2026-11-26` 或更新
   - Compatibility flags：勾选 `nodejs_compat`
4. 在 Notion 公开连接里再添加一条生产环境 Redirect URI，例如 `https://你的域名/api/oauth/callback`，并把 `.dev.vars` 里的 `NOTION_OAUTH_REDIRECT_URI` 改成同一个地址。
5. 配置密钥和变量（Settings → Environment variables / Secrets）：
   - `NOTION_OAUTH_CLIENT_ID`
   - `NOTION_OAUTH_CLIENT_SECRET`（Secret）
   - `NOTION_OAUTH_REDIRECT_URI`
   - `SESSION_SECRET`（Secret）
6. 可选：创建一个 KV namespace，在 `wrangler.toml` 里绑到 `PAGE_CACHE`，用于跨隔离缓存页面数据。不配也可以，会用 Cache API 和进程内缓存。
7. 绑定自定义域名（例如 `notion.dydlab.com`），DNS 需要在 Cloudflare 上。
8. 部署完成后先在网站用 Notion 登录检查：能列出已授权的页面、能打开一篇文字笔记、能改几个字并在官方 Notion 里看到更新。

命令行方式示例（需要已登录 `wrangler login`）：

```bash
pnpm build
pnpm wrangler pages project create superlight-notion
pnpm wrangler pages secret put NOTION_OAUTH_CLIENT_SECRET
pnpm wrangler pages secret put SESSION_SECRET
# 然后再设置 NOTION_OAUTH_CLIENT_ID 和 NOTION_OAUTH_REDIRECT_URI
pnpm wrangler pages deploy dist --project-name superlight-notion
```

## 项目结构

```
src/                     前端（Vite + React + TypeScript）
functions/api/           Cloudflare Pages Functions，对应 /api/*
functions/_lib/          Functions 共用逻辑（Notion 客户端、缓存、鉴权）
functions/_middleware.ts 给 /api/* 加上会话保护（OAuth 相关接口除外）
shared/                  前后端共用的富文本与类型
```

API 路由：

- `GET /api/oauth/start`、`GET /api/oauth/callback`
- `POST /api/logout`、`GET /api/me`
- `POST /api/login`（仅开发回退：密码登录）
- `GET /api/page/:id`
- `GET /api/search?q=`（OAuth 模式下列出令牌能看到的页面）
- `PATCH /api/block/:id`
- `GET /api/block/:id/children`（懒加载折叠块子树）
- `POST /api/block/:id/children`（默认在该块后面插入段落）
- `DELETE /api/block/:id`
- `GET /api/img?u=`（图片代理）

## 授权

本项目使用 MIT 许可证，见 [`LICENSE`](./LICENSE)。
