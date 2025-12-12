<template>
  <div class="log-container" ref="containerEl">
    <!-- 顶部控制栏：搜索框 -->
    <div class="log-header">
      <el-input v-model="searchQuery" placeholder="搜索日志..." clearable size="small" :prefix-icon="Search" />
    </div>

    <!-- 日志主体：使用 ElScrollbar 实现自定义滚动 -->
    <el-scrollbar ref="scrollbarRef" @scroll="handleScroll" class="log-body">
      <div class="log-list">
        <!-- 虚拟列表的内容 -->
        <div v-for="log in filteredLogs" :key="log.id" class="log-item">
          <span class="log-time" v-html="renderTime(log)"></span>
          <span class="log-name" v-html="renderName(log)"></span>
          <pre class="log-content" v-html="renderContent(log)"></pre>
        </div>
      </div>
    </el-scrollbar>

    <!-- 滚动到底部按钮 -->
    <transition name="fade">
      <el-button v-if="showScrollToBottom" class="scroll-to-bottom" type="primary" circle :icon="ArrowDown"
        @click="scrollToBottom" />
    </transition>
  </div>
</template>

<script lang="ts" setup>
import { ref, watch, computed, nextTick } from 'vue';
import { Time } from '@koishijs/client';
import Logger from 'reggol';
import ansi from 'ansi_up';
import { ElScrollbar, ElInput, ElButton } from 'element-plus';
import { Search, ArrowDown } from '@element-plus/icons-vue';

const props = defineProps<{
  logs: Logger.Record[];
}>();

// 模板引用
const scrollbarRef = ref<InstanceType<typeof ElScrollbar>>();
const containerEl = ref<HTMLDivElement>();

// 状态变量
const searchQuery = ref('');
const isNearBottom = ref(true); // 默认在底部
const showScrollToBottom = ref(false);

// ANSI 转换器
const converter = new (ansi['default'] || ansi)();

// 通过搜索查询过滤日志
const filteredLogs = computed(() =>
{
  if (!searchQuery.value)
  {
    return props.logs;
  }
  const query = searchQuery.value.toLowerCase();
  return props.logs.filter(log =>
    log.content.toLowerCase().includes(query) ||
    log.name.toLowerCase().includes(query)
  );
});

// 监听日志和过滤器的变化
watch([filteredLogs, () => props.logs.length], () =>
{
  // 检查用户是否正在选择文本
  const selection = window.getSelection();
  const isSelecting = selection && selection.type === 'Range' && selection.toString().length > 0;

  if (isNearBottom.value && !isSelecting)
  {
    scrollToBottom();
  }
});

// 滚动事件处理器
const handleScroll = ({ scrollTop, scrollLeft }) =>
{
  const scrollbar = scrollbarRef.value;
  if (!scrollbar || !scrollbar.wrapRef) return;

  const el = scrollbar.wrapRef;
  const scrollHeight = el.scrollHeight;
  const clientHeight = el.clientHeight;
  // 计算距离底部的距离 (50条日志 * 20px/条 约等于 1000px)
  const bottomThreshold = 1000;

  isNearBottom.value = scrollHeight - scrollTop - clientHeight < bottomThreshold;
  showScrollToBottom.value = !isNearBottom.value;
};

// 滚动到底部
const scrollToBottom = () =>
{
  nextTick(() =>
  {
    scrollbarRef.value?.scrollTo({ top: scrollbarRef.value?.wrapRef?.scrollHeight, behavior: 'smooth' });
  });
};

// 渲染函数
const renderColor = (code: number, value: any, decoration = '') => `\u001b[3${code < 8 ? code : '8;5;' + code}${decoration}m${value}\u001b[0m`;
const showTime = 'yyyy-MM-dd hh:mm:ss';
const renderTime = (record: Logger.Record) => converter.ansi_to_html(renderColor(8, Time.template(showTime, new Date(record.timestamp))));
const renderName = (record: Logger.Record) =>
{
  const prefix = `[${record.type[0].toUpperCase()}]`;
  const code = Logger.code(record.name, { colors: 3 });
  const label = renderColor(code, record.name, ';1');
  return converter.ansi_to_html(`${prefix} ${label}`);
};
const renderContent = (record: Logger.Record) => converter.ansi_to_html(record.content)

</script>

<style lang="scss" scoped>
.log-container {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  background-color: var(--terminal-bg);
  color: var(--terminal-fg);
  position: relative;
}

.log-header {
  padding: 8px 12px;
  background-color: var(--k-card-bg);
  border-bottom: 1px solid var(--k-border-color);
}

.log-body {
  flex-grow: 1;
}

.log-list {
  padding: 8px 12px;
}

.log-item {
  display: flex;
  align-items: baseline;
  line-height: 1.5;
  padding: 1px 0;
  /* 减小垂直 padding 来使行间距更紧凑 */
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
  /* 强制统一字体 */
}

.log-time {
  flex-shrink: 0;
  width: 160px;
}

.log-name {
  flex-shrink: 0;
  width: 180px;
  margin-left: 12px;
  font-weight: bold;
}

.log-content {
  flex-grow: 1;
  margin: 0;
  /* 移除 pre 标签的默认 margin */
  margin-left: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}

.scroll-to-bottom {
  position: absolute;
  right: 20px;
  bottom: 20px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
