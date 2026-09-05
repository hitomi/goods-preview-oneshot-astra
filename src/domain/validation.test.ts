import { describe, expect, it } from "vitest";
import {
  createLayer,
  createProject,
  isLayerSupported,
  PRODUCTS,
} from "./catalog";
import { productionIssues, validateProject } from "./validation";

describe("project validation and compatibility", () => {
  it("accepts usable defaults for every product", () => {
    for (const product of Object.keys(PRODUCTS) as (keyof typeof PRODUCTS)[])
      expect(validateProject(createProject(product)).product).toBe(product);
  });
  it("retains temporarily incompatible layers after a product switch", () => {
    const project = createProject("paper");
    const emboss = createLayer("emboss");
    project.layers.push(emboss);
    project.product = "acrylic";
    project.substrate = "clear";
    const validated = validateProject(project);
    expect(validated.layers).toContainEqual(emboss);
    expect(isLayerSupported("acrylic", "emboss")).toBe(false);
    expect(
      productionIssues(project, []).some(
        (issue) => issue.layerId === emboss.id && issue.severity === "error",
      ),
    ).toBe(true);
    expect(isLayerSupported("paper", "white", "back")).toBe(true);
    expect(isLayerSupported("badge", "print", "back")).toBe(false);
  });
  it("rejects unbounded numeric values, unknown content and dangling asset references", () => {
    const project = createProject();
    expect(() => validateProject({ ...project, width: Infinity })).toThrow(
      "宽度",
    );
    expect(() =>
      validateProject({
        ...project,
        scene: { ...project.scene, background: "url(https://example.com)" },
      }),
    ).toThrow("背景");
    expect(() =>
      validateProject({ ...project, externalTexture: "https://example.com" }),
    ).toThrow("未知");
    expect(() =>
      validateProject({
        ...project,
        layers: [{ ...project.layers[0], assetId: "missing" }],
      }),
    ).toThrow("未包含");
    expect(() => validateProject({ ...project, version: 2 })).toThrow("版本");
  });
  it("validates custom cutlines before accepting a backup", () => {
    const project = { ...createProject("acrylic"), shape: "custom" };
    expect(() => validateProject(project)).toThrow("刀线");
    expect(() =>
      validateProject({
        ...project,
        cutline: "<svg><script>alert(1)</script></svg>",
      }),
    ).toThrow();
    expect(
      validateProject({
        ...project,
        cutline: '<svg viewBox="0 0 10 10"><path d="M0 0L10 0L10 10Z"/></svg>',
      }).shape,
    ).toBe("custom");
  });
  it("returns detached data and flags missing white ink without blocking intentional transparency", () => {
    const project = createProject("acrylic");
    const copy = validateProject(project);
    copy.layers[0].name = "changed";
    expect(project.layers[0].name).not.toBe("changed");
    expect(
      productionIssues(project, []).find(
        (issue) => issue.id === "acrylic-white",
      )?.severity,
    ).toBe("warning");
    project.layers.push(createLayer("white"));
    expect(
      productionIssues(project, []).some(
        (issue) => issue.id === "acrylic-white",
      ),
    ).toBe(false);
  });
  it("estimates density using the same aspect-preserving fit as the renderer", () => {
    const project = createProject("paper");
    project.width = 50.8;
    project.height = 101.6;
    project.assetIds = ["art"];
    project.layers[0].assetId = "art";
    const asset = {
      id: "art",
      name: "square.png",
      mime: "image/png",
      width: 1000,
      height: 1000,
      hasAlpha: false,
      original: new Blob(),
      preview: new Blob(),
      createdAt: 0,
    };
    expect(
      productionIssues(project, [asset]).some((issue) =>
        issue.id.startsWith("dpi-"),
      ),
    ).toBe(false);
    project.layers[0].scale = 2;
    expect(
      productionIssues(project, [asset]).find((issue) =>
        issue.id.startsWith("dpi-"),
      )?.title,
    ).toContain("250 DPI");
  });
});
