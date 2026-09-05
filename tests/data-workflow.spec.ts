import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

type Upload = { name: string; mimeType: string; buffer: Buffer };

async function sampleImages(page: Page): Promise<Upload[]> {
  const images = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#3d765e";
    context.fillRect(0, 0, 256, 256);
    context.fillStyle = "#f3c970";
    context.fillRect(50, 50, 156, 156);
    const print = canvas.toDataURL("image/png").split(",")[1];
    context.fillStyle = "#000";
    context.fillRect(0, 0, 256, 256);
    context.fillStyle = "#fff";
    context.fillRect(128, 0, 128, 256);
    const grayscale = canvas.toDataURL("image/png").split(",")[1];
    context.clearRect(0, 0, 256, 256);
    context.fillStyle = "#000";
    context.fillRect(128, 0, 128, 256);
    const alpha = canvas.toDataURL("image/png").split(",")[1];
    return [print, grayscale, alpha];
  });
  return ["彩色图案.png", "局部灰度.png", "局部透明.png"].map(
    (name, index) => ({
      name,
      mimeType: "image/png",
      buffer: Buffer.from(images[index], "base64"),
    }),
  );
}

async function openStudio(page: Page) {
  await page.goto("/");
  await expect(page.getByLabel("项目名称", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "已保存在本机" }),
  ).toBeVisible();
}

async function saved(page: Page) {
  await expect(
    page.getByRole("status").filter({ hasText: "已保存在本机" }),
  ).toBeVisible();
}

async function openImport(page: Page, files: Upload[]) {
  await page.getByRole("button", { name: "批量导入图片" }).click();
  const dialog = page.getByRole("dialog", { name: "一次导入，逐张安排" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("选择批量图片").setInputFiles(files);
  return dialog;
}

async function importPrint(page: Page) {
  const [print] = await sampleImages(page);
  const dialog = await openImport(page, [print]);
  await expect(dialog.getByLabel("彩色图案.png 的用途")).toBeVisible();
  await dialog.getByLabel("彩色图案.png 的用途").selectOption("print-front");
  await dialog
    .getByRole("button", { name: "导入 1 张图片", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await saved(page);
  return print;
}

async function maskSides(page: Page) {
  return page.getByLabel("绿色代表施加工艺的区域").evaluate((element) => {
    const context = (element as HTMLCanvasElement).getContext("2d")!;
    return [
      context.getImageData(80, 80, 1, 1).data[3],
      context.getImageData(160, 80, 1, 1).data[3],
    ];
  });
}

async function installWriteFailure(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as { failProjectWrites: number };
    state.failProjectWrites = 0;
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === "projects" && state.failProjectWrites > 0) {
        state.failProjectWrites--;
        throw new DOMException(
          "Test storage quota failure",
          "QuotaExceededError",
        );
      }
      return key === undefined
        ? original.call(this, value)
        : original.call(this, value, key);
    };
  });
}

