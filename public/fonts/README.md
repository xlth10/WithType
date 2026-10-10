# 随包界面字体

网页与 Windows WebView2 共用 `noto-sans-sc-variable.woff2`，避免依赖 Segoe UI / PingFang 等不同系统字体造成的字宽、换行与字重差异。

- 来源：[Noto Sans SC Sans2.004](https://github.com/notofonts/noto-cjk/blob/Sans2.004/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf)。
- 版权与许可：`COPYRIGHT-NotoSansSC.txt`、`OFL-NotoSansSC.txt`。
- 仅从 TTF 转为 WOFF2 容器，保留全部 31,036 字形、100–900 字重与原版权/名称元数据；没有根据页面文案裁字，口述和模型回复可使用字体内的全部字符。
- 来源与导出 SHA-256 见 `manifest.json`。资源为约 7.8 MB，增加安装包体积，换取离线字体一致性；不访问在线字体服务。
- CSS 中的 `Typefree UI` 是本应用字体别名，原字体作者归属不变。字体未覆盖的语言/符号继续使用系统回退，系统文本光栅化也可能存在细微差异。

正常构建直接使用已提交的 WOFF2，无需 Python。只在复生成资源时安装 `fonttools` 和 `brotli`，下载上述固定版原始 TTF 后执行：

```bash
python scripts/prepare_ui_font.py /path/to/NotoSansSC-VF.ttf
```

若重新生成内容发生变化，应同时更新 manifest 并复验字体加载与前端构建。
