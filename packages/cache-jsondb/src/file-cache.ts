import type { Dict } from 'koishi'
import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'

interface ShardFile {
  index: number
  path: string
}

interface FileCacheBackendOptions {
  dir: string
  extension: string
  legacyFilePath: string
  maxFileSize: number
  maxEntriesPerFile: number
  parseTable: (content: string) => Dict<any>
  stringifyTable: (table: Dict<any>) => string
  parseLegacy: (content: string) => Dict<Dict<any>>
  debug: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
}

export class FileCacheBackend {
  constructor(private readonly options: FileCacheBackendOptions) {}

  async ensureDir() {
    await fs.mkdir(this.options.dir, { recursive: true })
  }

  async load() {
    const store: Dict<Dict<any>> = Object.create(null)
    let legacyLoaded = false

    try {
      const content = await fs.readFile(this.options.legacyFilePath, 'utf8')
      Object.assign(store, content ? this.options.parseLegacy(content) : Object.create(null))
      legacyLoaded = !!content
    } catch (error) {
      if (!this.isEnoent(error)) {
        this.options.warn('读取旧版缓存文件失败：%s', error)
      }
    }

    const groups = await this.listShardGroups()
    for (const [table, shards] of groups) {
      const target = store[table] ??= Object.create(null)
      for (const shard of shards) {
        try {
          const content = await fs.readFile(shard.path, 'utf8')
          Object.assign(target, content ? this.options.parseTable(content) : Object.create(null))
        } catch (error) {
          this.options.warn('读取缓存表 %s 的分片失败：%s', table, error)
        }
      }
    }

    return { store, legacyLoaded }
  }

  async writeTable(table: string, entries?: Dict<any>) {
    const existing = await this.listTableShards(table)
    if (!entries) {
      await Promise.all(existing.map(shard => this.deleteFileIfExists(shard.path)))
      return
    }

    const shards = this.splitEntries(Object.entries(entries))
    const written = new Set<string>()

    for (let index = 0; index < shards.length; index++) {
      const filePath = resolve(this.options.dir, this.createShardName(table, index + 1))
      await this.writeAtomic(filePath, this.options.stringifyTable(shards[index]))
      written.add(filePath)
    }

    await Promise.all(existing
      .filter(shard => !written.has(shard.path))
      .map(shard => this.deleteFileIfExists(shard.path)))

    this.options.debug('缓存表 %s 已写入 %s 个分片', table, shards.length)
  }

  async removeLegacyFile() {
    await this.deleteFileIfExists(this.options.legacyFilePath)
  }

  private splitEntries(entries: [string, any][]) {
    if (!entries.length) return [Object.create(null)]

    const maxEntries = this.options.maxEntriesPerFile > 0 ? this.options.maxEntriesPerFile : Number.POSITIVE_INFINITY
    const maxFileSize = this.options.maxFileSize > 0 ? this.options.maxFileSize : Number.POSITIVE_INFINITY
    const shards: Dict<any>[] = []
    let currentEntries: [string, any][] = []

    for (const entry of entries) {
      const candidate = currentEntries.concat([entry])
      const candidateTable = Object.fromEntries(candidate)
      const tooManyEntries = candidate.length > maxEntries
      const tooLarge = maxFileSize !== Number.POSITIVE_INFINITY
        && Buffer.byteLength(this.options.stringifyTable(candidateTable), 'utf8') > maxFileSize

      if ((tooManyEntries || tooLarge) && currentEntries.length) {
        shards.push(Object.fromEntries(currentEntries))
        currentEntries = [entry]
      } else {
        currentEntries = candidate
      }
    }

    if (currentEntries.length || !shards.length) {
      shards.push(Object.fromEntries(currentEntries))
    }

    return shards
  }

  private async listShardGroups() {
    const files = await this.safeReadDir()
    const groups = new Map<string, ShardFile[]>()
    const pattern = this.createShardPattern()

    for (const file of files) {
      const matched = file.match(pattern)
      if (!matched) continue

      const decodedName = this.decodeTableName(matched[1])
      if (!decodedName) continue

      const index = matched[2] ? Number(matched[2]) : 1
      const shards = groups.get(decodedName) ?? []
      shards.push({
        index,
        path: resolve(this.options.dir, file),
      })
      groups.set(decodedName, shards)
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
    const encoded = encodeURIComponent(table)
    return index === 1
      ? `${encoded}${this.options.extension}`
      : `${encoded}.${index}${this.options.extension}`
  }

  private decodeTableName(value: string) {
    try {
      return decodeURIComponent(value)
    } catch {
      return ''
    }
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
