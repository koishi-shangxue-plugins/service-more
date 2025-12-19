<template>
  <div class="log-container" ref="containerEl">
    <!-- 顶部控制栏：搜索框和复制按钮 -->
    <div class="log-toolbar">
      <div class="toolbar-left">
        <el-button :type="isPaused ? 'success' : 'warning'" :icon="isPaused ? VideoPlay : VideoPause"
          @click="togglePause" size="default" class="action-btn freeze-btn">
          {{ isPaused ? '恢复刷新' : '冻结日志' }}
        </el-button>
        <el-button v-if="selectedLogs.size > 0" type="primary" :icon="CopyDocument" @click="copySelectedLogs"
          size="default" class="action-btn copy-btn">
          复制选中 ({{ selectedLogs.size }})
        </el-button>
      </div>
      <el-input v-model="searchQuery" placeholder="搜索日志内容或来源..." clearable size="default" :prefix-icon="Search"
        class="search-input" />
    </div>

    <!-- 滚动容器：支持横向滚动 -->
    <div class="log-scroll-container">
      <div class="log-table-wrapper" :style="{
        '--time-width': timeWidth + 'px',
        '--name-width': nameWidth + 'px',
        '--checkbox-width': checkboxWidth + 'px',
        'min-width': tableMinWidth
      }">
        <!-- 表头 -->
        <div class="log-header-row">
          <div class="header-cell checkbox-col">
            <el-checkbox v-model="selectAll" @change="toggleSelectAll" :indeterminate="isIndeterminate" />
          </div>

          <div class="header-cell time-col" @click="toggleSort('time')">
            <span>时间</span>
            <el-icon v-if="sortKey === 'time'" class="sort-icon">
              <component :is="sortOrder === 'asc' ? CaretTop : CaretBottom" />
            </el-icon>
            <div class="resizer" @click.stop @mousedown="startResize($event, 'time')"
              @touchstart.stop.passive="startResize($event, 'time')"></div>
          </div>

          <div class="header-cell name-col p-0!">
            <el-dropdown trigger="click" @command="handleLevelFilter" class="w-full h-full">
              <div class="level-filter-trigger w-full h-full flex items-center px-12px">
                来源 <el-icon class="el-icon--right">
                  <ArrowDown />
                </el-icon>
              </div>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="ALL"
                    :class="{ 'is-active': levelFilter === 'ALL' }">ALL（全部）</el-dropdown-item>
                  <el-dropdown-item command="I" :class="{ 'is-active': levelFilter === 'I' }">I（信息）</el-dropdown-item>
                  <el-dropdown-item command="W" :class="{ 'is-active': levelFilter === 'W' }">W（警告）</el-dropdown-item>
                  <el-dropdown-item command="E" :class="{ 'is-active': levelFilter === 'E' }">E（错误）</el-dropdown-item>
                  <el-dropdown-item command="D" :class="{ 'is-active': levelFilter === 'D' }">D（调试）</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <div class="resizer" @click.stop @mousedown="startResize($event, 'name')"
              @touchstart.stop.passive="startResize($event, 'name')"></div>
          </div>

          <div class="header-cell content-col">
            <span>消息内容</span>
          </div>
        </div>

        <!-- 日志主体 -->
        <div class="log-body" ref="logBodyRef">
          <virtual-list ref="virtualListRef" :data="sortedLogs" :count="100" class="virtual-list-container"
            :style="{ height: listHeight + 'px' }">
            <template #default="log">
              <div class="log-item" :data-log-id="log.id" @dblclick="handleDblClick(log.id)"
                @click="handleRowClick(log.id)">
                <div class="log-cell checkbox-col">
                  <el-checkbox :model-value="selectedLogs.has(log.id)" @change="toggleLogSelection(log.id)"
                    @click.stop />
                </div>
                <div class="log-cell time-col" v-html="renderTime(log)"></div>
                <div class="log-cell name-col" v-html="renderName(log)"></div>
                <div class="log-cell content-col" v-html="renderContent(log)"></div>
              </div>
            </template>
          </virtual-list>
        </div>
      </div>
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
import { Time, VirtualList, message } from '@koishijs/client';
import Logger from 'reggol';
import ansi from 'ansi_up';
import { ElInput, ElButton, ElIcon, ElCheckbox, ElDropdown, ElDropdownMenu, ElDropdownItem } from 'element-plus';
import { Search, ArrowDown, CaretTop, CaretBottom, VideoPause, VideoPlay, CopyDocument } from '@element-plus/icons-vue';

