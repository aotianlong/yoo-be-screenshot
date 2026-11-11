#!/usr/bin/env bash
# 将 site/ 发布到 Cloudflare Pages，自定义域 yoo-screenshot.yoo.im
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v wrangler >/dev/null 2>&1; then
  echo "请先安装 wrangler: npm i -g wrangler 或 pnpm dlx wrangler"
  exit 1
fi

echo "Deploying Pages project: yoo-screenshot (output: site/)"
wrangler pages deploy site --project-name=yoo-screenshot --branch=main

echo ""
echo "自定义域 yoo-screenshot.yoo.im 已在 Cloudflare Pages 绑定（首次需在 Dashboard 或 API 添加一次）。"
echo ""
echo "隐私政策 URL: https://yoo-screenshot.yoo.im/privacy/"
