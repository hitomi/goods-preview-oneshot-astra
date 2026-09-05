import * as THREE from "three";
import type { Layer, Project, Side } from "../domain/model";
import { isLayerSupported, orderedLayers } from "../domain/catalog";
import { maskValue } from "../domain/masks";

export interface SurfaceMaps {
  color: THREE.CanvasTexture;
  finish: THREE.CanvasTexture;
  relief: THREE.CanvasTexture;
  hasArt: boolean;
}

function canvas(width: number, height: number) {
  const result = document.createElement("canvas");
  result.width = width;
  result.height = height;
  return result;
}

function context(target: HTMLCanvasElement) {
  const ctx = target.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法处理预览图片，请重新打开应用。");
  return ctx;
}

let example: HTMLCanvasElement | undefined;

/** A bundled, procedural artwork sample. It is only printed artwork, never a substitute for 3D geometry. */
export function exampleArtwork() {
  if (example) return example;
  const target = canvas(1024, 1024),
    ctx = context(target);
  ctx.fillStyle = "#eeeade";
  ctx.fillRect(0, 0, 1024, 1024);
  const wash = ctx.createLinearGradient(0, 0, 850, 1024);
  wash.addColorStop(0, "#ecebdc");
  wash.addColorStop(1, "#d7e0cc");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, 1024, 1024);
  let seed = 39;
  for (let i = 0; i < 17000; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const x = seed % 1024;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    ctx.fillStyle = `rgba(60,77,51,${0.012 + (seed % 12) / 1000})`;
    ctx.fillRect(x, seed % 1024, 2, 2);
  }
  function leaf(
    x: number,
    y: number,
    length: number,
    angle: number,
    color: string,
  ) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(
      length * 0.3,
      -length * 0.3,
      length * 0.8,
      -length * 0.22,
      length,
      0,
    );
    ctx.bezierCurveTo(
      length * 0.55,
      length * 0.37,
      length * 0.13,
      length * 0.24,
      0,
      0,
    );
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(1, 0);
    ctx.quadraticCurveTo(length * 0.48, length * 0.04, length * 0.9, 0);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#dde3c688";
    ctx.stroke();
    ctx.restore();
  }
  function branch(
    x: number,
    y: number,
    length: number,
    angle: number,
    count: number,
    shade: string,
  ) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-length * 0.03, -length * 0.6, length * 0.08, -length);
    ctx.strokeStyle = "#596b46";
    ctx.lineWidth = 3.1;
    ctx.stroke();
    for (let i = 1; i <= count; i++) {
      const position = i / (count + 1),
        yy = -length * position,
        xx = length * 0.045 * position;
      const size = 88 * (1 - position * 0.37) * (length / 500);
      leaf(xx, yy, size, -0.65, shade);
      leaf(
        xx,
        yy - 20,
        size * 1.08,
        Math.PI + 0.53,
        i % 2 ? "#718862" : "#829373",
      );
    }
    leaf(length * 0.07, -length + 35, 70, -1.48, shade);
    ctx.restore();
  }
  branch(466, 806, 510, -0.34, 7, "#405d46");
  branch(538, 810, 445, 0.36, 6, "#506c48");
  branch(504, 830, 320, 0.95, 4, "#72865c");
  branch(466, 821, 345, -0.84, 5, "#657953");
  ctx.textAlign = "center";
  ctx.fillStyle = "#3e5845";
  ctx.font = "39px Georgia, serif";
  ctx.letterSpacing = "9px";
  ctx.fillText("HERBARIUM", 512, 220);
  ctx.letterSpacing = "4px";
  ctx.font = "17px Georgia, serif";
  ctx.fillText("A SMALL COLLECTION OF WILD THINGS", 512, 258);
  ctx.letterSpacing = "7px";
  ctx.font = "22px serif";
  ctx.fillText("山 间 来 信", 512, 875);
  ctx.letterSpacing = "3px";
  ctx.font = "15px Georgia, serif";
  ctx.fillText("BOTANICAL STUDIES · No. 03", 512, 914);
  example = target;
  return target;
}

