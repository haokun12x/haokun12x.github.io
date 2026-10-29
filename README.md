# haokun12x.github.io

个人主页，纯静态 HTML/CSS/JS，无构建步骤，推送到 `main` 即由 GitHub Pages 发布。

- `index.html` — 页面内容
- `assets/style.css` — 样式（深浅色主题变量在文件顶部）
- `assets/main.js` — 主题切换与滚动动效
- `factory/` — 具身产线仿真子页面（Three.js，ES modules + importmap，无构建）：`js/data.js` 工艺与产品知识，`js/sim.js` 仿真内核，`js/world.js` 三维车间，`js/lab.js` 产品实验室

## 填写项目经历

在 `index.html` 中搜索 `EXPERIENCE`，每个 `<article class="exp">` 是一条经历：复制整块新增，填完后去掉 `is-placeholder` 类和 `待填写` 标记。

联系邮箱在 `index.html` 中搜索 `hello@example.com` 替换。

## 本地预览

```bash
python3 -m http.server 8000
```
