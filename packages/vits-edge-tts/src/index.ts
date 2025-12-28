import { Context, h, Schema, Service } from "koishi";
import type Vits from "@initencounter/vits";
import { Client } from "@gradio/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// 文本转语音结果接口
interface TTSResult {
  data: [{
    url: string;
  }];
}

class EdgeTTSVits extends Service implements Vits {
  static inject = {
    required: [] as const
  };

  private client: Client | null = null;
  private speakerList: string[] = [];

  constructor(ctx: Context, public config: EdgeTTSVits.Config) {
    super(ctx, "vits", true);

    // 加载本地语音列表
    try {
      const speakerPath = resolve(__dirname, "../data/speaker.json");
      const speakerData = readFileSync(speakerPath, "utf-8");
      this.speakerList = JSON.parse(speakerData);
      ctx.logger("vits-edge-tts").info(`已加载 ${this.speakerList.length} 个语音角色`);
    } catch (error) {
      ctx.logger("vits-edge-tts").error("加载语音列表失败:", error);
      this.speakerList = ["zh-CN-XiaoxiaoNeural - Female"];
    }

    // 注册edge-tts命令
    ctx.command("edge-tts <content:text>", "语音生成")
      .alias("vits")
      .alias("say")
      .option("speaker", "--spkr [value:string]", { fallback: config.speaker })
      .option("rate", "--rate [value:number]", { fallback: config.rate })
      .option("pitch", "--pitch [value:number]", { fallback: config.pitch })
      .action(async ({ options }, input) => {
        if (!input) return "内容未输入。";
        if (/<.*\/>/gm.test(input)) return "输入的内容不是纯文本。";

        try {
          return await this.generateSpeech(
            input,
            options.speaker,
            options.rate,
            options.pitch
          );
        } catch (error) {
          ctx.logger("vits-edge-tts").error("语音生成失败:", error);
          return "语音生成失败，请稍后重试。";
        }
      });
  }

  // 生成语音（每次调用时连接客户端）
  private async generateSpeech(
    text: string,
    voice: string,
    rate: number,
    pitch: number
  ): Promise<h> {
    // 每次调用时创建新的客户端连接
    const client = await Client.connect("https://redstoneleo-edge-tts-mcp-server.ms.show/");

    try {
      const result = await client.predict("/text_to_speech", {
        text,
        voice,
        rate,
        pitch
      }) as TTSResult;

      const audioUrl = result.data[0].url;
      return h.audio(audioUrl, { type: "voice" });
    } finally {
      // 请求完成后不需要保持连接
      this.ctx.logger("vits-edge-tts").debug("语音生成完成");
    }
  }

  // 实现Vits接口的say方法
  async say(options: Vits.Result): Promise<h> {
    const speaker = typeof options.speaker_id === "number"
      ? this.speakerList[options.speaker_id] || this.config.speaker
      : this.config.speaker;

    return this.generateSpeech(
      options.input,
      speaker,
      this.config.rate,
      this.config.pitch
    );
  }

}

namespace EdgeTTSVits {
  export interface Config {
    speaker: string;
    rate: number;
    pitch: number;
  }

  // 加载语音列表用于Schema
  const speakerPath = resolve(__dirname, "../data/speaker.json");
  let speakers: string[] = ["zh-CN-XiaoxiaoNeural - Female"];
  try {
    const speakerData = readFileSync(speakerPath, "utf-8");
    speakers = JSON.parse(speakerData);
  } catch (error) {
    // 使用默认值
  }

  export const usage = `
---

详细使用说明请查看 [README](https://github.com/koishi-shangxue-plugins/service-more/tree/main/packages/vits-edge-tts)

---
`
  export const Config: Schema<Config> = Schema.object({
    speaker: Schema.union(speakers)
      .default("zh-CN-XiaoxiaoNeural - Female")
      .description("默认语音角色"),
    rate: Schema.number()
      .min(-100)
      .max(100)
      .step(1)
      .role("slider")
      .default(0)
      .description("语速调节 (-100 到 100)"),
    pitch: Schema.number()
      .min(-100)
      .max(100)
      .step(1)
      .role("slider")
      .default(0)
      .description("音调调节 (-100 到 100)")
  }).description("基础配置");
}

export default EdgeTTSVits;