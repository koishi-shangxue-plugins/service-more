import { Query, deepEqual } from 'koishi'

// 读取嵌套字段
export function getValue(source: Record<string, unknown>, path: string) {
  if (!path) return source
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[segment]
  }, source)
}

// 在内存里执行查询表达式
export function evaluateQuery(row: Record<string, unknown>, query: Query.Expr): boolean {
  if (query.$and) {
    return query.$and.every(expr => evaluateQuery(row, expr))
  }
  if (query.$or) {
    return query.$or.some(expr => evaluateQuery(row, expr))
  }
  if (query.$not) {
    return !evaluateQuery(row, query.$not)
  }

  for (const key in query) {
    const value = query[key]
    const rowValue = getValue(row, key)

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const operators = Object.entries(value as Record<string, unknown>)
      if (operators.some(([operator]) => operator.startsWith('$'))) {
        const matched = operators.every(([operator, operatorValue]) => {
          switch (operator) {
            case '$eq':
              return deepEqual(rowValue, operatorValue)
            case '$ne':
              return !deepEqual(rowValue, operatorValue)
            case '$gt':
              return rowValue > operatorValue
            case '$gte':
              return rowValue >= operatorValue
            case '$lt':
              return rowValue < operatorValue
            case '$lte':
              return rowValue <= operatorValue
            case '$in':
              return Array.isArray(operatorValue) && operatorValue.some(item => deepEqual(item, rowValue))
            case '$nin':
              return Array.isArray(operatorValue) && !operatorValue.some(item => deepEqual(item, rowValue))
            case '$regex': {
              const pattern = operatorValue instanceof RegExp ? operatorValue : new RegExp(String(operatorValue))
              return pattern.test(String(rowValue ?? ''))
            }
            default:
              return false
          }
        })
        if (!matched) return false
        continue
      }
    }

    if (!deepEqual(rowValue, value)) {
      return false
    }
  }

  return true
}
