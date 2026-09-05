import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Box,
  Circle,
  File,
  FolderOpen,
  Import,
  Layers2,
  LoaderCircle,
  Plus,
  Trash2,
} from "lucide-react";
import type { Project, ProductType } from "../domain/model";
import { PRODUCTS, SUBSTRATES, createProject } from "../domain/catalog";
import { BADGE_SHAPES, isBadgeShape } from "../domain/badges";
import { BadgeShapeIcon } from "./BadgeShapeIcon";
import {
  deleteProject,
  importProject,
  listProjects,
  saveProject,
} from "../lib/storage";
import { IconButton, Modal } from "./ui";

export function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      setProjects(await listProjects());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "暂时无法读取本机项目，请重试。",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  async function create(type: ProductType) {
    setBusy(true);
    setError("");
    try {
      const project = createProject(type, `未命名${PRODUCTS[type].label}`);
      await saveProject(project);
      await navigate({
        to: "/studio/$projectId",
        params: { projectId: project.id },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "新项目没有保存成功，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function importBackup(file: File) {
    setBusy(true);
    setError("");
    try {
      const project = await importProject(file);
      await navigate({
        to: "/studio/$projectId",
        params: { projectId: project.id },
      });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "无法读取这个备份，请选择制物 Studio 的项目文件。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteProject(deleting.id);
      setDeleting(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "项目未能删除，请重试。");
    } finally {
      setBusy(false);
    }
  }
  const icons = { badge: Circle, paper: File, acrylic: Layers2 };
  return (
    <div className="projects-page">
      <header className="app-header">
        <Link className="brand" to="/projects">
          <span className="brand-symbol">
            <Box size={22} strokeWidth={1.5} />
          </span>
          <span>
            制物 <small>STUDIO</small>
          </span>
        </Link>
        <span className="library-header-note">你的本机制品工作室</span>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Import size={16} />
          {busy ? "正在处理…" : "导入项目备份"}
        </button>
        <input
          className="sr-only"
          aria-label="导入项目备份"
          type="file"
          accept=".json,.goods"
          ref={input}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importBackup(file);
            event.target.value = "";
          }}
        />
      </header>
      <main className="library-content">
        <div className="library-heading">
          <div>
            <span className="eyebrow">YOUR LOCAL STUDIO</span>
            <h1>让下一份设计，有形可见。</h1>
            <p>选一种制品开始，或接着打磨上次的想法。</p>
          </div>
          <span className="local-badge">
            <span />
            素材与项目仅保存在此设备
          </span>
        </div>
        <section className="new-projects" aria-label="新建项目">
          {(Object.keys(PRODUCTS) as ProductType[]).map((type) => {
            const Icon = icons[type];
            return (
              <button
                disabled={busy}
                className={`new-project new-${type}`}
                key={type}
                onClick={() => void create(type)}
              >
                <span className="new-product-icon">
                  <Icon size={38} strokeWidth={1.1} />
                </span>
                <span>
                  <small>新建样机</small>
                  <strong>{PRODUCTS[type].label}</strong>
                  <span>{PRODUCTS[type].description}</span>
                </span>
                <Plus size={22} />
              </button>
            );
          })}
        </section>
        <div className="library-section-title">
          <h2>
            本机项目 <span>{loading ? "" : projects.length}</span>
          </h2>
          <span>最近编辑优先</span>
        </div>
        {error && (
          <div className="error-box" role="alert">
            <p>{error}</p>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void refresh()}
            >
              重新读取
            </button>
          </div>
        )}
        {loading ? (
          <div className="library-state" role="status">
            <LoaderCircle className="spin" />
            正在读取本机项目…
          </div>
        ) : !error && projects.length === 0 ? (
          <div className="library-state">
            <FolderOpen size={32} />
            <h3>这里还没有你的制品</h3>
            <p>在上方选择一种制品，或导入之前下载的项目备份。</p>
          </div>
        ) : (
          <div className="project-grid">
            {projects.map((project) => {
              const Icon = icons[project.product];
              return (
                <article className="project-card" key={project.id}>
                  <Link
                    to="/studio/$projectId"
                    params={{ projectId: project.id }}
                    className="project-card-main"
                  >
                    <div
                      className={`project-cover cover-${project.product}`}
                      style={{ backgroundColor: project.scene.background }}
                    >
                      <div
                        className={`project-cover-product sample-${project.product}`}
                      >
                        {project.product === "badge" &&
                        isBadgeShape(project.shape) ? (
                          <BadgeShapeIcon shape={project.shape} size={44} />
                        ) : (
                          <Icon size={44} strokeWidth={1} />
                        )}
                        <span>
                          {project.product === "badge" &&
                          isBadgeShape(project.shape)
                            ? `${BADGE_SHAPES[project.shape].label}吧唧`
                            : PRODUCTS[project.product].label}
                        </span>
                      </div>
                      <span className="cover-size">
                        {project.width}
                        {project.shape !== "circle"
                          ? ` × ${project.height}`
                          : ""}{" "}
                        mm
                      </span>
                      <ArrowUpRight className="cover-arrow" size={19} />
                    </div>
                    <div className="project-card-info">
                      <h3>{project.name || "未命名制品"}</h3>
                      <p>
                        {SUBSTRATES[project.substrate].label} ·{" "}
                        {project.layers.length} 个图层
                      </p>
                    </div>
                  </Link>
                  <footer>
                    <time dateTime={new Date(project.updatedAt).toISOString()}>
                      {new Date(project.updatedAt).toLocaleString("zh-CN", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    <IconButton
                      label={`删除项目 ${project.name}`}
                      onClick={() => setDeleting(project)}
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
        <p className="library-footnote">
          浏览器数据清理后，本机项目可能被移除。定期下载项目备份，让原图和设置都有一份可带走的副本。
        </p>
      </main>
      {deleting && (
        <Modal
          title={`删除“${deleting.name}”？`}
          onClose={() => setDeleting(null)}
          busy={busy}
        >
          <p className="modal-intro">
            这会移除这个本机项目及其不再被使用的图片，无法在应用内撤销。已下载的项目备份仍可重新导入。
          </p>
          <footer className="modal-footer">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              保留项目
            </button>
            <button
              className="button destructive"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy ? "正在删除…" : "删除本机项目"}
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
