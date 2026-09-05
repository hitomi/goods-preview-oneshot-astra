import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

async function ready(page: Page) {
  await expect(page.getByText("已保存在本机", { exact: true })).toBeVisible();
  await expect(page.locator("canvas.preview-canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.locator("canvas.preview-canvas")).toHaveAttribute(
    "data-updating",
    "false",
  );
}

async function exportImage(page: Page) {
  await ready(page);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出效果图", exact: true }).click();
  return (await readFile((await (await downloading).path())!)).toString(
    "base64",
  );
}

async function rectangleCoverage(page: Page, png: string) {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    const w = (canvas.width = image.width),
      h = (canvas.height = image.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, w, h).data;
    let left = w,
      right = 0,
      top = h,
      bottom = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (
          Math.abs(data[i] - data[0]) +
            Math.abs(data[i + 1] - data[1]) +
            Math.abs(data[i + 2] - data[2]) >
          80
        ) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    let colored = 0,
      total = 0;
    for (let y = top + 5; y <= bottom - 5; y++)
      for (let x = left + 5; x <= right - 5; x++) {
        const i = (y * w + x) * 4;
        if (
          Math.max(data[i], data[i + 1], data[i + 2]) -
            Math.min(data[i], data[i + 1], data[i + 2]) >
          60
        )
          colored++;
        total++;
      }
    const sample = (fraction: number) => {
      const i =
        (Math.round((top + bottom) / 2) * w +
          Math.round(left + (right - left) * fraction)) *
        4;
      return [...data.slice(i, i + 3)];
    };
    return {
      coloredFraction: colored / total,
      total,
      left: sample(0.25),
      right: sample(0.75),
    };
  }, png);
}

