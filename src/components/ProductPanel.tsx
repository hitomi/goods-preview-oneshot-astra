import { Circle, File, Layers2, Upload, ChevronDown } from "lucide-react";
import type {
  Project,
  ProductType,
  Substrate,
  ShapeType,
} from "../domain/model";
import { PRODUCTS, SUBSTRATES } from "../domain/catalog";
import { NumberField } from "./ui";

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
      <div className="product-dimensions">
        <NumberField
          label={project.shape === "circle" ? "直径" : "宽度"}
          value={project.width}
          min={5}
          max={500}
          onChange={(n) =>
            update((p) => {
              p.width = n;
              if (p.shape === "circle") p.height = n;
            })
          }
        />
        {project.shape !== "circle" && (
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
      {project.product === "badge" ? (
        <div className="size-presets" aria-label="吧唧常用尺寸">
          {[32, 44, 58, 75].map((size) => (
            <button
              className={project.width === size ? "selected" : ""}
              key={size}
              onClick={() =>
                update((p) => {
                  p.width = p.height = size;
                })
              }
            >
              {size} mm
            </button>
          ))}
        </div>
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
          {project.cutline ? "替换 SVG 刀线" : "导入 SVG 刀线"}
          <ChevronDown size={12} />
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
