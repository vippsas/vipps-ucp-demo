/**
 * Bundles the orders dashboard React app for the browser.
 * Run from repo root: `deno task build:orders-dashboard`
 */
import * as esbuild from "esbuild";
import { dirname, fromFileUrl, join } from "@std/path";

const scriptDir = dirname(fromFileUrl(import.meta.url));
const root = dirname(scriptDir);
const staticDir = join(root, "static");

await Deno.mkdir(staticDir, { recursive: true });

await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["src/features/orders_dashboard/client/main.tsx"],
  bundle: true,
  outfile: "static/orders-dashboard.js",
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});

await esbuild.stop();

await Deno.copyFile(
  join(root, "src/features/orders_dashboard/client/orders-dashboard.css"),
  join(staticDir, "orders-dashboard.css"),
);

console.log("Wrote static/orders-dashboard.js and static/orders-dashboard.css");