test("thin rectangular paper and double-sided acrylic cover both complete print faces", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "纸品", exact: true }).click();
  await page.getByLabel("制品外形").selectOption("rectangle");
  await page.getByRole("button", { name: "暗色展台", exact: true }).click();
  await page.getByRole("button", { name: "批量导入图片" }).click();
  const files = [
    ["front.svg", "#bf2509", "#123ec4"],
    ["back.svg", "#008f29", "#b700a4"],
  ].map(([name, left, right]) => ({
    name,
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="70" height="210"><rect width="70" height="210" fill="${left}"/><rect x="35" width="35" height="210" fill="${right}"/></svg>`,
    ),
  }));
  await page.getByLabel("选择批量图片").setInputFiles(files);
  await page.getByLabel("front.svg 的用途").selectOption("print-front");
  await page.getByLabel("back.svg 的用途").selectOption("print-back");
  await page
    .getByRole("button", { name: "导入 2 张图片", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const [width, height, thickness] of [
    [70, 210, 0.4],
    [5, 15, 0.05],
  ]) {
    for (const [label, value] of [
      ["宽度", width],
      ["高度", height],
      ["厚度", thickness],
    ] as const) {
      await page.getByLabel(label, { exact: true }).fill(String(value));
      await page.getByLabel(label, { exact: true }).press("Enter");
    }
    await ready(page);
    await page.getByRole("button", { name: "复位视角", exact: true }).click();
    await page.getByRole("button", { name: "正面", exact: true }).click();
    const front = await rectangleCoverage(page, await exportImage(page));
    expect(front.total).toBeGreaterThan(10_000);
    expect(front.coloredFraction).toBeGreaterThan(0.98);
    expect(front.left[0]).toBeGreaterThan(front.left[2] + 60);
    expect(front.right[2]).toBeGreaterThan(front.right[0] + 60);
    await page.getByRole("button", { name: "背面", exact: true }).click();
    const back = await rectangleCoverage(page, await exportImage(page));
    expect(back.coloredFraction).toBeGreaterThan(0.98);
    expect(back.left[1]).toBeGreaterThan(back.left[0] + 50);
    expect(back.right[0]).toBeGreaterThan(back.right[1] + 50);
    if (width === 70) {
      await page.getByRole("button", { name: "立体", exact: true }).click();
      await writeFile(
        "docs/verification/paper-rectangle-fixed.png",
        Buffer.from(await exportImage(page), "base64"),
      );
    }
  }
  await page.reload();
  await ready(page);
  await expect(page.getByLabel("厚度", { exact: true })).toHaveValue("0.05");
  await expect(page.getByLabel("制品外形")).toHaveValue("rectangle");
  await page.getByRole("button", { name: "亚克力", exact: true }).click();
  await page.getByLabel("制品外形").selectOption("rectangle");
  for (const [label, value] of [
    ["宽度", "70"],
    ["高度", "210"],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).press("Enter");
  }
  await ready(page);
  await page.getByRole("button", { name: "复位视角", exact: true }).click();
  await page.getByRole("button", { name: "正面", exact: true }).click();
  const acrylicFront = await rectangleCoverage(page, await exportImage(page));
  expect(acrylicFront.coloredFraction).toBeGreaterThan(0.98);
  expect(acrylicFront.left[0]).toBeGreaterThan(acrylicFront.left[2] + 60);
  expect(acrylicFront.right[2]).toBeGreaterThan(acrylicFront.right[0] + 60);
  await page.getByRole("button", { name: "背面", exact: true }).click();
  const acrylicBack = await rectangleCoverage(page, await exportImage(page));
  expect(acrylicBack.coloredFraction).toBeGreaterThan(0.98);
  expect(acrylicBack.left[1]).toBeGreaterThan(acrylicBack.left[0] + 50);
  expect(acrylicBack.right[0]).toBeGreaterThan(acrylicBack.right[1] + 50);
  expect(errors).toEqual([]);
});

async function backingNoise(page: Page, png: string) {
  return page.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const target = document.createElement("canvas");
    const w = (target.width = image.width),
      h = (target.height = image.height);
    const context = target.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, w, h).data;
    let jumps = 0,
      total = 0;
    // A flat patch above the pin: continuous metal reflections must not alternate between cap and disc pixels.
    for (let y = Math.floor(h * 0.29); y < h * 0.42; y++)
      for (let x = Math.floor(w * 0.36); x < w * 0.63; x++) {
        let difference = 0;
        for (let channel = 0; channel < 3; channel++)
          difference += Math.abs(
            pixels[(y * w + x) * 4 + channel] -
              pixels[(y * w + x + 1) * 4 + channel],
          );
        if (difference > 6) jumps++;
        total++;
      }
    return jumps / total;
  }, png);
}

test("tilted badge metal backing remains smooth after size, zoom and viewpoint changes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "背面", exact: true }).click();
  await page.getByRole("button", { name: "暖光桌面", exact: true }).click();
  await page.getByLabel("直径", { exact: true }).fill("200");
  await page.getByLabel("直径", { exact: true }).press("Enter");
  await ready(page);
  const canvas = page.locator("canvas.preview-canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 35,
    box.y + box.height / 2 + 12,
    { steps: 8 },
  );
  await page.mouse.up();
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "缩小样机", exact: true }).click();
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "放大样机", exact: true }).click();
  await expect
    .poll(async () =>
      canvas.evaluate(async (element) => {
        const before = element.getAttribute("data-frames");
        await new Promise((resolve) => setTimeout(resolve, 150));
        return before === element.getAttribute("data-frames");
      }),
    )
    .toBe(true);
  const png = await exportImage(page);
  expect(await backingNoise(page, png)).toBeLessThan(0.01);
  await writeFile(
    "docs/verification/badge-backing-fixed.png",
    Buffer.from(png, "base64"),
  );
  for (const diameter of [200, 500]) {
    await page.getByLabel("直径", { exact: true }).fill(String(diameter));
    await page.getByLabel("直径", { exact: true }).press("Enter");
    await ready(page);
    for (let i = 0; i < 20; i++)
      await page.getByRole("button", { name: "放大样机", exact: true }).click();
    const closeup = await exportImage(page);
    expect(await backingNoise(page, closeup)).toBeLessThan(0.01);
    if (diameter === 500)
      await writeFile(
        "docs/verification/badge-backing-closeup-fixed.png",
        Buffer.from(closeup, "base64"),
      );
  }
  expect(errors).toEqual([]);
});
