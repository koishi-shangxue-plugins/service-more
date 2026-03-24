import type { Driver, Dict } from 'koishi'
import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'

interface ShardFile {
  index: number
  name: string
  path: string
}

interface DatabaseFileDriverOptions {
  dir: string
  extension: string
  maxFileSize: number
  maxRowsPerFile: number
  parseRows: (content: string) => any[]
  stringifyRows: (rows: any[]) => string
  parseLegacyIndexes?: (content: string) => Dict<Driver.Index[]>
  debug: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
}

const INDEX_FILE_NAME = '__indexes__.json'

export class DatabaseFileDriver {
  constructor(private readonly options: DatabaseFileDriverOptions) {}

  async ensureDir() {
    await fs.mkdir(this.options.dir, { recursive: true })
  }

  async loadTables() {
    const groups = await this.listShardGroups()
    const store: Dict<any[]> = Object.create(null)

    for (const [table, shards] of groups) {
      const rows: any[] = []
      for (const shard of shards) {
        try {
          const content = await fs.readFile(shard.path, 'utf8')
          const parsed = content ? this.options.parseRows(content) : []
          rows.push(...parsed)
        } catch (error) {
          this.options.warn('读取数据表 %s 的分片 %s 失败：%s', table, shard.name, error)
        }
      }
      store[table] = rows
    }

    return store
  }

  async loadIndexes() {
    const indexPath = resolve(this.options.dir, INDEX_FILE_NAME)
    try {
      const content = await fs.readFile(indexPath, 'utf8')
      return content ? JSON.parse(content) as Dict<Driver.Index[]> : Object.create(null)
    } catch (error) {
      if (this.isEnoent(error)) {
        return this.loadLegacyIndexes()
      }
      this.options.warn('读取索引文件失败：%s', error)
      return Object.create(null)
    }
  }

  async writeTable(table: string, rows?: any[]) {
    const existing = await this.listTableShards(table)

    if (rows === undefined) {
      await Promise.all(existing.map(shard => this.deleteFileIfExists(shard.path)))
      return
    }

    const shards = this.splitRows(rows)
    const written = new Set<string>()

    for (let index = 0; index < shards.length; index++) {
      const fileName = this.createShardName(table, index + 1)
      const filePath = resolve(this.options.dir, fileName)
      const content = this.options.stringifyRows(shards[index])
      await this.writeAtomic(filePath, content)
      written.add(filePath)
    }

    await Promise.all(existing
      .filter(shard => !written.has(shard.path))
      .map(shard => this.deleteFileIfExists(shard.path)))

    this.options.debug('数据表 %s 已写入 %s 个分片', table, shards.length)
  }

  async writeIndexes(indexes: Dict<Driver.Index[]>) {
    const indexPath = resolve(this.options.dir, INDEX_FILE_NAME)
    await this.writeAtomic(indexPath, JSON.stringify(indexes, null, 2))
    await this.deleteFileIfExists(resolve(this.options.dir, `_indexes${this.options.extension}`))
  }

  async collectTableSizes() {
    const groups = await this.listShardGroups()
    const sizes: Dict<number> = Object.create(null)

    for (const [table, shards] of groups) {
      let total = 0
      for (const shard of shards) {
        try {
          const stats = await fs.stat(shard.path)
          total += stats.size
        } catch (error) {
          if (!this.isEnoent(error)) {
            this.options.warn('读取数据表 %s 的文件信息失败：%s', table, error)
          }
        }
      }
      sizes[table] = total
    }

    return sizes
  }

  private async loadLegacyIndexes() {
    if (!this.options.parseLegacyIndexes) {
      return Object.create(null)
    }

    const legacyPath = resolve(this.options.dir, `_indexes${this.options.extension}`)
    try {
      const content = await fs.readFile(legacyPath, 'utf8')
      return content ? this.options.parseLegacyIndexes(content) : Object.create(null)
    } catch (error) {
      if (!this.isEnoent(error)) {
        this.options.warn('读取旧版索引文件失败：%s', error)
      }
      return Object.create(null)
    }
  }

  private splitRows(rows: any[]) {
    if (!rows.length) return [[]]

    const maxRows = this.options.maxRowsPerFile > 0 ? this.options.maxRowsPerFile : Number.POSITIVE_INFINITY
    const maxFileSize = this.options.maxFileSize > 0 ? this.options.maxFileSize : Number.POSITIVE_INFINITY
    const shards: any[][] = []
    let current: any[] = []

    for (const row of rows) {
      const candidate = current.concat([row])
      const tooManyRows = candidate.length > maxRows
      const tooLarge = maxFileSize !== Number.POSITIVE_INFINITY
        && Buffer.byteLength(this.options.stringifyRows(candidate), 'utf8') > maxFileSize

      if ((tooManyRows || tooLarge) && current.length) {
        shards.push(current)
        current = [row]
        if (maxFileSize !== Number.POSITIVE_INFINITY
          && Buffer.byteLength(this.options.stringifyRows(current), 'utf8') > maxFileSize) {
          this.options.warn('数据表分片中存在单条超限记录，仍会单独写入一个分片')
        }
      } else {
        current = candidate
      }
    }

    if (current.length || !shards.length) {
      shards.push(current)
    }

    return shards
  }

  private async listShardGroups() {
    const files = await this.safeReadDir()
    const groups = new Map<string, ShardFile[]>()
    const pattern = this.createShardPattern()

    for (const file of files) {
      if (file === INDEX_FILE_NAME) continue
      const matched = file.match(pattern)
      if (!matched) continue

      const table = matched[1]
      if (!table || table === '_indexes') continue

      const index = matched[2] ? Number(matched[2]) : 1
      const shards = groups.get(table) ?? []
      shards.push({
        index,
        name: file,
        path: resolve(this.options.dir, file),
      })
      groups.set(table, shards)
    }

    for (const shards of groups.values()) {
      shards.sort((left, right) => left.index - right.index)
    }

    return groups
  }

  private async listTableShards(table: string) {
    const groups = await this.listShardGroups()
    return groups.get(table) ?? []
  }

  private createShardPattern() {
    const extension = this.options.extension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`^(.*?)(?:\\.(\\d+))?${extension}$`)
  }

  private createShardName(table: string, index: number) {
    return index === 1
      ? `${table}${this.options.extension}`
      : `${table}.${index}${this.options.extension}`
  }

  private async safeReadDir() {
    try {
      return await fs.readdir(this.options.dir)
    } catch (error) {
      if (this.isEnoent(error)) return []
      throw error
    }
  }

  private async writeAtomic(filePath: string, content: string) {
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
    try {
      await fs.writeFile(tempPath, content, 'utf8')
      await this.deleteFileIfExists(filePath)
      await fs.rename(tempPath, filePath)
    } finally {
      await this.deleteFileIfExists(tempPath)
    }
  }

  private async deleteFileIfExists(filePath: string) {
    try {
      await fs.unlink(filePath)
    } catch (error) {
      if (!this.isEnoent(error)) throw error
    }
  }

  private isEnoent(error: unknown): error is NodeJS.ErrnoException {
    return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
  }
}
