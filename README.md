# superlight-notion

轻量网页应用：笔记仍放在 Notion 里，这里用来更快地阅读，并做一点点文字编辑。先给自己用，但按通用工具来组织代码，以后可以加上 Notion OAuth 多用户登录。

渲染层使用 MIT 许可的 [react-notion-x](https://github.com/NotionX/react-notion-x)（含 `notion-compat`，用于对接官方 API 读取私人笔记）。版权与许可证全文见 [`THIRD_PARTY_NOTICES`](./THIRD_PARTY_NOTICES)。

## 能做什么、不做什么

**可以：** 阅读已分享给集成的页面；修改段落、标题 1–3、列表、引用、待办的文字；勾选待办；在当前块后面插入新段落；删除一个块；用快捷键做加粗 / 斜体 / 行内代码 / 链接。

**不做：** 拖动排序、数据库、表格、分栏编辑、同步块、评论、多人实时协作、上传图片或文件。完整块编辑器库（BlockNote、TipTap、Lexical 等）也不会引入，以免把页面变重。

不支持的块会显示占位说明，并提供「在 Notion 中打开」的链接。

## 已知限制

- `notion-compat` 目前大约 20 种块完全支持、8 种部分支持，**不支持数据库**。图片、视频、嵌入块可能缺少尺寸或说明文字。
- Notion 官方 API 大约每秒 3 个请求；富文本单段最多 2000 个字符；一次最多追加 100 个块。本项目会遵守这些限制。
- 官方 API 返回的文件链接大约 1 小时后失效。图片会走 `/api/img` 代理，页面缓存时间也比较短（默认 2 分钟），并在写入后失效缓存。
- 内部集成只能看到你手动「连接」给它的页面。

## 准备 Notion

1. 打开 [My integrations](https://www.notion.so/my-integrations)，创建一个 **Internal integration**（内部集成）。
2. 复制它的 **Internal Integration Secret**（形如 `secret_...`），这就是 `NOTION_TOKEN`。能力需要包括读取内容、更新内容、插入内容。
3. 在 Notion 里打开你要作为根目录的页面，点击右上角 `···` → **Add connections / 连接**，把刚建的集成加上。子页面一般会一起被访问到；如果打不开，再对具体页面连一次。
4. 复制根页面链接。页面 ID 是 URL 末尾 32 位十六进制（可以带或不带短横线），例如：
   `https://www.notion.so/my-workspace/Title-0123456789abcdef0123456789abcdef`
   其中 `0123456789abcdef0123456789abcdef` 就是 `NOTION_ROOT_PAGE_ID`。

## 本地开发

需要 Node.js 18+（建议 22 或 24）和 [pnpm](https://pnpm.io/)。

```bash
pnpm install
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars`（不要提交这个文件）：

```
NOTION_TOKEN=secret_xxxxxxxx
NOTION_ROOT_PAGE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
APP_PASSWORD=your-private-password
```

启动本地环境（Wrangler 会跑 `functions/` 里的 Pages Functions，并把前端请求代理给 Vite）：

```bash
pnpm dev
```

然后打开终端里提示的地址（通常是 `http://localhost:8788`），用 `APP_PASSWORD` 登录。

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
4. 配置密钥和变量（Settings → Environment variables / Secrets）：
   - `NOTION_TOKEN`（Secret）
   - `APP_PASSWORD`（Secret）
   - `NOTION_ROOT_PAGE_ID`（明文变量即可）
5. 可选：创建一个 KV namespace，在 `wrangler.toml` 里绑到 `PAGE_CACHE`，用于跨隔离缓存页面数据。不配也可以，会用 Cache API 和进程内缓存。
6. 绑定自定义域名（例如 `notion.dydlab.com`），DNS 需要在 Cloudflare 上。
7. 部署完成后先在网站登录检查：能列出根页面下的页面、能打开一篇文字笔记、能改几个字并在官方 Notion 里看到更新。

命令行方式示例（需要已登录 `wrangler login`）：

```bash
pnpm build
pnpm wrangler pages project create superlight-notion
pnpm wrangler pages secret put NOTION_TOKEN
pnpm wrangler pages secret put APP_PASSWORD
# 然后再设置 NOTION_ROOT_PAGE_ID
pnpm wrangler pages deploy dist --project-name superlight-notion
```

## 项目结构

```
src/                     前端（Vite + React + TypeScript）
functions/api/           Cloudflare Pages Functions，对应 /api/*
functions/_lib/          Functions 共用逻辑（Notion 客户端、缓存、鉴权）
functions/_middleware.ts 给 /api/* 加上口令保护
shared/                  前后端共用的富文本与类型
```

API 路由：

- `POST /api/login`、`POST /api/logout`、`GET /api/me`
- `GET /api/page/:id`
- `GET /api/search?q=`
- `PATCH /api/block/:id`
- `POST /api/block/:id/children`（默认在该块后面插入段落）
- `DELETE /api/block/:id`
- `GET /api/img?u=`（图片代理）

个人模式下用 `APP_PASSWORD` 换 Cookie。后续若做多用户，可在鉴权这一层改成 Notion OAuth，按用户分别保存 token。

## 授权

本项目使用 MIT 许可证，见 [`LICENSE`](./LICENSE)。
