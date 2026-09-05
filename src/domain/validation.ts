import {
  isLayerSupported,
  LAYER_LABELS,
  PRODUCTS,
  SCENES,
  SUBSTRATES,
} from "./catalog";
import type { AssetRecord, Layer, ProductionIssue, Project } from "./model";
import { safeSvg } from "../lib/images";
import {
  BADGE_SHAPES,
  equalDimensions,
  isBadgeShape,
  isBadgeStandardSize,
} from "./badges";

const FLAT_SHAPES = ["circle", "rectangle", "rounded", "custom"] as const;

function fail(field: string): never {
  throw new Error(`项目数据无效：${field}。请使用本应用导出的完整备份。`);
}
function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(field);
  return value as Record<string, unknown>;
}
function fields(
  value: Record<string, unknown>,
  allowed: string[],
  field: string,
) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail(`${field}包含未知字段`);
}
function string(
  value: unknown,
  field: string,
  max = 200,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f]/.test(value)
  )
    fail(field);
}
function number(
  value: unknown,
  field: string,
  min: number,
  max: number,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    fail(field);
}
function oneOf(value: unknown, allowed: readonly string[], field: string) {
  if (typeof value !== "string" || !allowed.includes(value)) fail(field);
}
function boolean(value: unknown, field: string) {
  if (typeof value !== "boolean") fail(field);
}
function color(value: unknown, field: string) {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) fail(field);
}
function id(value: unknown, field: string): asserts value is string {
  string(value, field, 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) fail(field);
}

export function validateProject(input: unknown): Project {
  const p = record(input, "项目");
  fields(
    p,
    [
      "version",
      "id",
      "name",
      "createdAt",
      "updatedAt",
      "product",
      "width",
      "height",
      "thickness",
      "shape",
      "substrate",
      "lamination",
      "cutline",
      "layers",
      "assetIds",
      "scene",
      "quality",
    ],
    "项目",
  );
  if (p.version !== 1)
    throw new Error("不支持此项目版本，请使用兼容版本的制物 Studio 打开。");
  id(p.id, "项目编号");
  string(p.name, "项目名称");
  number(p.createdAt, "创建时间", 0, 8.64e15);
  number(p.updatedAt, "更新时间", 0, 8.64e15);
  oneOf(p.product, Object.keys(PRODUCTS), "制品类型");
  number(p.width, "宽度（5–500 mm）", 5, 500);
  number(p.height, "高度（5–500 mm）", 5, 500);
  number(p.thickness, "厚度（0.05–20 mm）", 0.05, 20);
  if (p.product === "badge") {
    if (!isBadgeShape(p.shape))
      fail("吧唧需要使用已有模具形状，暂不支持自定义刀线");
  } else {
    oneOf(p.shape, FLAT_SHAPES, "当前制品形状");
  }
  oneOf(p.substrate, Object.keys(SUBSTRATES), "底材");
  if (
    !PRODUCTS[p.product as Project["product"]].substrates.includes(
      p.substrate as Project["substrate"],
    )
  )
    fail("底材不适用于此制品");
  if (p.shape === "circle" && p.width !== p.height)
    fail("圆形制品宽高需要一致");
  if (
    p.product === "badge" &&
    isBadgeShape(p.shape) &&
    equalDimensions(p.shape) &&
    p.width !== p.height
  )
    fail(`${BADGE_SHAPES[p.shape].label}吧唧宽高需要一致`);
  oneOf(p.lamination, ["none", "matte", "gloss"], "覆膜");
  oneOf(p.quality, ["eco", "standard", "high"], "预览质量");
  if (p.cutline !== undefined) {
    if (typeof p.cutline !== "string" || p.cutline.length > 256 * 1024)
      fail("刀线大小");
    safeSvg(p.cutline);
  }
  if (p.shape === "custom" && !p.cutline) fail("自定义轮廓缺少刀线");
  if (!Array.isArray(p.assetIds) || p.assetIds.length > 200)
    fail("素材列表（最多 200 张）");
  const assetIds = new Set<string>();
  for (const asset of p.assetIds) {
    id(asset, "素材编号");
    if (assetIds.has(asset)) fail("重复素材编号");
    assetIds.add(asset);
  }
  if (!Array.isArray(p.layers) || p.layers.length > 64)
    fail("图层列表（最多 64 层）");
  const layerIds = new Set<string>();
  for (const item of p.layers) {
    const l = record(item, "图层");
    fields(
      l,
      [
        "id",
        "name",
        "kind",
        "side",
        "assetId",
        "enabled",
        "maskMode",
        "invert",
        "threshold",
        "opacity",
        "color",
        "scale",
        "offsetX",
        "offsetY",
        "rotation",
      ],
      "图层",
    );
    id(l.id, "图层编号");
    if (layerIds.has(l.id)) fail("重复图层编号");
    layerIds.add(l.id);
    string(l.name, "图层名称");
    oneOf(l.kind, Object.keys(LAYER_LABELS), "图层用途");
    oneOf(l.side, ["front", "back"], "印刷面");
    oneOf(l.maskMode, ["alpha", "luminance"], "蒙版模式");
    if (l.assetId !== undefined) {
      id(l.assetId, "图层素材编号");
      if (!assetIds.has(l.assetId)) fail("图层引用了未包含的素材");
    }
    boolean(l.enabled, "图层显示");
    boolean(l.invert, "蒙版反相");
    number(l.threshold, "蒙版阈值", 0, 1);
    number(l.opacity, "图层强度", 0, 1);
    color(l.color, "工艺颜色");
    number(l.scale, "图案缩放", 0.05, 10);
    number(l.offsetX, "横向偏移", -200, 200);
    number(l.offsetY, "纵向偏移", -200, 200);
    number(l.rotation, "图案旋转", -360, 360);
  }
  const scene = record(p.scene, "场景");
  fields(
    scene,
    [
      "preset",
      "background",
      "intensity",
      "ambient",
      "azimuth",
      "elevation",
      "exposure",
    ],
    "场景",
  );
  oneOf(scene.preset, Object.keys(SCENES), "场景预设");
  color(scene.background, "背景颜色");
  number(scene.intensity, "光源强度", 0, 10);
  number(scene.ambient, "环境亮度", 0, 5);
  number(scene.azimuth, "光源方向", -360, 360);
  number(scene.elevation, "光源高度", 0, 90);
  number(scene.exposure, "曝光", 0.1, 3);
  return structuredClone(p) as unknown as Project;
}

