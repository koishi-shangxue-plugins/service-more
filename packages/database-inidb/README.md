# koishi-plugin-database-inidb

[![npm](https://img.shields.io/npm/v/koishi-plugin-database-inidb?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-database-inidb)

基于 INI 文件的 Koishi 数据库服务。

## ✨ 功能

- **轻量化**: 无需额外依赖，开箱即用。
- **易于编辑**: INI 文件格式清晰，方便手动修改和查看。
- **并发安全**: 通过文件锁机制确保高并发下的数据一致性。

## ⚙️ 配置

### `path`

- **类型**: `string`
- **默认值**: `'data/database/inidb'`
- **描述**: 数据库文件（夹）的存储路径。每个数据表会在此文件夹下创建一个对应的 `.ini` 文件。
