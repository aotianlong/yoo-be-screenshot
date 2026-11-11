# yoo-be-screenshot

Chrome / Edge（Manifest V3）浏览器截图扩展：可视区域、整页滚动拼接、框选区域；截取后进入编辑页（裁剪、旋转、画笔、文字、撤销/重做），确认后再下载；可选在图片底部附加当前页面 URL。

## 安装（开发者模式）

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本仓库目录

## 使用

1. 点击工具栏图标打开弹窗（弹窗内点「设置」，或在扩展管理页进入「扩展程序选项」）
2. 在默认设置中保存常用的截图方式、图片格式与是否附加 URL；之后每次打开弹窗会自动套用
3. 按需临时修改选项后点击「开始截图」
4. 完成后会自动打开编辑页  
   - 框选 / 整页模式会自动关闭弹窗，在页面上完成操作  
5. 在编辑页中裁剪、旋转、画笔、文字等操作，支持撤销/重做；可「下载」或「复制」后粘贴到支持图片粘贴的上传区  
   - 若在弹窗中勾选了「添加当前 URL」，会在最终下载的图片底部附加 URL

## 开发

本项目为纯静态扩展，无需构建步骤。

## 发布到 Chrome 网上应用店

1. 阅读并补全根目录 [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md)（联系方式、隐私政策 URL）。
2. 隐私政策公网地址：**https://yoo-screenshot.yoo.im/privacy/**（源码在 `site/privacy/`，部署：`./scripts/deploy-privacy-site.sh`）。
3. 准备至少一张 **1280×800** 商店截图。
4. 打包：`chmod +x scripts/package-cws.sh && ./scripts/package-cws.sh`
5. 在 [Chrome 开发者信息中心](https://chrome.google.com/webstore/devconsole) 上传 `dist/yoo-screenshot-v*.zip`。
