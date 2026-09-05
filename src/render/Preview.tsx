import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Project, Side } from "../domain/model";
import { isLayerSupported } from "../domain/catalog";
import { badgeBack, productShape, surfaceGeometry } from "./geometry";
import { fitCameraClipping } from "./camera";
import {
  composeSurface,
  disposeMaps,
  ImageCache,
  surfaceMaterial,
  type SurfaceMaps,
} from "./materials";

export { validateCutline, parseCutline } from "./geometry";
export interface PreviewHandle {
  setView(view: "front" | "back" | "perspective"): void;
  zoom(delta: number): void;
  reset(): void;
  exportPng(): Promise<Blob>;
}
interface PreviewProps {
  project: Project;
  assetUrls: Record<string, string>;
  showGuides: boolean;
  autoRotate: boolean;
  onError?: (message: string) => void;
  onReady?: () => void;
}

function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      geometries.add(child.geometry);
      for (const material of Array.isArray(child.material)
        ? child.material
        : [child.material]) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

function studioEnvironment(renderer: THREE.WebGLRenderer) {
  const room = new RoomEnvironment(),
    pmrem = new THREE.PMREMGenerator(renderer);
  try {
    return pmrem.fromScene(room, 0.04);
  } finally {
    room.dispose();
    pmrem.dispose();
  }
}

interface ModelSurfaces {
  front?: SurfaceMaps;
  back?: SurfaceMaps;
  insideFront?: SurfaceMaps;
  insideBack?: SurfaceMaps;
}

