import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileImage,
  LoaderCircle,
  Plus,
  Upload,
  X,
  AlertCircle,
} from "lucide-react";
import type {
  AssetRecord,
  LayerKind,
  MaskMode,
  Project,
  Side,
} from "../domain/model";
import { createLayer, isLayerSupported, LAYER_LABELS } from "../domain/catalog";
import { processImage, safeSvg, suggestLayer } from "../lib/images";
import { useAssetUrls } from "../lib/useProject";
import { IconButton, Modal } from "./ui";

type Usage = "library" | "cutline" | `${LayerKind}-${Side}`;
interface ImportRow {
  asset: AssetRecord;
  usage: Usage;
  mode: MaskMode;
  invert: boolean;
}

export function ImportDialog({
  project,
  initialFiles,
  onClose,
  onCommit,
}: {
  project: Project;
  initialFiles?: File[];
  onClose: () => void;
  onCommit: (
    assets: AssetRecord[],
    edit: (draft: Project) => void,
  ) => Promise<void>;
}) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);
  const rowAssets = useMemo(() => rows.map((row) => row.asset), [rows]);
  const urls = useAssetUrls(rowAssets);

  async function addFiles(files: File[]) {
    if (!files.length) return;
    if (rows.length + files.length > 32) {
      setErrors(["每批最多处理 32 张图片，请分批导入；已选图片仍然保留。"]);
      return;
    }
    setProcessing(true);
    const good: ImportRow[] = [];
    const failed: string[] = [];
    // Decode sequentially so several full-resolution originals never compete for memory.
    for (const file of files) {
      try {
        const asset = await processImage(file);
        const guess = suggestLayer(file.name);
        const kind = guess?.kind ?? "print";
        const side = guess?.side ?? "front";
        good.push({
          asset,
          usage: isLayerSupported(project.product, kind, side)
            ? `${kind}-${side}`
            : "library",
          mode: asset.hasAlpha ? "alpha" : "luminance",
          invert: false,
        });
      } catch (e) {
        failed.push(
          `${file.name}：${e instanceof Error ? e.message : "无法读取，请重新导出为 PNG 后尝试。"}`,
        );
      }
    }
    setRows((current) => [...current, ...good]);
    setErrors((current) => [...current, ...failed]);
    setProcessing(false);
  }

  useEffect(() => {
    if (!initialized.current && initialFiles?.length) {
      initialized.current = true;
      void addFiles(initialFiles);
    }
  }, []);

  const updateRow = (index: number, changes: Partial<ImportRow>) =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...changes } : row)),
    );

  async function apply() {
    setSaving(true);
    try {
      const layerRows = rows.filter(
        (row) => row.usage !== "library" && row.usage !== "cutline",
      );
      if (project.layers.length + layerRows.length > 24)
        throw new Error(
          "每件制品最多预览 24 个图层。请把部分图片选择为“仅加入素材库”，之后仍可使用。",
        );
      const cutlines = rows.filter((row) => row.usage === "cutline");
      if (cutlines.length > 1)
        throw new Error("一件制品只能使用一条外轮廓，请仅选择一张刀线 SVG。");
      let cutline: string | undefined;
      if (cutlines.length) {
        cutline = safeSvg(await cutlines[0].asset.original.text());
        const { validateCutline } = await import("../render/Preview");
        validateCutline(cutline);
      }
      await onCommit(
        rows.map((row) => row.asset),
        (draft) => {
          for (const row of layerRows) {
            const [kind, side] = row.usage.split("-") as [LayerKind, Side];
            const layer = createLayer(kind, row.asset.id, side);
            layer.name = row.asset.name.replace(/\.[^.]+$/, "");
            layer.maskMode = row.mode;
            layer.invert = row.invert;
            // Replace only the bundled sample when the user's first print arrives.
            if (kind === "print")
              draft.layers = draft.layers.filter(
                (existing) =>
                  !(
                    existing.kind === "print" &&
                    existing.side === side &&
                    !existing.assetId
                  ),
              );
            draft.layers.push(layer);
          }
          if (cutline) {
            draft.cutline = cutline;
            draft.shape = "custom";
          }
        },
      );
      onClose();
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "导入未保存，请重试。"]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="一次导入，逐张安排"
      eyebrow="图案与工艺"
      wide
      onClose={onClose}
      busy={processing || saving}
    >
      <p className="modal-intro">
        选择每张图片用在哪里。同一素材之后也可以复用到其他图层，原图会完整保存在本机。
      </p>
      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
        aria-label="选择批量图片"
        onChange={(e) => {
          void addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <div
        className={`import-drop ${rows.length ? "compact" : ""}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!processing && !saving)
            void addFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <Upload size={24} />
        <div>
          <strong>
            {rows.length ? "继续添加图片" : "把图案和工艺图一起放进来"}
          </strong>
          <p>PNG、JPG、WebP、SVG · 每张最多 30 MB · 每批 32 张</p>
        </div>
        <button
          className="button secondary"
          disabled={processing || saving}
          onClick={() => fileRef.current?.click()}
        >
          <Plus size={16} />
          选择图片
        </button>
      </div>
      {processing && (
        <p className="inline-status" role="status">
          <LoaderCircle size={16} className="spin" />
          正在读取图片并生成预览…
        </p>
      )}
      {!!rows.length && (
        <div className="import-table">
          <div className="import-table-head">
            <span>图片</span>
            <span>用在这里</span>
            <span>工艺区域</span>
            <span />
          </div>
          {rows.map((row, index) => {
            const isMask = ![
              "library",
              "cutline",
              "print-front",
              "print-back",
            ].includes(row.usage);
            return (
              <div className="import-row" key={row.asset.id}>
                <div className="import-file">
                  <div className="checker thumb">
                    {urls[row.asset.id] ? (
                      <img src={urls[row.asset.id]} alt="" />
                    ) : (
                      <FileImage size={22} />
                    )}
                  </div>
                  <div>
                    <strong title={row.asset.name}>{row.asset.name}</strong>
                    <span>
                      {row.asset.width} × {row.asset.height} px
                      {row.asset.hasAlpha ? " · 含透明通道" : ""}
                    </span>
                  </div>
                </div>
                <label className="sr-only" htmlFor={`usage-${row.asset.id}`}>
                  {row.asset.name} 的用途
                </label>
                <select
                  id={`usage-${row.asset.id}`}
                  value={row.usage}
                  disabled={saving}
                  onChange={(e) =>
                    updateRow(index, { usage: e.target.value as Usage })
                  }
                >
                  <option value="library">仅加入素材库</option>
                  {(["front", "back"] as Side[]).flatMap((side) =>
                    (Object.keys(LAYER_LABELS) as LayerKind[])
                      .filter((kind) =>
                        isLayerSupported(project.product, kind, side),
                      )
                      .map((kind) => (
                        <option
                          value={`${kind}-${side}`}
                          key={`${kind}-${side}`}
                        >
                          {side === "front" ? "正面" : "背面"} ·{" "}
                          {LAYER_LABELS[kind]}
                        </option>
                      )),
                  )}
                  {project.product !== "badge" &&
                    row.asset.mime === "image/svg+xml" && (
                      <option value="cutline">制品刀线 · SVG</option>
                    )}
                </select>
                {isMask ? (
                  <div className="mask-choice">
                    <label className="sr-only" htmlFor={`mask-${row.asset.id}`}>
                      {row.asset.name} 的蒙版解释
                    </label>
                    <select
                      id={`mask-${row.asset.id}`}
                      value={
                        row.mode === "alpha"
                          ? "alpha"
                          : row.invert
                            ? "black"
                            : "white"
                      }
                      disabled={saving}
                      onChange={(e) =>
                        updateRow(index, {
                          mode:
                            e.target.value === "alpha" ? "alpha" : "luminance",
                          invert: e.target.value === "black",
                        })
                      }
                    >
                      <option value="alpha">Alpha · 不透明处生效</option>
                      <option value="white">灰度 · 白色处生效</option>
                      <option value="black">灰度 · 黑色处生效</option>
                    </select>
                  </div>
                ) : (
                  <span className="muted import-mode">
                    {row.usage === "cutline"
                      ? "单一闭合外轮廓"
                      : row.usage === "library"
                        ? "保留，暂不放入样机"
                        : "保留彩色与透明度"}
                  </span>
                )}
                <IconButton
                  label={`移除 ${row.asset.name}`}
                  disabled={saving}
                  onClick={() =>
                    setRows((current) => current.filter((_, i) => i !== index))
                  }
                >
                  <X size={16} />
                </IconButton>
              </div>
            );
          })}
        </div>
      )}
      {errors.length > 0 && (
        <div className="error-box" role="alert">
          <AlertCircle size={18} />
          <div>
            {errors.map((message, i) => (
              <p key={i}>{message}</p>
            ))}
          </div>
        </div>
      )}
      {rows.some(
        (row) =>
          !["library", "cutline", "print-front", "print-back"].includes(
            row.usage,
          ),
      ) && (
        <p className="helper">
          工艺区域默认按 50%
          阈值处理，导入后可预览蒙版、反相和调整阈值。灰度不会直接代表真实墨厚。
        </p>
      )}
      <footer className="modal-footer">
        <span className="muted">
          {rows.length
            ? `${rows.length} 张图片 · 文件留在此设备`
            : "PSD、AI、PDF、TIFF 请先导出为上述格式"}
        </span>
        <div>
          <button
            className="button secondary"
            disabled={processing || saving}
            onClick={onClose}
          >
            取消导入
          </button>
          <button
            className="button primary"
            disabled={!rows.length || processing || saving}
            onClick={() => void apply()}
          >
            {saving ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Plus size={16} />
            )}
            {saving ? "正在保存图片…" : `导入 ${rows.length || ""} 张图片`}
          </button>
        </div>
      </footer>
    </Modal>
  );
}
