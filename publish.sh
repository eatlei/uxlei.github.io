#!/usr/bin/env bash
# 一键发布。用法：
#   ./publish.sh                 → 提交说明默认用 "Update content"
#   ./publish.sh "新文章：标题"   → 用你自己的说明
#
# 流程：同步 Obsidian 笔记 → 提交 → 推送（GitHub Action 自动构建上线）

set -e

cd "$(dirname "$0")"

msg="${1:-Update content}"

echo "🔄 正在同步 Obsidian 笔记..."
node scripts/sync.mjs
echo ""

if [ -z "$(git status --porcelain)" ]; then
  echo "✨ 没有改动可以发布。要么还没写新内容，要么写了但 frontmatter 里 draft 还是 true。"
  exit 0
fi

echo "📝 正在提交以下改动："
git status --short
echo ""

git add -A
git commit -m "$msg"
git push

echo ""
echo "✅ 推送完成。GitHub Action 正在构建，1-2 分钟后访问："
echo "   https://eatlei.github.io/uxlei/"
