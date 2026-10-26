import { build } from "esbuild";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/background.ts", "src/ui.ts"],
  bundle: true,
  outdir: "dist",
  format: "esm",
  target: "chrome120",
  sourcemap: true,
});
await build({
  entryPoints: ["src/capture.ts", "src/picker.ts"],
  bundle: true,
  outdir: "dist",
  format: "iife",
  target: "chrome120",
  sourcemap: true,
});
for (const page of ["popup", "dashboard"])
  await writeFile(
    `dist/${page}.html`,
    `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DiffWatch</title><link rel="stylesheet" href="style.css"><body data-page="${page}"><main id="app"></main><script type="module" src="ui.js"></script></body></html>`,
  );
await copyFile("public/style.css", "dist/style.css");
await copyFile("public/icon.png", "dist/icon.png");
await writeFile(
  "dist/manifest.json",
  JSON.stringify(
    {
      manifest_version: 3,
      name: "DiffWatch",
      version: "1.0.0",
      description:
        "於專用背景分頁比較選定 DOM 文字、連結與圖片網址，所有資料留在本機。",
      minimum_chrome_version: "120",
      permissions: [
        "storage",
        "alarms",
        "scripting",
        "notifications",
        "activeTab",
      ],
      optional_host_permissions: ["https://*/*", "http://*/*"],
      background: { service_worker: "background.js", type: "module" },
      action: { default_popup: "popup.html", default_icon: "icon.png" },
      icons: { 128: "icon.png" },
      incognito: "not_allowed",
    },
    null,
    2,
  ),
);