test("批量分配保留有效图片，正确解释灰度和 Alpha，并在刷新后恢复", async ({
  page,
}) => {
  await openStudio(page);
  const files = await sampleImages(page);
  const dialog = await openImport(page, [
    ...files,
    {
      name: "损坏图片.png",
      mimeType: "image/png",
      buffer: Buffer.from("this is not an image"),
    },
  ]);
  await expect(dialog.getByRole("alert")).toContainText("损坏图片.png");
  await expect(dialog.getByLabel("局部透明.png 的用途")).toBeVisible();
  await dialog.getByLabel("彩色图案.png 的用途").selectOption("print-front");
  await dialog.getByLabel("局部灰度.png 的用途").selectOption("foil-front");
  await dialog.getByLabel("局部灰度.png 的蒙版解释").selectOption("black");
  await dialog.getByLabel("局部透明.png 的用途").selectOption("varnish-front");
  await expect(dialog.getByLabel("局部透明.png 的蒙版解释")).toHaveValue(
    "alpha",
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("局部灰度.png 的蒙版解释")).toHaveValue(
    "black",
  );
  await dialog
    .getByRole("button", { name: "导入 3 张图片", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await saved(page);
  await expect(page.getByRole("button", { name: /^编辑图层 / })).toHaveCount(3);

  await page
    .getByRole("button", { name: "编辑图层 局部灰度", exact: true })
    .click();
  await expect(page.getByLabel("如何读取蒙版")).toHaveValue("luminance");
  await expect(page.getByRole("checkbox", { name: /反相/ })).toBeChecked();
  await expect.poll(() => maskSides(page)).toEqual([255, 0]);
  await page
    .getByRole("button", { name: "编辑图层 局部透明", exact: true })
    .click();
  await expect(page.getByLabel("如何读取蒙版")).toHaveValue("alpha");
  await expect.poll(() => maskSides(page)).toEqual([0, 255]);

  await page.reload();
  await saved(page);
  await expect(page.getByRole("button", { name: /^编辑图层 / })).toHaveCount(3);
  await page
    .getByRole("button", { name: "编辑图层 局部灰度", exact: true })
    .click();
  await expect(page.getByLabel("如何读取蒙版")).toHaveValue("luminance");
  await expect(page.getByRole("checkbox", { name: /反相/ })).toBeChecked();
  await expect.poll(() => maskSides(page)).toEqual([255, 0]);
});

test("撤销批量导入再刷新，原图仍留在素材库并可重新用于图层", async ({
  page,
}) => {
  await openStudio(page);
  await importPrint(page);
  await expect(
    page.getByRole("button", { name: "编辑图层 彩色图案", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "编辑图层 彩色图案", exact: true }),
  ).toHaveCount(0);
  await saved(page);
  await page.reload();
  await saved(page);

  const selected = await page
    .getByLabel("图层素材")
    .selectOption({ label: "彩色图案.png" });
  expect(selected).toHaveLength(1);
  await saved(page);
  await page.reload();
  await saved(page);
  await expect(page.getByLabel("图层素材")).toHaveValue(selected[0]);
  const image = page
    .getByRole("tabpanel")
    .getByRole("img", {
      name: await page.getByLabel("图层名称").inputValue(),
      exact: true,
    });
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBe(256);
});

test("下载含原图的备份并导入新副本，坏备份不改变项目库", async ({
  page,
}, testInfo) => {
  await openStudio(page);
  const print = await importPrint(page);
  await page.getByLabel("项目名称", { exact: true }).fill("备份回归样机");
  await saved(page);
  const sourceUrl = page.url();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载项目", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.goods\.json$/);
  const backupPath = testInfo.outputPath("original.goods.json");
  await download.saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, "utf8"));
  expect(backup.assets).toHaveLength(1);
  expect(Buffer.from(backup.assets[0].original, "base64")).toEqual(
    print.buffer,
  );

  await page.getByRole("button", { name: "项目库", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page
    .getByLabel("导入项目备份", { exact: true })
    .setInputFiles(backupPath);
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue(
    "备份回归样机 · 副本",
  );
  expect(page.url()).not.toBe(sourceUrl);
  await saved(page);
  await expect(
    page.getByRole("button", { name: "编辑图层 彩色图案", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "项目库", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "备份回归样机", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "备份回归样机 · 副本", exact: true }),
  ).toBeVisible();

  await page
    .getByLabel("导入项目备份", { exact: true })
    .setInputFiles({
      name: "bad.goods.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ...backup, assets: [] })),
    });
  await expect(page.getByRole("alert")).toContainText("素材数量与项目不一致");
  await expect(page).toHaveURL(/\/projects$/);
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await page
    .getByRole("heading", { name: "备份回归样机", exact: true })
    .click();
  await expect(page).toHaveURL(sourceUrl);
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue(
    "备份回归样机",
  );
});

test("保存失败时保留编辑并阻止离开，重试成功后可以重开项目", async ({
  page,
}) => {
  await installWriteFailure(page);
  await openStudio(page);
  const studioUrl = page.url();
  await page.evaluate(() => {
    (window as unknown as { failProjectWrites: number }).failProjectWrites = 2;
  });
  await page.getByLabel("项目名称", { exact: true }).fill("存储恢复后的设计");
  await expect(
    page.getByRole("status").filter({ hasText: "保存失败" }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "本机存储空间不足" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "项目库", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "项目尚未保存，已留在当前页面" }),
  ).toBeVisible();
  await expect(page).toHaveURL(studioUrl);
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue(
    "存储恢复后的设计",
  );
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await saved(page);
  await page.reload();
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue(
    "存储恢复后的设计",
  );
  await page.getByRole("button", { name: "项目库", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page
    .getByRole("heading", { name: "存储恢复后的设计", exact: true })
    .click();
  await expect(page).toHaveURL(studioUrl);
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue(
    "存储恢复后的设计",
  );
});

test("批量导入事务失败保留待提交图片与用途，重试后只新增一份素材", async ({
  page,
}, testInfo) => {
  await installWriteFailure(page);
  await openStudio(page);
  const [print] = await sampleImages(page);
  const dialog = await openImport(page, [print]);
  await dialog.getByLabel("彩色图案.png 的用途").selectOption("foil-front");
  await dialog.getByLabel("彩色图案.png 的蒙版解释").selectOption("black");
  await page.evaluate(() => {
    (window as unknown as { failProjectWrites: number }).failProjectWrites = 1;
  });
  await dialog
    .getByRole("button", { name: "导入 1 张图片", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("本机存储空间不足");
  await expect(dialog.getByLabel("彩色图案.png 的用途")).toHaveValue(
    "foil-front",
  );
  await expect(dialog.getByLabel("彩色图案.png 的蒙版解释")).toHaveValue(
    "black",
  );
  await dialog
    .getByRole("button", { name: "导入 1 张图片", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await saved(page);
  await expect(
    page.getByRole("button", { name: "编辑图层 彩色图案", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^编辑图层 / })).toHaveCount(2);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载项目", exact: true }).click();
  const download = await downloading;
  const path = testInfo.outputPath("retried.goods.json");
  await download.saveAs(path);
  const backup = JSON.parse(await readFile(path, "utf8"));
  expect(backup.assets).toHaveLength(1);
  expect(backup.project.assetIds).toHaveLength(1);
  expect(
    backup.project.layers.filter(
      (layer: { assetId?: string }) => layer.assetId,
    ),
  ).toHaveLength(1);
});