export class ImageCache {
  private items = new Map<string, Promise<HTMLImageElement>>();
  get(url: string): Promise<HTMLImageElement> {
    if (!this.items.has(url))
      this.items.set(
        url,
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => {
            this.items.delete(url);
            reject(new Error("一张图层图片无法读取，请重新导入原图。"));
          };
          image.src = url;
        }),
      );
    return this.items.get(url)!;
  }
  retain(urls: string[]) {
    const valid = new Set(urls);
    for (const url of this.items.keys())
      if (!valid.has(url)) this.items.delete(url);
  }
  clear() {
    this.items.clear();
  }
}

function texture(target: HTMLCanvasElement, color = false) {
  const result = new THREE.CanvasTexture(target);
  result.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  result.anisotropy = 4;
  return result;
}

function rgb(color: string) {
  const parsed = new THREE.Color(color);
  // Canvas bytes are sRGB; Three.Color stores linear components.
  parsed.convertLinearToSRGB();
  return [
    Math.round(parsed.r * 255),
    Math.round(parsed.g * 255),
    Math.round(parsed.b * 255),
  ];
}

async function yieldForInput(signal?: AbortSignal) {
  signal?.throwIfAborted();
  // A timer turn also services ordinary input/timer work. scheduler.yield() continuations
  // starved ordinary timer tasks in Chromium measurements despite splitting Long Tasks.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  signal?.throwIfAborted();
}

