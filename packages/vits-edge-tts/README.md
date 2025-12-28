# koishi-plugin-vits-edge-tts

[![npm](https://img.shields.io/npm/v/koishi-plugin-vits-edge-tts?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-vits-edge-tts)

基于 Microsoft Edge TTS 的 Koishi VITS 语音合成服务插件。

## 功能特性

- 🎙️ **丰富的语音角色**：支持 300+ 种语音角色
- 🌍 **多语言支持**：支持中文、英文、日文、韩文、法语、德语、西班牙语等多种语言
- ⚡ **云端服务**：基于魔搭社区的 Edge TTS 服务，无需本地部署
- 🎛️ **灵活调节**：支持语速和音调调节
- 🔌 **标准接口**：实现 Koishi VITS 服务接口，可与其他插件无缝集成

## 使用方法

### 基础用法

使用 `edge-tts` 命令（或别名 `vits`、`say`）生成语音：

```
edge-tts 你好，世界
vits Hello, World!
say こんにちは
```

### 命令参数

- `--spkr <角色名>`：指定语音角色
- `--rate <数值>`：调节语速，范围 -100 到 100（负数减速，正数加速）
- `--pitch <数值>`：调节音调，范围 -100 到 100（负数降调，正数升调）

### 使用示例

```
# 使用默认角色
edge-tts 你好

# 指定中文男声
edge-tts --spkr "zh-CN-YunxiNeural - Male" 你好

# 调节语速（加快20%）
edge-tts --rate 20 你好

# 调节音调（降低10）
edge-tts --pitch -10 你好

# 组合使用
edge-tts --spkr "en-US-JennyNeural - Female" --rate 10 --pitch -5 Hello, how are you?
```

## 配置选项

在 Koishi 控制台的插件配置页面，你可以设置：

- **默认语音角色**：从 300+ 个语音中选择默认使用的角色
- **语速调节**：设置默认语速（-100 到 100）
- **音调调节**：设置默认音调（-100 到 100）

## 支持的语音角色

### 中文语音

- **普通话**：
  - `zh-CN-XiaoxiaoNeural - Female`（晓晓，女声，默认）
  - `zh-CN-XiaoyiNeural - Female`（晓伊，女声）
  - `zh-CN-YunjianNeural - Male`（云健，男声）
  - `zh-CN-YunxiNeural - Male`（云希，男声）
  - `zh-CN-YunxiaNeural - Male`（云霞，男声）
  - `zh-CN-YunyangNeural - Male`（云扬，男声）
  - `zh-CN-liaoning-XiaobeiNeural - Female`（晓北，辽宁口音）
  - `zh-CN-shaanxi-XiaoniNeural - Female`（晓妮，陕西口音）

- **粤语**：
  - `zh-HK-HiuGaaiNeural - Female`
  - `zh-HK-HiuMaanNeural - Female`
  - `zh-HK-WanLungNeural - Male`

- **台湾国语**：
  - `zh-TW-HsiaoChenNeural - Female`
  - `zh-TW-HsiaoYuNeural - Female`
  - `zh-TW-YunJheNeural - Male`

### 英文语音

- **美式英语**：
  - `en-US-AriaNeural - Female`
  - `en-US-JennyNeural - Female`
  - `en-US-GuyNeural - Male`
  - `en-US-AndrewNeural - Male`
  - 等多种美式英语语音

- **英式英语**：
  - `en-GB-SoniaNeural - Female`
  - `en-GB-RyanNeural - Male`
  - 等多种英式英语语音

### 其他语言

支持日语、韩语、法语、德语、西班牙语、阿拉伯语、俄语、葡萄牙语等 50+ 种语言的语音合成。

完整的语音列表请查看 [data/speaker.json](./data/speaker.json) 文件。

## 作为 VITS 服务使用

本插件实现了 Koishi 的 VITS 服务接口，可以被其他插件调用：

```typescript
// 在其他插件中使用
export class MyPlugin extends Service {
  static inject = ['vits']
  
  async generateVoice() {
    const audio = await this.ctx.vits.say({
      input: '你好，世界',
      speaker_id: 0  // 使用第一个语音角色
    })
    return audio
  }
}
```

## 技术说明

- **服务提供商**：[魔搭社区 Edge TTS MCP Server](https://modelscope.cn/studios/redstoneleo/Edge-TTS-MCP-Server)
- **底层技术**：Microsoft Edge Text-to-Speech API
- **客户端库**：[@gradio/client](https://www.npmjs.com/package/@gradio/client)

## 注意事项

1. 本插件依赖于魔搭社区的在线服务，需要网络连接
2. 服务可用性取决于魔搭社区的服务状态
3. 每次语音生成都会创建新的连接，适合按需使用的场景
4. 生成的语音为临时 URL，建议及时使用

## 许可证

MIT License

## 相关链接

- [Koishi 官网](https://koishi.chat/)
- [插件市场](https://koishi.chat/market/)
- [GitHub 仓库](https://github.com/koishi-shangxue-plugins/service-more)