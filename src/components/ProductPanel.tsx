import {
  Circle,
  File,
  Layers2,
  Upload,
  ChevronDown,
  Download,
} from "lucide-react";
import type {
  Project,
  ProductType,
  Substrate,
  ShapeType,
} from "../domain/model";
import { PRODUCTS, SUBSTRATES } from "../domain/catalog";
import {
  BADGE_SHAPES,
  equalDimensions,
  isBadgeShape,
  type BadgeShape,
} from "../domain/badges";
import { BadgeShapeIcon } from "./BadgeShapeIcon";
import { NumberField, downloadBlob } from "./ui";

const icons = { badge: Circle, paper: File, acrylic: Layers2 };

export function ProductPanel({
  project,
  update,
  onImport,
}: {
  project: Project;
  update: (fn: (p: Project) => void) => void;
  onImport: () => void;
}) {
  const badgeShape =
    project.product === "badge" && isBadgeShape(project.shape)
      ? BADGE_SHAPES[project.shape]
      : undefined;
  const linkedDimensions =
    project.shape === "circle" ||
    (project.product === "badge" && equalDimensions(project.shape));

  function changeProduct(type: ProductType) {
    if (type === project.product) return;
    const product = PRODUCTS[type];
    update((p) => {
      p.product = type;
      p.width = product.defaultWidth;
      p.height = product.defaultHeight;
      p.thickness = product.defaultThickness;
      p.substrate = product.substrates[0];
      p.shape = type === "badge" ? "circle" : "rounded";
      p.lamination = type === "acrylic" ? "none" : "gloss";
    });
  }
  return (
    <section className="product-section">
      <div className="section-title">
        <h2>制作什么</h2>
        <span className="step-number">01</span>
      </div>
      <div className="product-picker" aria-label="制品类型">
        {(Object.keys(PRODUCTS) as ProductType[]).map((type) => {
          const Icon = icons[type];
          return (
            <button
              key={type}
              className={project.product === type ? "selected" : ""}
              aria-pressed={project.product === type}
              onClick={() => changeProduct(type)}
            >
              <Icon size={21} strokeWidth={1.5} />
              <span>{PRODUCTS[type].label}</span>
            </button>
          );
        })}
      </div>
      {badgeShape && (
        <fieldset className="badge-shapes">
          <legend>吧唧形状</legend>
          <div className="badge-shape-picker">
            {(Object.keys(BADGE_SHAPES) as BadgeShape[]).map((shape) => (
              <button
                key={shape}
                className={project.shape === shape ? "selected" : ""}
                aria-pressed={project.shape === shape}
                onClick={() => {
                  if (project.shape === shape) return;
                  update((p) => {
                    p.shape = shape;
                    p.width = BADGE_SHAPES[shape].defaultWidth;
                    p.height = BADGE_SHAPES[shape].defaultHeight;
                  });
                }}
              >
                <BadgeShapeIcon shape={shape} />
                <span>{BADGE_SHAPES[shape].label}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div className="product-dimensions">
        <NumberField
          label={project.shape === "circle" ? "直径" : "宽度"}
          value={project.width}
          min={5}
          max={500}
          onChange={(n) =>
            update((p) => {
              p.width = n;
              if (linkedDimensions) p.height = n;
            })
          }
        />
        {!linkedDimensions && (
          <NumberField
            label="高度"
            value={project.height}
            min={5}
            max={500}
            onChange={(n) =>
              update((p) => {
                p.height = n;
              })
            }
          />
        )}
      </div>
      {badgeShape ? (
        <>
          <div
            className={`size-presets ${project.shape === "circle" ? "" : "badge-size-presets"}`}
            role="group"
            aria-label="吧唧常用尺寸"
          >
            {badgeShape.presets.map((size) => {
              const selected =
                project.width === size.width && project.height === size.height;
              return (
                <button
                  className={selected ? "selected" : ""}
                  aria-pressed={selected}
                  key={size.label}
                  onClick={() =>
                    update((p) => {
                      p.width = size.width;
                      p.height = size.height;
                    })
                  }
                >
                  {size.label}
                </button>
              );
            })}
          </div>
          <p className="badge-size-note">
            尺寸为成品外轮廓。预设参考厂家规格，包边与裁纸请使用对应模具模板。
          </p>
        </>
      ) : (
        <div className="form-row">
          <label className="select-field">
            外形
            <select
              aria-label="制品外形"
              value={project.shape}
              onChange={(e) =>
                update((p) => {
                  p.shape = e.target.value as ShapeType;
                  if (p.shape === "circle") p.height = p.width;
                })
              }
            >
              <option value="rounded">圆角矩形</option>
              <option value="rectangle">直角矩形</option>
              <option value="circle">圆形</option>
              {project.cutline && <option value="custom">自定义刀线</option>}
            </select>
          </label>
          <NumberField
            label="厚度"
            value={project.thickness}
            min={0.05}
            max={20}
            step={0.05}
            onChange={(n) =>
              update((p) => {
                p.thickness = n;
              })
            }
          />
        </div>
      )}
      {project.product !== "badge" && (
        <button className="text-button cutline-link" onClick={onImport}>
          <Upload size={13} />
          {project.cutline ? "替换刀线" : "导入刀线图片 / SVG"}
          <ChevronDown size={12} />
        </button>
      )}
      {project.product !== "badge" && project.cutline && (
        <button
          className="text-button cutline-link"
          onClick={() =>
            downloadBlob(
              new Blob([project.cutline!], { type: "image/svg+xml" }),
              `${project.name}-刀线.svg`,
            )
          }
        >
          <Download size={13} />
          下载当前刀线 SVG
        </button>
      )}
      <div className="section-title material-title">
        <h2>{project.product === "acrylic" ? "板材" : "底纸"}</h2>
        <span className="section-meta">
          {project.product === "acrylic" ? "BASE MATERIAL" : "PAPER STOCK"}
        </span>
      </div>
      <div className="material-list">
        {PRODUCTS[project.product].substrates.map((type: Substrate) => (
          <button
            key={type}
            className={`material-option ${project.substrate === type ? "selected" : ""}`}
            aria-pressed={project.substrate === type}
            onClick={() =>
              update((p) => {
                p.substrate = type;
              })
            }
          >
            <span
              className={`material-swatch swatch-${type}`}
              style={{ backgroundColor: SUBSTRATES[type].color }}
            />
            <span>
              <strong>{SUBSTRATES[type].label}</strong>
              <small>{SUBSTRATES[type].description}</small>
            </span>
            <span className="radio-dot" />
          </button>
        ))}
      </div>
      {project.product !== "acrylic" && (
        <label className="select-field finish-field">
          表面覆膜
          <select
            value={project.lamination}
            onChange={(e) =>
              update((p) => {
                p.lamination = e.target.value as Project["lamination"];
              })
            }
          >
            <option value="gloss">亮膜 · 明亮反光</option>
            <option value="matte">哑膜 · 柔和散射</option>
            {project.product === "paper" && (
              <option value="none">不覆膜 · 保留纸感</option>
            )}
          </select>
        </label>
      )}
    </section>
  );
}
