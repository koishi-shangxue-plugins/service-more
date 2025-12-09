import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'

import { Fonts } from './font'

/**
 * Merge font lists, update existing fonts and return new fonts
 * @param existingFonts
 * @param newFonts
 * @returns List of merged fonts
 */
export function mergeFonts(existingFonts: Fonts.Font[], newFonts: Fonts.Font[]): Fonts.Font[] {
  const sourceSymbol = Symbol.for('source')

  function getFontSource(font: Fonts.Font): any {
    return sourceSymbol in font
      ? font[sourceSymbol]
      : 'source' in font ? (font as any).source : undefined
  }

  const result = [...existingFonts]

  for (const newFont of newFonts) {
    const existingIndex = result.findIndex((font) => font.id === newFont.id)

    if (existingIndex === -1) {
      result.push(newFont)
    }
    else {
      const existingFont = result[existingIndex]
      const existingSource = getFontSource(existingFont)
      const newSource = getFontSource(newFont)

      if (existingSource === undefined || newSource === undefined || existingSource === newSource) {
        result[existingIndex] = newFont
      }
      else {
        result.push(newFont)
      }
    }
  }

  return result
}

/**
 * Checks if a string is a URL by testing if it starts with a protocol scheme followed by "://".
 * The function verifies that the string begins with a letter followed by letters, numbers,
 * plus signs, periods, or hyphens, and then "://".
 *
 * @param str - The string to check if it's a URL
 * @returns `true` if the string matches URL pattern, `false` otherwise
 *
 * @example
 * isUrl("http://example.com"); // true
 * isUrl("ftp://files.server.com"); // true
 * isUrl("file:///file"); // true
 * isUrl("example.com"); // false
 * isUrl("//example.com"); // false
 */
export function isUrl(str: string) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(str)
}

/**
 * Retrieves information about a file at the specified path.
 *
 * @param path - The path to the file to get information for. Can be a local file path or URL.
 * @returns An object containing the file's SHA256 hash as `id` and size in bytes.
 *          Returns `{ id: '', size: 0 }` if the path is a URL or if the file cannot be read.
 */
export async function getFileInfo(path: string) {
  if (!isUrl(path)) {
    try {
      const id = await getFileSha256(path)
      const fileStat = await stat(path)
      return { id, size: fileStat.size }
    }
    catch (e) {
      this.ctx.logger.warn(`Failed to read file: ${path}`, e.message)
    }
  }

  return { id: '', size: 0 }
}

/**
 * Computes the SHA-256 hash of a file at the specified path.
 *
 * @param path - The file path for which the SHA-256 hash is to be calculated.
 * @returns A promise that resolves to the SHA-256 hash of the file as a hexadecimal string.
 *
 * @throws Will throw an error if the file cannot be read or if there is an issue during the hashing process.
 */
export async function getFileSha256(path: string): Promise<string> {
  const sha256 = createHash('sha256')
  const fileStream = createReadStream(path)
  await new Promise<void>((resolve, reject) => {
    fileStream
      .on('data', (chunk) => sha256.update(chunk))
      .on('end', resolve)
      .on('error', reject)
  })

  return sha256.digest('hex')
}

export class ReadWriteLock {
  private waitingReaders: (() => void)[] = []
  private waitingWriters: (() => void)[] = []
  private activeReaders = 0
  private activeWriter = false
  private writerPreference: boolean

  constructor(writerPreference = false) {
    this.writerPreference = writerPreference
  }

  /**
   * Acquire read lock
   * @returns Function to release the read lock
   */
  async acquireReadLock() {
    // If there is an active writer, or waiting writers and writer preference is enabled
    if (this.activeWriter || (this.writerPreference && this.waitingWriters.length > 0)) {
      await new Promise<void>((resolve) => {
        this.waitingReaders.push(resolve)
      })
    }

    this.activeReaders++

    return () => this.releaseReadLock()
  }

  /**
   * Acquire write lock
   * @returns Function to release the write lock
   */
  async acquireWriteLock() {
    // If there are active readers or an active writer
    if (this.activeReaders > 0 || this.activeWriter) {
      await new Promise<void>((resolve) => {
        this.waitingWriters.push(resolve)
      })
    }

    this.activeWriter = true

    return () => this.releaseWriteLock()
  }

  /**
   * Release read lock
   */
  private releaseReadLock() {
    this.activeReaders--
    this.wakeUpWaiters()
  }

  /**
   * Release write lock
   */
  private releaseWriteLock() {
    this.activeWriter = false
    this.wakeUpWaiters()
  }

