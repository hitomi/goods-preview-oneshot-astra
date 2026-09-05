import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

type Upload = { name: string; mimeType: string; buffer: Buffer };
type Outline = "closed" | "open" | "multiple";

async function outlineImage(
  page: Page,
  name: string,
  options: {
    color?: "red" | "dark";
    shape?: Outline;
    transparent?: boolean;
    jpeg?: boolean;
  } = {},
): Promise<Upload> {
  const mimeType = options.jpeg ? "image/jpeg" : "image/png";
  const encoded = await page.evaluate(
    ({ color, shape, transparent, mime }) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 320;
      const context = canvas.getContext("2d")!;
      if (!transparent) {
        context.fillStyle = "white";
        context.fillRect(0, 0, 320, 320);
      }
      context.strokeStyle = color === "dark" ? "#111111" : "#e32232";
      context.lineWidth = 4;
      context.lineJoin = "round";
      if (shape === "multiple") {
        context.strokeRect(30, 45, 100, 220);
        context.strokeRect(185, 45, 100, 220);
      } else {
        // The notch must survive vectorization; a bounding box or convex hull is wrong.
        context.beginPath();
        context.moveTo(45, 45);
        context.lineTo(270, 45);
        context.lineTo(270, 270);
        context.lineTo(170, 270);
        context.lineTo(170, 170);
        context.lineTo(45, 170);
        if (shape === "open") context.lineTo(45, 75);
        else context.closePath();
        context.stroke();
      }
      return canvas.toDataURL(mime, 0.95).split(",")[1];
    },
    {
      color: options.color ?? "red",
      shape: options.shape ?? "closed",
      transparent: options.transparent ?? false,
      mime: mimeType,
    },
  );
  return { name, mimeType, buffer: Buffer.from(encoded, "base64") };
}

async function printImage(page: Page): Promise<Upload> {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 320;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#285748";
    context.fillRect(0, 0, 320, 320);
    context.fillStyle = "#e2b865";
    context.fillRect(55, 65, 200, 150);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  return {
    name: "凹形彩印.png",
    mimeType: "image/png",
    buffer: Buffer.from(encoded, "base64"),
  };
}

async function saved(page: Page) {
  await expect(
    page.getByRole("status").filter({ hasText: "已保存在本机" }),
  ).toBeVisible();
}

async function ready(page: Page) {
  await expect(page.locator("canvas.preview-canvas")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 60_000 },
  );
  await expect(page.locator("canvas.preview-canvas")).toHaveAttribute(
    "data-updating",
    "false",
  );
  await saved(page);
}

async function openPaper(page: Page) {
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "纸品", exact: true }).click();
  await saved(page);
}

async function openCutline(page: Page, file: Upload) {
  await page
    .getByRole("button", { name: /^(导入刀线图片 \/ SVG|替换刀线)$/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "把轮廓变成制品外形" });
  await dialog.getByLabel("选择批量图片").setInputFiles(file);
  await expect(dialog.getByLabel(`${file.name} 的用途`)).toHaveValue("cutline");
  return dialog;
}

async function recognized(dialog: Locator, name: string) {
  const trace = dialog.getByRole("region", { name: `${name} 的刀线识别` });
  await expect(trace.getByRole("status")).toContainText("已识别 1 条闭合轮廓");
  await expect(
    trace.getByRole("img", { name: "识别的矢量轮廓" }),
  ).toBeVisible();
  return trace;
}

async function downloadText(page: Page, button: Locator) {
  const downloading = page.waitForEvent("download");
  await button.click();
  const download = await downloading;
  return {
    text: await readFile((await download.path())!, "utf8"),
    filename: download.suggestedFilename(),
  };
}