const props = defineProps<{
  logs: Logger.Record[];
}>();

// --- 状态变量 ---
const searchQuery = ref('');
const isPaused = ref(false);
const snapshotLogs = ref<Logger.Record[]>([]);
const sortKey = ref<'time' | 'name' | null>(null);
const sortOrder = ref<'asc' | 'desc'>('asc');
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const timeWidth = ref(170);
const nameWidth = ref(240);
const checkboxWidth = ref(40);
const showScrollToBottom = ref(false);
const isNearBottom = ref(true);
const listHeight = ref(0);
const levelFilter = ref<'ALL' | 'I' | 'W' | 'E' | 'D'>('ALL');
const selectedLogs = ref<Set<number>>(new Set());
const selectAll = ref(false);

const tableMinWidth = computed(() =>
{
  // 保证在移动端也有足够的横向滚动宽度
  return (timeWidth.value + nameWidth.value + checkboxWidth.value + 400) + 'px';
});

// --- 模板引用 ---
const containerEl = ref<HTMLElement>();
const virtualListRef = ref();
const logBodyRef = ref<HTMLElement>();
let scrollableEl: HTMLElement | null = null;
let resizeObserver: ResizeObserver | null = null;

// --- ANSI 转换器 ---
const converter = new (ansi['default'] || ansi)();

// --- 过滤与排序 ---
const effectiveLogs = computed(() => isPaused.value ? snapshotLogs.value : props.logs);

const filteredLogs = computed(() =>
{
  let logs = effectiveLogs.value;

  // 日志级别筛选
  if (levelFilter.value !== 'ALL')
  {
    const filterType = levelFilter.value.toLowerCase();
    logs = logs.filter(log => log.type[0].toLowerCase() === filterType);
  }

  // 搜索筛选
  if (!searchQuery.value) return logs;
  const query = searchQuery.value.toLowerCase();
  return logs.filter(log =>
    log.content.toLowerCase().includes(query) ||
    log.name.toLowerCase().includes(query)
  );
});

const togglePause = () =>
{
  isPaused.value = !isPaused.value;
  if (isPaused.value)
  {
    snapshotLogs.value = [...props.logs];
  } else
  {
    snapshotLogs.value = [];
    nextTick(scrollToBottom);
  }
};

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

// --- 日志级别筛选 ---
const handleLevelFilter = (command: 'ALL' | 'I' | 'W' | 'E' | 'D') =>
{
  levelFilter.value = command;
  selectedLogs.value.clear();
  selectAll.value = false;
};

// --- 选择逻辑 ---
const isIndeterminate = computed(() =>
{
  const size = selectedLogs.value.size;
  return size > 0 && size < sortedLogs.value.length;
});

const toggleSelectAll = (checked: boolean) =>
{
  if (checked)
  {
    sortedLogs.value.forEach(log => selectedLogs.value.add(log.id));
  } else
  {
    selectedLogs.value.clear();
  }
  selectedLogs.value = new Set(selectedLogs.value);
};

