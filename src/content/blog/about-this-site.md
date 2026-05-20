---
title: "关于这个站点"
description: "用 Astro + GitHub Pages 搭起来的，记录一下技术选型的取舍。"
pubDate: 2026-05-20
tags: ["技术", "建站"]
---

这个站点用 [Astro](https://astro.build) + Tailwind 写的，部署在 GitHub Pages 上。

## 为什么不是 Notion / Wordpress / Substack

- **Notion**：写作体验好，但风格高度同质化，作为设计师作品集太弱了
- **Wordpress**：太重，要服务器，主题市场让人焦虑
- **Substack**：邮件订阅做得好，但完全没有设计自由度

我想要的是一个**完全可控的橱窗**——视觉、信息架构、加载速度都自己说了算，
同时**写起来要像 Markdown 一样无负担**。

## 为什么是 Astro

- 输出纯静态 HTML，GitHub Pages 免费托管
- Content Collections 用 frontmatter 管文章，跟 Jekyll/Hugo 一样自然
- 组件化做作品集页面比纯模板灵活得多
- 后期加 i18n 路由不用大改

## 为什么不是 Next.js

Next.js 也能做，但对一个内容站来说带的能力太多了（SSR、API Routes、Edge）。
Astro 是「为内容而生」的，定位更准。

技术选型不是越新越好，是**越贴合需求越好**。
