import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const shapes = [
  { label: "圆形", key: "circle", linked: true },
  { label: "椭圆形", key: "oval", linked: false },
  { label: "圆角方形", key: "rounded", linked: true },
  { label: "圆角长方形", key: "rectangle", linked: false },
  { label: "心形", key: "heart", linked: false },
  { label: "星形", key: "star", linked: true },
] as const;

async function ready(page: Page) {
  await expect(page.getByText("已保存在本机", { exact: true })).toBeVisible();
  await expect(page.locator("canvas.preview-canvas")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 60_000 },
  );
  await expect(page.locator("canvas.preview-canvas")).toHaveAttribute(
    "data-updating",
    "false",
  );
}

async function exportPng(page: Page) {
  await ready(page);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出效果图", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  expect(bytes.length).toBeGreaterThan(5_000);
  return bytes;
}

async function imageFixture(page: Page, circle = false) {
  const encoded = await page.evaluate((circle) => {
    const canvas = document.createElement("canvas");
    canvas.width = circle ? 1140 : 320;
    canvas.height = circle ? 420 : 320;
    const context = canvas.getContext("2d")!;
    context.fillStyle = circle ? "#f4f4f4" : "#cf1717";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (circle) {
      context.fillStyle = "#cf1717";
      context.beginPath();
      context.arc(canvas.width / 2, canvas.height / 2, 110, 0, Math.PI * 2);
      context.fill();
    }
    return canvas.toDataURL("image/png").split(",")[1];
  }, circle);
  return {
    name: circle ? "横版圆形校准图.png" : "完整红色图案.png",
    mimeType: "image/png",
    buffer: Buffer.from(encoded, "base64"),
  };
}

