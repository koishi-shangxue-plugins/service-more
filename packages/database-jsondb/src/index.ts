import { Context, Schema, Driver, Selection, Dict, deepEqual, executeUpdate, Eval } from 'koishi'
import { resolve } from 'node:path'
import { DatabaseFileDriver } from './file-driver'
import { evaluateQuery, getValue } from './query'

const DATABASE_PATH = 'data/database/jsondb'
const MAX_FILE_SIZE = 1024 * 1024
const MAX_ROWS_PER_FILE = 0
const WRITE_DEBOUNCE = 1000

function parseRows(content: string) {
  const parsed = JSON.parse(content)
  return Array.isArray(parsed) ? parsed : []
}

function stringifyRows(rows: any[]) {
  return JSON.stringify(rows, null, 2)
}

function parseLegacyIndexes(content: string) {
  const parsed = JSON.parse(content)
  return parsed && typeof parsed === 'object' ? parsed as Dict<Driver.Index[]> : Object.create(null)
}

class JsonDBDriver extends Driver {
  static name = 'jsondb'
  static inject = ['logger']

  private readonly basePath: string
  private readonly fileDriver: DatabaseFileDriver
  private store: Dict<any[]> = Object.create(null)
  private indexStore: Dict<Driver.Index[]> = Object.create(null)
  private readonly pendingWrites: Dict<() => void> = Object.create(null)
  private pendingIndexWrite: (() => void) | null = null
  private transactionalStore: Dict<any[]> | null = null
  private transactionalIndexes: Dict<Driver.Index[]> | null = null
  private stopped = false

  constructor(public ctx: Context, public config: JsonDBDriver.Config) {
    super(ctx, config)
    this.logger = ctx.logger(JsonDBDriver.name)
    this.basePath = resolve(ctx.baseDir, DATABASE_PATH)
    this.fileDriver = new DatabaseFileDriver({
      dir: this.basePath,
      extension: '.json',
      maxFileSize: MAX_FILE_SIZE,
      maxRowsPerFile: MAX_ROWS_PER_FILE,
      parseRows,
      stringifyRows,
      parseLegacyIndexes,
      debug: this.debug.bind(this),
      warn: this.warn.bind(this),
    })
  }

  async start() {
    this.stopped = false
    await this.fileDriver.ensureDir()
    this.store = await this.fileDriver.loadTables()
    this.indexStore = await this.fileDriver.loadIndexes()
    this.ctx.on('dispose', () => this.stop())
  }

  async stop() {
    if (this.stopped) return
    this.stopped = true

    const tables = Object.keys(this.pendingWrites)
    for (const table of tables) {
      this.cancelTableWrite(table)
      await this.flushTable(table)
    }

    if (this.pendingIndexWrite) {
      this.cancelIndexWrite()
      await this.flushIndexes()
    }
  }

  async drop(table: string) {
    delete this.activeStore()[table]
    this.scheduleTableWrite(table)
  }

  async dropAll() {
    const store = this.activeStore()
    const tables = Object.keys(store)
    if (this.transactionalStore) {
      this.transactionalStore = Object.create(null)
    } else {
      this.store = Object.create(null)
    }
    for (const table of tables) {
      this.scheduleTableWrite(table)
    }
  }

  async stats() {
    const stats: Driver.Stats = { size: 0, tables: {} }
    const sizes = await this.fileDriver.collectTableSizes()
    const store = this.activeStore()

    for (const table in store) {
      if (table === '_indexes') continue
      const size = sizes[table] ?? 0
      stats.tables[table] = {
        count: store[table]?.length ?? 0,
        size,
      }
      stats.size += size
    }

    for (const table in sizes) {
      if (table in stats.tables || table === '_indexes') continue
      stats.tables[table] = {
        count: 0,
        size: sizes[table],
      }
      stats.size += sizes[table]
    }

    return stats
  }

  async prepare(table: string) {
    const store = this.activeStore()
    if (!store[table]) {
      this.logger.info('auto creating table %c', table)
      store[table] = []
    }
  }

