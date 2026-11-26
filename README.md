# superlight-notion

**English** | [简体中文](./README.zh-CN.md)

A lightweight web app: notes stay in Notion, and this app is for faster reading plus a little text editing. Sign-in defaults to Notion OAuth (a public connection). Access tokens live only in a server-side encrypted session; browser JavaScript never sees the secrets.

The renderer is the MIT-licensed [react-notion-x](https://github.com/NotionX/react-notion-x) (including `notion-compat`, which talks to the official API for private notes). Copyright and the full license text are in [`THIRD_PARTY_NOTICES`](./THIRD_PARTY_NOTICES).

## What it is（项目定位）

This is an ultra-lightweight Notion frontend and proxy framework (lightweight Notion frontend / proxy). The official Notion client is too heavy on memory, especially when you also run an AI Agent on the same machine and the Agent itself needs a lot of memory.

Everyday use is different, too: people mainly read notes, and dictate or direct an AI Agent to edit them, rather than spending long sessions writing heavily inside official Notion. superlight-notion keeps only reading, a little text editing, and the proxy APIs those flows need, so the page and the process stay light.

## What it can and cannot do

**Can:** read pages shared with the integration; edit text in paragraphs, headings 1–3, lists, quotes, and to-dos; check to-dos; insert a new paragraph after the current block; delete a block; use shortcuts for bold / italic / inline code / links.

**Cannot:** drag-and-drop reordering, database cell editing, table editing, column editing, synced-block editing, comments, multiplayer realtime collaboration, or uploading images or files. Full block-editor libraries (BlockNote, TipTap, Lexical, and the like) are also not included, so the page does not get heavy.

Unsupported blocks show a placeholder and a “Open in Notion” link. `PageView` currently maps `Collection`, `Equation`, `Modal`, and `Pdf` to `UnsupportedBlock`.

## Hard limitations（硬性限制）

These limits come from the official Notion API and the current implementation. They need to be stated plainly; you cannot work around them by making the frontend “feel fast.”

- **Rate limits**: Notion assigns each connection a budget in a 60-second window. On standard plans (Free / Plus), each connection gets 180 requests per 60 seconds (average 3 req/s); Business / Enterprise gets 600 per 60 seconds (average 10 req/s). That 60-second budget may be used in bursts; requests do not have to be spaced evenly. When the limit is exceeded, Notion returns HTTP 429 and `rate_limited`, and the `Retry-After` response header gives the number of seconds to wait. Data source queries have a separate limit of about 3 req/s, and all connections in a workspace also share a workspace-level cap. This project backs off and retries only when it receives a real 429, honoring `Retry-After`; it no longer pre-emptively rate-limits.
- **Server-side cache TTL is 120 seconds**: Worker in-memory Map + optional KV (`PAGE_CACHE`) + Cloudflare Edge Cache API. A cache miss or expiry triggers a full re-fetch; there is no partial incremental refresh. Successful edits, inserts, or deletes explicitly invalidate the corresponding cache. Browser responses carry `cache-control: no-store`; the frontend itself does not cache page bodies.
- **Nested containers cannot be fetched in batch**: the official API’s `blocks.children.list` does not inline descendant blocks, and there is no batch endpoint to fetch children of multiple parents at once. So every nested container with `has_children: true` (such as `callout`, `toggle`, `column_list`, `column`, indented lists, and so on) needs an extra `blocks.children.list`. A single level returns at most 100 blocks; going over that paginates and costs another request.
- **Database views are currently skipped**: `notion-compat` skips `child_database` entirely, the `collection` fields are empty, and the frontend `Collection` component renders as an unsupported block. If this is later implemented with the traditional `GET /v1/databases` + `POST /v1/databases/query` (or `data_sources/query`) path, each view needs at least 2 requests; with the Views API it would be 2 + the number of visible rows, or 2 plus one additional batch query.
- **Page references (`link_to_page`)**: under default `notion-compat`, each reference adds about 2 shallow metadata requests (`blocks.retrieve` + `pages.retrieve`) and may also walk ancestors. The current lean fetcher has reduced this to at most 1 `pages.retrieve`. Inline `@mention` spans in a paragraph already include the title in `rich_text.plain_text`, so those fetches are skipped entirely.

## Best-practice usage guide（人类与 AI Agent 最佳实践）

To make first page loads faster and stay within the rate budget, prefer a flat note structure:

- Prefer flat `paragraph` blocks and simple lists; use nested containers sparingly.
- When an AI Agent writes notes, there are two recommended modes: **Strict mode** never uses nested containers such as `callout`, `toggle`, `column_list`, or `column`, so the first open of a page needs only 2 Notion API requests (`pages.retrieve` + `blocks.children.list`); **Relaxed mode** uses containers only where necessary, and only a few of them. See “Agent Writing Rules” below for the details.
- Avoid deep page nesting. In default `notion-compat`, each extra level used to cost 2 additional ancestor-chain breadcrumb requests. The latest optimizations removed that upward crawl, but a shallow structure is still cleaner and easier to maintain.
- Keep sibling blocks on a single page at or under 100, so `blocks.children.list` does not paginate (one request per 100 blocks).
- In OAuth mode the sidebar uses `POST /v1/search` (`filter.object = page`) with `page_size` 100. When there are 100 or fewer authorized pages, a single request returns the full nested tree (including `parent.page_id`). The frontend assembles that into a collapsible tree; it does not need per-level fetches.

## Recent optimizations（近期核心优化记录）

- [`f6c9b78`](https://github.com/DYD-Tech/superlight-notion/commit/f6c9b78): replaced the hardcoded 333ms pre-emptive limiter with 429-only backoff. Requests are sent at full speed by default; only when Notion actually returns HTTP 429 does the client parse `Retry-After` (or fall back to 500ms / 1000ms / 2000ms) and retry, up to 3 times.
- [`f807506`](https://github.com/DYD-Tech/superlight-notion/commit/f807506): removed the 3 duplicate root-page requests for `pages.retrieve`, `blocks.retrieve`, and `blocks.children.list` between `NotionCompatAPI.getPage` and `resolvePage`.
- [`dbdfbd7`](https://github.com/DYD-Tech/superlight-notion/commit/dbdfbd7): switched to a lean page fetcher (uses `notion-compat`’s `convertPage` directly, and no longer calls the full `getPage`):
  - Removed the unused ancestor-chain crawl (the frontend `PageView` already sets `disableHeader`, so breadcrumbs are not shown)
  - Removed redundant `blocks.retrieve` (a flat page now opens in 2 requests)
  - Skipped extra fetches for `child_page` and `@mention` (the title is already in the parent `children` list or in `rich_text.plain_text`)
  - `link_to_page` does at most one `pages.retrieve`, and degrades gracefully on failure
  - `toggle` blocks and toggleable headings (such as the 3 collapsible `heading_2` blocks on the workbench) lazy-load when expanded (`GET /api/block/:id/children`)
  - Sidebar search now uses `page_size: 100`
  - When `waitUntil` is present, the extra `await cache.set(...)` is no longer used

## Block-Type Reference（Notion 块类型速查表）

The tables below follow official API types, cross-checked against `notion-compat`’s `convertBlock` (`node_modules/notion-compat/build/index.mjs`) and the component mappings in `src/components/PageView.tsx`.

**How to read this:** “0 extra requests” means the block’s data is already in the `results` of the parent (usually the page root) `blocks.children.list` call, so no additional request is needed. If a block has `has_children: true` and is not a lazy-loaded toggle, it costs 1 more `blocks.children.list`.

### RECOMMENDED / Flat blocks（推荐使用的平铺块）

These leaf blocks, or blocks without children, come straight from the parent `blocks.children.list` and cost **0 extra requests**. Strict mode should use only this class, and must not add indented children to them.

| Official API type | What it renders | Request cost | `notion-compat` / `PageView` notes |
| --- | --- | --- | --- |
| `paragraph` | A normal paragraph; a Shift+Enter soft line break still belongs to the same block | 0 extra requests | Mapped to `text`; can be edited in place |
| `heading_1` | Heading 1 (when not toggleable) | 0 extra requests | Mapped to `header` |
| `heading_2` | Heading 2 (when not toggleable) | 0 extra requests | Mapped to `sub_header` |
| `heading_3` | Heading 3 (when not toggleable) | 0 extra requests | Mapped to `sub_sub_header` |
| `heading_4` | Heading 4 | 0 extra requests | `convertBlock` maps this to `header_4`; uncommon in official notes |
| `bulleted_list_item` | A bulleted list item with no nested children | 0 extra requests | Mapped to `bulleted_list`; editable |
| `numbered_list_item` | A numbered list item with no nested children | 0 extra requests | Mapped to `numbered_list`; editable |
| `to_do` | A to-do item with no nested children | 0 extra requests | Text is editable and the checkbox can be toggled |
| `quote` | A quote with no nested children | 0 extra requests | Type name stays `quote`; editable |
| `code` | A code block | 0 extra requests | Lazily loads the `react-notion-x` `Code` component |
| `divider` | A divider | 0 extra requests | Rendered as-is |
| `equation` | A block equation | 0 extra requests | `convertBlock` converts the expression, but `PageView` maps `Equation` to `UnsupportedBlock` |
| `file` | A file attachment | 0 extra requests | `convertBlock` has a matching branch; rendering is limited |
| `pdf` | A PDF preview | 0 extra requests | `convertBlock` sets a height, but `PageView` maps `Pdf` to `UnsupportedBlock` |
| `image` | An image (proxied through `/api/img`) | 0 extra requests | Supports external URLs or Notion file URLs |
| `video` | Video / Loom, etc. | 0 extra requests | `convertBlock` handles some sources |
| `audio` | Audio | 0 extra requests | **Not handled explicitly in `convertBlock`**; the official type name is kept, and rendering may be incomplete |
| `embed` | A generic embed (Twitter, Figma, Spotify, etc.) | 0 extra requests | Mapped by hostname to `tweet` / `maps` / `figma` and similar |
| `bookmark` | A bookmark preview | 0 extra requests | Uses `bookmark.url` |
| `link_preview` | A link preview | 0 extra requests | **Not handled explicitly in `convertBlock`**; rendering may be incomplete |
| `synced_block` | A synced-block reference used as a leaf / with no children | 0 extra requests | Mapped to `transclusion_container` when there is no source, or `transclusion_reference` when `synced_from` is set |
| `template` | A template button | 0 extra requests | `convertBlock` only `break`s; almost no structure is converted |
| `breadcrumb` | Breadcrumbs (this app’s header is disabled) | 0 extra requests | The frontend sets `disableHeader`, so page-header breadcrumbs are not shown |
| `table_of_contents` | A table of contents | 0 extra requests | Generated by `react-notion-x` from already loaded blocks |
| `link_to_page` | A page reference (title only; body is not fetched) | at most +1 `pages.retrieve` | Mapped to `alias`; the same target is deduplicated; failures degrade gracefully. `@mention` is skipped and costs no request |

In addition, `PageView` maps `Modal` to `UnsupportedBlock` (modal-style blocks are not supported today).

### NOT RECOMMENDED / Container or nested blocks（不推荐 / 慎用的容器与嵌套块）

These blocks each trigger extra requests per instance, or are skipped and not rendered. Relaxed mode may use a few of them, but they should not be stacked.

| Official API type | What it renders | Request cost | `notion-compat` / `PageView` notes |
| --- | --- | --- | --- |
| `column_list` | A multi-column container | +1 `blocks.children.list` per instance | Used to obtain the `column` blocks inside |
| `column` | A single column | +1 per instance (and +1 more for any nested container inside the column that has children) | Appears together with `column_list` |
| `toggle` | A toggle list | 0 extra requests on first open (lazy-loaded); +1 `blocks.children.list` when expanded | After a click on `<details>`, loads via `GET /api/block/:id/children` |
| `heading_1` / `heading_2` / `heading_3` (`is_toggleable: true`) | A toggleable heading | Same as above: lazy on first open, +1 when expanded | The fetcher fills in `format.toggleable` so `react-notion-x` renders a `<details>` element |
| `callout` | A callout | 0 when it has no children; +1 per instance when it has children | `convertBlock` keeps the `callout` type as-is |
| `quote` / `paragraph` / list types / `to_do` (`has_children: true`) | A paragraph or list with indented children | +1 per instance | Any non-lazy block with `has_children: true` fetches its children |
| `table` | A simple table | +1 to fetch `table_row` children | `convertBlock` handles column count / header formatting |
| `table_row` | A table row | Returned in the parent `table` children list | Should not be used as a top-level block on its own |
| `child_page` | A child-page link | 0 extra requests (the title is already in the parent children list); opening it is a separate page load | Mapped to `page`; `pages.retrieve` is no longer called for it |
| `child_database` | A child database / database view | Currently skipped, 0 requests; if later implemented with the query API, at least +2 per view | `notion-compat` simply `break`s and leaves `collection` empty; `PageView` maps `Collection` to `UnsupportedBlock` |
| `synced_block` (with children) | A synced-block container that has content | +1 per instance | The counterpart of the leaf form; there is no batch API |

### Agent Writing Rules（Agent 写作规则）

- **Strict mode**: use only the “RECOMMENDED / Flat blocks” above, and do not create any nested children with `has_children: true` (no indented lists, and do not nest paragraphs inside a callout). Then the first open of a whole page needs only 2 Notion API requests: `pages.retrieve` + `blocks.children.list`.
- **Relaxed mode**: a small number of container blocks is allowed, but keep the total under 3 containers per page and nesting no deeper than 1 level. For long content that should stay collapsed, prefer a `toggle` or a toggleable heading (children lazy-load on expand) instead of reaching first for stacked `column_list` + `callout` blocks.

## Set up Notion (OAuth public connection)

1. Open the developer portal: [notion.so/profile/integrations](https://www.notion.so/profile/integrations) (the older address [notion.so/my-integrations](https://www.notion.so/my-integrations) usually redirects here). You need to be signed in to Notion first.
2. Create a new integration / New connection.
3. Fill in:
   - **Name**: for example `superlight-notion`
   - **Authentication method**: choose **OAuth** (public connection); do not use an internal-integration API key
   - **Redirect URI** (local development): `http://localhost:8788/api/oauth/callback`
   - **Installable in**: Any workspace (or restrict workspaces as needed). This usually cannot be changed after creation
   - **Capabilities**: enable reading content, updating content, and inserting content
4. After creation, copy the **OAuth client ID** and **OAuth client secret** from Configuration on the same page. You do not need to submit the integration to the Notion template marketplace to start authorizing.
5. The first time you click “Sign in with Notion” in the app, Notion shows a page picker. Select the pages you are willing to share. To add more pages later, go through authorization again.

About local `http://localhost`: official OAuth examples use `https://` domains and do not explicitly forbid local http. The developer dashboard generally accepts `http://localhost:port/path`, and it must match the `redirect_uri` in the authorization request **exactly** (`localhost` and `127.0.0.1` are not the same address). If the dashboard refuses to save an http address, use an HTTPS tunnel (for example Cloudflare Tunnel) and enter `https://.../api/oauth/callback`.

## Local development

You need Node.js 18+ (22 or 24 recommended) and [pnpm](https://pnpm.io/).

```bash
pnpm install
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` (do not commit this file):

```
NOTION_OAUTH_CLIENT_ID=your client id
NOTION_OAUTH_CLIENT_SECRET=your client secret
NOTION_OAUTH_REDIRECT_URI=http://localhost:8788/api/oauth/callback
SESSION_SECRET=replace this with a long random string
```

`SESSION_SECRET` is used to sign the state cookie and to encrypt the session with AES-GCM (it holds the access token, an optional refresh token, plus the workspace name and bot id). You can generate one with:

```bash
openssl rand -base64 32
```

Access tokens live only in an HttpOnly encrypted cookie; API responses never return the token.

If none of the OAuth variables above are configured, an optional development fallback is enabled: `NOTION_TOKEN` + `APP_PASSWORD` (and an optional `NOTION_ROOT_PAGE_ID`). Production use should go through OAuth.

Start the local environment (Wrangler runs the Pages Functions in `functions/` and proxies frontend requests to Vite):

```bash
pnpm dev
```

Then open the address printed in the terminal (usually `http://localhost:8788`) and click “Sign in with Notion.”

Common commands:

```bash
pnpm typecheck
pnpm test
pnpm build
```

`pnpm build` writes the frontend into `dist/`. `pnpm preview` can then locally preview “static assets + Functions” with Wrangler, and it also reads `.dev.vars`.

## Deploy to Cloudflare Pages (do not deploy yet — steps only)

1. Put the code in a Git repository (GitHub / GitLab, etc.), or upload `dist/` directly with `wrangler pages deploy`.
2. Create a Pages project in the Cloudflare Dashboard. Build settings:
   - **Framework preset:** None / or Vite
   - **Build command:** `pnpm install && pnpm build`
   - **Build output directory:** `dist`
   - **Root directory:** the repository root
3. Configure compatibility in the project settings:
   - Compatibility date: `2026-11-26` or later is recommended
   - Compatibility flags: enable `nodejs_compat`
4. Add a production Redirect URI to the Notion public connection, for example `https://your-domain/api/oauth/callback`, and set `NOTION_OAUTH_REDIRECT_URI` in `.dev.vars` to the same address.
5. Configure variables and secrets (Settings → Environment variables / Secrets):
   - `NOTION_OAUTH_CLIENT_ID`
   - `NOTION_OAUTH_CLIENT_SECRET` (Secret)
   - `NOTION_OAUTH_REDIRECT_URI`
   - `SESSION_SECRET` (Secret)
6. Optional: create a KV namespace and bind it to `PAGE_CACHE` in `wrangler.toml` for cross-isolate page caching. This is not required; Cache API and in-process memory are used otherwise.
7. Bind a custom domain (for example `notion.dydlab.com`). DNS needs to be on Cloudflare.
8. After a deploy, sign in with Notion on the site and check that authorized pages are listed, a text note can be opened, and a small edit shows up in official Notion.

CLI example (requires `wrangler login`):

```bash
pnpm build
pnpm wrangler pages project create superlight-notion
pnpm wrangler pages secret put NOTION_OAUTH_CLIENT_SECRET
pnpm wrangler pages secret put SESSION_SECRET
# then set NOTION_OAUTH_CLIENT_ID and NOTION_OAUTH_REDIRECT_URI
pnpm wrangler pages deploy dist --project-name superlight-notion
```

## Project structure

```
src/                     Frontend (Vite + React + TypeScript)
functions/api/           Cloudflare Pages Functions, mapped to /api/*
functions/_lib/          Shared Functions logic (Notion client, cache, auth)
functions/_middleware.ts Session protection for /api/* (OAuth routes excluded)
shared/                  Rich-text helpers and types shared by frontend and backend
```

API routes:

- `GET /api/oauth/start`, `GET /api/oauth/callback`
- `POST /api/logout`, `GET /api/me`
- `POST /api/login` (development fallback only: password login)
- `GET /api/page/:id`
- `GET /api/search?q=` (in OAuth mode, lists pages the token can see)
- `PATCH /api/block/:id`
- `GET /api/block/:id/children` (lazy-load a toggle block’s subtree)
- `POST /api/block/:id/children` (by default, inserts a paragraph after that block)
- `DELETE /api/block/:id`
- `GET /api/img?u=` (image proxy)

## License

This project is licensed under the MIT License; see [`LICENSE`](./LICENSE).