const toggleLogSelection = (logId: number) =>
{
  if (selectedLogs.value.has(logId))
  {
    selectedLogs.value.delete(logId);
  } else
  {
    selectedLogs.value.add(logId);
  }

  // 触发响应式更新
  selectedLogs.value = new Set(selectedLogs.value);

  // 更新全选状态
  if (selectedLogs.value.size === 0)
  {
    selectAll.value = false;
  } else if (selectedLogs.value.size === sortedLogs.value.length)
  {
    selectAll.value = true;
  }
};

const handleDblClick = (logId: number) =>
{
  // 双击切换勾选状态
  toggleLogSelection(logId);
};

let lastClickTime = 0;
const handleRowClick = (logId: number) =>
{
  if (isMobile)
  {
    const now = Date.now();
    // 模拟双击逻辑，因为某些手机浏览器对 dblclick 支持不佳
    if (now - lastClickTime < 300)
    {
      toggleLogSelection(logId);
      lastClickTime = 0;
    } else
    {
      lastClickTime = now;
    }
  }
};

const copySelectedLogs = async () =>
{
  const selectedLogRecords = sortedLogs.value.filter(log => selectedLogs.value.has(log.id));
  if (selectedLogRecords.length === 0) return;

  const textToCopy = selectedLogRecords.map(log => formatCopyText(log)).join('\n');

  try
  {
    await navigator.clipboard.writeText(textToCopy);
    message.success(`已复制 ${selectedLogRecords.length} 条日志`);
  } catch (error)
  {
    message.error('复制失败');
  }
};

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
const startResize = (e: MouseEvent | TouchEvent, col: 'time' | 'name') =>
{
  const startX = 'clientX' in e ? e.clientX : e.touches[0].clientX;
  const startWidth = col === 'time' ? timeWidth.value : nameWidth.value;

  const onMove = (moveEvent: MouseEvent | TouchEvent) =>
  {
    const currentX = 'clientX' in moveEvent ? moveEvent.clientX : moveEvent.touches[0].clientX;
    const diff = currentX - startX;
    const newWidth = Math.max(50, startWidth + diff);
    if (col === 'time') timeWidth.value = newWidth;
    else nameWidth.value = newWidth;
  };

  const onEnd = () =>
  {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onEnd);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', onEnd);
    document.body.style.cursor = '';
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onEnd);
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onEnd);
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

  if (isNearBottom.value && !isSelecting && !sortKey.value)
  {
    nextTick(scrollToBottom);
  }
});

// 鼠标松开时，如果选择了文字，切换对应日志的勾选状态
const handleMouseUp = () =>
{
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  const container = logBodyRef.value;
  if (!container) return;

  const items = container.querySelectorAll('.log-item');

  let changed = false;
  items.forEach(item =>
  {
    if (selection.containsNode(item, true))
    {
      const logId = Number((item as HTMLElement).dataset.logId);
      if (!isNaN(logId))
      {
        // 切换状态
        if (selectedLogs.value.has(logId))
        {
          selectedLogs.value.delete(logId);
        } else
        {
          selectedLogs.value.add(logId);
        }
        changed = true;
      }
    }
  });

  if (changed)
  {
    selectedLogs.value = new Set(selectedLogs.value);
    // 更新全选状态
    selectAll.value = selectedLogs.value.size === sortedLogs.value.length;
    // 不再清除文字选中，允许用户继续复制
  }
};

