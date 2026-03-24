import { Awaitable, Context, Dict, Schema, Service } from 'koishi'
import { dirname, parse, resolve } from 'node:path'
import { FileCacheBackend } from './file-cache'

const CACHE_PATH = 'data/cache/cache.csv'
const MAX_FILE_SIZE = 1024 * 1024
const MAX_ENTRIES_PER_FILE = 0
const WRITE_DEBOUNCE = 1000

declare module 'koishi' {
  interface Context {
    cache: Cache
  }
}

export interface Tables {
  default: any
}

abstract class Cache extends Service {
  static [Service.provide] = 'cache'

  constructor(ctx: Context) {
    super(ctx, 'cache')
  }

  abstract clear<K extends keyof Tables>(table: K): Promise<void>
  abstract get<K extends keyof Tables>(table: K, key: string): Promise<Tables[K]>
  abstract set<K extends keyof Tables>(table: K, key: string, value: Tables[K], maxAge?: number): Promise<void>
  abstract delete<K extends keyof Tables>(table: K, key: string): Promise<void>
  abstract keys<K extends keyof Tables>(table: K): AsyncIterable<string>
  abstract values<K extends keyof Tables>(table: K): AsyncIterable<Tables[K]>
  abstract entries<K extends keyof Tables>(table: K): AsyncIterable<[string, Tables[K]]>

  async forEach<K extends keyof Tables>(table: K, callback: (value: Tables[K], key: string) => Awaitable<void>) {
    const tasks: Awaitable<void>[] = []
    for await (const [key, value] of this.entries(table)) {
      tasks.push(callback(value, key))
    }
    await Promise.all(tasks)
  }
}

function escapeCsv(value: unknown) {
  const source = String(value ?? '')
  if (!/[",\r\n]/.test(source)) return source
  return `"${source.replace(/"/g, '""')}"`
}

function parseCsvLine(line: string) {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (char === ',' && !inQuotes) {
      values.push(current)
      current = ''
      continue
    }
    current += char
  }

  values.push(current)
  return values
}

function parseJsonValue(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function parseTable(content: string) {
  const lines = content.split(/\r?\n/).filter(Boolean)
  const table: Dict<any> = Object.create(null)
  for (const line of lines.slice(1)) {
    const [key = '', value = ''] = parseCsvLine(line)
    table[key] = parseJsonValue(value)
  }
  return table
}

function stringifyTable(table: Dict<any>) {
  const lines = ['key,value']
  for (const key in table) {
    lines.push(`${escapeCsv(key)},${escapeCsv(JSON.stringify(table[key]))}`)
  }
  return lines.join('\n')
}

function parseLegacy(content: string) {
  const lines = content.split(/\r?\n/).filter(Boolean)
  const store: Dict<Dict<any>> = Object.create(null)
  for (const line of lines.slice(1)) {
    const [table = '', key = '', value = ''] = parseCsvLine(line)
    const target = store[table] ??= Object.create(null)
    target[key] = parseJsonValue(value)
  }
  return store
}

class CsvDBCache extends Cache {
  static inject = ['logger']

  private readonly legacyPath: string
  private readonly shardDir: string
  private readonly backend: FileCacheBackend
  private readonly ready: Promise<void>
  private store: Dict<Dict<any>> = Object.create(null)
  private readonly pendingWrites: Dict<() => void> = Object.create(null)
  private legacyLoaded = false
  private stopped = false

  constructor(protected ctx: Context, public config: CsvDBCache.Config) {
    super(ctx)
    this.legacyPath = resolve(ctx.baseDir, CACHE_PATH)
    const pathInfo = parse(this.legacyPath)
    this.shardDir = resolve(dirname(this.legacyPath), pathInfo.name)
    this.backend = new FileCacheBackend({
      dir: this.shardDir,
      extension: '.csv',
      legacyFilePath: this.legacyPath,
      maxFileSize: MAX_FILE_SIZE,
      maxEntriesPerFile: MAX_ENTRIES_PER_FILE,
      parseTable,
      stringifyTable,
      parseLegacy,
      debug: this.debug.bind(this),
      warn: this.warn.bind(this),
    })
    this.ready = this.initialize()
    this.ctx.on('dispose', () => this.shutdown())
  }

  private async initialize() {
    await this.backend.ensureDir()
    const loaded = await this.backend.load()
    this.store = loaded.store
    this.legacyLoaded = loaded.legacyLoaded
  }

  private async shutdown() {
    await this.ready
    if (this.stopped) return
    this.stopped = true

    const tables = Object.keys(this.pendingWrites)
    for (const table of tables) {
      this.cancelWrite(table)
      await this.flushTable(table)
    }
  }

  async clear(name: string) {
    await this.ready
    delete this.store[name]
    this.scheduleWrite(name)
  }

  async get(name: string, key: string) {
    await this.ready
    return this.table(name)[key]
  }

  async set(name: string, key: string, value: any, maxAge?: number) {
    await this.ready
    this.table(name)[key] = value
    this.scheduleWrite(name)
  }

  async delete(name: string, key: string) {
    await this.ready
    delete this.table(name)[key]
    this.scheduleWrite(name)
  }

  async *keys(table: string) {
    await this.ready
    yield* Object.keys(this.table(table))
  }

  async *values(table: string) {
    await this.ready
    yield* Object.values(this.table(table))
  }

  async *entries(table: string) {
    await this.ready
    const entries = this.table(table)
    for (const key in entries) {
      yield [key, entries[key]] as [string, any]
    }
  }

  private table(name: string) {
    return this.store[name] ??= Object.create(null)
  }

  private scheduleWrite(table: string) {
    this.cancelWrite(table)
    this.pendingWrites[table] = this.ctx.setTimeout(() => {
      void this.flushTable(table)
    }, WRITE_DEBOUNCE)
  }

  private cancelWrite(table: string) {
    const dispose = this.pendingWrites[table]
    if (!dispose) return
    dispose()
    delete this.pendingWrites[table]
  }

  private async flushTable(table: string) {
    await this.ready
    delete this.pendingWrites[table]
    await this.migrateLegacyIfNeeded()

    const entries = this.store[table]
    if (entries && !Object.keys(entries).length) {
      delete this.store[table]
    }

    try {
      await this.backend.writeTable(table, this.store[table])
    } catch (error) {
      this.warn('写入缓存表 %s 失败：%s', table, error)
    }
  }

  private async migrateLegacyIfNeeded() {
    if (!this.legacyLoaded) return

    const tables = Object.keys(this.store)
    for (const table of tables) {
      await this.backend.writeTable(table, this.store[table])
    }

    await this.backend.removeLegacyFile()
    this.legacyLoaded = false
  }

  private debug(message: string, ...args: unknown[]) {
    if (!this.config.debug) return
    this.ctx.logger('cache').debug(message, ...args)
  }

  private warn(message: string, ...args: unknown[]) {
    this.ctx.logger('cache').warn(message, ...args)
  }
}

namespace CsvDBCache {
  export interface Config {
    debug: boolean
  }

  export const Config: Schema<Config> = Schema.object({
    debug: Schema.boolean().description('是否输出调试日志。').default(false),
  })
}

export default CsvDBCache