test("红色 JPEG 刀线与彩印批量导入，保留凹口、原图及 SVG，刷新和备份回导一致", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openPaper(page);
  const print = await printImage(page);
  const outline = await outlineImage(page, "凹形红线.jpg", { jpeg: true });
  await page.getByLabel("项目名称", { exact: true }).fill("图片刀线回归");
  await page.getByRole("button", { name: "批量导入图片" }).click();
  const dialog = page.getByRole("dialog", { name: "一次导入，逐张安排" });
  await dialog.getByLabel("选择批量图片").setInputFiles([print, outline]);
  await dialog.getByLabel(`${print.name} 的用途`).selectOption("print-front");
  await dialog.getByLabel(`${outline.name} 的用途`).selectOption("cutline");
  await expect(
    dialog
      .getByLabel(`${print.name} 的用途`)
      .locator('option[value="cutline"]'),
  ).toBeDisabled();
  const trace = await recognized(dialog, outline.name);
  await trace.getByRole("button", { name: "放大核对刀线" }).click();
  const inspection = page.getByRole("dialog", {
    name: "核对刀线轮廓",
    exact: true,
  });
  await expect(inspection).toBeVisible();
  await inspection.getByRole("slider", { name: "刀线查看比例" }).focus();
  await page.keyboard.press("End");
  await expect(
    inspection.getByRole("slider", { name: "刀线查看比例" }),
  ).toHaveValue("4");
  await inspection
    .getByRole("button", { name: "返回导入", exact: true })
    .click();
  await expect(inspection).not.toBeVisible();
  await expect(dialog.getByLabel(`${print.name} 的用途`)).toHaveValue(
    "print-front",
  );
  await expect(dialog.getByLabel(`${outline.name} 的用途`)).toHaveValue(
    "cutline",
  );
  const vector = await downloadText(
    page,
    trace.getByRole("button", { name: "下载识别的 SVG" }),
  );
  expect(vector.filename).toBe("凹形红线-刀线.svg");
  const geometry = await page.evaluate((svg) => {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const polygon = doc.querySelector("polygon");
    const points = (polygon?.getAttribute("points") ?? "")
      .trim()
      .split(/\s+/)
      .map((pair) => pair.split(",").map(Number));
    const turns = points.map((point, i) => {
      const next = points[(i + 1) % points.length];
      const after = points[(i + 2) % points.length];
      return Math.sign(
        (next[0] - point[0]) * (after[1] - next[1]) -
          (next[1] - point[1]) * (after[0] - next[0]),
      );
    });
    return {
      error: !!doc.querySelector("parsererror"),
      polygons: doc.querySelectorAll("polygon").length,
      points: points.length,
      concave: turns.includes(1) && turns.includes(-1),
    };
  }, vector.text);
  expect(geometry).toMatchObject({ error: false, polygons: 1, concave: true });
  expect(geometry.points).toBeGreaterThanOrEqual(6);
  await page.screenshot({
    path: "docs/verification/raster-cutline-recognition.png",
  });
  await dialog
    .getByRole("button", { name: "导入 2 张图片", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await ready(page);
  await expect(page.getByLabel("制品外形")).toHaveValue("custom");
  await expect(
    page.getByRole("button", { name: "编辑图层 凹形彩印", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^编辑图层 / })).toHaveCount(1);
  await page.reload();
  await ready(page);
  await expect(page.getByLabel("制品外形")).toHaveValue("custom");
  const current = await downloadText(
    page,
    page.getByRole("button", { name: "下载当前刀线 SVG" }),
  );
  expect(current.text).toBe(vector.text);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载项目", exact: true }).click();
  const backupPath = testInfo.outputPath("raster-cutline.goods.json");
  await (await downloading).saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, "utf8"));
  expect(backup.project.cutline).toBe(vector.text);
  expect(backup.assets).toHaveLength(2);
  for (const original of [print, outline]) {
    const asset = backup.assets.find(
      (entry: { name: string }) => entry.name === original.name,
    );
    expect(asset).toBeDefined();
    expect(Buffer.from(asset.original, "base64")).toEqual(original.buffer);
  }
  const sourceUrl = page.url();
  await page.getByRole("button", { name: "项目库", exact: true }).click();
  await page
    .getByLabel("导入项目备份", { exact: true })
    .setInputFiles(backupPath);
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue(
    "图片刀线回归 · 副本",
  );
  expect(page.url()).not.toBe(sourceUrl);
  await ready(page);
  await expect(page.getByLabel("制品外形")).toHaveValue("custom");
  const restored = await downloadText(
    page,
    page.getByRole("button", { name: "下载当前刀线 SVG" }),
  );
  expect(restored.text).toBe(vector.text);
  expect(errors).toEqual([]);
});

