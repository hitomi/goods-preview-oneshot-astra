import { Sun } from "lucide-react";
import type { Project, ScenePreset } from "../domain/model";
import { SCENES } from "../domain/catalog";
import { RangeField } from "./ui";

export function applyScene(project: Project, preset: ScenePreset) {
  const { background, intensity, ambient, azimuth, elevation, exposure } =
    SCENES[preset];
  project.scene = {
    preset,
    background,
    intensity,
    ambient,
    azimuth,
    elevation,
    exposure,
  };
}

export function ScenePanel({
  project,
  update,
}: {
  project: Project;
  update: (fn: (p: Project) => void) => void;
}) {
  const edit = (changes: Partial<Project["scene"]>) =>
    update((p) => {
      Object.assign(p.scene, changes);
    });
  return (
    <div className="scene-panel">
      <div className="inspector-heading">
        <Sun size={27} strokeWidth={1.3} />
        <div>
          <span className="eyebrow">LIGHT & ATMOSPHERE</span>
          <h3>让工艺遇见光</h3>
        </div>
      </div>
      <label className="select-field">
        场景预设
        <select
          value={project.scene.preset}
          onChange={(e) =>
            update((p) => applyScene(p, e.target.value as ScenePreset))
          }
        >
          {(Object.keys(SCENES) as ScenePreset[]).map((key) => (
            <option key={key} value={key}>
              {SCENES[key].label}
            </option>
          ))}
        </select>
      </label>
      <RangeField
        label="主光强度"
        value={project.scene.intensity}
        min={0}
        max={10}
        step={0.1}
        onChange={(n) => edit({ intensity: n })}
      />
      <RangeField
        label="环境补光"
        value={project.scene.ambient}
        min={0}
        max={5}
        step={0.1}
        onChange={(n) => edit({ ambient: n })}
      />
      <RangeField
        label="光照方向"
        value={project.scene.azimuth}
        min={-180}
        max={180}
        unit="°"
        onChange={(n) => edit({ azimuth: n })}
      />
      <RangeField
        label="光源高度"
        value={project.scene.elevation}
        min={5}
        max={90}
        unit="°"
        onChange={(n) => edit({ elevation: n })}
      />
      <RangeField
        label="画面曝光"
        value={project.scene.exposure}
        min={0.1}
        max={3}
        step={0.05}
        onChange={(n) => edit({ exposure: n })}
      />
      <label className="color-field">
        背景颜色
        <input
          type="color"
          value={project.scene.background}
          onChange={(e) => edit({ background: e.target.value })}
        />
        <span>{project.scene.background.toUpperCase()}</span>
      </label>
      <div className="note">
        想看清光油与烫色，可以把光源调到侧面，再轻轻转动样机。判断图案颜色时，使用中性柔光。
      </div>
      <div className="subsection-heading">预览画质</div>
      <label className="select-field">
        性能偏好
        <select
          value={project.quality}
          onChange={(e) =>
            update((p) => {
              p.quality = e.target.value as Project["quality"];
            })
          }
        >
          <option value="eco">节能 · 更低渲染负载</option>
          <option value="standard">均衡 · 日常设计</option>
          <option value="high">精细 · 查看工艺细节</option>
        </select>
      </label>
      <p className="helper">
        静止时停止绘制。预览画质不会改变保存在项目里的原图。
      </p>
    </div>
  );
}
