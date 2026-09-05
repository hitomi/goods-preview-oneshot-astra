import {
  uid,
  type Layer,
  type LayerKind,
  type ProductType,
  type Project,
  type ScenePreset,
  type Side,
  type Substrate,
} from "./model";

export const PRODUCTS: Record<
  ProductType,
  {
    label: string;
    description: string;
    defaultWidth: number;
    defaultHeight: number;
    defaultThickness: number;
    substrates: Substrate[];
  }
> = {
  badge: {
    label: "吧唧",
    description: "带金属背针的圆形徽章",
    defaultWidth: 58,
    defaultHeight: 58,
    defaultThickness: 4,
    substrates: ["white", "pearlescent", "holographic"],
  },
  paper: {
    label: "纸品",
    description: "卡片、明信片与异形纸制品",
    defaultWidth: 100,
    defaultHeight: 148,
    defaultThickness: 0.4,
    substrates: ["white", "pearlescent", "kraft", "textured", "holographic"],
  },
  acrylic: {
    label: "亚克力",
    description: "透明板材与自定义轮廓",
    defaultWidth: 70,
    defaultHeight: 100,
    defaultThickness: 3,
    substrates: ["clear", "frosted", "white"],
  },
};

export const SUBSTRATES: Record<
  Substrate,
  { label: string; description: string; color: string }
> = {
  white: {
    label: "白色底材",
    description: "以白色承托图案，色彩清楚",
    color: "#f8f7f2",
  },
  pearlescent: {
    label: "珠光纸",
    description: "带细微珠光反射；实际颜色需看纸样",
    color: "#ece7df",
  },
  holographic: {
    label: "镭射纸",
    description: "随光线产生彩色反射；图案覆盖率影响透出效果",
    color: "#dce5e2",
  },
  kraft: {
    label: "牛皮纸",
    description: "暖褐色纸底会影响印刷颜色",
    color: "#bc9465",
  },
  textured: {
    label: "纹理纸",
    description: "带轻微纸面纹理，细节请结合纸样判断",
    color: "#f0ecdf",
  },
  clear: {
    label: "透明亚克力",
    description: "无白墨区域透光，可从两侧观察",
    color: "#edf5f4",
  },
  frosted: {
    label: "磨砂亚克力",
    description: "半透明板材，漫射透光",
    color: "#e7eeeb",
  },
};

export const LAYER_LABELS: Record<LayerKind, string> = {
  print: "彩色印刷",
  white: "白墨",
  varnish: "局部光油",
  matte: "局部磨砂",
  foil: "烫色",
  emboss: "压凸",
  deboss: "压凹",
};

export const SCENES: Record<
  ScenePreset,
  {
    label: string;
    description: string;
    background: string;
    intensity: number;
    ambient: number;
    azimuth: number;
    elevation: number;
    exposure: number;
  }
> = {
  studio: {
    label: "柔光棚",
    description: "均匀柔光，检查整体图案",
    background: "#e8eae5",
    intensity: 3,
    ambient: 1,
    azimuth: -35,
    elevation: 55,
    exposure: 1.1,
  },
  daylight: {
    label: "日光窗边",
    description: "侧向亮光，观察表面细节",
    background: "#e3e9ef",
    intensity: 3.8,
    ambient: 0.8,
    azimuth: 55,
    elevation: 40,
    exposure: 1.15,
  },
  warm: {
    label: "暖光桌面",
    description: "温暖环境，观察材质氛围",
    background: "#e8dbcc",
    intensity: 2.8,
    ambient: 0.85,
    azimuth: -55,
    elevation: 35,
    exposure: 1.05,
  },
  night: {
    label: "暗色展台",
    description: "集中光线，查看金属与光油反射",
    background: "#252d2b",
    intensity: 4,
    ambient: 0.3,
    azimuth: 35,
    elevation: 60,
    exposure: 1.1,
  },
};

export function isLayerSupported(
  product: ProductType,
  kind: LayerKind,
  side: Side = "front",
): boolean {
  if (product === "badge")
    return side === "front" && !["white", "emboss", "deboss"].includes(kind);
  if (product === "acrylic") return !["emboss", "deboss"].includes(kind);
  return true;
}

export function createLayer(
  kind: LayerKind,
  assetId?: string,
  side: Side = "front",
): Layer {
  return {
    id: uid(),
    name: `${side === "back" ? "背面" : "正面"}${LAYER_LABELS[kind]}`,
    kind,
    side,
    ...(assetId ? { assetId } : {}),
    enabled: true,
    maskMode: "alpha",
    invert: false,
    threshold: 0.5,
    opacity: 1,
    color: kind === "foil" ? "#d4a94e" : "#ffffff",
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
  };
}

export const layerStage = (kind: LayerKind): number =>
  kind === "white" ? 0 : kind === "print" ? 1 : 2;
export function orderedLayers(layers: readonly Layer[]): Layer[] {
  return [...layers].sort((a, b) => layerStage(a.kind) - layerStage(b.kind));
}

export function createProject(
  product: ProductType = "badge",
  name = "未命名设计",
): Project {
  const spec = PRODUCTS[product];
  const { label: _label, description: _description, ...scene } = SCENES.studio;
  const now = Date.now();
  return {
    version: 1,
    id: uid(),
    name,
    createdAt: now,
    updatedAt: now,
    product,
    width: spec.defaultWidth,
    height: spec.defaultHeight,
    thickness: spec.defaultThickness,
    shape: product === "badge" ? "circle" : "rounded",
    substrate: product === "acrylic" ? "clear" : "white",
    lamination: product === "badge" ? "gloss" : "none",
    layers: [createLayer("print")],
    assetIds: [],
    scene: { preset: "studio", ...scene },
    quality: "standard",
  };
}
