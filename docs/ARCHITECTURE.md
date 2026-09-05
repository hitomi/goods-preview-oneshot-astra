# 架构与工程约定

## 技术栈

Node 24 + npm；React + TypeScript + Vite；TanStack Router 对应项目库与工作台；Three.js 实现 PBR 三维；IndexedDB（idb）保存项目和原始 Blob；Vite PWA/Workbox 预缓存全部应用资产；Vitest 测领域逻辑、Playwright 测生产构建工作流。

应用运行与数据处理不依赖云服务、外部纹理/HDR、第三方 CDN、统计或账户。开发/首次安装可由 localhost 或 HTTPS 静态服务提供，安装缓存完成后运行不依赖网络。直接双击 HTML 不具备 Service Worker 条件。

Cloudflare Pages 可用于分发首次安装所需的静态文件，不承担项目数据或图片处理。`wrangler.jsonc` 指定 `dist`；无 Functions 或云存储绑定。Pages 默认 SPA 回退负责深层地址，`public/_headers` 为入口与 Service Worker 设置重新验证、为带内容哈希的资源设置长期缓存。发布步骤见 [DEPLOYMENT](DEPLOYMENT.md)。

## 边界

- `src/domain/`：序列化模型、制品目录、层兼容规则、制作检查、严格导入验证。
- `src/lib/`：IndexedDB 持久化、图片处理、备份、React 本地编辑状态与撤销。
- `src/render/`：几何体、色彩/工艺纹理合成、灯光、资源生命周期。仅从项目和素材 URL 读入，不写项目。
- `src/components/`：以用户任务划分面板、导入分配、项目库、帮助和可访问对话框。

原图 Blob 与 <=2048px 的预览 Blob 分离。CPU 处理限制并发，大图在解码后缩小，保留尺寸用于 DPI 提示；拒绝超限文件需清楚告知，不静默截断批次。蒙版采用 Alpha 或灰度×Alpha，支持反相与阈值；印刷保持 sRGB。工艺按物理含义合成粗糙度/清漆/金属色/凹凸贴图。

本地保存事务结束才更新保存状态；串行化写入并使用版本/快照避免旧保存覆盖新编辑。离开有未持久化内容时保护输入。备份版本校验后导入新项目，保留当前项目。损坏/未来版本/外部 URL/超限内容拒绝并提供可操作说明。

## 渲染与性能

Three.js 只在参数、纹理、窗口、相机变化时绘制；阻尼或用户开启自动旋转期间逐帧工作。页面隐藏时停止。DPR 按质量档位限制；纹理限制 1024/2048；不使用远程环境贴图，本地生成摄影棚环境。

材质与几何按依赖变更重建；光照更改不重新解码图片。所有 geometry/material/texture/render target/object URL 在替换和卸载时释放。几何分段及 SVG 复杂度有上限，提供错误恢复而非白屏。像素合成按块让出执行权；新编辑通过 AbortSignal 取消旧合成，PNG 导出等待最新合成结束。

图层显示与合成共享物理顺序：白墨底层 → 彩印 → 表面工艺。上下移动仅调整同一印刷面、同一工序中的层序。名称输入采用本地草稿，短暂清空时保留上一个有效名称，避免连带阻断保存和备份。备份导入在提交事务前执行与普通导入相同的刀线几何检查。

官方依据：[Three.js MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html) 的 clearcoat、roughness、metalness、transmission 等能力及开销；[Vite PWA precache](https://vite-pwa-org.netlify.app/guide/service-worker-precache) 要求将全部离线资源纳入预缓存。

## 验证

单测关注：蒙版方向/Alpha/阈值、兼容矩阵、坏备份、尺寸边界与资产保留。端到端关注：批量分配、提交后可见图层、刷新恢复、备份回导、产品切换不丢图、PNG 非空、断网后冷启动编辑和保存、键盘/取消/错误。截图只作视觉证据，不能替代交互断言。
