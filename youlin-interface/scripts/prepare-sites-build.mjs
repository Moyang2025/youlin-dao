import {
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

const projectRoot = process.cwd();
const staticDirectory = resolve(projectRoot, "site-static");
const distDirectory = resolve(projectRoot, "dist");
const clientDirectory = resolve(distDirectory, "client");
const serverDirectory = resolve(distDirectory, "server");
const hostingSource = resolve(projectRoot, ".openai", "hosting.json");
const metadataDirectory = resolve(distDirectory, ".openai");
const hostingTarget = resolve(metadataDirectory, "hosting.json");

if (!distDirectory.startsWith(`${projectRoot}${sep}`)) {
  throw new Error("Refusing to prepare a build outside the project directory.");
}

await rm(distDirectory, { recursive: true, force: true });
await mkdir(serverDirectory, { recursive: true });
await mkdir(metadataDirectory, { recursive: true });
await cp(staticDirectory, clientDirectory, { recursive: true });
await copyFile(hostingSource, hostingTarget);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolutePath)));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

const embeddedAssets = {};

for (const absolutePath of await listFiles(staticDirectory)) {
  const relativePath = relative(staticDirectory, absolutePath).replaceAll("\\", "/");
  const routePath = `/${relativePath}`;
  const extension = extname(relativePath).toLowerCase();
  const contents = await readFile(absolutePath);

  embeddedAssets[routePath] = {
    body: contents.toString("base64"),
    type: contentTypes[extension] ?? "application/octet-stream"
  };
}

const workerSource = `const assets = ${JSON.stringify(embeddedAssets)};
const decodedAssets = new Map();

function decodeAsset(pathname, encodedBody) {
  const cached = decodedAssets.get(pathname);
  if (cached) return cached;

  const binary = atob(encodedBody);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  decodedAssets.set(pathname, bytes);
  return bytes;
}

function resolveAsset(pathname) {
  if (pathname === "/") return "/index.html";
  if (assets[pathname]) return pathname;
  if (pathname.endsWith("/") && assets[\`\${pathname}index.html\`]) {
    return \`\${pathname}index.html\`;
  }
  if (!pathname.includes(".") && assets[\`\${pathname}.html\`]) {
    return \`\${pathname}.html\`;
  }
  return assets["/404.html"] ? "/404.html" : null;
}

export default {
  fetch(request) {
    const url = new URL(request.url);
    const assetPath = resolveAsset(url.pathname);

    if (!assetPath) {
      return new Response("Not found", { status: 404 });
    }

    const asset = assets[assetPath];
    const body = decodeAsset(assetPath, asset.body);
    const isNotFound = assetPath === "/404.html" && url.pathname !== "/404.html";
    const headers = new Headers({
      "Content-Type": asset.type,
      "Content-Length": String(body.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Cache-Control": assetPath.startsWith("/_next/static/")
        ? "public, max-age=31536000, immutable"
        : asset.type.startsWith("text/html")
          ? "no-cache"
          : "public, max-age=3600"
    });

    return new Response(request.method === "HEAD" ? null : body, {
      status: isNotFound ? 404 : 200,
      headers
    });
  }
};
`;

await writeFile(resolve(serverDirectory, "index.js"), workerSource, "utf8");