export function productionIssues(
  project: Project,
  assets: AssetRecord[],
): ProductionIssue[] {
  const issues: ProductionIssue[] = [];
  const push = (issue: ProductionIssue) => issues.push(issue);
  if (!PRODUCTS[project.product].substrates.includes(project.substrate))
    push({
      id: "substrate",
      severity: "error",
      title: "底材不适用于当前制品",
      detail:
        "请在当前制品的底材列表中重新选择；已有图案会保留。依据：本应用的制品结构范围。",
    });
  if (
    project.product === "badge" &&
    (!isBadgeShape(project.shape) ||
      (equalDimensions(project.shape) && project.width !== project.height))
  )
    push({
      id: "badge-shape",
      severity: "error",
      title: "吧唧形状与尺寸不匹配",
      detail:
        "请选择已有吧唧模具形状；圆形、圆角方形和星形的宽高需要一致。自定义刀线不能直接用于包边吧唧。依据：本应用支持的徽章结构。",
    });
  if (
    project.product !== "badge" &&
    (!(FLAT_SHAPES as readonly string[]).includes(project.shape) ||
      (project.shape === "circle" && project.width !== project.height))
  )
    push({
      id: "product-shape",
      severity: "error",
      title: "形状不适用于当前制品",
      detail:
        "请选择当前制品支持的形状；圆形需要相同宽高。图案与原刀线会保留。依据：本应用的制品形状范围。",
    });
  if (
    project.product === "badge" &&
    isBadgeShape(project.shape) &&
    !isBadgeStandardSize(project.shape, project.width, project.height)
  )
    push({
      id: "badge-size",
      severity: "warning",
      title: "此尺寸需要确认吧唧模具",
      detail:
        "当前宽高不在应用收录的厂家规格示例中，可以继续预览。请向厂家确认这一形状和尺寸的模具、包边及背针。依据：UCANBADGE 与缶バッジの達人的公开规格；收录尺寸并非通用标准。",
    });
  if (project.product === "badge")
    push({
      id: "badge-wrap",
      severity: "warning",
      title: "为吧唧包边预留图案",
      detail:
        "当前宽高表示成品外轮廓；弧面正面的安全区域更小，实际裁纸还需包边。请使用所选工厂对应模具的模板，不要直接把预览边缘作为裁切线。依据：徽章包边结构，参见制作说明。",
    });
  if (project.shape === "custom")
    push({
      id: "custom-cutline",
      severity: "warning",
      title: "异形刀线需要厂家复核",
      detail:
        "此处检查闭合轮廓；最小圆角、细颈、刀具半径与结构强度仍需厂家确认。依据：切割方式与板材厚度各异。",
    });
  const active = project.layers.filter(
    (layer) =>
      layer.enabled &&
      isLayerSupported(project.product, layer.kind, layer.side),
  );
  for (const layer of project.layers) {
    if (!layer.enabled) continue;
    if (!isLayerSupported(project.product, layer.kind, layer.side)) {
      push({
        id: `unsupported-${layer.id}`,
        layerId: layer.id,
        severity: "error",
        title: `${layer.name}暂不参与预览`,
        detail: `当前${PRODUCTS[project.product].label}${layer.side === "back" ? "背面" : ""}不支持此工艺。图层已保留，可隐藏或切回原制品。依据：本应用支持的生产结构。`,
      });
      continue;
    }
    const asset = assets.find((item) => item.id === layer.assetId);
    if (layer.assetId && !asset) {
      push({
        id: `missing-${layer.id}`,
        layerId: layer.id,
        severity: "error",
        title: `${layer.name}缺少素材`,
        detail: "请重新导入原图或恢复含原图的备份。",
      });
      continue;
    }
    if (layer.kind !== "print" && !asset)
      push({
        id: `mask-${layer.id}`,
        layerId: layer.id,
        severity: "info",
        title: `${layer.name}使用整面区域`,
        detail: "如需局部加工，请为此层分配灰度或 Alpha 蒙版。",
      });
    if (
      asset &&
      layer.kind !== "print" &&
      !asset.hasAlpha &&
      layer.maskMode === "alpha"
    )
      push({
        id: `alpha-${layer.id}`,
        layerId: layer.id,
        severity: "warning",
        title: `${layer.name}的图片没有透明区域`,
        detail:
          "Alpha 模式会覆盖整张图片。黑白工艺图请选择「灰度」，白色为有效区域；可用反相切换。依据：图片透明通道检测。",
      });
    if (asset && layer.kind === "print" && asset.mime !== "image/svg+xml") {
      // Artwork uses contain-fit; the shorter physical fit determines its actual printed density.
      const dpi = Math.max(
        asset.width / ((project.width * layer.scale) / 25.4),
        asset.height / ((project.height * layer.scale) / 25.4),
      );
      if (dpi < 300)
        push({
          id: `dpi-${layer.id}`,
          layerId: layer.id,
          severity: "warning",
          title: `${layer.name}约 ${Math.round(dpi)} DPI`,
          detail:
            "按原图像素、当前尺寸和缩放估算。300 DPI 仅作为本应用提醒值，是否足够需结合观看距离与厂家交付要求；请优先使用更高分辨率原图。",
        });
    }
    processAdvice(layer, project, push);
  }
  if (
    project.product === "acrylic" &&
    project.substrate !== "white" &&
    active.some((l) => l.kind === "print") &&
    !active.some((l) => l.kind === "white")
  )
    push({
      id: "acrylic-white",
      severity: "warning",
      title: "透明板材上尚未设置白墨",
      detail:
        "彩印会透出背景。希望颜色不透时，请添加白墨层并指定覆盖区域；有意透色可以保留。依据：透明基材白墨承托原理，参见制作说明。",
    });
  if (
    active.some((l) => l.kind === "varnish") &&
    active.some((l) => l.kind === "matte")
  )
    push({
      id: "finish-overlap",
      severity: "warning",
      title: "检查光油与磨砂是否重叠",
      detail:
        "同一区域的表面处理会互相影响。请分别确认蒙版和加工顺序，预览不能替代厂家对叠加工艺的判断。依据：表面处理层序。",
    });
  push({
    id: "bleed",
    severity: "info",
    title: "送厂前核对出血和安全区",
    detail:
      "尺寸线仅表示成品轮廓。文字、孔位与重要图案应避开边缘，具体距离、套印误差和最小线宽以工厂模板为准。依据：裁切与套印结构，参见制作说明中的厂家实例。",
  });
  push({
    id: "reference",
    severity: "info",
    title: "此样机用于视觉参考",
    detail:
      "屏幕 RGB、近似材质和灯光不能保证实物颜色、烫色或压纹深度。特殊底材与叠加工艺请结合实物样品打样确认。",
  });
  return issues;
}

function processAdvice(
  layer: Layer,
  project: Project,
  push: (issue: ProductionIssue) => void,
) {
  if (["foil", "emboss", "deboss"].includes(layer.kind))
    push({
      id: `process-${layer.id}`,
      layerId: layer.id,
      severity: "warning",
      title: `${layer.name}需要工艺确认`,
      detail:
        "请向厂家确认可用材料、最小线宽、套印容差和加工顺序。这里的颜色与凹凸强度仅控制视觉近似，不表示连续可调的生产参数。依据：制造设备和材料规格因厂而异。",
    });
  if (layer.kind === "white" && project.substrate === "white")
    push({
      id: `white-${layer.id}`,
      layerId: layer.id,
      severity: "info",
      title: `${layer.name}在白底上可能无需单独加工`,
      detail:
        "白色底材通常已经承托色彩；请确认是否有专门的白墨表现需求，避免不必要的工序。",
    });
}
