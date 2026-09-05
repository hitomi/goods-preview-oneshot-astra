import { openDB, type DBSchema } from "idb";
import { uid, type AssetRecord, type Project } from "../domain/model";
import { validateProject } from "../domain/validation";
import {
  inspectImage,
  MAX_IMAGE_BYTES,
  MAX_PREVIEW_EDGE,
  verifyImageDecodes,
} from "./images";

interface StudioDatabase extends DBSchema {
  projects: { key: string; value: Project };
  assets: { key: string; value: AssetRecord };
}

const DATABASE_NAME = "zhiwu-studio";
export const MAX_BACKUP_BYTES = 150 * 1024 * 1024;
let database: ReturnType<typeof openDB<StudioDatabase>> | undefined;
let writeQueue: Promise<unknown> = Promise.resolve();

function db() {
  if (!database)
    database = openDB<StudioDatabase>(DATABASE_NAME, 1, {
      upgrade(connection) {
        connection.createObjectStore("projects", { keyPath: "id" });
        connection.createObjectStore("assets", { keyPath: "id" });
      },
      blocking() {
        void database?.then((connection) => connection.close());
        database = undefined;
      },
      terminated() {
        database = undefined;
      },
    }).catch((error: unknown) => {
      database = undefined;
      throw error;
    });
  return database;
}

function serial<T>(operation: () => Promise<T>): Promise<T> {
  const next = writeQueue.catch(() => undefined).then(operation);
  writeQueue = next;
  return next;
}

function storageError(error: unknown): Error {
  if (error instanceof DOMException && error.name === "QuotaExceededError")
    return new Error(
      "本机存储空间不足。编辑仍保留在当前页面，请下载备份或清理其他项目后重试。",
    );
  return error instanceof Error
    ? error
    : new Error("本机保存失败，请保持此页面打开并重试。");
}

export async function listProjects(): Promise<Project[]> {
  return (await (await db()).getAll("projects")).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}

export async function getProject(id: string): Promise<Project | undefined> {
  const project = await (await db()).get("projects", id);
  return project ? validateProject(project) : undefined;
}

export async function getAssets(ids: string[]): Promise<AssetRecord[]> {
  const connection = await db();
  const transaction = connection.transaction("assets", "readonly");
  const items = await Promise.all(ids.map((id) => transaction.store.get(id)));
  await transaction.done;
  return items.filter((item): item is AssetRecord => Boolean(item));
}

async function validateAsset(asset: AssetRecord): Promise<void> {
  if (
    !asset ||
    typeof asset !== "object" ||
    typeof asset.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(asset.id)
  )
    throw new Error("素材编号无效。");
  if (
    typeof asset.name !== "string" ||
    !asset.name.trim() ||
    asset.name.length > 200 ||
    /[\u0000-\u001f]/.test(asset.name)
  )
    throw new Error("素材名称无效。");
  if (
    !["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(
      asset.mime,
    )
  )
    throw new Error("备份含有不支持的素材格式。");
  if (
    !Number.isInteger(asset.width) ||
    !Number.isInteger(asset.height) ||
    asset.width < 1 ||
    asset.height < 1 ||
    asset.width * asset.height > 40_000_000 ||
    Math.max(asset.width, asset.height) > 32768
  )
    throw new Error("素材尺寸无效或超限。");
  if (
    typeof asset.hasAlpha !== "boolean" ||
    !Number.isFinite(asset.createdAt) ||
    asset.createdAt < 0
  )
    throw new Error("素材信息不完整。");
  if (!(asset.original instanceof Blob) || !(asset.preview instanceof Blob))
    throw new Error("素材缺少原始图片或预览。");
  const original = await inspectImage(asset.original);
  if (original.mime !== asset.mime)
    throw new Error("原始素材格式与备份记录不一致。");
  const sizeMatches =
    (original.width === asset.width && original.height === asset.height) ||
    (asset.mime === "image/jpeg" &&
      original.width === asset.height &&
      original.height === asset.width);
  if (asset.mime !== "image/svg+xml" && !sizeMatches)
    throw new Error("原始图片尺寸与备份记录不一致。");
  const preview = await inspectImage(asset.preview);
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(preview.mime) ||
    preview.mime !== asset.preview.type ||
    Math.max(preview.width, preview.height) > MAX_PREVIEW_EDGE
  )
    throw new Error("备份预览格式无效或尺寸超过 2048 像素。");
}

export function saveProject(
  project: Project,
  assets: AssetRecord[] = [],
): Promise<void> {
  let snapshot: Project;
  try {
    snapshot = validateProject(project);
  } catch (error) {
    return Promise.reject(error);
  }
  const incoming = assets.map((asset) => ({ ...asset }));
  return serial(async () => {
    for (const asset of incoming) {
      if (!snapshot.assetIds.includes(asset.id))
        throw new Error("要保存的素材未加入项目素材库。");
      await validateAsset(asset);
    }
    const connection = await db();
    const transaction = connection.transaction(
      ["projects", "assets"],
      "readwrite",
    );
    // Observe aborts immediately, including manual aborts before the await below.
    void transaction.done.catch(() => undefined);
    try {
      for (const asset of incoming)
        await transaction.objectStore("assets").put(asset);
      for (const assetId of snapshot.assetIds)
        if (!(await transaction.objectStore("assets").getKey(assetId))) {
          transaction.abort();
          throw new Error(
            "项目引用的原始素材未找到，尚未保存。请恢复素材或重新导入。",
          );
        }
      await transaction.objectStore("projects").put(snapshot);
      await transaction.done;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        /* A completed/aborted transaction cannot be aborted again. */
      }
      throw storageError(error);
    }
  });
}

