# koishi-plugin-database-csvdb

[![npm](https://img.shields.io/npm/v/koishi-plugin-database-csvdb?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-database-csvdb)

基于 CSV 文件的 Koishi 数据库服务。

## ✨ 功能

- **轻量化**: 无需额外依赖，开箱即用。
- **通用性强**: CSV 格式通用，可被多种表格软件（如 Excel）直接打开和编辑。
- **并发安全**: 通过文件锁机制确保高并发下的数据一致性。

## ⚙️ 配置

### `path`

- **类型**: `string`
- **默认值**: `'data/database/csvdb'`
- **描述**: 数据库文件（夹）的存储路径。每个数据表会在此文件夹下创建一个对应的 `.csv` 文件。
