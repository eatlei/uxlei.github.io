#!/usr/bin/env node
// 把 Obsidian 写作库 (uxlei/) 同步到 Astro 网站内容目录。
//   - 读取 uxlei/ 下所有 .md（跳过 _ 开头的文件/文件夹、attachments/、隐藏目录）
//   - 校验 frontmatter（必须有 title 和 pubDate；draft:true 跳过不发布）
//   - 把文章引用的图片复制到 public/blog/<slug>/，并把图片路径改写成网站可用的绝对路径
//   - 输出到 src/content/blog/<slug>.md
// 每次运行都会先清空上一次同步的产物，再重新生成，所以重命名/删除笔记都会正确反映。

import { readdir, readFile, writeFile, mkdir, rm, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VAULT = path.join(PROJECT_ROOT, "uxlei");
const BLOG_OUT = path.join(PROJECT_ROOT, "src", "content", "blog");
const IMG_OUT = path.join(PROJECT_ROOT, "public", "blog");

// 网站部署在子路径下，图片绝对路径要带上它。来源：astro.config.mjs 的 base 字段。
const BASE = "/uxlei.github.io";

const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".bmp"]);

// ---------- 工具 ----------

const log = (...a) => console.log(...a);
const warn = (...a) => console.warn("⚠️ ", ...a);

