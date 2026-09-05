import {
  uid,
  type AssetRecord,
  type LayerKind,
  type Side,
} from "../domain/model";

export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_PREVIEW_EDGE = 2048;
const MAX_SVG_BYTES = 256 * 1024;
const svgTags = new Set([
  "svg",
  "g",
  "defs",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "text",
  "tspan",
  "title",
  "desc",
]);
const svgAttributes = new Set([
  "id",
  "xmlns",
  "xmlns:xlink",
  "version",
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "transform",
  "gradientTransform",
  "gradientUnits",
  "spreadMethod",
  "offset",
  "stop-color",
  "stop-opacity",
  "clip-path",
  "clip-rule",
  "clipPathUnits",
  "mask",
  "maskUnits",
  "maskContentUnits",
  "preserveAspectRatio",
  "href",
  "xlink:href",
  "font-size",
  "font-family",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "dx",
  "dy",
  "rotate",
  "letter-spacing",
  "style",
  "color",
]);
const styleAttributes = new Set([
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "clip-path",
  "clip-rule",
  "mask",
  "stop-color",
  "stop-opacity",
  "font-size",
  "font-family",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "color",
]);

function safeValue(name: string, value: string) {
  if (
    /[<\\\u0000-\u001f]/.test(value) ||
    /&(?!(?:amp|quot|apos|lt|gt);)/i.test(value)
  )
    throw new Error("SVG 属性含有不支持的编码，请导出简化 SVG 或 PNG。");
  if (name === "xmlns" && value !== "http://www.w3.org/2000/svg")
    throw new Error("SVG 命名空间无效。");
  if (name === "xmlns:xlink" && value !== "http://www.w3.org/1999/xlink")
    throw new Error("SVG 链接命名空间无效。");
  if (
    (name === "href" || name === "xlink:href") &&
    !/^#[a-zA-Z_][\w.-]*$/.test(value)
  )
    throw new Error("SVG 不能引用外部文件，请将图片嵌入为普通 PNG 后导入。");
  if (
    /url\s*\(/i.test(value) &&
    !/^url\(\s*#[a-zA-Z_][\w.-]*\s*\)$/.test(value)
  )
    throw new Error("SVG 只允许文件内部的渐变、蒙版与裁切引用。");
  if (
    name !== "xmlns" &&
    name !== "xmlns:xlink" &&
    /(?:https?:|data:|javascript:|file:|ftp:|@import)/i.test(value)
  )
    throw new Error("SVG 包含外部或可执行内容。请导出纯图形 SVG 或 PNG。");
}

/** Strict static-SVG subset; rejects scripting, embedded documents and all external resources. */
export function safeSvg(text: string): string {
  if (!text || new TextEncoder().encode(text).length > MAX_SVG_BYTES)
    throw new Error(
      "SVG 需小于 256 KiB，请简化路径后重试，或将图案导出为 PNG。",
    );
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA|<\?(?!xml\s)/i.test(text))
    throw new Error("SVG 不支持实体、CDATA 或处理指令，请导出纯图形 SVG。");
  let source = text
    .replace(/^\uFEFF/, "")
    .replace(/^\s*<\?xml\s[^?]*\?>\s*/i, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  const tokens = source.match(/<[^>]*>|[^<]+/g);
  if (!tokens || tokens.join("") !== source)
    throw new Error("SVG 文件结构不完整。");
  const stack: string[] = [];
  let roots = 0;
  let count = 0;
  for (const token of tokens) {
    if (!token.startsWith("<")) {
      if (!stack.length && token.trim())
        throw new Error("SVG 根节点外包含内容。");
      if (/[>&]/.test(token.replace(/&(?:amp|quot|apos|lt|gt);/g, "")))
        throw new Error("SVG 文本编码无效。");
      continue;
    }
    const closing = /^<\/([a-zA-Z][\w-]*)\s*>$/.exec(token);
    if (closing) {
      if (stack.pop() !== closing[1]) throw new Error("SVG 标签未正确闭合。");
      continue;
    }
    const opening = /^<([a-zA-Z][\w-]*)([\s\S]*?)(\/?)>$/.exec(token);
    if (!opening || !svgTags.has(opening[1]))
      throw new Error(
        "SVG 含有不支持的元素。请导出纯路径 SVG，或使用 PNG 图案。",
      );
    if (++count > 10_000 || stack.length > 64)
      throw new Error("SVG 结构过于复杂，请简化路径后重试。");
    if (!stack.length) {
      roots++;
      if (roots !== 1 || opening[1] !== "svg")
        throw new Error("文件必须包含一个 SVG 根节点。");
    }
    const used = new Set<string>();
    let attributes = opening[2];
    while (attributes.trim()) {
      const attribute =
        /^\s+([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(
          attributes,
        );
      if (!attribute) throw new Error("SVG 属性格式无效。");
      const name = attribute[1];
      const value = attribute[2] ?? attribute[3];
      if (!svgAttributes.has(name) || used.has(name))
        throw new Error(`SVG 属性 ${name} 不受支持，请导出简化 SVG 或 PNG。`);
      used.add(name);
      if (name === "style") {
        for (const declaration of value
          .split(";")
          .filter((item) => item.trim())) {
          const colon = declaration.indexOf(":");
          const property = declaration.slice(0, colon).trim();
          if (colon === -1 || !styleAttributes.has(property))
            throw new Error("SVG 含有不支持的样式，请导出纯图形 SVG 或 PNG。");
          safeValue(property, declaration.slice(colon + 1).trim());
        }
      } else safeValue(name, value);
      attributes = attributes.slice(attribute[0].length);
    }
    if (!opening[3]) stack.push(opening[1]);
  }
  if (roots !== 1 || stack.length) throw new Error("SVG 标签未正确闭合。");
  if (!/^<svg\b[^>]*\sxmlns\s*=/.test(source))
    source = source.replace(
      /^<svg\b/,
      '<svg xmlns="http://www.w3.org/2000/svg"',
    );
  return source;
}

export interface ImageMetadata {
  mime: string;
  width: number;
  height: number;
}

function checkDimensions(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("无法读取图片尺寸，请重新导出图片。");
  if (width * height > MAX_IMAGE_PIXELS || Math.max(width, height) > 32_768)
    throw new Error(
      "图片最多支持 4000 万像素，单边不超过 32768 像素。请缩小后重试；原文件未被修改。",
    );
}

/** Header checks happen before decoding so a tiny compressed file cannot allocate an unbounded canvas. */
export async function inspectImage(blob: Blob): Promise<ImageMetadata> {
  if (!blob.size || blob.size > MAX_IMAGE_BYTES)
    throw new Error("单张图片需大于 0 字节且不超过 30 MiB，请压缩或分批处理。");
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let mime = "";
  let width = 0;
  let height = 0;
  if (
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    String.fromCharCode(...bytes.slice(1, 4)) === "PNG" &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10 &&
    String.fromCharCode(...bytes.slice(12, 16)) === "IHDR"
  ) {
    mime = "image/png";
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    mime = "image/jpeg";
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 8
      ) {
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += length;
    }
  } else if (
    bytes.length >= 25 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    mime = "image/webp";
    const type = String.fromCharCode(...bytes.slice(12, 16));
    if (type === "VP8X" && bytes.length >= 30) {
      width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    } else if (
      type === "VP8 " &&
      bytes.length >= 30 &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    } else if (type === "VP8L" && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
  } else {
    const text = new TextDecoder().decode(bytes);
    if (
      !/^\s*(?:\uFEFF)?(?:<\?xml[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b/i.test(
        text,
      )
    )
      throw new Error(
        "不支持此图片格式。请上传 PNG、JPEG、WebP 或纯图形 SVG；PSD、PDF、AI 和 TIFF 请先导出。",
      );
    const svg = safeSvg(text);
    mime = "image/svg+xml";
    const root = /^<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
    const attribute = (name: string) =>
      new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`).exec(root)?.[1];
    const box = attribute("viewBox")
      ?.trim()
      .split(/[\s,]+/)
      .map(Number);
    const readLength = (value: string | undefined) => {
      const match = value?.match(/^([\d.]+)(px|mm|cm|in|pt)?$/);
      if (!match) return 0;
      const factors: Record<string, number> = {
        px: 1,
        mm: 96 / 25.4,
        cm: 96 / 2.54,
        in: 96,
        pt: 96 / 72,
      };
      return Number(match[1]) * factors[match[2] || "px"];
    };
    width = readLength(attribute("width")) || (box?.length === 4 ? box[2] : 0);
    height =
      readLength(attribute("height")) || (box?.length === 4 ? box[3] : 0);
  }
  checkDimensions(width, height);
  return { mime, width: Math.round(width), height: Math.round(height) };
}

async function readPicture(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const picture = new Image();
    await new Promise<void>((resolve, reject) => {
      picture.onload = () => resolve();
      picture.onerror = () =>
        reject(new Error("图片解码失败，文件可能损坏。请重新导出后再上传。"));
      picture.src = url;
    });
    checkDimensions(picture.naturalWidth, picture.naturalHeight);
    return picture;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Used during restore as well as file intake: a valid header alone does not prove decodability. */
export async function verifyImageDecodes(
  blob: Blob,
  mime: string,
): Promise<void> {
  const safe =
    mime === "image/svg+xml"
      ? new Blob([safeSvg(await blob.text())], { type: mime })
      : new Blob([blob], { type: mime });
  const picture = await readPicture(safe);
  picture.src = "";
}

export async function processImage(file: File): Promise<AssetRecord> {
  const metadata = await inspectImage(file);
  let decodeBlob: Blob = new Blob([file], { type: metadata.mime });
  if (metadata.mime === "image/svg+xml") {
    // Vectors are rasterized at the preview budget, never at the browser's tiny fallback SVG size.
    const ratio = MAX_PREVIEW_EDGE / Math.max(metadata.width, metadata.height);
    const svg = safeSvg(await file.text()).replace(/^<svg\b[^>]*>/, (root) => {
      const viewport = /\sviewBox\s*=/.test(root)
        ? ""
        : ` viewBox="0 0 ${metadata.width} ${metadata.height}"`;
      return root
        .replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/g, "")
        .replace(
          /(\/?)>$/,
          `${viewport} width="${Math.max(1, Math.round(metadata.width * ratio))}" height="${Math.max(1, Math.round(metadata.height * ratio))}"$1>`,
        );
    });
    decodeBlob = new Blob([svg], { type: metadata.mime });
  }
  const picture = await readPicture(decodeBlob);
  try {
    const ratio = Math.min(
      1,
      MAX_PREVIEW_EDGE / Math.max(picture.naturalWidth, picture.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(picture.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(picture.naturalHeight * ratio));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context)
      throw new Error("浏览器无法创建图片预览。请关闭部分标签页后重试。");
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hasAlpha = false;
    for (let i = 3; i < pixels.length; i += 4)
      if (pixels[i] < 255) {
        hasAlpha = true;
        break;
      }
    const preview = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("生成预览失败，请缩小图片后重试。")),
        "image/png",
      ),
    );
    canvas.width = 0;
    canvas.height = 0;
    return {
      id: uid(),
      name:
        file.name
          .replace(/[\u0000-\u001f]/g, "")
          .trim()
          .slice(0, 200) || "未命名图片",
      mime: metadata.mime,
      width:
        metadata.mime === "image/svg+xml"
          ? metadata.width
          : picture.naturalWidth,
      height:
        metadata.mime === "image/svg+xml"
          ? metadata.height
          : picture.naturalHeight,
      hasAlpha,
      original: file,
      preview,
      createdAt: Date.now(),
    };
  } finally {
    picture.src = "";
  }
}

export function suggestLayer(
  name: string,
): { kind: LayerKind; side: Side } | null {
  const base = name.replace(/\.[^.]+$/, "").toLowerCase();
  const side: Side =
    /背面|反面|(?:^|[\s_.-])(?:back|rear|reverse)(?:$|[\s_.-])/.test(base)
      ? "back"
      : "front";
  const candidates: [LayerKind, RegExp][] = [
    ["white", /白墨|白版|white(?:ink)?/],
    ["varnish", /光油|局部uv|varnish|(?:^|[\s_.-])uv(?:$|[\s_.-])/],
    ["matte", /磨砂|matte|frost/],
    ["foil", /烫金|烫银|烫色|foil/],
    ["deboss", /压凹|deboss/],
    ["emboss", /压凸|压花|emboss/],
    ["print", /印刷|图案|正面|背面|反面|print|front|back|artwork/],
  ];
  const match = candidates.find(([, pattern]) => pattern.test(base));
  return match ? { kind: match[0], side } : null;
}
