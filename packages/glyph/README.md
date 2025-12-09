# koishi-plugin-fonts

Koishi 的字体管理器插件 - 提供动态字体配置项

## 功能特性

- 🎨 自动扫描字体目录，加载所有字体文件
- 📦 将字体转换为 Base64 Data URL，方便直接使用
- 🔧 通过动态配置项 `Schema.dynamic('font')` 提供字体选择
- 🚀 其他插件无需自己处理字体上传和管理
- ✨ 支持 TTF、OTF、WOFF、WOFF2 格式

## 配置

在 Koishi 中启用插件，

然后将你的字体文件（.ttf、.otf、.woff、.woff2）放入 Koishi 根目录下的 `data/fonts` 目录。

**注意**：`root` 配置项是相对于 Koishi 实例的根目录（`ctx.baseDir`），而不是插件目录。

例如，如果你的 Koishi 安装在 `/home/user/koishi`，那么字体目录应该是 `/home/user/koishi/data/fonts`。

## 使用示例

参考 `example-usage.ts` 文件查看完整的使用示例。

### 配置界面

用户在 Koishi 控制台的配置界面中，会看到一个下拉框，列出所有可用的字体。每个选项会显示：

- 字体名称
- 字体格式（ttf/otf/woff/woff2）
- 文件大小

选择字体后，配置项的值就是该字体的完整 Base64 Data URL。

## 许可证

MIT
