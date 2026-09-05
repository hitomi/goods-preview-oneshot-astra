import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Box,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Download,
  Eye,
  EyeOff,
  FileDown,
  FolderOpen,
  Layers3,
  LoaderCircle,
  Maximize,
  MousePointer2,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Redo2,
  RotateCw,
  Ruler,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
  X,
} from "lucide-react";
import type { LayerKind, ScenePreset } from "../domain/model";
import { uid } from "../domain/model";
import {
  createLayer,
  isLayerSupported,
  layerStage,
  orderedLayers,
  LAYER_LABELS,
  PRODUCTS,
  SCENES,
} from "../domain/catalog";
import { productionIssues } from "../domain/validation";
import { exportProject } from "../lib/storage";
import { useAssetUrls, useProject } from "../lib/useProject";
import { useOffline } from "../lib/useOffline";
import type { PreviewHandle } from "../render/Preview";
import { IconButton, Modal, NameInput, downloadBlob } from "./ui";
import { ProductPanel } from "./ProductPanel";
import { LayerInspector } from "./LayerInspector";
import { ScenePanel, applyScene } from "./ScenePanel";
import { AddLayerDialog } from "./AddLayerDialog";
import { ImportDialog } from "./ImportDialog";
import { HelpDialog } from "./HelpDialog";

const Preview = lazy(() => import("../render/Preview"));

