import {
  Plus,
  Image,
  Droplets,
  Sparkles,
  Sun,
  Layers,
  ArrowUpFromLine,
  ArrowDownToLine,
} from "lucide-react";
import type { LayerKind, ProductType } from "../domain/model";
import { LAYER_LABELS, isLayerSupported } from "../domain/catalog";
import { Modal } from "./ui";

const descriptions: Record<LayerKind, string> = {
  print: "彩色图案，可使用素材库中的任意图片",
  white: "给透明或有色底材增加白色遮盖",
  varnish: "局部明亮反光，转动样机查看光泽",
  matte: "局部哑油，让选中区域柔和散射",
  foil: "金属箔覆盖，可选金、银或其他箔色",
  emboss: "纸张表面压凸，侧光下观察起伏",
  deboss: "纸张表面压凹，观察细节与阴影",
};
const icons = {
  print: Image,
  white: Layers,
  varnish: Droplets,
  matte: Sun,
  foil: Sparkles,
  emboss: ArrowUpFromLine,
  deboss: ArrowDownToLine,
};

export function AddLayerDialog({
  product,
  onAdd,
  onClose,
}: {
  product: ProductType;
  onAdd: (kind: LayerKind) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="为设计加一道工艺" eyebrow="图层" onClose={onClose}>
      <p className="modal-intro">先选择工艺，再指定它的图片和加工区域。</p>
      <div className="process-picker">
        {(Object.keys(LAYER_LABELS) as LayerKind[]).map((kind) => {
          const Icon = icons[kind];
          const supported = isLayerSupported(product, kind, "front");
          return (
            <button
              disabled={!supported}
              key={kind}
              onClick={() => onAdd(kind)}
            >
              <span className={`process-icon mark-${kind}`}>
                <Icon size={21} />
              </span>
              <span>
                <strong>{LAYER_LABELS[kind]}</strong>
                <small>
                  {supported
                    ? descriptions[kind]
                    : "当前制品不适用；原有图层会保留"}
                </small>
              </span>
              <Plus size={17} />
            </button>
          );
        })}
      </div>
      <p className="helper">
        工艺选项用于效果预览，底材适配、工艺叠加与加工细节需与制作厂家确认。
      </p>
    </Modal>
  );
}
