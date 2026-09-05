import { useCallback, useEffect, useRef, useState } from "react";
import type { AssetRecord, Project } from "../domain/model";
import { getAssets, getProject, saveProject } from "./storage";

export type SaveStatus = "saved" | "saving" | "error";

export function useProject(id: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [saveError, setSaveError] = useState("");
  const [, setHistoryVersion] = useState(0);
  const latest = useRef<Project | null>(null);
  const saved = useRef<Project | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const past = useRef<Project[]>([]);
  const future = useRef<Project[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    (async () => {
      try {
        const found = await getProject(id);
        if (!found)
          throw new Error(
            "这个项目不在当前浏览器中。可以从项目库打开其他项目，或导入之前下载的备份。",
          );
        const loaded = await getAssets(found.assetIds);
        if (cancelled) return;
        latest.current = saved.current = found;
        setProject(found);
        setAssets(loaded);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "项目读取失败，请重试。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, [id]);

  const persist = useCallback(
    async (snapshot: Project, newAssets?: AssetRecord[]) => {
      if (alive.current) setSaveStatus("saving");
      const work = queue.current
        .catch(() => undefined)
        .then(() => saveProject(snapshot, newAssets));
      queue.current = work;
      try {
        await work;
        saved.current = snapshot;
        if (alive.current && latest.current === snapshot) {
          setSaveStatus("saved");
          setSaveError("");
        }
      } catch (e) {
        if (alive.current) {
          setSaveStatus("error");
          setSaveError(
            e instanceof Error ? e.message : "本机保存失败，请下载备份或重试。",
          );
        }
        throw e;
      }
    },
    [],
  );

  const schedule = useCallback(
    (next: Project) => {
      // History restores edits, never removes already imported originals from the library.
      next.assetIds = [
        ...new Set([...(latest.current?.assetIds ?? []), ...next.assetIds]),
      ];
      latest.current = next;
      setProject(next);
      setSaveStatus("saving");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void persist(next).catch(() => undefined);
      }, 450);
    },
    [persist],
  );

  const update = useCallback(
    (edit: (draft: Project) => void) => {
      if (!latest.current) return;
      const before = latest.current;
      const next = structuredClone(before);
      edit(next);
      if (JSON.stringify(before) === JSON.stringify(next)) return;
      next.updatedAt = Date.now();
      past.current = [...past.current.slice(-39), before];
      future.current = [];
      schedule(next);
      setHistoryVersion((v) => v + 1);
    },
    [schedule],
  );

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (!previous || !latest.current) return;
    future.current.push(latest.current);
    schedule({ ...previous, updatedAt: Date.now() });
    setHistoryVersion((v) => v + 1);
  }, [schedule]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next || !latest.current) return;
    past.current.push(latest.current);
    schedule({ ...next, updatedAt: Date.now() });
    setHistoryVersion((v) => v + 1);
  }, [schedule]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (latest.current && latest.current !== saved.current)
      await persist(latest.current);
    else await queue.current;
  }, [persist]);

  const commitAssets = useCallback(
    async (newAssets: AssetRecord[], edit: (draft: Project) => void) => {
      if (!latest.current) return;
      clearTimeout(timer.current);
      const before = latest.current;
      const next = structuredClone(before);
      next.assetIds = [
        ...new Set([...next.assetIds, ...newAssets.map((a) => a.id)]),
      ];
      edit(next);
      next.updatedAt = Date.now();
      // The editor is covered by its modal until this transaction has committed.
      await persist(next, newAssets);
      past.current = [...past.current.slice(-39), before];
      future.current = [];
      latest.current = saved.current = next;
      setProject(next);
      setAssets((current) => [
        ...current.filter((a) => !newAssets.some((b) => b.id === a.id)),
        ...newAssets,
      ]);
      setSaveStatus("saved");
      setHistoryVersion((v) => v + 1);
    },
    [persist],
  );

  return {
    project,
    assets,
    loading,
    error,
    saveStatus,
    saveError,
    update,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    flush,
    commitAssets,
  };
}

export function useAssetUrls(assets: AssetRecord[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const next = Object.fromEntries(
      assets.map((asset) => [asset.id, URL.createObjectURL(asset.preview)]),
    );
    setUrls(next);
    return () => Object.values(next).forEach((url) => URL.revokeObjectURL(url));
  }, [assets]);
  return urls;
}
