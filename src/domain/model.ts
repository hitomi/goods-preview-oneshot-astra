export type ProductType = "badge" | "paper" | "acrylic";
export type ShapeType = "circle" | "rectangle" | "rounded" | "custom";
export type Substrate =
  | "white"
  | "pearlescent"
  | "holographic"
  | "kraft"
  | "textured"
  | "clear"
  | "frosted";
export type LayerKind =
  "print" | "white" | "varnish" | "matte" | "foil" | "emboss" | "deboss";
export type MaskMode = "alpha" | "luminance";
export type Side = "front" | "back";
export type ScenePreset = "studio" | "daylight" | "warm" | "night";
export interface Layer {
  id: string;
  name: string;
  kind: LayerKind;
  side: Side;
  assetId?: string;
  enabled: boolean;
  maskMode: MaskMode;
  invert: boolean;
  threshold: number;
  opacity: number;
  color: string;
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
}
export interface Project {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  product: ProductType;
  width: number;
  height: number;
  thickness: number;
  shape: ShapeType;
  substrate: Substrate;
  lamination: "gloss" | "matte" | "none";
  cutline?: string;
  layers: Layer[];
  assetIds: string[];
  scene: {
    preset: ScenePreset;
    background: string;
    intensity: number;
    ambient: number;
    azimuth: number;
    elevation: number;
    exposure: number;
  };
  quality: "eco" | "standard" | "high";
}
export interface AssetRecord {
  id: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  original: Blob;
  preview: Blob;
  createdAt: number;
}
export interface ProductionIssue {
  id: string;
  severity: "error" | "warning" | "info";
  title: string;
  detail: string;
  layerId?: string;
}
export const uid = () => crypto.randomUUID();
