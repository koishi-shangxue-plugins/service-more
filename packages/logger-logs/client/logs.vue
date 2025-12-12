<template>
  <div class="log-container" ref="containerEl"
    :style="{ '--time-width': timeWidth + 'px', '--name-width': nameWidth + 'px' }">
    <!-- 顶部控制栏：搜索框 -->
    <div class="log-toolbar">
      <el-input v-model="searchQuery" placeholder="搜索日志..." clearable size="small" :prefix-icon="Search" />
    </div>

    <!-- 表头：支持排序和列宽调整 -->
    <div class="log-header-row">
      <!-- 时间列 -->
      <div class="header-cell time-col" @click="toggleSort('time')">
        <span>时间</span>
        <el-icon v-if="sortKey === 'time'" class="sort-icon">
          <component :is="sortOrder === 'asc' ? CaretTop : CaretBottom" />
        </el-icon>
        <div class="resizer" @click.stop @mousedown="startResize($event, 'time')"></div>
      </div>

      <!-- 名称列 -->
      <div class="header-cell name-col" @click="toggleSort('name')">
        <span>来源</span>
        <el-icon v-if="sortKey === 'name'" class="sort-icon">
          <component :is="sortOrder === 'asc' ? CaretTop : CaretBottom" />
        </el-icon>
        <div class="resizer" @click.stop @mousedown="startResize($event, 'name')"></div>
      </div>

      <!-- 内容列 -->
      <div class="header-cell content-col">
        <span>消息内容</span>
      </div>
    </div>

    <!-- 日志主体：使用 VirtualList 实现高性能渲染 -->
    <div class="log-body" ref="logBodyRef">
      <virtual-list ref="virtualListRef" :data="sortedLogs" :count="100" class="virtual-list-container"
        :style="{ height: listHeight + 'px' }">
        <template #default="log">
          <div class="log-item">
            <div class="log-cell time-col" v-html="renderTime(log)"></div>
            <div class="log-cell name-col" v-html="renderName(log)"></div>
            <div class="log-cell content-col" v-html="renderContent(log)"></div>
          </div>
        </template>
      </virtual-list>
    </div>

    <!-- 滚动到底部按钮 -->
    <transition name="fade">
      <el-button v-if="showScrollToBottom" class="scroll-to-bottom" type="primary" circle :icon="ArrowDown"
        @click="scrollToBottom" />
    </transition>
  </div>
</template>