export async function composeSurface(
  project: Project,
  side: Side,
  urls: Record<string, string>,
  images: ImageCache,
  options: { fromInside?: boolean; signal?: AbortSignal } = {},
): Promise<SurfaceMaps> {
  let lastYield = performance.now();
  const checkpoint = async () => {
    options.signal?.throwIfAborted();
    if (performance.now() - lastYield >= 8) {
      await yieldForInput(options.signal);
      lastYield = performance.now();
    }
  };
  const maximum =
    project.quality === "eco" ? 512 : project.quality === "high" ? 2048 : 1024;
  const aspect =
    project.width /
    (project.product === "badge" ? project.width : project.height);
  const width = Math.max(
    32,
    Math.round(aspect >= 1 ? maximum : maximum * aspect),
  );
  const height = Math.max(
    32,
    Math.round(aspect >= 1 ? maximum / aspect : maximum),
  );
  const colorCanvas = canvas(width, height),
    finishCanvas = canvas(width, height),
    reliefCanvas = canvas(width, height);
  const colorCtx = context(colorCanvas),
    finishCtx = context(finishCanvas),
    reliefCtx = context(reliefCanvas);
  const art = colorCtx.createImageData(width, height),
    finish = finishCtx.createImageData(width, height),
    relief = reliefCtx.createImageData(width, height);
  const transparent =
    project.product === "acrylic" &&
    ["clear", "frosted"].includes(project.substrate);
  const base = rgb(
    project.substrate === "kraft"
      ? "#b39167"
      : project.substrate === "pearlescent"
        ? "#f1e9df"
        : "#f4f2eb",
  );
  const roughness =
    project.lamination === "gloss"
      ? 0.28
      : project.lamination === "matte"
        ? 0.86
        : project.substrate === "textured" || project.substrate === "kraft"
          ? 0.86
          : 0.56;
  const clearcoat =
    project.lamination === "gloss"
      ? 0.95
      : project.lamination === "matte"
        ? 0.07
        : 0.12;
  const metalness =
    project.substrate === "holographic"
      ? 0.72
      : project.substrate === "pearlescent"
        ? 0.22
        : 0;
  for (let i = 0; i < art.data.length; i += 4) {
    // Check the time budget once per 65,536 pixels (32 rows at the maximum texture size).
    if ((i & 0x3ffff) === 0) await checkpoint();
    art.data[i] = base[0];
    art.data[i + 1] = base[1];
    art.data[i + 2] = base[2];
    art.data[i + 3] = transparent ? 0 : 255;
    finish.data[i] = Math.round(clearcoat * 255);
    finish.data[i + 1] = Math.round(roughness * 255);
    finish.data[i + 2] = Math.round(metalness * 255);
    finish.data[i + 3] = 255;
    const grain =
      project.substrate === "textured" || project.substrate === "kraft"
        ? ((Math.sin(i * 78.233) * 43758.5453) % 1) * 7
        : 0;
    relief.data[i] = 128 + grain;
    relief.data[i + 1] = 128 + grain;
    relief.data[i + 2] = 128 + grain;
    relief.data[i + 3] = 255;
  }
  const layers = project.layers.filter(
    (layer) =>
      layer.enabled &&
      layer.opacity > 0 &&
      layer.side === side &&
      isLayerSupported(project.product, layer.kind, layer.side),
  );
  // White ink is a physical underbase on either viewing side, independent of its position in the editable list.
  const physicalOrder = orderedLayers(layers);
  // Looking through clear stock reaches white underbase before the color inks.
  // Keep normal editing/production order intact; this separate view composites only the reverse of that ink stack.
  const ordered = options.fromInside
    ? [
        ...physicalOrder.filter(
          (layer) => layer.kind === "print" || layer.kind === "foil",
        ),
        ...physicalOrder.filter((layer) => layer.kind === "white"),
      ]
    : physicalOrder;
  const whiteCoverage = new Float32Array(width * height);
  const scratch = canvas(width, height),
    scratchCtx = context(scratch);
  for (const layer of ordered) {
    await checkpoint();
    let source: CanvasImageSource | undefined;
    if (layer.assetId) {
      if (!urls[layer.assetId])
        throw new Error(
          `“${layer.name}”的原图暂不可用，请等待素材加载或重新导入。`,
        );
      source = await images.get(urls[layer.assetId]);
    } else if (layer.kind === "print") source = exampleArtwork();
    drawLayer(scratchCtx, scratch, layer, source);
    const pixels = scratchCtx.getImageData(0, 0, width, height).data;
    const foil = rgb(layer.color);
    for (let i = 0; i < pixels.length; i += 4) {
      if ((i & 0x3ffff) === 0) await checkpoint();
      if (layer.kind === "print") {
        const alpha = (pixels[i + 3] / 255) * layer.opacity;
        const coverage =
          alpha * (transparent ? 0.74 + 0.26 * whiteCoverage[i / 4] : 1);
        const white = whiteCoverage[i / 4];
        // Approximate subtractive ink on stock: image white leaves the stock visible unless a white underbase is present.
        // Each printable image still uses normal source-over ordering on the common canvas.
        const r =
          pixels[i] *
          (project.product === "acrylic"
            ? 1
            : (base[0] + (255 - base[0]) * white) / 255);
        const g =
          pixels[i + 1] *
          (project.product === "acrylic"
            ? 1
            : (base[1] + (255 - base[1]) * white) / 255);
        const b =
          pixels[i + 2] *
          (project.product === "acrylic"
            ? 1
            : (base[2] + (255 - base[2]) * white) / 255);
        over(art.data, i, r, g, b, coverage);
        const exposedStock =
          Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) / 255;
        finish.data[i + 2] =
          finish.data[i + 2] * (1 - alpha) +
          metalness * 255 * exposedStock * (1 - white) * alpha;
        continue;
      }
      const region =
        maskValue(
          pixels[i],
          pixels[i + 1],
          pixels[i + 2],
          pixels[i + 3],
          layer.maskMode,
          layer.invert,
          layer.threshold,
        ) / 255;
      if (!region) continue;
      const strength = region * layer.opacity;
      if (layer.kind === "white") {
        whiteCoverage[i / 4] = Math.max(whiteCoverage[i / 4], strength);
        over(art.data, i, 255, 255, 255, strength);
        finish.data[i + 2] *= 1 - strength;
      } else if (layer.kind === "foil") {
        over(art.data, i, foil[0], foil[1], foil[2], strength);
        finish.data[i + 2] =
          finish.data[i + 2] * (1 - strength) + 255 * strength;
        finish.data[i + 1] =
          finish.data[i + 1] * (1 - strength) + 60 * strength;
        finish.data[i] = finish.data[i] * (1 - strength) + 76 * strength;
      } else if (layer.kind === "varnish") {
        finish.data[i] = finish.data[i] * (1 - strength) + 255 * strength;
        finish.data[i + 1] =
          finish.data[i + 1] * (1 - strength) + 18 * strength;
        if (transparent && art.data[i + 3] < 25) art.data[i + 3] = 25;
      } else if (layer.kind === "matte") {
        finish.data[i] *= 1 - strength;
        finish.data[i + 1] =
          finish.data[i + 1] * (1 - strength) + 245 * strength;
        if (transparent && art.data[i + 3] < 55) art.data[i + 3] = 55;
      } else {
        const level = 128 + (layer.kind === "emboss" ? 110 : -110) * strength;
        relief.data[i] = level;
        relief.data[i + 1] = level;
        relief.data[i + 2] = level;
      }
    }
  }
  colorCtx.putImageData(art, 0, 0);
  await checkpoint();
  finishCtx.putImageData(finish, 0, 0);
  await checkpoint();
  reliefCtx.putImageData(relief, 0, 0);
  options.signal?.throwIfAborted();
  return {
    color: texture(colorCanvas, true),
    finish: texture(finishCanvas),
    relief: texture(reliefCanvas),
    hasArt: layers.length > 0,
  };
}

