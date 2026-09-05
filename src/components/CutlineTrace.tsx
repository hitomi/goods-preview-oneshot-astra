import { useEffect, useState } from "react";
import { Download, LoaderCircle, ZoomIn } from "lucide-react";
import type { AssetRecord } from "../domain/model";
import type { TraceCutlineMode, TraceCutlineResult } from "../lib/traceCutline";
import { traceAssetCutline } from "../lib/traceCutlineClient";
import { downloadBlob, Modal } from "./ui";

export function CutlineTrace({
  asset,
  imageUrl,
  width,
  height,
  disabled,
  onResult,
}: {
  asset: AssetRecord;
  imageUrl?: string;
  width: number;
  height: number;
  disabled: boolean;
  onResult: (id: string, result?: TraceCutlineResult) => void;
}) {
  const [mode, setMode] = useState<TraceCutlineMode>("auto");
  const [result, setResult] = useState<TraceCutlineResult>();
  const [error, setError] = useState("");
  const [svgUrl, setSvgUrl] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setResult(undefined);
    onResult(asset.id);
    void traceAssetCutline(asset, mode, controller.signal)
      .then(async (next) => {
        const { validateCutline } = await import("../render/geometry");
        if (controller.signal.aborted) return;
        validateCutline(next.svg);
        setResult(next);
        onResult(asset.id, next);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "无法识别刀线，请检查图片。",
          );
      });
    return () => controller.abort();
  }, [asset, mode, onResult, attempt]);

  useEffect(() => {
    if (!result) {
      setSvgUrl("");
      return;
    }
    const url = URL.createObjectURL(
      new Blob([result.svg], { type: "image/svg+xml" }),
    );
    setSvgUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);

  const stretched =
    result &&
    Math.abs(
      result.bounds.width / result.bounds.height / (width / height) - 1,
    ) > 0.02;
  return (
    <section className="cutline-trace" aria-label={`${asset.name} 的刀线识别`}>
      <div className="cutline-trace-preview checker">
        {imageUrl && <img src={imageUrl} alt="刀线原图" />}
        {result && svgUrl && (
          <img
            className="cutline-trace-vector"
            src={svgUrl}
            alt="识别的矢量轮廓"
          />
        )}
      </div>
      <div className="cutline-trace-controls">
        <label className="select-field">
          线条颜色
          <select
            aria-label={`${asset.name} 的刀线颜色`}
            value={mode}
            disabled={disabled}
            onChange={(event) => {
              onResult(asset.id);
              setResult(undefined);
              setMode(event.target.value as TraceCutlineMode);
            }}
          >
            <option value="auto">自动识别</option>
            <option value="red">红色轮廓</option>
            <option value="dark">黑色轮廓</option>
          </select>
        </label>
        <button
          className="text-button"
          disabled={disabled}
          onClick={() => setExpanded(true)}
        >
          <ZoomIn size={14} />
          放大核对刀线
        </button>
        {!result && !error && (
          <p className="inline-status" role="status">
            <LoaderCircle size={15} className="spin" />
            正在识别闭合轮廓…
          </p>
        )}
        {error && (
          <div className="cutline-trace-error" role="alert">
            <p>{error}</p>
            <button
              className="text-button"
              disabled={disabled}
              onClick={() => setAttempt((value) => value + 1)}
            >
              重新识别
            </button>
          </div>
        )}
        {result && (
          <>
            <p role="status">
              已识别 1 条闭合轮廓 · {result.pointCount} 个节点
            </p>
            <p>
              蓝绿色线是识别轮廓。导入后按制品 {width} × {height} mm 缩放。
            </p>
            {stretched && (
              <p className="cutline-trace-warning">
                轮廓比例与制品不同，应用后会拉伸。可在导入后调整制品宽高。
              </p>
            )}
            {result.warnings.map((warning) => (
              <p className="cutline-trace-warning" key={warning}>
                {warning}
              </p>
            ))}
            <button
              className="text-button"
              onClick={() =>
                downloadBlob(
                  new Blob([result.svg], { type: "image/svg+xml" }),
                  `${asset.name.replace(/\.[^.]+$/, "")}-刀线.svg`,
                )
              }
            >
              <Download size={14} />
              下载识别的 SVG
            </button>
          </>
        )}
        <p className="muted">
          仅支持一条闭合外轮廓；有断口、孔洞或多条线时，请先修正图片。
        </p>
      </div>
      {expanded && (
        <Modal title="核对刀线轮廓" wide onClose={() => setExpanded(false)}>
          <p className="modal-intro">
            蓝绿色线是识别的内缘，淡色背景是原图。请检查凹口和转角；放大后可滚动查看细节。
          </p>
          <label className="cutline-zoom-label">
            查看比例 · {Math.round(zoom * 100)}%
            <input
              aria-label="刀线查看比例"
              type="range"
              min="1"
              max="4"
              step="0.25"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </label>
          <div className="cutline-detail-viewport">
            <div
              className="cutline-detail-image checker"
              style={{
                width: `${zoom * 100}%`,
                aspectRatio: `${asset.width} / ${asset.height}`,
              }}
            >
              {imageUrl && <img src={imageUrl} alt="放大的刀线原图" />}
              {result && svgUrl && <img src={svgUrl} alt="放大的矢量轮廓" />}
            </div>
          </div>
          <footer className="modal-footer">
            <span className="muted">
              制品尺寸 {width} × {height} mm
            </span>
            <button
              className="button primary"
              onClick={() => setExpanded(false)}
            >
              返回导入
            </button>
          </footer>
        </Modal>
      )}
    </section>
  );
}
