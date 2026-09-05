# Cloudflare Pages 部署

当前已配置静态构建、Wrangler 命令及缓存响应头，本地验收通过；用户提供的首次云端日志显示构建成功，但使用 Workers 命令发布失败，尚无 Pages 发布成功记录。验证记录见 [PROGRESS](PROGRESS.md)。

Pages 只托管 `dist` 中的应用文件。用户图片、工程与 IndexedDB 数据留在设备内，无需 Pages Functions、数据库或运行时密钥，也不启用 Web Analytics。

## 推荐：连接 GitHub

代码推送到 [hitomi/goods-preview-oneshot-astra](https://github.com/hitomi/goods-preview-oneshot-astra) 后，在 Cloudflare 的 **Workers & Pages → Create application → Pages** 中连接 GitHub 仓库，填写：

| 设置 | 值 |
| --- | --- |
| 项目名称 | `goods-preview-oneshot-astra`，与 `wrangler.jsonc` 一致 |
| 生产分支 | `main` |
| 根目录 | 仓库根目录，保持默认 |
| 构建命令 | `npm run build` |
| 构建输出目录 | `dist` |

Pages 会安装依赖并执行构建；保存部署后，后续推送会触发自动构建。具体界面名称以 [Pages Git 集成指南](https://developers.cloudflare.com/pages/get-started/git-integration/) 为准。

使用当前 Pages 构建环境，保留仓库根目录的 `.node-version`，与本地保持相同的 Node 24 版本；不要设置冲突的 `NODE_VERSION`。Pages 支持读取该文件，不能仅依靠 `package.json` 的 `engines` 选择 Node 版本。[构建环境说明](https://developers.cloudflare.com/pages/configuration/build-image/)

构建命令填写 `npm run build` 即可；`pages:deploy` 用于从本机上传，不应作为 Pages 云端构建命令。

## 构建成功，但提示缺少 Worker 入口

若日志依次出现 `Success: Build command completed`、`Executing user deploy command: npx wrangler deploy` 和 `Missing entry-point to Worker script or to assets directory`，说明发布阶段调用了 Workers 命令，与本仓库的 Pages 配置不匹配。`npx wrangler deploy` 是 Workers Builds 的默认发布命令；这类日志通常表示创建时进入了 Workers 的 Git 部署流程。[Workers Builds 配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)

继续使用本项目约定的 Pages 部署方式：

1. 回到 **Workers & Pages**，创建应用时明确进入 **Pages**，连接同一个 GitHub 仓库。
2. 生产分支填 `main`，构建命令填 `npm run build`，输出目录填 `dist`，根目录保持默认。
3. 保存并部署。Pages Git 集成会在构建后上传输出目录，无需填写独立的 `npx wrangler deploy` 发布命令。如果页面要求填写该命令，请返回检查是否仍在 Workers 创建流程。[Pages Git 集成指南](https://developers.cloudflare.com/pages/get-started/git-integration/)

不要为消除这条错误向 Pages 配置补上 Worker `main` 或 `assets` 字段，也不要把 Workers Builds 的命令替换当成已创建 Pages 项目。命令行方式需要先有 Pages 项目与相应授权，完整步骤见下方“Wrangler 手动发布”。日志里的依赖弃用、安装脚本与包体积提示没有导致本次失败，构建产物已成功生成。

## Pages API 认证错误 10000

如果已换成 `wrangler pages deploy` 却返回 `Authentication error [code: 10000]`，先检查部署进程使用的 `CLOUDFLARE_API_TOKEN`：令牌需具备目标账户的 **Account → Cloudflare Pages → Edit** 权限，账户资源范围与 `CLOUDFLARE_ACCOUNT_ID` 对应。账户本人是管理员不代表该令牌具有同等权限；Workers Builds 自动生成的令牌也不能假定拥有 Pages 权限。还需确认目标 Pages 项目确实已创建。更换命令不会把 Worker 项目转换为 Pages 项目。[Pages API 权限](https://developers.cloudflare.com/pages/configuration/api/)

采用上方推荐的 Pages Git 集成流程可直接由 Pages 完成发布；使用自定义 CI 时，按“Wrangler 手动发布”配置项目和部署凭据。

## Wrangler 本地预览

在仓库根目录使用项目 Node 版本和锁定依赖：

```bash
fnm install
fnm use
npm ci
npm run pages:dev
```

该命令先构建，再启动本地 Pages 服务，打开终端显示的 localhost 地址。它用于检查路由与静态响应头，不会发布远程站点。日常源码开发继续使用 `npm run dev`。

运行 Pages 环境的浏览器验收：

```bash
npx playwright install chromium
npm run test:pages
```

验收命令使用 Wrangler 的本地 `8788` 端口，覆盖应用工作流、SPA 深层路由和缓存响应头；运行前先结束占用该端口的手动预览服务。测试结果以实际输出及 [PROGRESS](PROGRESS.md) 为准。

`wrangler.jsonc` 声明 Pages 项目名和 `pages_build_output_dir: "./dist"`；项目使用 Pages 专用命令上传此目录。[Wrangler 配置说明](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)

## Wrangler 手动发布

本机交互登录：

```bash
npx wrangler login
```

若已按上面的 GitHub 方式建立同名 Pages 项目，直接执行发布命令，不再创建项目。Git 集成项目也支持 Wrangler 手动发布；如果只希望手动发布，可在 Pages 关闭自动分支部署。[Git 集成与手动部署](https://developers.cloudflare.com/pages/get-started/git-integration/)

只有确定使用 **Direct Upload**、不采用 Pages Git 集成时，才首次创建项目：

```bash
npx wrangler pages project create goods-preview-oneshot-astra --production-branch main
```

Direct Upload 项目创建后不能改为 Git 集成；以后需要 Git 集成时必须新建项目。[Direct Upload 限制](https://developers.cloudflare.com/pages/get-started/direct-upload/)

对已存在且生产分支为 `main` 的项目发布：

```bash
npm run pages:deploy -- --branch main
```

该命令重新构建并上传 `dist`。`--branch main` 明确发布到项目的生产分支；若项目采用其他生产分支，应先统一设置。[Pages CLI 参数](https://developers.cloudflare.com/workers/wrangler/commands/pages/)

自动化发布时，通过 CI 的密钥存储注入 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`。令牌权限使用目标账户的 **Cloudflare Pages: Edit**；令牌仅进入部署进程环境，不写入仓库、`wrangler.jsonc`、构建产物或 `VITE_*` 变量。[CI 凭据说明](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)

## 路由、缓存与离线数据

生产构建不包含顶层 `404.html`，使用 Pages 默认 SPA 回退，将 `/projects` 和 `/studio/…` 等深层地址交给应用路由。不要添加会取消该行为的顶层 404 文件。[SPA 路由说明](https://developers.cloudflare.com/pages/configuration/serving-pages/#single-page-application-spa-rendering)

`public/_headers` 随 Vite 构建复制到 `dist`，控制 HTML、Service Worker 与应用清单重新验证，带内容哈希的构建资源采用长期缓存。Service Worker 的离线预缓存由应用管理；HTTP 重新验证策略不等于禁用离线使用。修改响应头后需重新构建并发布。[Pages 响应头规则](https://developers.cloudflare.com/pages/configuration/headers/)

使用稳定的生产域名或自定义域名安装 PWA，首次打开并等到应用提示“可离线使用”后再断网。每次部署的预览域名与正式域名属于不同来源，不能共享原来的本机项目；从 localhost 或旧域名迁移时，先下载工程备份，再在新域名导入。

上线后在最终 HTTPS 域名验证：首页及深层地址刷新、三维预览、导入编辑并保存、刷新恢复、工程备份与导出，以及首次缓存后的断网重开。配置和本地预览通过不能代替这一步；远程构建、域名和浏览器安装结果应按实际情况记录到 [PROGRESS](PROGRESS.md)。
