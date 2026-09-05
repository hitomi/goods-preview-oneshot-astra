import { describe, expect, it } from "vitest";
import {
  BADGE_SHAPES,
  equalDimensions,
  isBadgeShape,
  isBadgeStandardSize,
  type BadgeShape,
} from "./badges";
import { createProject } from "./catalog";
import { productionIssues, validateProject } from "./validation";

describe("badge mould shapes and dimensions", () => {
  it("accepts every listed mould and both orientations of elongated presets", () => {
    for (const shape of Object.keys(BADGE_SHAPES) as BadgeShape[]) {
      const spec = BADGE_SHAPES[shape];
      expect(isBadgeShape(shape)).toBe(true);
      expect(
        isBadgeStandardSize(shape, spec.defaultWidth, spec.defaultHeight),
      ).toBe(true);
      for (const preset of spec.presets) {
        const project = {
          ...createProject("badge"),
          shape,
          width: preset.width,
          height: preset.height,
        };
        expect(validateProject(project)).toEqual(project);
        expect(
          productionIssues(project, []).some(
            (issue) => issue.id === "badge-shape" || issue.id === "badge-size",
          ),
        ).toBe(false);
        expect(preset.source.url).toMatch(/^https:\/\//);
      }
    }
    expect(isBadgeStandardSize("oval", 45, 70)).toBe(true);
    expect(isBadgeStandardSize("rectangle", 44, 70)).toBe(true);
    expect(isBadgeStandardSize("rectangle", 51, 76)).toBe(true);
  });

  it("requires equal sides only for the badge shapes that have that contract", () => {
    for (const shape of ["circle", "rounded", "star"] as const) {
      expect(equalDimensions(shape)).toBe(true);
      const project = {
        ...createProject("badge"),
        shape,
        width: 60,
        height: 50,
      };
      expect(() => validateProject(project)).toThrow("宽高需要一致");
      expect(
        productionIssues(project, []).find(
          (issue) => issue.id === "badge-shape",
        )?.severity,
      ).toBe("error");
    }
    for (const shape of ["oval", "rectangle", "heart"] as const) {
      expect(equalDimensions(shape)).toBe(false);
      expect(
        validateProject({
          ...createProject("badge"),
          shape,
          width: 60,
          height: 50,
        }).shape,
      ).toBe(shape);
    }
    expect(
      validateProject({
        ...createProject("paper"),
        shape: "rounded",
        width: 60,
        height: 50,
      }).height,
    ).toBe(50);
  });

  it("preserves legacy version-one projects and warns about unsampled sizes without rejecting", () => {
    for (const dimension of [5, 58, 500]) {
      const legacy = {
        ...createProject("badge"),
        width: dimension,
        height: dimension,
      };
      const restored = validateProject(legacy);
      expect(restored.version).toBe(1);
      expect(restored.width).toBe(dimension);
      expect(restored.height).toBe(dimension);
      expect(
        productionIssues(restored, []).find(
          (issue) => issue.id === "badge-size",
        )?.severity,
      ).toBe("warning");
      expect(
        productionIssues(restored, []).some(
          (issue) => issue.severity === "error",
        ),
      ).toBe(false);
    }
    const unusual = {
      ...createProject("badge"),
      shape: "heart" as const,
      width: 73.5,
      height: 62,
    };
    expect(validateProject(unusual)).toEqual(unusual);
    expect(
      productionIssues(unusual, []).find((issue) => issue.id === "badge-size")
        ?.detail,
    ).toContain("可以继续预览");
  });

  it("preserves hidden cutlines, original asset references, and temporarily unsupported layers", () => {
    const paper = createProject("paper");
    paper.assetIds = ["original-art"];
    paper.layers[0].assetId = "original-art";
    paper.layers[0].side = "back";
    paper.cutline =
      '<svg viewBox="0 0 10 10"><polygon points="0,0 10,0 10,10 0,10"/></svg>';
    const badge = {
      ...paper,
      product: "badge",
      shape: "heart",
      width: 57,
      height: 52,
    };
    const restored = validateProject(badge);
    expect(restored.assetIds).toEqual(paper.assetIds);
    expect(restored.layers).toEqual(paper.layers);
    expect(restored.cutline).toBe(paper.cutline);
    expect(restored.layers).not.toBe(paper.layers);
  });

  it("rejects custom badge die lines and badge-only forms in paper or acrylic", () => {
    const cutline =
      '<svg viewBox="0 0 10 10"><polygon points="0,0 10,0 10,10 0,10"/></svg>';
    expect(() =>
      validateProject({ ...createProject("badge"), shape: "custom", cutline }),
    ).toThrow("自定义刀线");
    for (const product of ["paper", "acrylic"] as const) {
      for (const shape of ["oval", "heart", "star"] as const) {
        const project = { ...createProject(product), shape };
        expect(() => validateProject(project)).toThrow("当前制品形状");
        expect(
          productionIssues(project, []).find(
            (issue) => issue.id === "product-shape",
          )?.severity,
        ).toBe("error");
      }
      expect(
        validateProject({ ...createProject(product), shape: "custom", cutline })
          .cutline,
      ).toBe(cutline);
    }
  });

  it("rejects unknown shape keys and invalid dimensions instead of guessing a mould", () => {
    for (const shape of [
      "custom",
      "constructor",
      "toString",
      "diamond",
      null,
      5,
    ]) {
      expect(isBadgeShape(shape)).toBe(false);
      expect(() =>
        validateProject({ ...createProject("badge"), shape }),
      ).toThrow();
    }
    expect(isBadgeStandardSize("custom", 57, 57)).toBe(false);
    expect(isBadgeStandardSize("circle", 57, Number.NaN)).toBe(false);
    expect(isBadgeStandardSize("circle", 57.1, 57.1)).toBe(false);
    expect(() =>
      validateProject({ ...createProject("badge"), shape: "oval", width: 501 }),
    ).toThrow("宽度");
    expect(() =>
      validateProject({
        ...createProject("badge"),
        shape: "oval",
        height: Number.NaN,
      }),
    ).toThrow("高度");
  });
});