export function Studio({ id }: { id: string }) {
  const editor = useProject(id);
  const { project, assets, update } = editor;
  const navigate = useNavigate();
  const urls = useAssetUrls(assets);
  const offline = useOffline();
  const preview = useRef<PreviewHandle>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [tab, setTab] = useState<"layer" | "scene" | "checks">("layer");
  const [mobilePanel, setMobilePanel] = useState<
    "none" | "product" | "properties"
  >("none");
  const [importFiles, setImportFiles] = useState<File[] | null>(null);
  const [importCutline, setImportCutline] = useState(false);
  const openImport = (files: File[] = [], cutline = false) => {
    setImportCutline(cutline);
    setImportFiles(files);
  };
  const [addLayer, setAddLayer] = useState(false);
  const [help, setHelp] = useState(false);
  const [projectMenu, setProjectMenu] = useState(false);
  const [guides, setGuides] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [view, setView] = useState<"front" | "back" | "perspective">(
    "perspective",
  );
  const [ready, setReady] = useState(false);
  const [renderError, setRenderError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState<"png" | "backup" | "">("");
  const [dragOver, setDragOver] = useState(false);
  const issues = useMemo(
    () => (project ? productionIssues(project, assets) : []),
    [project, assets],
  );
  const selected =
    project?.layers.find((layer) => layer.id === selectedId) ??
    project?.layers.at(-1);
  const warningCount = issues.filter(
    (issue) => issue.severity !== "info",
  ).length;
  const backgroundChannels = (
    project?.scene.background.match(/[0-9a-f]{2}/gi) ?? ["ff", "ff", "ff"]
  ).map((channel) => parseInt(channel, 16));
  const darkBackground =
    backgroundChannels[0] * 0.2126 +
      backgroundChannels[1] * 0.7152 +
      backgroundChannels[2] * 0.0722 <
    100;

  useBlocker({
    shouldBlockFn: async () => {
      if (importFiles !== null) {
        setActionError("请先导入或取消当前这批图片，再离开工作台。");
        return true;
      }
      try {
        await editor.flush();
        return false;
      } catch {
        setActionError(
          "项目尚未保存，已留在当前页面。请重试保存或下载项目备份。",
        );
        return true;
      }
    },
    enableBeforeUnload: () =>
      editor.saveStatus !== "saved" || importFiles !== null,
  });

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (importFiles !== null || addLayer || help) return;
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, select") || target.isContentEditable)
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? editor.redo() : editor.undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void editor.flush().catch(() => undefined);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [editor.undo, editor.redo, editor.flush, importFiles, addLayer, help]);

  async function exportFile(type: "png" | "backup") {
    if (!project) return;
    setBusy(type);
    setActionError("");
    try {
      if (type === "png") {
        const blob = await preview.current?.exportPng();
        if (!blob) throw new Error("三维画面尚未准备好，请稍后重试。");
        downloadBlob(blob, `${project.name || "制品样机"}-效果图.png`);
      } else
        downloadBlob(
          await exportProject(project),
          `${project.name || "制品样机"}.goods.json`,
        );
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "导出失败，请重试。");
    } finally {
      setBusy("");
    }
  }

  const add = (kind: LayerKind) => {
    const layer = createLayer(kind);
    update((p) => {
      p.layers.push(layer);
    });
    setSelectedId(layer.id);
    setTab("layer");
    setAddLayer(false);
  };
  function changeView(next: typeof view) {
    setView(next);
    preview.current?.setView(next);
  }

  if (editor.loading)
    return (
      <div className="full-state" role="status">
        <LoaderCircle size={28} className="spin" />
        <h1>正在打开你的工作台</h1>
        <p>从本机读取项目与图片…</p>
      </div>
    );
  if (editor.error || !project)
    return (
      <div className="full-state">
        <FolderOpen size={34} />
        <h1>暂时无法打开这个项目</h1>
        <p role="alert">{editor.error}</p>
        <button
          className="button primary"
          onClick={() => void navigate({ to: "/projects" })}
        >
          返回本机项目库
        </button>
      </div>
    );

  return (
    <div className="studio-shell">
      <header className="app-header">
        <button
          className="brand"
          onClick={() => void navigate({ to: "/projects" })}
          aria-label="制物 Studio · 打开项目库"
        >
          <span className="brand-symbol">
            <Box size={22} strokeWidth={1.5} />
          </span>
          <span>
            制物 <small>STUDIO</small>
          </span>
        </button>
        <div className="header-divider" />
        <div className="project-title">
          <NameInput
            label="项目名称"
            value={project.name}
            onChange={(value) =>
              update((p) => {
                p.name = value;
              })
            }
          />
          <span className={`save-state ${editor.saveStatus}`} role="status">
            {editor.saveStatus === "saved" ? (
              <CheckCheck size={12} />
            ) : editor.saveStatus === "saving" ? (
              <LoaderCircle size={12} className="spin" />
            ) : (
              <AlertTriangle size={12} />
            )}
            {editor.saveStatus === "saved"
              ? "已保存在本机"
              : editor.saveStatus === "saving"
                ? "正在保存…"
                : "保存失败"}
          </span>
        </div>
        <div className="header-actions">
          <button
            className="icon-button mobile-project-menu"
            aria-label="更多项目操作"
            onClick={() => setProjectMenu(true)}
          >
            <MoreHorizontal size={20} />
          </button>
          <IconButton label="使用指南" onClick={() => setHelp(true)}>
            <CircleHelp size={18} />
          </IconButton>
          <button
            className="button quiet library-button"
            onClick={() => void navigate({ to: "/projects" })}
          >
            <FolderOpen size={16} />
            项目库
          </button>
          <button
            className="button secondary backup-button"
            disabled={!!busy}
            onClick={() => void exportFile("backup")}
          >
            <FileDown size={16} />
            <span>{busy === "backup" ? "正在打包…" : "下载项目"}</span>
          </button>
          <button
            className="button primary export-button"
            aria-label="导出效果图"
            disabled={!!busy || !ready || !!renderError}
            onClick={() => void exportFile("png")}
          >
            <Download size={16} />
            <span>{busy === "png" ? "正在导出…" : "导出效果图"}</span>
          </button>
        </div>
      </header>
      {editor.saveStatus === "error" && (
        <div className="save-error-bar" role="alert">
          <AlertTriangle size={16} />
          <span>{editor.saveError || "保存失败，你的修改仍在当前页面。"}</span>
          <button onClick={() => void editor.flush().catch(() => undefined)}>
            重试保存
          </button>
          <button onClick={() => void exportFile("backup")}>下载备份</button>
        </div>
      )}
      <div className="workspace">
        <aside
          className={`left-panel ${mobilePanel === "product" ? "mobile-visible" : ""}`}
          aria-label="制品与图层"
        >
          <div className="mobile-panel-header">
            <strong>制品与图层</strong>
            <IconButton
              label="关闭制品面板"
              onClick={() => setMobilePanel("none")}
            >
              <X size={18} />
            </IconButton>
          </div>
          <ProductPanel
            project={project}
            update={update}
            onImport={() => openImport([], true)}
          />
          <section className="layers-section">
            <div className="section-title">
              <h2>图案与工艺</h2>
              <span className="step-number">02</span>
            </div>
            <button className="import-button" onClick={() => openImport()}>
              <Upload size={17} />
              <span>批量导入图片</span>
              <span className="import-shortcut">PNG / SVG +</span>
            </button>
            <div className="layer-list" aria-label="图层列表">
              {orderedLayers(project.layers)
                .reverse()
                .map((layer) => {
                  const supported = isLayerSupported(
                    project.product,
                    layer.kind,
                    layer.side,
                  );
                  return (
                    <div
                      className={`layer-row ${selected?.id === layer.id ? "selected" : ""} ${!layer.enabled || !supported ? "layer-muted" : ""}`}
                      key={layer.id}
                    >
                      <button
                        className="layer-select"
                        onClick={() => {
                          setSelectedId(layer.id);
                          setTab("layer");
                        }}
                        aria-pressed={selected?.id === layer.id}
                        aria-label={`编辑图层 ${layer.name}`}
                      >
                        <span className={`layer-thumbnail mark-${layer.kind}`}>
                          {layer.assetId && urls[layer.assetId] ? (
                            <img src={urls[layer.assetId]} alt="" />
                          ) : layer.kind === "print" ? (
                            <span className="mini-art">M</span>
                          ) : (
                            <Sparkles size={17} />
                          )}
                        </span>
                        <span>
                          <strong>{layer.name}</strong>
                          <small>
                            {layer.side === "front" ? "正面" : "背面"} ·{" "}
                            {LAYER_LABELS[layer.kind]}
                            {!supported ? " · 不适用" : ""}
                          </small>
                        </span>
                      </button>
                      <IconButton
                        label={`${layer.enabled ? "隐藏" : "显示"} ${layer.name}`}
                        onClick={() =>
                          update((p) => {
                            const item = p.layers.find(
                              (l) => l.id === layer.id,
                            );
                            if (item) item.enabled = !item.enabled;
                          })
                        }
                      >
                        {layer.enabled && supported ? (
                          <Eye size={15} />
                        ) : (
                          <EyeOff size={15} />
                        )}
                      </IconButton>
                    </div>
                  );
                })}
            </div>
            <p className="helper layer-order-hint">
              从下到上：白墨 → 彩印 →
              表面工艺。同一面、同一工序内可调整叠放顺序。
            </p>
            {!project.layers.length && (
              <p className="helper">
                还没有图层。导入图案或添加一道工艺，就能开始设计。
              </p>
            )}
            <button
              className="add-layer-button"
              disabled={project.layers.length >= 24}
              onClick={() => setAddLayer(true)}
            >
              <Plus size={16} />
              添加图层 / 工艺
            </button>
            <div className="layer-count">
              <Layers3 size={12} />
              <span>
                {project.layers.length} 个图层 · {assets.length} 张本机素材
              </span>
            </div>
          </section>
          <div className="panel-bottom-note">
            <ShieldCheck size={16} />
            <span>从素材到预览，全部留在本机。</span>
          </div>
        </aside>
        <main
          className={`preview-workspace ${dragOver ? "drag-over" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node))
              setDragOver(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            if (event.dataTransfer.files.length)
              openImport(Array.from(event.dataTransfer.files));
          }}
          aria-label="三维预览工作区"
        >
          <div className="canvas-topbar">
            <div className="canvas-breadcrumb">
              <span>样机预览</span>
              <ChevronRight size={12} />
              <strong>{PRODUCTS[project.product].label}</strong>
              <span className="live-badge">
                <span />
                实时 3D
              </span>
            </div>
            <div className="history-tools">
              <IconButton
                label="撤销"
                disabled={!editor.canUndo}
                onClick={editor.undo}
              >
                <Undo2 size={16} />
              </IconButton>
              <IconButton
                label="重做"
                disabled={!editor.canRedo}
                onClick={editor.redo}
              >
                <Redo2 size={16} />
              </IconButton>
            </div>
          </div>
          <div
            className={`canvas-area ${darkBackground ? "dark-scene" : ""}`}
            style={{ background: project.scene.background }}
          >
            <Suspense
              fallback={
                <div className="canvas-loading">
                  <LoaderCircle size={24} className="spin" />
                  <span>正在准备三维工作台…</span>
                </div>
              }
            >
              <Preview
                ref={preview}
                project={project}
                assetUrls={urls}
                showGuides={guides}
                autoRotate={rotating}
                onReady={() => {
                  setReady(true);
                  setRenderError("");
                }}
                onError={setRenderError}
              />
            </Suspense>
            {renderError && (
              <div className="canvas-error" role="alert">
                <AlertTriangle size={24} />
                <strong>暂时无法显示三维画面</strong>
                <p>{renderError}</p>
                <span>你的项目仍然保留，可继续编辑设置或下载项目备份。</span>
              </div>
            )}
            <div className="view-switcher" aria-label="预览视角">
              {(
                [
                  { value: "perspective", label: "立体" },
                  { value: "front", label: "正面" },
                  { value: "back", label: "背面" },
                ] as const
              ).map((option) => (
                <button
                  aria-pressed={view === option.value}
                  className={view === option.value ? "selected" : ""}
                  key={option.value}
                  onClick={() => changeView(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="model-caption">
              <span>{PRODUCTS[project.product].label}</span>
              <strong>
                {project.shape === "circle"
                  ? `Ø ${project.width}`
                  : `${project.width} × ${project.height}`}{" "}
                <small>mm</small>
              </strong>
              <p>
                {project.product === "badge"
                  ? "正面可视尺寸参考"
                  : `板材厚度 ${project.thickness} mm`}
              </p>
            </div>
            <div className="canvas-tools">
              <IconButton
                label="放大样机"
                onClick={() => preview.current?.zoom(1)}
              >
                <ZoomIn size={18} />
              </IconButton>
              <IconButton
                label="缩小样机"
                onClick={() => preview.current?.zoom(-1)}
              >
                <ZoomOut size={18} />
              </IconButton>
              <span className="tool-divider" />
              <IconButton
                label="复位视角"
                onClick={() => {
                  preview.current?.reset();
                  setView("perspective");
                }}
              >
                <Maximize size={17} />
              </IconButton>
              <IconButton
                label="显示尺寸参考线"
                aria-pressed={guides}
                onClick={() => setGuides(!guides)}
              >
                <Ruler size={17} />
              </IconButton>
              <IconButton
                label={rotating ? "停止自动旋转" : "自动旋转样机"}
                aria-pressed={rotating}
                onClick={() => setRotating(!rotating)}
              >
                <RotateCw size={17} />
              </IconButton>
            </div>
            <span className="orbit-hint">
              <MousePointer2 size={12} />
              拖动旋转 · 滚轮缩放
            </span>
            {dragOver && (
              <div className="canvas-drop-overlay">
                <Upload size={38} />
                <h2>松开，安排你的图案与工艺</h2>
                <p>支持一次导入多张图片</p>
              </div>
            )}
          </div>
          <section className="scene-strip" aria-label="快速切换场景">
            <div className="scene-strip-label">
              <Sun size={17} />
              <div>
                <strong>换个光线看看</strong>
                <small>SCENES & LIGHTING</small>
              </div>
            </div>
            <div className="scene-presets">
              {(Object.keys(SCENES) as ScenePreset[]).map((key) => (
                <button
                  key={key}
                  aria-pressed={project.scene.preset === key}
                  className={`scene-card scene-${key} ${project.scene.preset === key ? "selected" : ""}`}
                  onClick={() => update((p) => applyScene(p, key))}
                >
                  <span className="scene-miniature">
                    <span className="mini-sphere" />
                  </span>
                  <span>{SCENES[key].label}</span>
                  {project.scene.preset === key && <Check size={13} />}
                </button>
              ))}
            </div>
            <button
              className="scene-adjust"
              onClick={() => {
                setTab("scene");
                setMobilePanel("properties");
              }}
            >
              <Settings2 size={16} />
              <span>调整</span>
            </button>
          </section>
        </main>
        <aside
          className={`right-panel ${mobilePanel === "properties" ? "mobile-visible" : ""}`}
          aria-label="属性设置"
        >
          <div className="mobile-panel-header">
            <strong>属性设置</strong>
            <IconButton
              label="关闭属性面板"
              onClick={() => setMobilePanel("none")}
            >
              <X size={18} />
            </IconButton>
          </div>
          <div className="inspector-tabs" role="tablist" aria-label="属性面板">
            {[
              { key: "layer", label: "图层" },
              { key: "scene", label: "灯光" },
              { key: "checks", label: "制作检查" },
            ].map((item) => (
              <button
                role="tab"
                aria-selected={tab === item.key}
                tabIndex={tab === item.key ? 0 : -1}
                aria-controls={`panel-${item.key}`}
                id={`tab-${item.key}`}
                key={item.key}
                onClick={() => setTab(item.key as typeof tab)}
                onKeyDown={(event) => {
                  const keys = ["layer", "scene", "checks"] as const;
                  const index = keys.indexOf(tab);
                  const next =
                    event.key === "ArrowRight"
                      ? keys[(index + 1) % 3]
                      : event.key === "ArrowLeft"
                        ? keys[(index + 2) % 3]
                        : event.key === "Home"
                          ? keys[0]
                          : event.key === "End"
                            ? keys[2]
                            : null;
                  if (next) {
                    event.preventDefault();
                    setTab(next);
                    document.getElementById(`tab-${next}`)?.focus();
                  }
                }}
              >
                {item.label}
                {item.key === "checks" && warningCount > 0 && (
                  <span className="check-count">{warningCount}</span>
                )}
              </button>
            ))}
          </div>
          <div
            className="inspector-content"
            id={`panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
          >
            {tab === "layer" && (
              <LayerInspector
                project={project}
                layer={selected}
                assets={assets}
                urls={urls}
                update={update}
                onDelete={() =>
                  update((p) => {
                    p.layers = p.layers.filter(
                      (layer) => layer.id !== selected?.id,
                    );
                  })
                }
                onDuplicate={() => {
                  if (!selected) return;
                  const copy = {
                    ...structuredClone(selected),
                    id: uid(),
                    name: `${selected.name.slice(0, 197)} 副本`,
                  };
                  update((p) => {
                    p.layers.push(copy);
                  });
                  setSelectedId(copy.id);
                }}
                onMove={(direction) =>
                  update((p) => {
                    if (!selected) return;
                    const peers = p.layers.filter(
                      (l) =>
                        l.side === selected.side &&
                        layerStage(l.kind) === layerStage(selected.kind),
                    );
                    const peerIndex = peers.findIndex(
                      (l) => l.id === selected.id,
                    );
                    const neighbor = peers[peerIndex + direction];
                    if (!neighbor) return;
                    const index = p.layers.findIndex(
                      (l) => l.id === selected?.id,
                    );
                    const target = p.layers.findIndex(
                      (l) => l.id === neighbor.id,
                    );
                    if (index >= 0 && target >= 0 && target < p.layers.length)
                      [p.layers[index], p.layers[target]] = [
                        p.layers[target],
                        p.layers[index],
                      ];
                  })
                }
              />
            )}
            {tab === "scene" && (
              <ScenePanel project={project} update={update} />
            )}
            {tab === "checks" && (
              <div className="production-panel">
                <div className="inspector-heading">
                  <ShieldCheck size={28} strokeWidth={1.3} />
                  <div>
                    <span className="eyebrow">BEFORE MAKING</span>
                    <h3>送厂前，多看一步</h3>
                  </div>
                </div>
                <p className="helper">
                  通用预览档案 ·
                  已检查尺寸、图片与工艺兼容性。具体出血和线宽请使用厂家的模板。
                </p>
                {issues.length ? (
                  issues.map((issue) => (
                    <div
                      className={`production-issue issue-${issue.severity}`}
                      key={issue.id}
                    >
                      <div>
                        {issue.severity === "info" ? (
                          <CircleHelp size={16} />
                        ) : (
                          <AlertTriangle size={16} />
                        )}
                        <h4>{issue.title}</h4>
                      </div>
                      <p>{issue.detail}</p>
                      {issue.layerId && (
                        <button
                          className="text-button"
                          onClick={() => {
                            setSelectedId(issue.layerId!);
                            setTab("layer");
                          }}
                        >
                          查看这个图层
                          <ChevronRight size={12} />
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="note">
                    <Check size={16} />
                    当前没有发现尺寸或工艺兼容性问题。工艺叠加、套印和颜色仍需实物打样。
                  </div>
                )}
                <button
                  className="button secondary full-width"
                  onClick={() => setHelp(true)}
                >
                  <CircleHelp size={15} />
                  了解预览的边界
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>
      <div className="mobile-toolbar">
        <button onClick={() => setMobilePanel("product")}>
          <PanelLeft size={18} />
          制品与图层
        </button>
        <button onClick={() => openImport()}>
          <Upload size={18} />
          导入图片
        </button>
        <button onClick={() => setMobilePanel("properties")}>
          <Settings2 size={18} />
          属性与灯光
        </button>
      </div>
      <footer className="statusbar">
        <span>
          <span
            className={`connection-dot ${offline.offlineReady ? "is-ready" : ""}`}
          />
          <span role="status" aria-label="离线状态">
            {offline.offlineReady
              ? offline.online
                ? "可离线使用"
                : "正在离线使用"
              : "首次使用 · 正在准备离线缓存"}
          </span>
          <span className="status-separator">/</span>素材不上传
        </span>
        <button onClick={() => setHelp(true)}>
          用于观察结构与工艺效果，颜色与细节以实物打样为准
          <CircleHelp size={12} />
        </button>
        <span className="status-quality">
          {project.quality === "eco"
            ? "节能"
            : project.quality === "high"
              ? "精细"
              : "均衡"}
          画质
        </span>
      </footer>
      {actionError && (
        <div className="toast error-toast" role="alert">
          <AlertTriangle size={17} />
          <span>{actionError}</span>
          <IconButton label="关闭提示" onClick={() => setActionError("")}>
            <X size={16} />
          </IconButton>
        </div>
      )}
      {offline.needRefresh && (
        <div className="update-notice">
          <span>新版本已准备好，保存后即可更新。</span>
          <button
            onClick={async () => {
              try {
                await editor.flush();
                await offline.updateServiceWorker(true);
              } catch {
                setActionError("保存失败，请先重试保存，再更新应用。");
              }
            }}
          >
            保存并更新
          </button>
        </div>
      )}
      {importFiles !== null && (
        <ImportDialog
          project={project}
          initialFiles={importFiles}
          initialUsage={importCutline ? "cutline" : undefined}
          onClose={() => setImportFiles(null)}
          onCommit={editor.commitAssets}
        />
      )}
      {addLayer && (
        <AddLayerDialog
          product={project.product}
          onClose={() => setAddLayer(false)}
          onAdd={add}
        />
      )}
      {help && (
        <HelpDialog
          offlineReady={offline.offlineReady}
          onInstall={offline.install}
          onClose={() => setHelp(false)}
        />
      )}
      {projectMenu && (
        <Modal title="项目操作" onClose={() => setProjectMenu(false)}>
          <div className="project-menu-actions">
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={() => void exportFile("backup")}
            >
              <FileDown size={17} />
              下载项目备份
            </button>
            <button
              className="button secondary"
              onClick={() => void navigate({ to: "/projects" })}
            >
              <FolderOpen size={17} />
              打开本机项目库
            </button>
            <button
              className="button secondary"
              onClick={() => {
                setProjectMenu(false);
                setHelp(true);
              }}
            >
              <CircleHelp size={17} />
              使用指南与安装
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
