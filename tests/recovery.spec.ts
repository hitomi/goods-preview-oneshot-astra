import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator("canvas.preview-canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.getByText("已保存在本机", { exact: true })).toBeVisible();
}

test("empty name drafts cannot break saving, navigation or backup", async ({
  page,
}) => {
  await open(page);
  const projectName = await page
    .getByLabel("项目名称", { exact: true })
    .inputValue();
  const layerName = await page
    .getByLabel("图层名称", { exact: true })
    .inputValue();
  await page.getByLabel("项目名称", { exact: true }).fill("");
  await page.getByLabel("图层名称", { exact: true }).fill("");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载项目", exact: true }).click();
  const backup = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(backup.project.name).toBe(projectName);
  expect(backup.project.layers[0].name).toBe(layerName);
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue(
    projectName,
  );
  await expect(page.getByLabel("图层名称", { exact: true })).toHaveValue(
    layerName,
  );
  await expect(page.getByText("保存失败", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "项目库", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "让下一份设计，有形可见。" }),
  ).toBeVisible();
});

test("backup import rejects open cutlines and invalid product geometry before writing", async ({
  page,
}) => {
  await open(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载项目", exact: true }).click();
  const backup = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  await page.getByRole("button", { name: "项目库", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  backup.project.product = "paper";
  backup.project.shape = "custom";
  backup.project.cutline =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 10 L80 80 L10 80"/></svg>';
  await page.getByLabel("导入项目备份", { exact: true }).setInputFiles({
    name: "bad-cutline.goods.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByRole("alert")).toContainText("闭合");
  await expect(page.getByRole("article")).toHaveCount(1);
  backup.project.shape = "circle";
  delete backup.project.cutline;
  backup.project.height += 10;
  await page.getByLabel("导入项目备份", { exact: true }).setInputFiles({
    name: "bad-circle.goods.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByRole("alert")).toContainText("宽高需要一致");
  await expect(page.getByRole("article")).toHaveCount(1);
});

test("layer list and reorder respect actual white ink, print and finish sequence", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("tab", { name: "图层", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "灯光", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.getByRole("tab", { name: "图层", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "纸品", exact: true }).click();
  await page.getByRole("button", { name: "添加图层 / 工艺" }).click();
  await page.getByRole("button", { name: /烫色 金属箔覆盖/ }).click();
  await page.getByRole("button", { name: "添加图层 / 工艺" }).click();
  await page.getByRole("button", { name: /彩色印刷 彩色图案/ }).click();
  await page.getByLabel("图层名称", { exact: true }).fill("第二张彩印");
  await expect(
    page.getByRole("button", { name: "上移图层", exact: true }),
  ).toBeDisabled();
  const layerList = page.getByLabel("图层列表", { exact: true });
  await expect(
    layerList.getByRole("button", { name: /^编辑图层/ }).first(),
  ).toHaveAttribute("aria-label", "编辑图层 正面烫色");
  await page.getByRole("button", { name: "下移图层", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "下移图层", exact: true }),
  ).toBeDisabled();
  await expect(
    layerList.getByRole("button", { name: /^编辑图层/ }).last(),
  ).toHaveAttribute("aria-label", "编辑图层 第二张彩印");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "更多项目操作" }).click();
  const backup = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载项目备份", exact: true }).click();
  expect((await backup).suggestedFilename()).toContain(".goods.json");
});

test("single-sided clear acrylic shows reverse ink and white underbase on its back", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "亚克力", exact: true }).click();
  await page.getByRole("button", { name: "背面", exact: true }).click();
  const capture = async () => {
    await expect(page.locator("canvas.preview-canvas")).toHaveAttribute(
      "data-updating",
      "false",
    );
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出效果图", exact: true }).click();
    return createHash("sha256")
      .update(await readFile((await (await download).path())!))
      .digest("hex");
  };
  const inkBack = await capture();
  await page
    .getByRole("button", { name: "隐藏 正面彩色印刷", exact: true })
    .click();
  const emptyBack = await capture();
  expect(inkBack).not.toBe(emptyBack);
  await page
    .getByRole("button", { name: "显示 正面彩色印刷", exact: true })
    .click();
  await page.getByRole("button", { name: "添加图层 / 工艺" }).click();
  await page.getByRole("button", { name: /白墨 给透明/ }).click();
  const whiteBack = await capture();
  expect(whiteBack).not.toBe(inkBack);
  expect(whiteBack).not.toBe(emptyBack);
  await page.getByRole('button', { name: '添加图层 / 工艺' }).click();
  await page.getByRole('button', { name: /彩色印刷 彩色图案/ }).click();
  await page.getByRole('combobox', { name: '印刷面', exact: true }).selectOption('back');
  await page.getByRole('slider', { name: '印刷不透明度', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(page.getByRole('slider', { name: '印刷不透明度', exact: true })).toHaveValue('0');
  expect(await capture()).toBe(whiteBack);
});