async function importImage(
  page: Page,
  file: Awaited<ReturnType<typeof imageFixture>>,
) {
  await page.getByRole("button", { name: "批量导入图片", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "一次导入，逐张安排" });
  await dialog.getByLabel("选择批量图片").setInputFiles(file);
  await dialog.getByLabel(`${file.name} 的用途`).selectOption("print-front");
  await dialog
    .getByRole("button", { name: "导入 1 张图片", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await ready(page);
}

async function redRegion(page: Page, png: Buffer) {
  return page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    const width = (canvas.width = image.width);
    const height = (canvas.height = image.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    const red = (x: number, y: number) => {
      const i = (y * width + x) * 4;
      return (
        pixels[i] > 100 &&
        pixels[i] > pixels[i + 1] + 60 &&
        pixels[i] > pixels[i + 2] + 50
      );
    };
    let left = width,
      right = -1,
      top = height,
      bottom = -1,
      count = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (!red(x, y)) continue;
        count++;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    const redWidth = Math.max(0, right - left + 1);
    const redHeight = Math.max(0, bottom - top + 1);
    let centerRedCount = 0;
    // This central rectangle lies inside even the heart and star back plates.
    // Ink may wrap around the perimeter but must not cover the metal and pin here.
    if (count) {
      for (
        let y = Math.ceil(top + redHeight * 0.4);
        y < top + redHeight * 0.6;
        y++
      )
        for (
          let x = Math.ceil(left + redWidth * 0.4);
          x < left + redWidth * 0.6;
          x++
        )
          if (red(x, y)) centerRedCount++;
    }
    let upperSplitRows = 0,
      lowerSplitRows = 0;
    for (let y = top; y <= bottom; y++) {
      const runs: { start: number; end: number }[] = [];
      let start = -1;
      for (let x = left; x <= right + 1; x++) {
        if (x <= right && red(x, y)) {
          if (start < 0) start = x;
        } else if (start >= 0) {
          if (x - start > redWidth * 0.025) runs.push({ start, end: x });
          start = -1;
        }
      }
      if (
        runs.some(
          (run, i) => i > 0 && run.start - runs[i - 1].end > redWidth * 0.04,
        )
      ) {
        if (y < top + redHeight / 2) upperSplitRows++;
        else lowerSplitRows++;
      }
    }
    return {
      count,
      centerRedCount,
      width: redWidth,
      height: redHeight,
      fill: count / (redWidth * redHeight || 1),
      upperSplitRows,
      lowerSplitRows,
    };
  }, png.toString("base64"));
}

async function fillDimension(page: Page, name: string, value: string) {
  await page.getByLabel(name, { exact: true }).fill(value);
  await page.getByLabel(name, { exact: true }).press("Enter");
}

async function backup(page: Page) {
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载项目", exact: true }).click();
  const download = await downloading;
  const bytes = await readFile((await download.path())!);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

test("六种吧唧形状保存并导出真实正背面，心形凹口与星形分叉保留", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await ready(page);
  await importImage(page, await imageFixture(page));
  await page
    .getByRole("combobox", { name: "表面覆膜", exact: true })
    .selectOption("matte");
  const frontHashes = new Set<string>();
  for (const shape of shapes) {
    const button = page.getByRole("button", { name: shape.label, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("高度", { exact: true })).toHaveCount(
      shape.linked ? 0 : 1,
    );
    await expect(
      page
        .getByRole("group", { name: "吧唧常用尺寸" })
        .getByRole("button")
        .first(),
    ).toBeVisible();
    await ready(page);
    await page.getByRole("button", { name: "复位视角", exact: true }).click();
    await page.getByRole("button", { name: "正面", exact: true }).click();
    const front = await exportPng(page);
    const region = await redRegion(page, front);
    expect(region.count).toBeGreaterThan(5_000);
    expect(region.fill).toBeGreaterThan(0.25);
    // These assert silhouette features, independent of exact lighting or camera pixels.
    if (shape.key === "heart")
      expect(region.upperSplitRows).toBeGreaterThan(region.height * 0.03);
    if (shape.key === "star") {
      expect(region.lowerSplitRows).toBeGreaterThan(region.height * 0.04);
      expect(region.fill).toBeLessThan(0.72);
    }
    const frontHash = createHash("sha256").update(front).digest("hex");
    frontHashes.add(frontHash);
    await page.getByRole("button", { name: "背面", exact: true }).click();
    const back = await exportPng(page);
    expect(createHash("sha256").update(back).digest("hex")).not.toBe(frontHash);
    const backRegion = await redRegion(page, back);
    // A real printed shell rolls inward: a narrow colored edge remains visible
    // from the back, while the central metal plate and pin stay free of artwork.
    expect(backRegion.count).toBeLessThanOrEqual(region.count * 0.15);
    expect(backRegion.centerRedCount).toBe(0);
    if (shape.key === "heart" || shape.key === "star") {
      await testInfo.attach(`${shape.key}-front`, {
        body: front,
        contentType: "image/png",
      });
      await testInfo.attach(`${shape.key}-back`, {
        body: back,
        contentType: "image/png",
      });
    }
  }
  expect(frontHashes.size).toBe(6);
  await page.reload();
  await ready(page);
  await expect(
    page.getByRole("button", { name: "星形", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("长椭圆图案保持圆形比例，自定尺寸提示、撤销、切换及备份保留素材", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "椭圆形", exact: true }).click();
  await fillDimension(page, "宽度", "95");
  await fillDimension(page, "高度", "35");
  const file = await imageFixture(page, true);
  await importImage(page, file);
  await page.getByLabel("项目名称", { exact: true }).fill("异形吧唧图案测试");
  await page
    .getByRole("combobox", { name: "表面覆膜", exact: true })
    .selectOption("matte");
  await page.getByRole("tab", { name: /^制作检查/ }).click();
  await expect(
    page.getByText("此尺寸需要确认吧唧模具", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "复位视角", exact: true }).click();
  await page.getByRole("button", { name: "正面", exact: true }).click();
  const circle = await redRegion(page, await exportPng(page));
  expect(circle.count).toBeGreaterThan(1_000);
  expect(circle.width / circle.height).toBeGreaterThan(0.9);
  expect(circle.width / circle.height).toBeLessThan(1.1);
  await page.getByRole("button", { name: "星形", exact: true }).click();
  await ready(page);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "椭圆形", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("宽度", { exact: true })).toHaveValue("95");
  await expect(page.getByLabel("高度", { exact: true })).toHaveValue("35");
  await ready(page);
  await page.reload();
  await ready(page);
  await expect(page.getByLabel("宽度", { exact: true })).toHaveValue("95");
  const layer = page.getByRole("button", {
    name: "编辑图层 横版圆形校准图",
    exact: true,
  });
  for (const product of ["纸品", "亚克力"]) {
    await page.getByRole("button", { name: product, exact: true }).click();
    await ready(page);
    await expect(
      page.getByRole("group", { name: "吧唧形状", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "心形", exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .getByLabel("制品外形")
        .locator(
          'option[value="heart"], option[value="star"], option[value="oval"]',
        ),
    ).toHaveCount(0);
    await expect(layer).toBeVisible();
  }
  await page.getByRole("button", { name: "吧唧", exact: true }).click();
  await page.getByRole("button", { name: "心形", exact: true }).click();
  await ready(page);
  await expect(layer).toBeVisible();
  const originalUrl = page.url();
  const saved = await backup(page);
  expect(saved.value.project.shape).toBe("heart");
  expect(saved.value.project.layers).toHaveLength(1);
  expect(saved.value.assets).toHaveLength(1);
  expect(Buffer.from(saved.value.assets[0].original, "base64")).toEqual(
    file.buffer,
  );
  await page.getByRole("button", { name: "项目库", exact: true }).click();
  await page.getByLabel("导入项目备份", { exact: true }).setInputFiles({
    name: "心形吧唧.goods.json",
    mimeType: "application/json",
    buffer: saved.bytes,
  });
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue(
    "异形吧唧图案测试 · 副本",
  );
  await ready(page);
  expect(page.url()).not.toBe(originalUrl);
  await expect(
    page.getByRole("button", { name: "心形", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(layer).toBeVisible();
  const restored = await backup(page);
  expect(Buffer.from(restored.value.assets[0].original, "base64")).toEqual(
    file.buffer,
  );
  expect(restored.value.project.layers[0].name).toBe("横版圆形校准图");
});

test("390px 六形状按钮可触达并支持键盘，心形与星形断网保存后可以重开", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "制品与图层", exact: true }).click();
  for (const shape of shapes) {
    const button = page.getByRole("button", { name: shape.label, exact: true });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeEnabled();
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
  }
  await page.getByRole("button", { name: "关闭制品面板" }).click();
  await expect(page.getByText("可离线使用", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const projectPath = new URL(page.url()).pathname;
  await context.setOffline(true);
  let current = page;
  for (const label of ["心形", "星形"]) {
    await current
      .getByRole("button", { name: "制品与图层", exact: true })
      .click();
    await current.getByRole("button", { name: label, exact: true }).focus();
    await current.keyboard.press(label === "心形" ? "Enter" : "Space");
    await expect(
      current.getByRole("button", { name: label, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    if (label === "星形") {
      await fillDimension(current, "宽度", "60");
      await expect(current.getByLabel("高度", { exact: true })).toHaveCount(0);
    }
    await current.getByRole("button", { name: "关闭制品面板" }).click();
    await ready(current);
    expect(
      await current.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await current.close();
    current = await context.newPage();
    await current.setViewportSize({ width: 390, height: 844 });
    await current.goto(projectPath);
    await ready(current);
    await expect(
      current.getByText("正在离线使用", { exact: true }),
    ).toBeVisible();
    await current
      .getByRole("button", { name: "制品与图层", exact: true })
      .click();
    await expect(
      current.getByRole("button", { name: label, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    if (label === "星形")
      await expect(current.getByLabel("宽度", { exact: true })).toHaveValue(
        "60",
      );
    await current.getByRole("button", { name: "关闭制品面板" }).click();
  }
});
