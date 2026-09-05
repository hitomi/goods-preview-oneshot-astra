import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createLayer, createProject } from "../domain/catalog";
import { uid, type AssetRecord } from "../domain/model";
import {
  deleteProject,
  exportProject,
  getAssets,
  getProject,
  importProject,
  listProjects,
  saveProject,
} from "./storage";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aONkAAAAASUVORK5CYII=";
function fixture(): AssetRecord {
  const original = new Blob(
    [Uint8Array.from(atob(PNG), (letter) => letter.charCodeAt(0))],
    { type: "image/png" },
  );
  return {
    id: uid(),
    name: "原始图案.png",
    mime: "image/png",
    width: 1,
    height: 1,
    hasAlpha: true,
    original,
    preview: original,
    createdAt: Date.now(),
  };
}

beforeEach(async () => {
  for (const project of await listProjects()) await deleteProject(project.id);
});

describe("authoritative local projects", () => {
  it("commits originals and project together, then survives reopening and a backup round trip", async () => {
    const project = createProject();
    const asset = fixture();
    project.assetIds = [asset.id];
    project.layers = [createLayer("print", asset.id)];
    await saveProject(project, [asset]);
    expect((await getProject(project.id))?.layers[0].assetId).toBe(asset.id);
    const retained = (await getAssets([asset.id]))[0];
    expect(await retained.original.arrayBuffer()).toEqual(
      await asset.original.arrayBuffer(),
    );
    const backup = await exportProject(project);
    const restored = await importProject(backup);
    expect(restored.id).not.toBe(project.id);
    expect(restored.assetIds[0]).not.toBe(asset.id);
    expect(restored.layers[0].assetId).toBe(restored.assetIds[0]);
    expect(
      await (await getAssets(restored.assetIds))[0].original.arrayBuffer(),
    ).toEqual(await asset.original.arrayBuffer());
    expect((await getProject(project.id))?.name).toBe(project.name);
    expect(await listProjects()).toHaveLength(2);
  });
  it("aborts a save containing a dangling original and preserves the previous authoritative snapshot", async () => {
    const project = createProject();
    await saveProject(project);
    await expect(
      saveProject({ ...project, name: "不能保存", assetIds: ["missing"] }),
    ).rejects.toThrow("原始素材");
    expect((await getProject(project.id))?.name).toBe(project.name);
  });
  it("serializes snapshots so a later edit wins and caller mutations cannot alter queued data", async () => {
    const project = createProject();
    const first = saveProject(project);
    const second = saveProject({ ...project, name: "较新编辑" });
    project.name = "未提交的外部修改";
    await Promise.all([first, second]);
    expect((await getProject(project.id))?.name).toBe("较新编辑");
  });
  it("does not delete an original still referenced by another project", async () => {
    const first = createProject();
    const second = createProject();
    const asset = fixture();
    first.assetIds = [asset.id];
    second.assetIds = [asset.id];
    await saveProject(first, [asset]);
    await saveProject(second);
    await deleteProject(first.id);
    expect(await getAssets([asset.id])).toHaveLength(1);
    await deleteProject(second.id);
    expect(await getAssets([asset.id])).toHaveLength(0);
  });
  it("rejects damaged, future and incomplete backups without modifying existing projects", async () => {
    const project = createProject();
    const asset = fixture();
    project.assetIds = [asset.id];
    project.layers = [createLayer("print", asset.id)];
    await saveProject(project, [asset]);
    const data = JSON.parse(await (await exportProject(project)).text());
    await expect(importProject(new Blob(["{ broken"]))).rejects.toThrow("JSON");
    await expect(
      importProject(new Blob([JSON.stringify({ ...data, version: 8 })])),
    ).rejects.toThrow("版本");
    await expect(
      importProject(new Blob([JSON.stringify({ ...data, assets: [] })])),
    ).rejects.toThrow("数量");
    await expect(
      importProject(
        new Blob([
          JSON.stringify({
            ...data,
            assets: [{ ...data.assets[0], original: "%%%=" }],
          }),
        ]),
      ),
    ).rejects.toThrow("编码");
    await expect(
      importProject(
        new Blob([
          JSON.stringify({
            ...data,
            assets: [{ ...data.assets[0], previewMime: "image/svg+xml" }],
          }),
        ]),
      ),
    ).rejects.toThrow("预览");
    expect(await listProjects()).toHaveLength(1);
    expect(await getProject(project.id)).toEqual(project);
  });
});