  async get(sel: Selection.Immutable) {
    const { table, query, args } = sel
    const [options] = args
    const source = (this.activeStore()[table as string] ?? []).filter(row => evaluateQuery(row, query))
    let result = source.slice()

    if (options.sort) {
      result.sort((left, right) => {
        for (const key in options.sort) {
          const order = options.sort[key]
          const leftValue = getValue(left, key)
          const rightValue = getValue(right, key)
          if (leftValue < rightValue) return order === 'asc' ? -1 : 1
          if (leftValue > rightValue) return order === 'asc' ? 1 : -1
        }
        return 0
      })
    }

    const offset = options.offset ?? 0
    const limit = options.limit ?? Number.POSITIVE_INFINITY
    result = result.slice(offset, offset + limit)

    if (options.fields && Object.keys(options.fields).length) {
      const inclusion = Object.values(options.fields)[0]
      const keys = Object.keys(options.fields)
      result = result.map((row) => {
        if (inclusion) {
          const output: Record<string, unknown> = {}
          for (const key of keys) {
            const value = getValue(row, key)
            if (value !== undefined) output[key] = value
          }
          return output
        }

        const output = { ...row }
        for (const key of keys) {
          delete output[key]
        }
        return output
      })
    }

    return result
  }

  async eval(sel: Selection.Immutable, expr: Eval.Expr) {
    const rows = await this.get(sel)
    const aggrKey = Object.keys(expr)[0] as keyof Eval.Aggr<any>
    const aggrValue = expr[aggrKey]

    if (aggrKey === '$count') return rows.length

    const values = rows.map((row) => {
      const value = typeof aggrValue === 'string' ? getValue(row, aggrValue) : aggrValue
      return typeof value === 'number' ? value : 0
    })

    if (!values.length) return 0

    switch (aggrKey) {
      case '$sum':
        return values.reduce((total, value) => total + value, 0)
      case '$avg':
        return values.reduce((total, value) => total + value, 0) / values.length
      case '$max':
        return Math.max(...values)
      case '$min':
        return Math.min(...values)
      default:
        this.warn('不支持的聚合操作：%s', aggrKey)
        return 0
    }
  }

  async set(sel: Selection.Mutable, update: {}) {
    const { table, query, ref } = sel
    const tableData = this.activeStore()[table as string] ?? []
    let matched = 0
    let modified = 0

    for (const row of tableData) {
      if (!evaluateQuery(row, query)) continue
      matched += 1
      const before = structuredClone(row)
      executeUpdate(row, update, ref)
      if (!deepEqual(before, row)) {
        modified += 1
      }
    }

    if (modified) this.scheduleTableWrite(table as string)
    return { matched, modified }
  }

  async remove(sel: Selection.Mutable) {
    const { table, query } = sel
    const tableData = this.activeStore()[table as string] ?? []
    let removed = 0
    const remained = tableData.filter((row) => {
      const matched = evaluateQuery(row, query)
      if (matched) removed += 1
      return !matched
    })

    if (removed) {
      this.activeStore()[table as string] = remained
      this.scheduleTableWrite(table as string)
    }

    return { matched: removed, removed }
  }

  async create(sel: Selection.Mutable, data: {}) {
    const { table, model } = sel
    const tableData = this.activeStore()[table as string] ??= []
    const row = model.create(data)

    if (model.primary && model.autoInc && !Array.isArray(model.primary)) {
      const primaryKey = model.primary
      if (row[primaryKey] === undefined || row[primaryKey] === null) {
        const maxId = tableData.reduce((current, item) => Math.max(current, Number(item[primaryKey] ?? 0)), 0)
        row[primaryKey] = maxId + 1
      }
    }

    tableData.push(row)
    this.scheduleTableWrite(table as string)
    return row
  }

  async upsert(sel: Selection.Mutable, data: any[], keys: string[]) {
    const { table, model, ref } = sel
    const tableData = this.activeStore()[table as string] ??= []
    const result = { inserted: 0, matched: 0, modified: 0 }

    for (const item of data) {
      const query = Object.fromEntries(keys.map(key => [key, item[key]]))
      const existedRows = tableData.filter(row => evaluateQuery(row, query))

      if (existedRows.length) {
        for (const row of existedRows) {
          result.matched += 1
          const before = structuredClone(row)
          executeUpdate(row, item, ref)
          if (!deepEqual(before, row)) {
            result.modified += 1
          }
        }
        continue
      }

      const row = executeUpdate(model.create(), item, ref)
      if (model.primary && model.autoInc && !Array.isArray(model.primary)) {
        const primaryKey = model.primary
        if (row[primaryKey] === undefined || row[primaryKey] === null) {
          const maxId = tableData.reduce((current, currentRow) => Math.max(current, Number(currentRow[primaryKey] ?? 0)), 0)
          row[primaryKey] = maxId + 1
        }
      }
      tableData.push(row)
      result.inserted += 1
    }

    if (result.inserted || result.modified) {
      this.scheduleTableWrite(table as string)
    }
    return result
  }

