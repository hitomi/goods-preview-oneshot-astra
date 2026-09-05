import { describe, expect, it } from "vitest";
import { inspectImage, safeSvg, suggestLayer } from "./images";

describe("local image intake", () => {
  it("suggests a process and back side without imposing a choice on unrelated names", () => {
    expect(suggestLayer("角色_背面_白墨.png")).toEqual({
      kind: "white",
      side: "back",
    });
    expect(suggestLayer("uv_back.png")).toEqual({
      kind: "varnish",
      side: "back",
    });
    expect(suggestLayer("front-deboss.webp")).toEqual({
      kind: "deboss",
      side: "front",
    });
    expect(suggestLayer("日落.jpg")).toBeNull();
  });
  it("accepts static paths with internal gradients and rejects active or remote SVG content", () => {
    const valid =
      '<svg viewBox="0 0 20 30"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><path fill="url(#g)" d="M0 0L20 30Z"/></svg>';
    expect(safeSvg(valid)).toContain('xmlns="http://www.w3.org/2000/svg"');
    for (const invalid of [
      '<svg onload="alert(1)"/>',
      "<svg><script/></svg>",
      '<svg><image href="https://host/a.png"/></svg>',
      '<svg><path fill="url(https://host/mask)"/></svg>',
      "<svg><foreignObject/></svg>",
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>',
      "<svg><g></svg>",
      '<svg><path style="fill: url(https://host/a)"/></svg>',
      "<svg/><svg/>",
    ])
      expect(() => safeSvg(invalid)).toThrow();
  });
  it("validates dimensions before browser decoding and reports unsupported formats", async () => {
    const png = new Uint8Array(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    png.set([73, 72, 68, 82], 12);
    const view = new DataView(png.buffer);
    view.setUint32(16, 40_000);
    view.setUint32(20, 40_000);
    await expect(inspectImage(new Blob([png]))).rejects.toThrow("4000 万");
    await expect(inspectImage(new Blob(["%PDF-1.4"]))).rejects.toThrow(
      "不支持",
    );
    await expect(
      inspectImage(
        new Blob(['<svg viewBox="0 0 40 20"><path d="M0 0L40 20"/></svg>']),
      ),
    ).resolves.toEqual({ mime: "image/svg+xml", width: 40, height: 20 });
  });
});