test("开口和多轮廓保留待导入图片，颜色切换可恢复，取消不应用过时识别", async ({
  page,
}) => {
  await openPaper(page);
  const initialShape = await page.getByLabel("制品外形").inputValue();
  const open = await outlineImage(page, "有断口.png", { shape: "open" });
  const multiple = await outlineImage(page, "两条轮廓.png", {
    shape: "multiple",
  });
  const valid = await outlineImage(page, "可恢复的红线.png");
  const dialog = await openCutline(page, open);
  await expect(dialog.getByRole("alert")).toContainText("闭合");
  await expect(
    dialog.getByRole("button", { name: "导入 1 张图片", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(`${open.name} 的用途`)).toHaveValue("cutline");
  await dialog.getByRole("button", { name: `移除 ${open.name}` }).click();
  await dialog.getByLabel("选择批量图片").setInputFiles(multiple);
  await expect(dialog.getByRole("alert")).toContainText(/多条|多个/);
  await expect(
    dialog.getByRole("button", { name: "导入 1 张图片", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: `移除 ${multiple.name}` }).click();
  await dialog.getByLabel("选择批量图片").setInputFiles(valid);
  await recognized(dialog, valid.name);
  await dialog.getByLabel(`${valid.name} 的刀线颜色`).selectOption("dark");
  await expect(dialog.getByRole("alert")).toContainText("黑色");
  await expect(
    dialog.getByRole("button", { name: "导入 1 张图片", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel(`${valid.name} 的刀线颜色`).selectOption("red");
  await recognized(dialog, valid.name);
  await expect(
    dialog.getByRole("button", { name: "导入 1 张图片", exact: true }),
  ).toBeEnabled();
  // Start another interpretation, then leave before it can become authoritative.
  await dialog.getByLabel(`${valid.name} 的刀线颜色`).selectOption("auto");
  await dialog.getByRole("button", { name: "取消导入" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel("制品外形")).toHaveValue(initialShape);
  await page.reload();
  await ready(page);
  await expect(page.getByLabel("制品外形")).toHaveValue(initialShape);
  const retried = await openCutline(page, valid);
  await recognized(retried, valid.name);
  await retried
    .getByRole("button", { name: "导入 1 张图片", exact: true })
    .click();
  await expect(retried).not.toBeVisible();
  await saved(page);
  await expect(page.getByLabel("制品外形")).toHaveValue("custom");
});

test("离线冷启动后首次图片刀线识别可运行，透明黑线在重开项目后保留", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openPaper(page);
  const outline = await outlineImage(page, "透明背景黑刀线.png", {
    color: "dark",
    transparent: true,
  });
  await page.getByLabel("项目名称", { exact: true }).fill("离线刀线项目");
  await saved(page);
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
  const dialog = await openCutline(page, outline);
  await recognized(dialog, outline.name);
  await dialog
    .getByRole("button", { name: "导入 1 张图片", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await ready(page);
  const savedVector = await downloadText(
    page,
    page.getByRole("button", { name: "下载当前刀线 SVG" }),
  );
  await page.close();
  const reopened = await context.newPage();
  reopened.on("pageerror", (error) => errors.push(error.message));
  await reopened.goto(path);
  await ready(reopened);
  await expect(reopened.getByLabel("项目名称", { exact: true })).toHaveValue(
    "离线刀线项目",
  );
  await expect(reopened.getByLabel("制品外形")).toHaveValue("custom");
  const restoredVector = await downloadText(
    reopened,
    reopened.getByRole("button", { name: "下载当前刀线 SVG" }),
  );
  expect(restoredVector.text).toBe(savedVector.text);
  const backup = await downloadText(
    reopened,
    reopened.getByRole("button", { name: "下载项目", exact: true }),
  );
  expect(
    Buffer.from(JSON.parse(backup.text).assets[0].original, "base64"),
  ).toEqual(outline.buffer);
  expect(errors).toEqual([]);
});

test("390px 手机可以检查刀线识别并完成导入，弹窗和保存操作没有横向溢出", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "制品与图层", exact: true }).click();
  await page.getByRole("button", { name: "亚克力", exact: true }).click();
  const outline = await outlineImage(
    page,
    "手机端带有较长文件名称的凹形透明刀线.png",
    { transparent: true },
  );
  const dialog = await openCutline(page, outline);
  const trace = await recognized(dialog, outline.name);
  const color = trace.getByLabel(`${outline.name} 的刀线颜色`);
  await color.selectOption("red");
  await recognized(dialog, outline.name);
  for (const name of ["刀线原图", "识别的矢量轮廓"]) {
    const image = trace.getByRole("img", { name, exact: true });
    const geometry = await image.evaluate((element) => {
      const image = element.getBoundingClientRect();
      const frame = element.parentElement!.getBoundingClientRect();
      return {
        width: image.width,
        height: image.height,
        frameWidth: frame.width,
        frameHeight: frame.height,
      };
    });
    expect(geometry.width).toBeLessThanOrEqual(geometry.frameWidth);
    expect(geometry.height).toBeLessThanOrEqual(geometry.frameHeight);
  }
  await color.scrollIntoViewIfNeeded();
  const colorBox = await color.boundingBox();
  expect(colorBox!.x).toBeGreaterThanOrEqual(0);
  expect(colorBox!.x + colorBox!.width).toBeLessThanOrEqual(390);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const submit = dialog.getByRole("button", {
    name: "导入 1 张图片",
    exact: true,
  });
  await submit.scrollIntoViewIfNeeded();
  const submitBox = await submit.boundingBox();
  expect(submitBox!.x).toBeGreaterThanOrEqual(0);
  expect(submitBox!.x + submitBox!.width).toBeLessThanOrEqual(390);
  expect(submitBox!.y).toBeGreaterThanOrEqual(0);
  expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(844);
  await page.screenshot({
    path: "docs/verification/raster-cutline-mobile-390.png",
  });
  await submit.click();
  await expect(dialog).not.toBeVisible();
  await saved(page);
  await expect(page.getByLabel("制品外形")).toHaveValue("custom");
  await page.getByRole("button", { name: "关闭制品面板" }).click();
  await ready(page);
  await page.reload();
  await ready(page);
  await page.getByRole("button", { name: "制品与图层", exact: true }).click();
  await expect(page.getByLabel("制品外形")).toHaveValue("custom");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