function over(
  bytes: Uint8ClampedArray,
  offset: number,
  r: number,
  g: number,
  b: number,
  alpha: number,
) {
  const previous = bytes[offset + 3] / 255,
    output = alpha + previous * (1 - alpha);
  if (output <= 0) return;
  bytes[offset] = (r * alpha + bytes[offset] * previous * (1 - alpha)) / output;
  bytes[offset + 1] =
    (g * alpha + bytes[offset + 1] * previous * (1 - alpha)) / output;
  bytes[offset + 2] =
    (b * alpha + bytes[offset + 2] * previous * (1 - alpha)) / output;
  bytes[offset + 3] = output * 255;
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  target: HTMLCanvasElement,
  layer: Layer,
  source?: CanvasImageSource,
) {
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.save();
  ctx.translate(
    target.width * (0.5 + layer.offsetX / 100),
    target.height * (0.5 + layer.offsetY / 100),
  );
  ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.scale(layer.scale, layer.scale);
  if (!source) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(
      -target.width / 2,
      -target.height / 2,
      target.width,
      target.height,
    );
  } else {
    const image = source as HTMLImageElement | HTMLCanvasElement;
    const w =
      image instanceof HTMLImageElement ? image.naturalWidth : image.width;
    const h =
      image instanceof HTMLImageElement ? image.naturalHeight : image.height;
    const fit = Math.min(target.width / w, target.height / h);
    ctx.drawImage(source, (-w * fit) / 2, (-h * fit) / 2, w * fit, h * fit);
  }
  ctx.restore();
}

export function surfaceMaterial(
  project: Project,
  maps: SurfaceMaps,
  back: boolean,
) {
  const clear =
    project.product === "acrylic" &&
    ["clear", "frosted"].includes(project.substrate);
  return new THREE.MeshPhysicalMaterial({
    map: maps.color,
    roughnessMap: maps.finish,
    metalnessMap: maps.finish,
    clearcoatMap: maps.finish,
    clearcoatRoughnessMap: maps.finish,
    bumpMap: maps.relief,
    bumpScale:
      project.product === "paper"
        ? Math.min(project.thickness * 0.35, 0.16)
        : 0,
    roughness: 1,
    metalness: 1,
    clearcoat: 1,
    clearcoatRoughness: 1,
    iridescence:
      project.substrate === "holographic"
        ? 0.85
        : project.substrate === "pearlescent"
          ? 0.22
          : 0,
    iridescenceIOR: 1.4,
    iridescenceThicknessRange: [180, 520],
    transparent: clear,
    depthWrite: !clear,
    side: back ? THREE.BackSide : THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

export function disposeMaps(maps: SurfaceMaps) {
  maps.color.dispose();
  maps.finish.dispose();
  maps.relief.dispose();
}