// --- 生命周期 ---
onMounted(() =>
{
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
    logBodyRef.value.addEventListener('mouseup', handleMouseUp);
  }

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
  logBodyRef.value?.removeEventListener('mouseup', handleMouseUp);
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

// 格式化错误堆栈，在 "at " 前添加换行
const formatStackTrace = (content: string): string =>
{
  // 匹配 "at " 开头的堆栈行，排除 URL (at http://...)
  // 使用正则：匹配 at 后面跟着空格，且后面不是 http/https/file 等协议
  return content.replace(/(\s+)(at\s+(?!(https?|file|ftp|ws):\/\/))/g, '\n$2');
};

const renderContent = (record: Logger.Record) =>
{
  let content = record.content;

  // 仅在非 info/success 级别且包含 " at " 时尝试格式化堆栈
  const isErrorLike = record.type !== 'info' && record.type !== 'success';
  if (isErrorLike && content.includes(' at '))
  {
    content = formatStackTrace(content);
  }

  return converter.ansi_to_html(content);
};

// --- 复制事件处理 ---
const formatCopyText = (record: Logger.Record) =>
{
  const time = Time.template(showTime, new Date(record.timestamp));
  const prefix = `[${record.type[0].toUpperCase()}]`;
  const cleanContent = record.content.replace(/\u001b\[[0-9;]*m/g, '');
  return `${time} ${prefix} ${record.name} ${cleanContent}`;
};

</script>

<style lang="scss" scoped>
/* 使用 CDN 加载字体，支持多个源竞速 */
@font-face {
  font-family: 'MapleMono-NF-CN-Regular';
  src: url('https://cdn.jsdmirror.com/gh/koishi-shangxue-plugins/koishi-plugins-assets-temp@main/plugins/fonts/raw/MapleMono-NF-CN-Regular.ttf') format('truetype'),
    url('https://cdn.jsdelivr.net/gh/koishi-shangxue-plugins/koishi-plugins-assets-temp@main/plugins/fonts/raw/MapleMono-NF-CN-Regular.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}

.log-container {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  background-color: var(--terminal-bg);
  color: var(--terminal-fg);
  position: relative;
  font-family: 'MapleMono-NF-CN-Regular', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
}

.log-toolbar {
  padding: 12px 16px;
  background-color: var(--k-card-bg);
  border-bottom: 1px solid var(--k-border-color);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  z-index: 20;

  .toolbar-left {
    display: flex;
    gap: 8px;
  }

  .search-input {
    max-width: 400px;
    flex: 1;
  }

  .action-btn {
    transition: all 0.3s ease;
    font-weight: 500;

    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }
  }
}

.log-scroll-container {
  flex: 1;
  overflow: auto;
  background-color: var(--terminal-bg);
}

.log-table-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
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
  right: -2px;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 10;
  transition: background-color 0.2s;

  &::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 20%;
    bottom: 20%;
    width: 1px;
    background-color: var(--k-border-color);
    transform: translateX(-50%);
  }

  &:hover,
  &:active {
    background-color: var(--k-primary);

    &::after {
      background-color: white;
    }
  }
}

.sort-icon {
  margin-left: 4px;
}

.level-filter-trigger {
  cursor: pointer;
  user-select: none;
  transition: color 0.2s;

  &:hover {
    color: var(--k-primary);
  }
}

.checkbox-col {
  width: var(--checkbox-width);
  flex-shrink: 0;
  padding-left: 12px;
  padding-right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.log-body {
  flex-grow: 1;
  overflow: hidden;
  position: relative;
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
  font-size: 0.9em;
  /* 整体日志内容缩小至 90% */

  &:hover {
    background-color: rgba(128, 128, 128, 0.1);
  }
}

.time-col {
  width: var(--time-width);
  flex-shrink: 0;
  padding-right: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-right: 1px solid var(--k-border-color);
  color: var(--terminal-timestamp);
}

.name-col {
  width: var(--name-width);
  flex-shrink: 0;
  padding-right: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: bold;
  border-right: 1px solid var(--k-border-color);
}

.content-col {
  flex-grow: 1;
  padding-right: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  min-width: 0;
}

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

:deep(.el-dropdown-menu__item.is-active) {
  color: var(--k-primary);
  font-weight: bold;
}

@media (max-width: 768px) {
  .log-toolbar {
    padding: 8px;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;

    .toolbar-left {
      justify-content: space-between;
    }

    .search-input {
      max-width: none;
    }
  }

  .resizer {
    width: 16px;
    /* 手机端加大触摸区域 */
    right: -8px;
  }
}
</style>
