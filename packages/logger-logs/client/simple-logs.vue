<template>
  <virtual-list class="log-list k-text-selectable" :data="logs" :count="100" :max-height="maxHeight">
    <template #="record">
      <div class="line">
        <code v-html="renderLine(record)"></code>
      </div>
    </template>
  </virtual-list>
</template>

<script lang="ts" setup>
import { Time, VirtualList } from '@koishijs/client';
import Logger from 'reggol';
import ansi from 'ansi_up';

defineProps<{
  logs: Logger.Record[],
  maxHeight?: string,
}>();

const converter = new (ansi['default'] || ansi)();

function renderColor(code: number, value: any, decoration = '')
{
  return `\u001b[3${code < 8 ? code : '8;5;' + code}${decoration}m${value}\u001b[0m`;
}

const showTime = 'yyyy-MM-dd hh:mm:ss';

function renderLine(record: Logger.Record)
{
  const prefix = `[${record.type[0].toUpperCase()}]`;
  const space = ' ';
  let indent = 3 + space.length, output = '';
  indent += showTime.length + space.length;
  output += renderColor(8, Time.template(showTime, new Date(record.timestamp))) + space;
  const code = Logger.code(record.name, { colors: 3 });
  const label = renderColor(code, record.name, ';1');
  const padLength = label.length - record.name.length;
  output += prefix + space + label.padEnd(padLength) + space;
  output += record.content.replace(/\n/g, '\n' + ' '.repeat(indent));
  return converter.ansi_to_html(output);
}
</script>

<style lang="scss" scoped>
.log-list {
  color: var(--terminal-fg);
  background-color: var(--terminal-bg);
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
  font-size: 14px;

  :deep(.el-scrollbar__view) {
    padding: 0.5rem 1rem;
  }

  .line {
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-all;
  }
}
</style>