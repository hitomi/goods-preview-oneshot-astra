import { traceCutline, type TraceCutlineMode } from "./traceCutline";

self.onmessage = (
  event: MessageEvent<{
    pixels: Uint8ClampedArray;
    width: number;
    height: number;
    mode: TraceCutlineMode;
  }>,
) => {
  try {
    const { pixels: data, width, height, mode } = event.data;
    self.postMessage({
      ok: true,
      result: traceCutline({ data, width, height }, { mode }),
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "无法识别刀线，请使用单条闭合线稿。",
    });
  }
};
