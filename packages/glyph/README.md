# koishi-plugin-glyph

Koishi 的字体管理器插件

## 功能特性

- 🎨 自动扫描字体目录，加载所有字体文件
- 📦 将字体转换为 Base64 Data URL，方便直接使用
- 🔧 导出 `fontlist` 供其他插件使用，提供字体选择配置项
- 🚀 提供 `ctx.glyph` 服务，其他插件可以获取字体信息
- 📥 支持自动下载字体：`ctx.glyph.checkFont(name, url)`
- ✨ 支持多种字体格式：TTF、OTF、WOFF、WOFF2、TTC、EOT、SVG 等
- 🎯 内置 `default` 字体选项，用于不使用自定义字体的场景

## 配置

在 Koishi 中启用插件后，将字体文件放入 `data/fonts` 目录（默认路径）。

插件会自动创建该目录，无需手动创建。

**注意**：`root` 配置项是相对于 Koishi 实例的根目录（`ctx.baseDir`）。

例如，如果你的 Koishi 安装在 `/home/user/koishi`，那么字体目录应该是 `/home/user/koishi/data/fonts`。

## 使用方法

### 1. 在其他插件中使用字体选择器

```typescript
import { Context, Schema } from 'koishi';
import { fontlist } from 'koishi-plugin-glyph';
import type {} from 'koishi-plugin-glyph';  // 导入类型声明

export const name = 'my-plugin';

// 必须注入 glyph 服务
export const inject = {
  required: ['glyph']
};

export interface Config {
  font: string;  // 存储字体名称
}

export const Config: Schema<Config> = Schema.object({
  // 使用 fontlist 提供字体选择
  font: Schema.union(fontlist).description('选择要使用的字体')
});

export function apply(ctx: Context, config: Config) {
  // 获取字体的 Data URL
  const fontDataUrl = ctx.glyph.getFontDataUrl(config.font);
  
  if (fontDataUrl) {
    // 使用字体 Data URL
    console.log('字体已加载:', config.font);
  }
}
```

### 2. 自动下载字体

```typescript
export function apply(ctx: Context, config: Config) {
  ctx.on('ready', async () => {
    // 检查字体是否存在，不存在则自动下载
    const fontExists = await ctx.glyph.checkFont(
      'NotoColorEmoji-Regular',
      'https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@main/fonts/NotoColorEmoji.ttf'
    );
    
    if (fontExists) {
      console.log('字体已准备就绪');
    }
  });
}
```

### 3. 使用 default 字体

如果不想使用自定义字体，可以选择 `default` 选项：

```typescript
const fontDataUrl = ctx.glyph.getFontDataUrl('default');
// 返回空字符串 ''，表示使用系统默认字体
```

## API

### ctx.glyph 服务

#### getFontDataUrl(name: string): string | undefined

获取指定字体的 Base64 Data URL。

- 参数：`name` - 字体名称（不含扩展名）
- 返回：字体的 Data URL，如果字体不存在则返回 `undefined`
- 特殊：`default` 字体返回空字符串 `''`

#### getFontNames(): string[]

获取所有已加载的字体名称列表。

#### getFontInfo(name: string): FontInfo | undefined

获取字体的详细信息（名称、格式、大小等）。

#### checkFont(fontName: string, downloadUrl: string): Promise<boolean>

检查字体是否存在，如果不存在则从指定 URL 下载。

- 参数：
  - `fontName` - 字体名称（不含扩展名）
  - `downloadUrl` - 字体文件的下载 URL
- 返回：`true` 表示字体可用，`false` 表示下载失败

## 配置界面

用户在 Koishi 控制台的配置界面中，会看到字体列表，包括：

- `default` - 不使用自定义字体
- 其他可用字体（显示字体名称）

**注意**：新添加的字体需要重启 Koishi 才能生效。

## 完整示例

参考 `example-usage.ts` 文件查看完整的使用示例。

## 许可证

MIT
