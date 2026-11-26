# superlight-notion

轻量网页应用：笔记仍放在 Notion 里，这里用来更快地阅读，并做一点点文字编辑。登录默认走 Notion OAuth（公开连接），访问令牌只保存在服务器端的加密会话里，浏览器 JavaScript 拿不到密钥。

渲染层使用 MIT 许可的 [react-notion-x](https://github.com/NotionX/react-notion-x)（含 `notion-compat`，用于对接官方 API 读取私人笔记）。版权与许可证全文见 [`THIRD_PARTY_NOTICES`](./THIRD_PARTY_NOTICES)。

## 能做什么、不做什么

**可以：** 阅读已分享给集成的页面；修改段落、标题 1–3、列表、引用、待办的文字；勾选待办；在当前块后面插入新段落；删除一个块；用快捷键做加粗 / 斜体 / 行内代码 / 链接。

**不做：** 拖动排序、数据库、表格、分栏编辑、同步块、评论、多人实时协作、上传图片或文件。完整块编辑器库（BlockNote、TipTap、Lexical 等）也不会引入，以免把页面变重。

不支持的块会显示占位说明，并提供「在 Notion 中打开」的链接。

## 已知限制

- `notion-compat` 目前大约 20 种块完全支持、8 种部分支持，**不支持数据库**。图片、视频、嵌入块可能缺少尺寸或说明文字。
- Notion 官方 API 大约每秒 3 个请求；富文本单段最多 2000 个字符；一次最多追加 100 个块。本项目会遵守这些限制。
- 官方 API 返回的文件链接大约 1 小时后失效。图片会走 `/api/img` 代理，页面缓存时间也比较短（默认 2 分钟），并在写入后失效缓存。
- OAuth 连接只能看到授权时在页面选择器里勾选的页面。要增加页面，请再点一次「用 Notion 登录」或侧栏里的「授权更多页面」。

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
- `POST /api/block/:id/children`（默认在该块后面插入段落）
- `DELETE /api/block/:id`
- `GET /api/img?u=`（图片代理）

## 授权

本项目使用 MIT 许可证，见 [`LICENSE`](./LICENSE)。
