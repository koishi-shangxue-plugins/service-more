# koishi-plugin-database-txtdb

[![npm](https://img.shields.io/npm/v/koishi-plugin-database-txtdb?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-database-txtdb)

基于 TXT 文件的 Koishi 数据库服务。

## ✨ 功能

- **极简**: 使用最简单的纯文本格式，无需任何解析。
- **高度可读**: 数据以 JSON 字符串形式逐行存储，易于阅读和调试。
- **并发安全**: 通过文件锁机制确保高并发下的数据一致性。

## ⚙️ 配置

### `path`

- **类型**: `string`
- **默认值**: `'data/database/txtdb'`
- **描述**: 数据库文件（夹）的存储路径。每个数据表会在此文件夹下创建一个对应的 `.txt` 文件。