<script lang="ts" setup>
import { ref, watch, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { Time, VirtualList } from '@koishijs/client';
import Logger from 'reggol';
import ansi from 'ansi_up';
import { ElInput, ElButton, ElIcon } from 'element-plus';
import { Search, ArrowDown, CaretTop, CaretBottom } from '@element-plus/icons-vue';

const props = defineProps<{
  logs: Logger.Record[];
}>();

// --- 状态变量 ---
const searchQuery = ref('');
const sortKey = ref<'time' | 'name' | null>(null);
const sortOrder = ref<'asc' | 'desc'>('asc');
const timeWidth = ref(170); // 调整为更紧凑的时间列宽
const nameWidth = ref(240); // 增加来源列宽以适应较长的插件名
const showScrollToBottom = ref(false);
const isNearBottom = ref(true);
const listHeight = ref(0); // 动态计算列表高度

// --- 模板引用 ---
const containerEl = ref<HTMLElement>();
const virtualListRef = ref();
const logBodyRef = ref<HTMLElement>(); // 新增引用
let scrollableEl: HTMLElement | null = null;
let resizeObserver: ResizeObserver | null = null;

// --- ANSI 转换器 ---
const converter = new (ansi['default'] || ansi)();

// --- 过滤与排序 ---
const filteredLogs = computed(() =>
{
  if (!searchQuery.value) return props.logs;
  const query = searchQuery.value.toLowerCase();
  return props.logs.filter(log =>
    log.content.toLowerCase().includes(query) ||
    log.name.toLowerCase().includes(query)
  );
});

const sortedLogs = computed(() =>
{
  const logs = [...filteredLogs.value];
  if (!sortKey.value) return logs;

  return logs.sort((a, b) =>
  {
    let valA, valB;
    if (sortKey.value === 'time')
    {
      valA = a.timestamp;
      valB = b.timestamp;
    } else
    {
      valA = a.name;
      valB = b.name;
    }

    if (valA < valB) return sortOrder.value === 'asc' ? -1 : 1;
    if (valA > valB) return sortOrder.value === 'asc' ? 1 : -1;
    return 0;
  });
});

// --- 排序逻辑 ---
const toggleSort = (key: 'time' | 'name') =>
{
  if (sortKey.value === key)
  {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  } else
  {
    sortKey.value = key;
    sortOrder.value = 'asc';
  }
};

// --- 列宽调整逻辑 ---
const startResize = (e: MouseEvent, col: 'time' | 'name') =>
{
  const startX = e.clientX;
  const startWidth = col === 'time' ? timeWidth.value : nameWidth.value;

  const onMouseMove = (moveEvent: MouseEvent) =>
  {
    const diff = moveEvent.clientX - startX;
    const newWidth = Math.max(50, startWidth + diff); // 最小宽度 50px
    if (col === 'time') timeWidth.value = newWidth;
    else nameWidth.value = newWidth;
  };

  const onMouseUp = () =>
  {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
  };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  document.body.style.cursor = 'col-resize';
};

// --- 滚动逻辑 ---
const handleScroll = (e: Event) =>
{
  const target = e.target as HTMLElement;
  const bottomThreshold = 1000;
  isNearBottom.value = target.scrollHeight - target.scrollTop - target.clientHeight < bottomThreshold;
  showScrollToBottom.value = !isNearBottom.value;
};

const scrollToBottom = () =>
{
  if (!scrollableEl) return;

  const targetScrollTop = scrollableEl.scrollHeight;
  const currentScrollTop = scrollableEl.scrollTop;
  const duration = 200;

  if (targetScrollTop - currentScrollTop - scrollableEl.clientHeight < 1)
  {
    scrollableEl.scrollTop = targetScrollTop;
    return;
  }

  const startTime = performance.now();
  const animateScroll = (currentTime: number) =>
  {
    const elapsedTime = currentTime - startTime;
    if (elapsedTime >= duration)
    {
      scrollableEl.scrollTop = targetScrollTop;
      return;
    }
    const progress = elapsedTime / duration * (2 - elapsedTime / duration);
    scrollableEl.scrollTop = currentScrollTop + (targetScrollTop - currentScrollTop) * progress;
    requestAnimationFrame(animateScroll);
  };
  requestAnimationFrame(animateScroll);
};

// --- 监听新日志 ---
watch(() => props.logs.length, () =>
{
  const selection = window.getSelection();
  const isSelecting = selection && selection.type === 'Range' && selection.toString().length > 0;

  // 只有在底部、没有选择文本、且没有处于排序状态（通常看新日志时不希望排序打乱）时才自动滚动
  if (isNearBottom.value && !isSelecting && !sortKey.value)
  {
    nextTick(scrollToBottom);
  }
});

// --- 生命周期 ---
onMounted(() =>
{
  // 1. 初始化 ResizeObserver 以动态计算列表高度
  if (logBodyRef.value)
  {
    resizeObserver = new ResizeObserver((entries) =>
    {
      for (const entry of entries)
      {
        listHeight.value = entry.contentRect.height;
      }
    });
    resizeObserver.observe(logBodyRef.value);
  }

  // 2. 获取 VirtualList 内部的滚动容器
  const el = virtualListRef.value?.$el;
  if (el)
  {
    scrollableEl = el.querySelector('.el-scrollbar__wrap');
    if (scrollableEl)
    {
      scrollableEl.addEventListener('scroll', handleScroll);
      scrollableEl.scrollTop = scrollableEl.scrollHeight;
    }
  }
});

onBeforeUnmount(() =>
{
  if (resizeObserver)
  {
    resizeObserver.disconnect();
  }
  if (scrollableEl)
  {
    scrollableEl.removeEventListener('scroll', handleScroll);
  }
});

// --- 渲染函数 ---
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
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
}

.log-toolbar {
  padding: 8px 12px;
  background-color: var(--k-card-bg);
  border-bottom: 1px solid var(--k-border-color);
  flex-shrink: 0;
}

.log-header-row {
  display: flex;
  background-color: var(--k-card-bg);
  border-bottom: 1px solid var(--k-border-color);
  font-weight: bold;
  font-size: 12px;
  user-select: none;
  flex-shrink: 0;
  color: var(--k-text-active);
  /* 确保表头文字在浅色模式下可见 */
}

.header-cell {
  padding: 8px 12px;
  position: relative;
  display: flex;
  align-items: center;
  cursor: pointer;

  &:hover {
    background-color: var(--k-hover-bg);
  }
}

.resizer {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: col-resize;
  z-index: 1;

  &:hover {
    background-color: var(--k-primary);
  }
}

.sort-icon {
  margin-left: 4px;
}

.log-body {
  flex-grow: 1;
  overflow: hidden;
  position: relative;
  /* 确保 ResizeObserver 能正确测量 */
}

.virtual-list-container {
  width: 100%;
}

.log-item {
  display: flex;
  align-items: baseline;
  line-height: 1.5;
  padding: 1px 0;
  border-bottom: 1px solid transparent;
  /* 占位，避免抖动 */

  &:hover {
    /* 使用半透明背景色，这样在深色和浅色模式下都能叠加出合适的效果，而不会完全覆盖文字颜色 */
    background-color: rgba(128, 128, 128, 0.1);
  }
}

/* 列样式 */
.time-col {
  width: var(--time-width);
  flex-shrink: 0;
  padding-left: 12px;
  padding-right: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-right: 1px solid transparent;
  /* 可选：列分割线 */
}

.name-col {
  width: var(--name-width);
  flex-shrink: 0;
  padding-right: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: bold;
}

.content-col {
  flex-grow: 1;
  padding-right: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  min-width: 0;
  /* 防止 flex 子项溢出 */
}

/* 强制所有子元素继承字体 */
.log-cell :deep(*) {
  font-family: inherit;
}

.scroll-to-bottom {
  position: absolute;
  right: 20px;
  bottom: 20px;
  z-index: 10;
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
