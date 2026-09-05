import { useEffect, useRef } from "react";
import { ArrowDown, ArrowUp, Copy, RotateCcw, Trash2 } from "lucide-react";
import type { AssetRecord, Layer, Project } from "../domain/model";
import { LAYER_LABELS, isLayerSupported, layerStage } from "../domain/catalog";
import { maskValue } from "../domain/masks";
import { IconButton, NameInput, RangeField } from "./ui";

function MaskPreview({ url, layer }: { url?: string; layer: Layer }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    let cancelled = false;
    const draw = (img?: HTMLImageElement) => {
      if (cancelled) return;
      context.clearRect(0, 0, 240, 160);
      if (img) {
        const ratio = Math.min(240 / img.width, 160 / img.height);
        context.drawImage(
          img,
          (240 - img.width * ratio) / 2,
          (160 - img.height * ratio) / 2,
          img.width * ratio,
          img.height * ratio,
        );
      } else {
        context.fillStyle = "#fff";
        context.fillRect(0, 0, 240, 160);
      }
      const pixels = context.getImageData(0, 0, 240, 160);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const value = maskValue(
          pixels.data[i],
          pixels.data[i + 1],
          pixels.data[i + 2],
          pixels.data[i + 3],
          layer.maskMode,
          layer.invert,
          layer.threshold,
        );
        pixels.data[i] = 67;
        pixels.data[i + 1] = 127;
        pixels.data[i + 2] = 108;
        pixels.data[i + 3] = value;
      }
      context.putImageData(pixels, 0, 0);
    };
    if (url) {
      const img = new Image();
      img.onload = () => draw(img);
      img.src = url;
    } else draw();
    return () => {
      cancelled = true;
    };
  }, [url, layer.maskMode, layer.invert, layer.threshold]);
  return (
    <div className="mask-preview checker">
      <canvas
        ref={ref}
        width={240}
        height={160}
        aria-label="绿色代表施加工艺的区域"
      />
      <span>绿色区域施加工艺</span>
    </div>
  );
}