function model(project: Project, surfaces: ModelSurfaces) {
  const { front, back, insideFront, insideBack } = surfaces;
  const group = new THREE.Group();
  if (project.product === "badge") {
    group.add(badgeBack(project));
    const face = new THREE.Mesh(
      surfaceGeometry(project),
      surfaceMaterial(project, front!, false),
    );
    face.castShadow = true;
    face.receiveShadow = true;
    group.add(face);
  } else {
    const transparent =
      project.product === "acrylic" &&
      ["clear", "frosted"].includes(project.substrate);
    const bodyGeometry = new THREE.ExtrudeGeometry(productShape(project), {
      depth: project.thickness,
      steps: 1,
      bevelEnabled: project.product === "acrylic",
      bevelThickness: Math.min(project.thickness * 0.06, 0.15),
      bevelSize: Math.min(project.thickness * 0.045, 0.12),
      bevelSegments: 3,
      curveSegments: 36,
    });
    bodyGeometry.translate(0, 0, -project.thickness / 2);
    const bodyMaterial = new THREE.MeshPhysicalMaterial({
      color:
        project.substrate === "kraft"
          ? "#af8c61"
          : transparent
            ? "#f3fcf8"
            : "#ebe9df",
      metalness: 0,
      roughness: transparent
        ? project.substrate === "frosted"
          ? 0.43
          : 0.08
        : 0.76,
      transmission: transparent ? 0.96 : 0,
      // The clear volume must not occlude the inward-facing ink plane in the depth buffer.
      depthWrite: !transparent,
      thickness: project.thickness,
      ior: 1.49,
      attenuationColor: "#d6f3e8",
      attenuationDistance: Math.max(100, project.thickness * 40),
      clearcoat: transparent ? 1 : 0,
      clearcoatRoughness: project.substrate === "frosted" ? 0.4 : 0.08,
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.castShadow = !transparent;
    body.receiveShadow = true;
    group.add(body);
    const offset =
      project.thickness / 2 +
      (project.product === "acrylic"
        ? Math.min(project.thickness * 0.06, 0.15)
        : 0) +
      0.006;
    if (front) {
      const face = new THREE.Mesh(
        surfaceGeometry(project),
        surfaceMaterial(project, front, false),
      );
      face.position.z = offset;
      face.renderOrder = 2;
      face.castShadow = !transparent;
      group.add(face);
    }
    if (back) {
      const reverse = new THREE.Mesh(
        surfaceGeometry(project, true),
        surfaceMaterial(project, back, true),
      );
      reverse.position.z = -offset;
      reverse.renderOrder = 2;
      reverse.castShadow = !transparent;
      group.add(reverse);
    }
    for (const [sourceSide, maps] of [
      ["front", insideFront],
      ["back", insideBack],
    ] as const) {
      if (!maps) continue;
      const inward = new THREE.Mesh(
        surfaceGeometry(project, sourceSide === "back"),
        surfaceMaterial(project, maps, sourceSide === "front"),
      );
      // Preserve the original UVs and physical ink plane: viewing the reverse naturally mirrors the image.
      inward.position.z = (sourceSide === "front" ? 1 : -1) * (offset - 0.002);
      inward.renderOrder = 1;
      group.add(inward);
    }
  }
  return group;
}

class PreviewRuntime implements PreviewHandle {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, 1, 0.1, 10000);
  readonly controls: OrbitControls;
  readonly key = new THREE.DirectionalLight("#fff9ef", 3);
  readonly fill = new THREE.DirectionalLight("#dbe9ff", 1);
  readonly rim = new THREE.DirectionalLight("#ffffff", 1.5);
  readonly ambient = new THREE.HemisphereLight("#f7f6ed", "#61706a", 0.5);
  private environment: THREE.WebGLRenderTarget;
  private shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  private model?: THREE.Group;
  private modelBounds = new THREE.Box3();
  private guides?: THREE.Group;
  private images = new ImageCache();
  private observer: ResizeObserver;
  private frame = 0;
  private frames = 0;
  private previousTime = 0;
  private generation = 0;
  private buildController?: AbortController;
  private disposed = false;
  private contextLost = false;
  private modelKey = "";
  private latest?: Project;
  private modelProjectId = "";
  private modelProduct?: Project["product"];
  private size = 100;
  private ready = false;
  private notifyReady = false;
  private pending: Promise<void> = Promise.resolve();
  private buildError?: Error;
  private guideVisible = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private reportError: (message: string) => void,
    private reportReady: () => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.environment = studioEnvironment(this.renderer);
    this.scene.environment = this.environment.texture;
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.normalBias = 0.08;
    this.key.shadow.bias = -0.00015;
    this.key.shadow.radius = 4;
    this.scene.add(this.key, this.fill, this.rim, this.ambient);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ opacity: 0.1, depthWrite: false }),
    );
    this.shadow.receiveShadow = true;
    this.scene.add(this.shadow);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.85;
    this.controls.autoRotateSpeed = 0.8;
    this.controls.addEventListener("change", this.invalidate);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas.parentElement ?? canvas);
    document.addEventListener("visibilitychange", this.visibility);
    canvas.addEventListener("webglcontextlost", this.lost);
    canvas.addEventListener("webglcontextrestored", this.restored);
    this.camera.position.set(100, 60, 240);
    this.resize();
  }

  update(
    project: Project,
    urls: Record<string, string>,
    guides: boolean,
    autoRotate: boolean,
  ) {
    this.latest = project;
    this.guideVisible = guides;
    if (this.guides) this.guides.visible = guides;
    this.controls.autoRotate =
      autoRotate &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = project.scene;
    this.scene.background = new THREE.Color(scene.background);
    this.scene.environmentIntensity = scene.ambient * 0.78;
    this.renderer.toneMappingExposure = scene.exposure;
    const max = Math.max(project.width, project.height);
    const azimuth = THREE.MathUtils.degToRad(scene.azimuth),
      elevation = THREE.MathUtils.degToRad(scene.elevation);
    this.key.position.set(
      Math.sin(azimuth) * Math.cos(elevation) * max * 4,
      Math.sin(elevation) * max * 4,
      Math.cos(azimuth) * Math.cos(elevation) * max * 4,
    );
    this.key.intensity = scene.intensity * 0.8;
    this.key.color.set(
      scene.preset === "warm"
        ? "#ffd9a8"
        : scene.preset === "daylight"
          ? "#f6fbff"
          : "#fff9ef",
    );
    this.fill.position.set(max * 3, max * 0.4, max * 2);
    this.fill.intensity = scene.ambient * 0.7;
    this.rim.position.set(-max * 3, max * 2, -max * 3);
    this.rim.intensity = scene.preset === "night" ? 2.5 : scene.ambient * 1.5;
    this.rim.color.set(scene.preset === "warm" ? "#f8d5ac" : "#e1eeff");
    this.ambient.intensity = scene.ambient * 0.5;
    Object.assign(this.key.shadow.camera, {
      left: -max,
      right: max,
      top: max,
      bottom: -max,
      near: 1,
      far: max * 12,
    });
    this.key.shadow.camera.updateProjectionMatrix();
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      project.quality === "eco" ? 1 : project.quality === "high" ? 2 : 1.5,
    );
    if (this.renderer.getPixelRatio() !== ratio) {
      this.renderer.setPixelRatio(ratio);
      this.resize();
    }
    const key = JSON.stringify([
      project.id,
      project.product,
      project.width,
      project.height,
      project.thickness,
      project.shape,
      project.cutline,
      project.substrate,
      project.lamination,
      project.layers,
      project.quality,
      project.layers.map((layer) => (layer.assetId ? urls[layer.assetId] : "")),
    ]);
    if (key !== this.modelKey) {
      this.modelKey = key;
      const generation = ++this.generation;
      this.buildController?.abort();
      this.buildController = new AbortController();
      this.canvas.dataset.updating = "true";
      this.images.retain(Object.values(urls));
      this.pending = this.rebuild(
        project,
        urls,
        generation,
        this.buildController.signal,
      );
    }
    this.invalidate();
  }

  private async rebuild(
    project: Project,
    urls: Record<string, string>,
    generation: number,
    signal: AbortSignal,
  ) {
    const built: SurfaceMaps[] = [];
    try {
      // Coalesce fast slider/input updates before expensive pixel processing.
      if (this.model)
        await new Promise<void>((resolve) => setTimeout(resolve, 65));
      if (this.disposed || generation !== this.generation) return;
      // Sequential work bounds peak CPU and temporary image memory on mobile devices.
      const surfaces: ModelSurfaces = {};
      const sideLayers = (side: Side) =>
        project.layers.filter(
          (layer) =>
            layer.enabled &&
            layer.opacity > 0 &&
            layer.side === side &&
            isLayerSupported(project.product, layer.kind, side),
        );
      const transparent =
        project.product === "acrylic" &&
        ["clear", "frosted"].includes(project.substrate);
      for (const side of ["front", "back"] as const) {
        if (side === "back" && project.product === "badge") continue;
        const layers = sideLayers(side);
        if (!transparent || layers.length) {
          const maps = await composeSurface(project, side, urls, this.images, {
            signal,
          });
          built.push(maps);
          surfaces[side] = maps;
        }
        if (
          transparent &&
          layers.some((layer) =>
            ["print", "white", "foil"].includes(layer.kind),
          ) &&
          !sideLayers(side === "front" ? "back" : "front").some(
            (layer) => layer.kind === "print",
          )
        ) {
          const maps = await composeSurface(project, side, urls, this.images, {
            fromInside: true,
            signal,
          });
          built.push(maps);
          surfaces[side === "front" ? "insideFront" : "insideBack"] = maps;
        }
        signal.throwIfAborted();
      }
      if (this.disposed || generation !== this.generation) {
        built.forEach(disposeMaps);
        return;
      }
      const next = model(project, surfaces);
      if (this.model) {
        this.scene.remove(this.model);
        disposeObject(this.model);
      }
      this.model = next;
      this.scene.add(next);
      this.modelBounds.setFromObject(next);
      const previousSize = this.size;
      this.size = Math.max(project.width, project.height);
      this.shadow.scale.setScalar(this.size * 8);
      this.controls.minDistance = this.size * 0.7;
      this.controls.maxDistance = this.size * 12;
      if (this.modelProjectId !== project.id) this.reset();
      else if (
        this.modelProduct !== project.product ||
        Math.abs(this.size / previousSize - 1) > 0.45
      ) {
        const direction = this.camera.position
          .clone()
          .sub(this.controls.target)
          .normalize();
        this.controls.target.set(0, 0, 0);
        this.camera.position.copy(
          direction.multiplyScalar(this.fittedDistance()),
        );
        this.controls.update();
      }
      this.modelProjectId = project.id;
      this.modelProduct = project.product;
      this.makeGuides(project);
      this.buildError = undefined;
      this.canvas.dataset.updating = "false";
      this.ready = true;
      this.notifyReady = true;
      this.invalidate();
    } catch (error) {
      built.forEach(disposeMaps);
      if (signal.aborted) return;
      if (!this.disposed && generation === this.generation) {
        this.buildError =
          error instanceof Error
            ? error
            : new Error("样机暂时无法更新，请检查图片与刀线。");
        this.canvas.dataset.updating = "false";
        this.reportError(this.buildError.message);
      }
    }
  }

  private makeGuides(project: Project) {
    if (this.guides) {
      this.scene.remove(this.guides);
      disposeObject(this.guides);
    }
    const group = new THREE.Group();
    const outline = productShape(project).getPoints(80);
    for (const [scale, color] of [[1, "#ce8551"]] as const) {
      const geometry = new THREE.BufferGeometry().setFromPoints(
        outline.map(
          (point) =>
            new THREE.Vector3(
              point.x * scale,
              point.y * scale,
              project.thickness / 2 +
                project.width * (project.product === "badge" ? 0.014 : 0.002) +
                0.12,
            ),
        ),
      );
      const line = new THREE.Line(
        geometry,
        new THREE.LineDashedMaterial({
          color,
          dashSize: this.size * 0.014,
          gapSize: this.size * 0.012,
          depthTest: false,
          transparent: true,
          opacity: 0.85,
        }),
      );
      line.computeLineDistances();
      line.renderOrder = 5;
      group.add(line);
    }
    group.visible = this.guideVisible;
    this.guides = group;
    this.scene.add(group);
  }

  private resize = () => {
    if (this.disposed) return;
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? this.canvas.clientWidth),
      height = Math.max(1, parent?.clientHeight ?? this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  };

  private visibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.previousTime = 0;
    } else this.invalidate();
  };
  private lost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.canvas.dataset.ready = "false";
    this.reportError(
      "显卡预览已暂停，正在等待浏览器恢复。当前项目与原图不会被清除，可继续编辑或备份。",
    );
  };
  private restored = () => {
    this.contextLost = false;
    // Render-target pixels cannot survive context loss; regenerate the local studio lighting before resuming.
    this.environment.dispose();
    this.environment = studioEnvironment(this.renderer);
    this.scene.environment = this.environment.texture;
    this.notifyReady = true;
    this.invalidate();
  };

  private invalidate = () => {
    if (this.frame || this.disposed || this.contextLost || document.hidden)
      return;
    this.frame = requestAnimationFrame(this.render);
  };

  private render = (time: number) => {
    this.frame = 0;
    if (this.disposed || this.contextLost || document.hidden) return;
    const delta = this.previousTime
      ? Math.min((time - this.previousTime) / 1000, 0.05)
      : 1 / 60;
    this.previousTime = time;
    const changed = this.controls.update(delta);
    this.shadow.position
      .copy(this.camera.position)
      .sub(this.controls.target)
      .normalize()
      .multiplyScalar(-this.size * 0.14);
    this.shadow.quaternion.copy(this.camera.quaternion);
    fitCameraClipping(this.camera, this.modelBounds);
    try {
      this.renderer.render(this.scene, this.camera);
      this.canvas.dataset.frames = String(++this.frames);
      this.canvas.dataset.textures = String(this.renderer.info.memory.textures);
      this.canvas.dataset.geometries = String(
        this.renderer.info.memory.geometries,
      );
      if (this.ready && !this.buildError) {
        const first = this.canvas.dataset.ready !== "true";
        this.canvas.dataset.ready = "true";
        if (first || this.notifyReady) {
          this.notifyReady = false;
          this.reportReady();
        }
      }
    } catch {
      this.reportError("3D 预览未能绘制，请尝试降低预览质量或重新打开应用。");
      return;
    }
    if (changed || this.controls.autoRotate) this.invalidate();
  };

  setView(view: "front" | "back" | "perspective") {
    const current = this.camera.position.distanceTo(this.controls.target);
    this.controls.target.set(0, 0, 0);
    if (view === "perspective")
      this.camera.position.set(current * 0.43, current * 0.22, current * 0.875);
    else this.camera.position.set(0, 0, current * (view === "back" ? -1 : 1));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
    this.invalidate();
  }
  zoom(delta: number) {
    const vector = this.camera.position.clone().sub(this.controls.target);
    const distance = THREE.MathUtils.clamp(
      vector.length() * Math.exp(-delta * 0.18),
      this.controls.minDistance,
      this.controls.maxDistance,
    );
    this.camera.position
      .copy(this.controls.target)
      .add(vector.setLength(distance));
    this.controls.update();
    this.invalidate();
  }
  reset() {
    const distance = this.fittedDistance();
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(
      distance * 0.43,
      distance * 0.22,
      distance * 0.875,
    );
    this.camera.up.set(0, 1, 0);
    this.controls.update();
    this.invalidate();
  }
  private fittedDistance() {
    const width = this.latest?.width ?? this.size,
      height = this.latest?.height ?? this.size;
    const fit = Math.max(height, width / Math.max(this.camera.aspect, 0.3));
    return (
      (fit / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)))) *
      1.44
    );
  }
  async exportPng(): Promise<Blob> {
    let work: Promise<void>;
    do {
      work = this.pending;
      await work;
    } while (work !== this.pending);
    if (!this.ready || this.contextLost || this.disposed || this.buildError)
      throw (
        this.buildError ?? new Error("预览还未准备好，请等待画面出现后再导出。")
      );
    fitCameraClipping(this.camera, this.modelBounds);
    this.renderer.render(this.scene, this.camera);
    return new Promise((resolve, reject) =>
      this.canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("效果图导出失败，请重试。")),
        "image/png",
      ),
    );
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    this.buildController?.abort();
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    document.removeEventListener("visibilitychange", this.visibility);
    this.canvas.removeEventListener("webglcontextlost", this.lost);
    this.canvas.removeEventListener("webglcontextrestored", this.restored);
    this.controls.removeEventListener("change", this.invalidate);
    this.controls.dispose();
    if (this.model) disposeObject(this.model);
    if (this.guides) disposeObject(this.guides);
    disposeObject(this.shadow);
    this.key.shadow.dispose();
    this.environment.dispose();
    this.images.clear();
    this.renderer.dispose();
  }
}

