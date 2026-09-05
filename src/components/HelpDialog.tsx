import {
  Download,
  MousePointer2,
  ShieldCheck,
  Layers,
  WifiOff,
} from "lucide-react";
import { Modal } from "./ui";

export function HelpDialog({
  onClose,
  offlineReady,
  onInstall,
}: {
  onClose: () => void;
  offlineReady: boolean;
  onInstall?: () => void;
}) {
  return (
    <Modal
      title="把想象，转成可观察的制品"
      eyebrow="制物 STUDIO · 使用指南"
      onClose={onClose}
    >
      <div className="help-list">
        <section>
          <MousePointer2 size={21} />
          <div>
            <h3>从一个完整样机开始</h3>
            <p>
              左侧选制品与底材，导入图片后逐张指定用途。拖动旋转、滚轮缩放；也可以使用画布上的正面、背面和缩放按钮。
            </p>
          </div>
        </section>
        <section>
          <Layers size={21} />
          <div>
            <h3>让工艺图有明确的含义</h3>
            <p>
              Alpha
              读取不透明区域；灰度读取明暗，也可反相让黑色生效。绿色蒙版表示加工范围，阈值不会改变真实墨厚。各图层共享画布，透明边距会被保留。
            </p>
          </div>
        </section>
        <section>
          <ShieldCheck size={21} />
          <div>
            <h3>预览和真实制作之间</h3>
            <p>
              这里检查尺寸、图片与工艺兼容性。出血、线宽、套印与工艺组合取决于厂家；屏幕无法精确证明印刷颜色、手感或结构强度。吧唧尺寸为正面参考，包边需使用厂家的模板。
            </p>
          </div>
        </section>
        <section>
          <Layers size={21} />
          <div>
            <h3>从线稿识别制品外形</h3>
            <p>
              纸品与亚克力支持导入刀线图片或
              SVG。普通图片请只保留一条闭合红线或黑线；检查叠加轮廓后再导入。识别沿线条内缘，线宽会带来误差，制品宽高决定最终尺寸。有断口、孔洞或多条轮廓时需先修正线稿。
            </p>
          </div>
        </section>
        <section>
          <Download size={21} />
          <div>
            <h3>文件留在自己的设备里</h3>
            <p>
              修改自动保存在当前浏览器。下载项目备份会包含原图，可迁移到另一台设备。清理浏览器数据可能移除本机项目，请定期备份。PNG
              是当前视角效果图，不是生产文件。
            </p>
          </div>
        </section>
        <section>
          <WifiOff size={21} />
          <div>
            <h3>{offlineReady ? "已经可以离线使用" : "准备离线工作"}</h3>
            <p>
              {offlineReady
                ? "应用已缓存到本机，断开网络后仍可打开、编辑和导出。"
                : "首次打开需要完成应用缓存。底栏显示“可离线使用”后，即可断网使用。"}
              可在浏览器菜单中安装到桌面；首次启动需通过本地服务或 HTTPS 打开。
            </p>
            {onInstall && (
              <button className="button secondary" onClick={onInstall}>
                安装到此设备
              </button>
            )}
          </div>
        </section>
      </div>
      <footer className="modal-footer">
        <span className="muted">撤销 Ctrl / ⌘ Z · 重做 Ctrl / ⌘ ⇧ Z</span>
        <button className="button primary" onClick={onClose}>
          继续设计
        </button>
      </footer>
    </Modal>
  );
}
