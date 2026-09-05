import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

async function ready(page: import("@playwright/test").Page) {
  await expect(page.locator("canvas.preview-canvas")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 60_000 },
  );
  await expect(page.locator("canvas.preview-canvas")).toHaveAttribute(
    "data-updating",
    "false",
  );
  await expect(page.getByText("已保存在本机", { exact: true })).toBeVisible();
}

test("three products, physical views, supported processes and real PNG export", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "背面", exact: true }).click();
  const backDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出效果图", exact: true }).click();
  const back = await readFile((await (await backDownload).path())!);
  expect(back.subarray(1, 4).toString()).toBe("PNG");
  expect(back.length).toBeGreaterThan(10_000);
  await page.getByRole("button", { name: "正面", exact: true }).click();
  const frontDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出效果图", exact: true }).click();
  const front = await readFile((await (await frontDownload).path())!);
  expect(createHash("sha256").update(front).digest("hex")).not.toBe(
    createHash("sha256").update(back).digest("hex"),
  );
  await page.getByRole("button", { name: "纸品", exact: true }).click();
  await page.getByLabel("宽度", { exact: true }).fill("125");
  await page.getByLabel("宽度", { exact: true }).press("Enter");
  await ready(page);
  await page.getByRole("button", { name: "添加图层 / 工艺" }).click();
  await page.getByRole("button", { name: /压凸 纸张表面压凸/ }).click();
  await expect(page.getByLabel("图层名称")).toHaveValue("正面压凸");
  await page.getByRole("button", { name: "亚克力", exact: true }).click();
  await ready(page);
  await expect(
    page.getByText("这个工艺不适用于当前制品", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "添加图层 / 工艺" }).click();
  await expect(
    page.getByRole("button", { name: /压凸 当前制品不适用/ }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /白墨 给透明/ }).click();
  await page.getByRole("tab", { name: "制作检查" }).click();
  await expect(page.getByText("透明板材上尚未设置白墨")).toHaveCount(0);
  await page.getByRole("button", { name: "暗色展台", exact: true }).click();
  await page.getByRole("button", { name: "纸品", exact: true }).click();
  await ready(page);
  await expect(
    page.getByRole("button", { name: "编辑图层 正面压凸" }),
  ).toBeVisible();
  await page.reload();
  await ready(page);
  await expect(
    page.getByRole("button", { name: "纸品", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("production PWA reloads offline with no external runtime resources", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const external: string[] = [];
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).origin !== origin
    )
      external.push(request.url());
  });
  await page.goto("/");
  await ready(page);
  await expect(page.getByText("可离线使用", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const path = new URL(page.url()).pathname;
  await context.setOffline(true);
  await page.reload();
  await ready(page);
  await expect(page.getByText("正在离线使用", { exact: true })).toBeVisible();
  await page.getByLabel("项目名称", { exact: true }).fill("断网后继续设计");
  await page.getByRole("button", { name: "暖光桌面", exact: true }).click();
  await ready(page);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(path);
  await ready(reopened);
  await expect(reopened.getByLabel("项目名称", { exact: true })).toHaveValue(
    "断网后继续设计",
  );
  await expect(
    reopened.getByRole("button", { name: "暖光桌面", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const downloaded = reopened.waitForEvent("download");
  await reopened
    .getByRole("button", { name: "导出效果图", exact: true })
    .click();
  expect(
    (await readFile((await (await downloaded).path())!)).length,
  ).toBeGreaterThan(10_000);
  expect(external).toEqual([]);
});

test("single closed SVG changes geometry; invalid cutline keeps batch input", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "亚克力", exact: true }).click();
  await page.getByRole("button", { name: "批量导入图片" }).click();
  const cutline =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 5 C95 25 95 75 50 95 C5 75 5 25 50 5 Z"/></svg>';
  await page
    .getByLabel("选择批量图片")
    .setInputFiles({
      name: "leaf.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(cutline),
    });
  await page.getByLabel("leaf.svg 的用途").selectOption("cutline");
  await page
    .getByRole("button", { name: "导入 1 张图片", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await ready(page);
  await expect(page.getByLabel("制品外形")).toHaveValue("custom");
  await page.reload();
  await ready(page);
  await expect(page.getByLabel("制品外形")).toHaveValue("custom");
  await page.getByRole("button", { name: "批量导入图片" }).click();
  await page
    .getByLabel("选择批量图片")
    .setInputFiles({
      name: "open.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 10 L90 90 L10 90"/></svg>',
      ),
    });
  await page.getByLabel("open.svg 的用途").selectOption("cutline");
  await page
    .getByRole("button", { name: "导入 1 张图片", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("闭合");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("open.svg", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "取消导入" }).click();
  await expect(page.getByLabel("制品外形")).toHaveValue("custom");
});

test("stationary rendering stops; controls resume; reduced motion does not auto-rotate", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await ready(page);
  const canvas = page.locator("canvas.preview-canvas");
  const measurement = await canvas.evaluate(async (element) => {
    const before = Number(element.getAttribute("data-frames"));
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { before, after: Number(element.getAttribute("data-frames")) };
  });
  expect(measurement.after - measurement.before).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "放大样机" }).click();
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-frames")))
    .toBeGreaterThan(measurement.after);
  await expect(
    page.getByRole("button", { name: "自动旋转样机" }),
  ).toHaveAttribute("aria-pressed", "false");
});

test("wide workspaces and mobile editing remain accessible without overflow", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  for (const width of [1440, 1920, 2560, 3840]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(
      page.getByRole("button", { name: "导出效果图", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const box = await page.locator("canvas.preview-canvas").boundingBox();
    expect(box!.width).toBeGreaterThan(width - 800);
    if (width === 1440)
      await page.screenshot({ path: "docs/verification/desktop-1440.png" });
    if (width === 3840)
      await page.screenshot({ path: "docs/verification/desktop-3840.png" });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "制品与图层", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "制品与图层", exact: true }).click();
  await page.getByRole("button", { name: "纸品", exact: true }).click();
  await page.getByLabel("宽度", { exact: true }).fill("127");
  await page.getByLabel("宽度", { exact: true }).press("Enter");
  await page.getByRole("button", { name: "关闭制品面板" }).click();
  await ready(page);
  await page.getByRole("button", { name: "属性与灯光" }).click();
  await page.getByRole("tab", { name: "灯光", exact: true }).click();
  await page.getByRole("combobox", { name: "场景预设", exact: true }).selectOption("daylight");
  await page.getByRole("button", { name: "关闭属性面板" }).click();
  await ready(page);
  await page.screenshot({ path: "docs/verification/mobile-390.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await ready(page);
  await page.getByRole("button", { name: "制品与图层", exact: true }).click();
  await expect(page.getByLabel("宽度", { exact: true })).toHaveValue("127");
});

test("WebGL unavailable preserves edit and backup recovery", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...args: unknown[]
    ) {
      if (kind === "webgl" || kind === "webgl2") return null;
      return original.apply(this, [kind, ...args] as never);
    } as typeof original;
  });
  await page.goto("/");
  await expect(page.getByText("暂时无法显示三维画面")).toBeVisible();
  await page.getByLabel("项目名称", { exact: true }).fill("设备不支持时仍保存");
  await expect(page.getByText("已保存在本机", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "导出效果图", exact: true }),
  ).toBeDisabled();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载项目", exact: true }).click();
  const content = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(content.project.name).toBe("设备不支持时仍保存");
});
