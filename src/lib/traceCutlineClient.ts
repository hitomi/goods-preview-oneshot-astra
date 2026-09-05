import type { AssetRecord } from "../domain/model";
import type { TraceCutlineMode, TraceCutlineResult } from "./traceCutline";

/** Decode the bounded preview, then transfer its pixels; the original stays untouched. */
export async function traceAssetCutline(
  asset: AssetRecord,
  mode: TraceCutlineMode,
  signal: AbortSignal,
): Promise<TraceCutlineResult> {
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(asset.preview);
  let pixels: ImageData;
  try {
    signal.throwIfAborted();
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("无法读取刀线图片，请关闭部分标签页后重试。");
    try {
      context.drawImage(bitmap, 0, 0);
      pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    } finally {
      canvas.width = canvas.height = 0;
    }
  } finally {
    bitmap.close();
  }
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./traceCutline.worker.ts", import.meta.url),
      { type: "module" },
    );
    const cleanup = () => {
      clearTimeout(timeout);
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("识别已取消", "AbortError"));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "识别耗时过长，请使用更清晰、简单的单条闭合线稿。原图仍保留。",
        ),
      );
    }, 15_000);
    worker.onmessage = (
      event: MessageEvent<
        | { ok: true; result: TraceCutlineResult }
        | { ok: false; message: string }
      >,
    ) => {
      cleanup();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.message));
    };
    worker.onerror = () => {
      cleanup();
      reject(
        new Error("刀线识别未能启动，请重新打开应用后重试，或导入 SVG 刀线。"),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else
      worker.postMessage(
        {
          pixels: pixels.data,
          width: pixels.width,
          height: pixels.height,
          mode,
        },
        [pixels.data.buffer],
      );
  });
}
