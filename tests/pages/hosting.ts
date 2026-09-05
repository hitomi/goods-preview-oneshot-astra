import { expect, test } from "@playwright/test";

test("Pages serves SPA deep links and applies PWA cache headers", async ({ request }) => {
  const root = await request.get("/");
  expect(root.status()).toBe(200);
  expect(root.headers()["cache-control"]).toBe("no-cache");
  const html = await root.text();

  for (const path of ["/projects", "/studio/pages-routing-check"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/html");
    expect(await response.text()).toBe(html);
    expect(response.headers()["cache-control"]).toBe("no-cache");
  }

  const serviceWorker = await request.get("/sw.js");
  expect(serviceWorker.status()).toBe(200);
  expect(serviceWorker.headers()["content-type"]).toContain("javascript");
  expect(serviceWorker.headers()["cache-control"]).toBe("no-cache");

  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  expect(manifest.headers()["cache-control"]).toBe("no-cache");
  expect(await manifest.json()).toMatchObject({ start_url: "/", scope: "/" });

  const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)]
    .map((match) => match[1]);
  expect(assetPaths.length).toBeGreaterThan(0);
  for (const path of assetPaths) {
    const asset = await request.get(path);
    expect(asset.status()).toBe(200);
    expect(asset.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  }
});