function slugify(filename) {
  const base = filename.replace(/\.md$/i, "");
  return base.trim().replace(/[\s_]+/g, "-").replace(/[\\/:*?"<>|]+/g, "");
}

// 递归收集库里的文章 .md，跳过模板/说明/附件/隐藏目录。
async function collectPosts(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name.startsWith("_")) continue; // .obsidian / _templates / _写作说明.md
    if (e.name === "attachments") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await collectPosts(full, out);
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

// 解析 frontmatter 块（首尾 --- 之间）。只取我们关心的标量字段，正文与原 frontmatter 原样保留。
function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { ok: false };
  const block = m[1];
  const get = (key) => {
    const r = block.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
    return r ? r[1].replace(/^["']|["']$/g, "").trim() : undefined;
  };
  return {
    ok: true,
    title: get("title"),
    pubDate: get("pubDate"),
    draft: /^draft:\s*true\s*$/m.test(block),
    bodyOffset: m[0].length,
  };
}

// 在库里把图片引用解析成真实文件。尝试：相对笔记、相对库根、attachments/、全库按文件名兜底。
async function resolveImage(ref, noteDir, vaultFileIndex) {
  const decoded = decodeURIComponent(ref);
  const candidates = [
    path.resolve(noteDir, decoded),
    path.resolve(VAULT, decoded),
    path.resolve(VAULT, "attachments", path.basename(decoded)),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // 兜底：全库找同名文件
  const hit = vaultFileIndex.get(path.basename(decoded));
  return hit ?? null;
}

// 建一个 文件名 -> 绝对路径 的索引，用于兜底解析图片。
async function buildFileIndex(dir, index = new Map()) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await buildFileIndex(full, index);
    else if (!index.has(e.name)) index.set(e.name, full);
  }
  return index;
}

// 清空上一次同步产物：src/content/blog 下非 _ 开头的 .md，以及整个 public/blog。
async function cleanOutputs() {
  if (existsSync(BLOG_OUT)) {
    for (const name of await readdir(BLOG_OUT)) {
      if (name.toLowerCase().endsWith(".md") && !name.startsWith("_")) {
        await rm(path.join(BLOG_OUT, name), { force: true });
      }
    }
  }
  await rm(IMG_OUT, { recursive: true, force: true });
}

// ---------- 主流程 ----------

async function main() {
  if (!existsSync(VAULT)) {
    warn(`找不到写作库目录 ${VAULT}，跳过同步。`);
    return;
  }
  await mkdir(BLOG_OUT, { recursive: true });

  const postFiles = await collectPosts(VAULT);
  const fileIndex = await buildFileIndex(VAULT);

  await cleanOutputs();

  const errors = [];
  let published = 0;
  let skipped = 0;

  for (const file of postFiles) {
    const rel = path.relative(VAULT, file);
    let content = await readFile(file, "utf8");
    const fm = parseFrontmatter(content);

    if (!fm.ok) {
      errors.push(`${rel}：缺少 frontmatter（开头的 --- 区块）。`);
      continue;
    }
    if (fm.draft) {
      skipped++;
      continue;
    }
    if (!fm.title) errors.push(`${rel}：frontmatter 缺少 title。`);
    if (!fm.pubDate) errors.push(`${rel}：frontmatter 缺少 pubDate（格式如 2026-05-21）。`);
    if (!fm.title || !fm.pubDate) continue;

    const slug = slugify(path.basename(file));
    const noteDir = path.dirname(file);
    const usedImages = [];

    // 改写 Obsidian 嵌入图片 ![[xxx.png]] -> ![](绝对路径)
    content = await replaceAsync(content, /!\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]/g, async (full, target) => {
      const ext = path.extname(target).toLowerCase();
      if (!IMG_EXT.has(ext)) {
        warn(`${rel}：发现非图片嵌入 ![[${target}]]，已原样保留（网站不会渲染）。`);
        return full;
      }
      const url = await stageImage(target, noteDir, fileIndex, slug, usedImages, rel);
      return url ? `![](${url})` : full;
    });

    // 改写标准 markdown 图片 ![alt](path)（跳过外链）
    content = await replaceAsync(content, /(!\[[^\]]*\]\()([^)]+)(\))/g, async (full, pre, url, post) => {
      const trimmed = url.trim();
      if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith("data:")) return full;
      const ext = path.extname(trimmed.split(/[?#]/)[0]).toLowerCase();
      if (!IMG_EXT.has(ext)) return full;
      const newUrl = await stageImage(trimmed, noteDir, fileIndex, slug, usedImages, rel);
      return newUrl ? `${pre}${newUrl}${post}` : full;
    });

    await writeFile(path.join(BLOG_OUT, `${slug}.md`), content, "utf8");
    published++;
    log(`✓ ${rel}  →  blog/${slug}${usedImages.length ? `  (+${usedImages.length} 张图)` : ""}`);
  }

  log("");
  log(`同步完成：发布 ${published} 篇，跳过草稿 ${skipped} 篇。`);

  if (errors.length) {
    log("");
    console.error("❌ 有问题需要先修正：");
    for (const e of errors) console.error("   - " + e);
    process.exit(1);
  }
}

// 把一张图片复制到 public/blog/<slug>/ 并返回网站用的绝对路径；失败返回 null。
async function stageImage(ref, noteDir, fileIndex, slug, usedImages, rel) {
  const src = await resolveImage(ref, noteDir, fileIndex);
  if (!src) {
    warn(`${rel}：找不到图片 "${ref}"，已跳过。`);
    return null;
  }
  const filename = path.basename(src);
  const destDir = path.join(IMG_OUT, slug);
  await mkdir(destDir, { recursive: true });
  await copyFile(src, path.join(destDir, filename));
  usedImages.push(filename);
  return `${BASE}/blog/${slug}/${encodeURIComponent(filename)}`;
}

// 支持异步替换的 String.replace。
async function replaceAsync(str, regex, asyncFn) {
  const matches = [];
  str.replace(regex, (...args) => {
    matches.push(args);
    return "";
  });
  let result = "";
  let lastIndex = 0;
  for (const args of matches) {
    const match = args[0];
    const offset = args[args.length - 2];
    result += str.slice(lastIndex, offset) + (await asyncFn(...args));
    lastIndex = offset + match.length;
  }
  result += str.slice(lastIndex);
  return result;
}

main().catch((err) => {
  console.error("❌ 同步失败：", err);
  process.exit(1);
});