  /**
   * Wake up waiting operations
   */
  private wakeUpWaiters() {
    if (this.activeWriter || this.activeReaders > 0) {
      return // If there are still active readers or writers, don't wake up any waiters
    }

    if (this.writerPreference && this.waitingWriters.length > 0) {
      // Prioritize waking up a waiting writer
      const writer = this.waitingWriters.shift()
      writer?.()
    }
    else if (this.waitingReaders.length > 0) {
      // Wake up all waiting readers
      const readers = [...this.waitingReaders]
      this.waitingReaders = []
      readers.forEach((reader) => reader())
    }
    else if (this.waitingWriters.length > 0) {
      // Wake up a waiting writer
      const writer = this.waitingWriters.shift()
      writer?.()
    }
  }

  /**
   * Execute a function with read lock
   * @param fn Function to execute
   * @returns Result of the function
   */
  async withReadLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const release = await this.acquireReadLock()
    try {
      return await fn()
    }
    finally {
      release()
    }
  }

  /**
   * Execute a function with write lock
   * @param fn Function to execute
   * @returns Result of the function
   */
  async withWriteLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const release = await this.acquireWriteLock()
    try {
      return await fn()
    }
    finally {
      release()
    }
  }

  /**
   * Get current lock state information
   * @returns Lock status information
   */
  getStatus() {
    return {
      activeReaders: this.activeReaders,
      activeWriter: this.activeWriter,
      waitingReaders: this.waitingReaders.length,
      waitingWriters: this.waitingWriters.length,
      writerPreference: this.writerPreference,
    }
  }

  /**
   * Wait for all pending write operations to complete
   * This provides a synchronization point to ensure all writes are finished
   *
   * @returns A promise that resolves when all pending writes are completed
   */
  async waitForWritesToComplete(): Promise<void> {
    return await this.withWriteLock(() => {})
  }
}

/**
 * Type guard function that determines if an unknown object is a valid {@link Fonts.FontManifest}.
 *
 * A valid Font Manifest must:
 * - Be a non-null object
 * - Have a string `version` property
 * - Have a `fonts` object property containing font families
 * - Each font family must be an array of valid FontManifestSource
 * - If present, the optional `options` property must be an object with some options
 *
 * @param obj - The object to check
 * @returns True if the object is a valid Font Manifest, false otherwise
 */
export function isFontManifest(obj: unknown): obj is Fonts.FontManifest {
  if (!obj || typeof obj !== 'object') return false

  if (!('version' in obj && typeof obj.version === 'string')) return false
  if (!('fonts' in obj && typeof obj.fonts === 'object' && obj.fonts !== null)) return false

  const fonts = obj.fonts as Record<string, unknown>
  for (const family in fonts) {
    const sources = fonts[family]
    if (!Array.isArray(sources)) return false

    for (const source of sources) {
      if (!isFontManifestSource(source)) return false
    }
  }

  if ('options' in obj) {
    const options = obj.options
    if (!isFontManifestOptions(options)) return false
  }

  return true
}

/**
 * Type guard that checks if the given object is a valid {@link Fonts.FontManifestSource}.
 *
 * A valid FontManifestSource must:
 * - Be an object
 * - Have a 'type' property which is one of: 'local', 'remote', or 'google'
 * - For 'google' type: must have a 'urls' property that is an array
 * - For 'local' or 'remote' types: must have a 'slice' property that is an array
 *
 * @param obj - The object to check
 * @returns True if the object is a valid FontManifestSource, false otherwise
 */
function isFontManifestSource(obj: unknown): obj is Fonts.FontManifestSource {
  if (!obj || typeof obj !== 'object') return false

  if (!('type' in obj && typeof obj.type === 'string')) return false
  const { type } = obj as { type: string }
  if (!['local', 'remote', 'google'].includes(type)) return false

  if ('options' in obj) {
    const options = obj.options
    if (!isFontManifestOptions(options)) return false
  }

  if (type === 'google') {
    return 'urls' in obj && Array.isArray((obj as any).urls)
  }
  else {
    return 'slice' in obj && Array.isArray((obj as any).slice)
  }
}

/**
 * Type guard that checks if the provided object conforms to the {@link Fonts.FontManifestOptions} interface.
 *
 * @param obj - The object to check
 * @returns A type predicate indicating whether the object is a FontManifestOptions
 */
function isFontManifestOptions(obj: unknown): obj is Fonts.FontManifestOptions {
  if (obj === null || obj === undefined || typeof obj !== 'object') return false

  const options = obj as Record<string, unknown>
  if ('getSha256' in options && typeof options.getSha256 !== 'boolean') return false

  return true
}

export function isNonEmptyString(str?: string | null): boolean {
  return Boolean(str && str.trim().length > 0)
}