  async withTransaction(callback: () => Promise<void>) {
    if (this.transactionalStore && this.transactionalIndexes) {
      return callback()
    }

    this.transactionalStore = structuredClone(this.store)
    this.transactionalIndexes = structuredClone(this.indexStore)

    try {
      await callback()
      const previousStore = this.store
      const previousIndexes = this.indexStore
      this.store = this.transactionalStore
      this.indexStore = this.transactionalIndexes

      const tables = new Set([...Object.keys(previousStore), ...Object.keys(this.store)])
      for (const table of tables) {
        if (!deepEqual(previousStore[table], this.store[table])) {
          this.scheduleTableWrite(table)
        }
      }

      if (!deepEqual(previousIndexes, this.indexStore)) {
        this.scheduleIndexWrite()
      }
    } finally {
      this.transactionalStore = null
      this.transactionalIndexes = null
    }
  }

  async getIndexes(table: string) {
    return this.activeIndexes()[table] ?? []
  }

  async createIndex(table: string, index: Driver.Index) {
    const indexes = this.activeIndexes()
    const tableIndexes = indexes[table] ??= []
    const name = index.name || Object.keys(index.keys).join('_')
    if (tableIndexes.some(item => item.name === name)) {
      this.warn('数据表 %s 上的索引 %s 已存在', table, name)
      return
    }
    tableIndexes.push({ ...index, name })
    this.scheduleIndexWrite()
  }

  async dropIndex(table: string, name: string) {
    const indexes = this.activeIndexes()
    const tableIndexes = indexes[table] ?? []
    const position = tableIndexes.findIndex(item => item.name === name)
    if (position === -1) return
    tableIndexes.splice(position, 1)
    this.scheduleIndexWrite()
  }

  private activeStore() {
    return this.transactionalStore ?? this.store
  }

  private activeIndexes() {
    return this.transactionalIndexes ?? this.indexStore
  }

  private scheduleTableWrite(table: string) {
    this.cancelTableWrite(table)
    this.pendingWrites[table] = this.ctx.setTimeout(() => {
      void this.flushTable(table)
    }, WRITE_DEBOUNCE)
  }

  private cancelTableWrite(table: string) {
    const dispose = this.pendingWrites[table]
    if (!dispose) return
    dispose()
    delete this.pendingWrites[table]
  }

  private scheduleIndexWrite() {
    this.cancelIndexWrite()
    this.pendingIndexWrite = this.ctx.setTimeout(() => {
      void this.flushIndexes()
    }, WRITE_DEBOUNCE)
  }

  private cancelIndexWrite() {
    this.pendingIndexWrite?.()
    this.pendingIndexWrite = null
  }

  private async flushTable(table: string) {
    delete this.pendingWrites[table]
    if (this.transactionalStore) return
    try {
      await this.fileDriver.writeTable(table, this.store[table])
    } catch (error) {
      this.warn('写入数据表 %s 失败：%s', table, error)
    }
  }

  private async flushIndexes() {
    this.pendingIndexWrite = null
    if (this.transactionalIndexes) return
    try {
      await this.fileDriver.writeIndexes(this.indexStore)
    } catch (error) {
      this.warn('写入索引文件失败：%s', error)
    }
  }

  private debug(message: string, ...args: unknown[]) {
    if (!this.config.debug) return
    this.logger.debug(message, ...args)
  }

  private warn(message: string, ...args: unknown[]) {
    this.logger.warn(message, ...args)
  }
}

namespace JsonDBDriver {
  export interface Config {
    debug: boolean
  }

  export const Config: Schema<Config> = Schema.object({
    debug: Schema.boolean().description('是否输出调试日志。').default(false),
  })
}

export default JsonDBDriver