const Preview = forwardRef<PreviewHandle, PreviewProps>(
  function Preview(props, ref) {
    const canvas = useRef<HTMLCanvasElement>(null),
      runtime = useRef<PreviewRuntime | null>(null);
    const callbacks = useRef(props);
    callbacks.current = props;
    const [error, setError] = useState<string>();
    useImperativeHandle(
      ref,
      () => ({
        setView: (view) => runtime.current?.setView(view),
        zoom: (delta) => runtime.current?.zoom(delta),
        reset: () => runtime.current?.reset(),
        exportPng: () =>
          runtime.current?.exportPng() ??
          Promise.reject(new Error("当前设备无法导出 3D 预览。")),
      }),
      [],
    );
    useEffect(() => {
      if (!canvas.current) return;
      try {
        runtime.current = new PreviewRuntime(
          canvas.current,
          (message) => {
            setError(message);
            callbacks.current.onError?.(message);
          },
          () => {
            setError(undefined);
            callbacks.current.onReady?.();
          },
        );
      } catch {
        const message =
          "此浏览器暂时无法打开 3D 预览。请启用硬件加速或使用支持 WebGL 2 的浏览器；仍可编辑、保存和备份项目。";
        setError(message);
        callbacks.current.onError?.(message);
      }
      return () => {
        runtime.current?.dispose();
        runtime.current = null;
      };
    }, []);
    useEffect(() => {
      runtime.current?.update(
        props.project,
        props.assetUrls,
        props.showGuides,
        props.autoRotate,
      );
    }, [props.project, props.assetUrls, props.showGuides, props.autoRotate]);
    return (
      <>
        <canvas
          ref={canvas}
          className="preview-canvas"
          data-ready="false"
          data-frames="0"
          aria-label="制品三维预览，可拖动旋转并滚轮缩放"
        />
        {error && !props.onError && (
          <div className="preview-error" role="status">
            <strong>预览需要处理</strong>
            <p>{error}</p>
          </div>
        )}
      </>
    );
  },
);

export default Preview;
