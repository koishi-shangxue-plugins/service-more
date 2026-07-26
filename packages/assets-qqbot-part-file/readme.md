# assets-qqbot-part-file

QQ 机器人分片上传版 `assets` 服务。

## 支持内容

- 图片
- 视频
- 音频

## 说明

- 通过 QQ 官方 `upload_prepare -> PUT 分片 -> upload_part_finish -> files` 流程获取可公开访问的 `raw_url`
- 图片链接会自动补上 `response-content-type=image/jpeg`，便于嵌入 Markdown
- `file_type=4` 的普通文件不会返回 `raw_url`，因此不适合作为 Markdown 图片 URL

## 配置项

- `appid`：QQ 机器人 AppID
- `appSecret`：QQ 机器人 AppSecret
- `groupId`：用于上传的群 OpenID
