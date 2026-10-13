# 随包界面字体

本项目使用用户指定的本机 Type 最新版中的 Noto Sans SC Sans2.004 可变字体，CSS 别名为 `WithType UI`。同一 WOFF2 文件在浏览器预览和 Windows WebView2 中离线加载。

- 来源、100–900 字重范围、31,036 个字形及 SHA-256 见 `manifest.json`。
- 字体约 7.8 MB，增加相应的包体积。不请求在线字体。
- 官方版权和 OFL 1.1 许可分别保留在 `COPYRIGHT-NotoSansSC.txt` 与 `OFL-NotoSansSC.txt`，随安装包和便携包分发。
- 正常构建直接使用当前 WOFF2，不需要字体转换工具。`npm run verify:appearance` 核对源字体、构建产物和配色基准。
- 字体未覆盖的字符仍使用系统回退；相同字形文件不能保证不同系统的光栅化像素完全一致。
