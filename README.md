# haokun12x.github.io

个人主页，纯静态 HTML/CSS/JS，无构建步骤，推送到 `main` 即由 GitHub Pages 发布。

- `index.html` — 页面内容
- `assets/style.css` — 样式（深浅色主题变量在文件顶部）
- `assets/main.js` — 主题切换与滚动动效

## 填写项目经历

在 `index.html` 中搜索 `EXPERIENCE`，每个 `<article class="exp">` 是一条经历：复制整块新增，填完后去掉 `is-placeholder` 类和 `待填写` 标记。

联系邮箱在 `index.html` 中搜索 `hello@example.com` 替换。

## 本地预览

```bash
python3 -m http.server 8000
```