export function deleteProject(id: string): Promise<void> {
  return serial(async () => {
    const connection = await db();
    const transaction = connection.transaction(
      ["projects", "assets"],
      "readwrite",
    );
    const project = await transaction.objectStore("projects").get(id);
    await transaction.objectStore("projects").delete(id);
    if (project) {
      const retained = new Set(
        (await transaction.objectStore("projects").getAll()).flatMap(
          (item) => item.assetIds,
        ),
      );
      for (const assetId of project.assetIds)
        if (!retained.has(assetId))
          await transaction.objectStore("assets").delete(assetId);
    }
    await transaction.done;
  });
}

interface BackupAsset {
  id: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  createdAt: number;
  original: string;
  preview: string;
  previewMime: string;
}

async function encode(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32768)
    binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(binary);
}

function decode(value: unknown, mime: string): Blob {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
    value.length % 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw new Error("备份内图片编码无效或超过单张 30 MiB 上限。");
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error("备份中的图片数据损坏。");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

export async function exportProject(project: Project): Promise<Blob> {
  const snapshot = validateProject(project);
  const assets = await getAssets(snapshot.assetIds);
  if (assets.length !== snapshot.assetIds.length)
    throw new Error(
      "部分原图未保存在本机，无法生成完整备份。请先完成素材保存。",
    );
  const estimated = assets.reduce(
    (sum, asset) =>
      sum +
      Math.ceil(asset.original.size / 3) * 4 +
      Math.ceil(asset.preview.size / 3) * 4,
    0,
  );
  if (estimated > MAX_BACKUP_BYTES - 1024 * 1024)
    throw new Error(
      "此项目备份超过 150 MiB 上限。请拆分项目；原始素材仍完整保存在本机。",
    );
  const savedAssets: BackupAsset[] = [];
  for (const asset of assets)
    savedAssets.push({
      id: asset.id,
      name: asset.name,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
      hasAlpha: asset.hasAlpha,
      createdAt: asset.createdAt,
      original: await encode(asset.original),
      preview: await encode(asset.preview),
      previewMime: asset.preview.type,
    });
  const backup = new Blob(
    [
      JSON.stringify({
        format: "zhiwu-studio",
        version: 1,
        project: snapshot,
        assets: savedAssets,
      }),
    ],
    { type: "application/json" },
  );
  if (backup.size > MAX_BACKUP_BYTES)
    throw new Error("此项目备份超过 150 MiB 上限，请拆分项目后备份。");
  return backup;
}

export async function importProject(file: Blob): Promise<Project> {
  if (!file.size || file.size > MAX_BACKUP_BYTES)
    throw new Error("项目备份需大于 0 字节且不超过 150 MiB。");
  let content: unknown;
  try {
    content = JSON.parse(await file.text());
  } catch {
    throw new Error(
      "无法读取项目备份：文件不是有效 JSON。请使用制物 Studio 导出的项目文件。",
    );
  }
  if (!content || typeof content !== "object" || Array.isArray(content))
    throw new Error("项目备份结构无效。");
  const backup = content as Record<string, unknown>;
  if (
    Object.keys(backup).some(
      (key) => !["format", "version", "project", "assets"].includes(key),
    ) ||
    backup.format !== "zhiwu-studio" ||
    backup.version !== 1
  )
    throw new Error(
      "备份格式或版本不受支持，请使用兼容版本的制物 Studio 打开。",
    );
  const originalProject = validateProject(backup.project);
  if (originalProject.cutline) {
    // Use the same geometry gate as batch import before committing any backup data.
    const { validateCutline } = await import("../render/geometry");
    validateCutline(originalProject.cutline);
  }
  if (
    !Array.isArray(backup.assets) ||
    backup.assets.length !== originalProject.assetIds.length ||
    backup.assets.length > 200
  )
    throw new Error("备份素材数量与项目不一致，文件可能不完整。");
  const mapping = new Map<string, string>();
  const assets: AssetRecord[] = [];
  for (const entry of backup.assets) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("备份素材结构无效。");
    const asset = entry as Record<string, unknown>;
    if (
      Object.keys(asset).some(
        (key) =>
          ![
            "id",
            "name",
            "mime",
            "width",
            "height",
            "hasAlpha",
            "createdAt",
            "original",
            "preview",
            "previewMime",
          ].includes(key),
      )
    )
      throw new Error("备份素材含有未知字段。");
    if (
      typeof asset.id !== "string" ||
      !originalProject.assetIds.includes(asset.id) ||
      mapping.has(asset.id)
    )
      throw new Error("备份素材编号重复或不属于当前项目。");
    if (typeof asset.mime !== "string" || typeof asset.previewMime !== "string")
      throw new Error("备份素材格式缺失。");
    const record = {
      id: uid(),
      name: asset.name,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
      hasAlpha: asset.hasAlpha,
      createdAt: asset.createdAt,
      original: decode(asset.original, asset.mime),
      preview: decode(asset.preview, asset.previewMime),
    } as AssetRecord;
    await validateAsset(record);
    // Browser decoders also verify compressed image payloads, beyond portable header checks.
    if (typeof Image !== "undefined") {
      await verifyImageDecodes(record.original, record.mime);
      await verifyImageDecodes(record.preview, record.preview.type);
    }
    mapping.set(asset.id, record.id);
    assets.push(record);
  }
  const now = Date.now();
  const project: Project = {
    ...originalProject,
    id: uid(),
    name: `${originalProject.name.slice(0, 190)} · 副本`,
    createdAt: now,
    updatedAt: now,
    assetIds: originalProject.assetIds.map((id) => mapping.get(id)!),
    layers: originalProject.layers.map((layer) => ({
      ...layer,
      id: uid(),
      ...(layer.assetId ? { assetId: mapping.get(layer.assetId)! } : {}),
    })),
  };
  await saveProject(project, assets);
  return project;
}