export function LayerInspector({
  project,
  layer,
  assets,
  urls,
  update,
  onDelete,
  onDuplicate,
  onMove,
}: {
  project: Project;
  layer?: Layer;
  assets: AssetRecord[];
  urls: Record<string, string>;
  update: (fn: (p: Project) => void) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  if (!layer)
    return (
      <div className="inspector-empty">
        <p>选择一个图层，调整它的图案或工艺区域。</p>
      </div>
    );
  const edit = (changes: Partial<Layer>) =>
    update((p) => {
      const target = p.layers.find((l) => l.id === layer.id);
      if (target) Object.assign(target, changes);
    });
  const isMask = layer.kind !== "print";
  const active = isLayerSupported(project.product, layer.kind, layer.side);
  const peers = project.layers.filter(
    (item) =>
      item.side === layer.side &&
      layerStage(item.kind) === layerStage(layer.kind),
  );
  return (
    <div className="layer-inspector">
      <div className="inspector-heading">
        <span className={`layer-type-mark mark-${layer.kind}`} />
        <div>
          <span className="eyebrow">
            {layer.side === "front" ? "正面" : "背面"} ·{" "}
            {LAYER_LABELS[layer.kind]}
          </span>
          <h3>{layer.name}</h3>
        </div>
      </div>
      {!active && (
        <div className="note warning">
          这个工艺不适用于当前制品，已暂停预览。图层和原图仍保留，切换回适用制品即可恢复。
        </div>
      )}
      <label className="select-field">
        图层名称
        <NameInput
          label="图层名称"
          value={layer.name}
          onChange={(value) => edit({ name: value })}
        />
      </label>
      <label className="select-field">
        使用的图片
        <select
          aria-label="图层素材"
          value={layer.assetId ?? ""}
          onChange={(e) => edit({ assetId: e.target.value || undefined })}
        >
          <option value="">{isMask ? "整面施加工艺" : "内置示例图案"}</option>
          {assets.map((asset) => (
            <option value={asset.id} key={asset.id}>
              {asset.name}
            </option>
          ))}
        </select>
      </label>
      {project.product !== "badge" && (
        <label className="select-field">
          印刷面
          <select
            value={layer.side}
            onChange={(e) => edit({ side: e.target.value as Layer["side"] })}
          >
            <option value="front">正面</option>
            <option value="back">背面</option>
          </select>
        </label>
      )}
      {isMask ? (
        <>
          <div className="subsection-heading">工艺区域</div>
          <label className="select-field">
            如何读取蒙版
            <select
              value={layer.maskMode}
              onChange={(e) =>
                edit({ maskMode: e.target.value as Layer["maskMode"] })
              }
            >
              <option value="alpha">Alpha · 读取透明度</option>
              <option value="luminance">灰度 · 读取明暗</option>
            </select>
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={layer.invert}
              onChange={(e) => edit({ invert: e.target.checked })}
            />
            反相
            {layer.maskMode === "luminance"
              ? " · 黑色处生效"
              : " · 低透明度处生效"}
          </label>
          <RangeField
            label="区域阈值"
            value={Math.round(layer.threshold * 100)}
            min={1}
            max={99}
            unit="%"
            onChange={(n) => edit({ threshold: n / 100 })}
          />
          <MaskPreview
            url={layer.assetId ? urls[layer.assetId] : undefined}
            layer={layer}
          />
          <p className="helper">
            完全透明处不加工。阈值用于划分区域，不能代表工艺墨厚。
          </p>
          {layer.kind === "foil" && (
            <>
              <div className="subsection-heading">烫色</div>
              <div className="foil-colors">
                {[
                  { name: "香槟金", color: "#d7b46a" },
                  { name: "亮银", color: "#d9dce1" },
                  { name: "玫瑰金", color: "#ce9290" },
                  { name: "宝石蓝", color: "#547fb0" },
                ].map((foil) => (
                  <button
                    key={foil.color}
                    title={foil.name}
                    aria-label={foil.name}
                    aria-pressed={layer.color === foil.color}
                    style={{ background: foil.color }}
                    onClick={() => edit({ color: foil.color })}
                  />
                ))}
                <label className="color-input-label">
                  自选
                  <input
                    type="color"
                    aria-label="自定义烫色"
                    value={layer.color}
                    onChange={(e) => edit({ color: e.target.value })}
                  />
                </label>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="image-preview checker">
            {layer.assetId && urls[layer.assetId] ? (
              <img src={urls[layer.assetId]} alt={layer.name} />
            ) : (
              <div className="sample-art-label">
                <span>植物集</span>
                <small>内置植物图案</small>
              </div>
            )}
          </div>
          <RangeField
            label="印刷不透明度"
            value={Math.round(layer.opacity * 100)}
            min={0}
            max={100}
            unit="%"
            onChange={(n) => edit({ opacity: n / 100 })}
          />
        </>
      )}
      <div className="subsection-heading">
        图案位置
        <IconButton
          label="重置图案位置"
          onClick={() =>
            edit({ scale: 1, offsetX: 0, offsetY: 0, rotation: 0 })
          }
        >
          <RotateCcw size={13} />
        </IconButton>
      </div>
      <RangeField
        label="图案缩放"
        value={Math.round(layer.scale * 100)}
        min={5}
        max={300}
        unit="%"
        onChange={(n) => edit({ scale: n / 100 })}
      />
      <RangeField
        label="水平位置"
        value={layer.offsetX}
        min={-100}
        max={100}
        unit="%"
        onChange={(n) => edit({ offsetX: n })}
      />
      <RangeField
        label="垂直位置"
        value={layer.offsetY}
        min={-100}
        max={100}
        unit="%"
        onChange={(n) => edit({ offsetY: n })}
      />
      <RangeField
        label="图案旋转"
        value={layer.rotation}
        min={-180}
        max={180}
        unit="°"
        onChange={(n) => edit({ rotation: n })}
      />
      <div className="layer-actions">
        <IconButton
          label="下移图层"
          disabled={peers[0]?.id === layer.id}
          onClick={() => onMove(-1)}
        >
          <ArrowDown size={16} />
        </IconButton>
        <IconButton
          label="上移图层"
          disabled={peers.at(-1)?.id === layer.id}
          onClick={() => onMove(1)}
        >
          <ArrowUp size={16} />
        </IconButton>
        <button
          className="text-button"
          disabled={project.layers.length >= 24}
          onClick={onDuplicate}
        >
          <Copy size={14} />
          复制
        </button>
        <button className="text-button danger" onClick={onDelete}>
          <Trash2 size={14} />
          移除
        </button>
      </div>
      <p className="helper">移除图层后，素材仍留在项目中；也可以撤销恢复。</p>
    </div>
  );
}
