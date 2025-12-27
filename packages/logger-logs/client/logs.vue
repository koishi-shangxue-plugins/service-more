<template>
  <div class="log-container" ref="containerEl">
    <!-- 搜索框（保留功能但隐藏，用户可用浏览器自带搜索） -->
    <el-input v-model="searchQuery" v-show="false" />

    <!-- 滚动容器：支持横向滚动 -->
    <div class="log-scroll-container">
      <div class="log-table-wrapper" :style="{
        '--time-width': timeWidth + 'px',
        '--checkbox-width': checkboxWidth + 'px',
        'min-width': tableMinWidth
      }">
        <!-- 表头 -->
        <div class="log-header-row">
          <div class="header-cell checkbox-col">
            <el-checkbox v-model="selectAll" @change="toggleSelectAll" :indeterminate="isIndeterminate" />
          </div>

          <!-- 时间列：改为下拉框 -->
          <div class="header-cell time-col p-0!">
            <el-dropdown trigger="click" @command="handleTimeSort" class="time-dropdown">
              <div class="time-filter-trigger flex items-center px-8px">
                时间 <el-icon class="el-icon--right">
                  <ArrowDown />
                </el-icon>
              </div>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="asc"
                    :class="{ 'is-active': sortKey === 'time' && sortOrder === 'asc' }">按时间顺序</el-dropdown-item>
                  <el-dropdown-item command="desc"
                    :class="{ 'is-active': sortKey === 'time' && sortOrder === 'desc' }">按时间逆序</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <div class="resizer" @click.stop @mousedown="startResize($event, 'time')"
              @touchstart.stop.passive="startResize($event, 'time')"></div>
          </div>

          <!-- 日志内容列：添加复制按钮 -->
          <div class="header-cell content-col p-0! flex items-center justify-between">
            <el-dropdown trigger="click" @command="handleLevelFilter" class="level-dropdown">
              <div class="level-filter-trigger flex items-center px-12px">
                日志内容 <el-icon class="el-icon--right">
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

            <!-- 复制选中按钮 -->
            <el-button v-if="selectedLogs.size > 0" type="primary" :icon="CopyDocument" @click="copySelectedLogs"
              size="small" class="copy-btn ml-8px mr-12px">
              复制选中 ({{ selectedLogs.size }})
            </el-button>
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
                <div class="log-cell content-col" v-html="renderCombinedContent(log)"></div>
              </div>
            </template>
          </virtual-list>
        </div>
      </div>
    </div>

    <!-- 右下角悬浮按钮组 -->
    <div class="floating-buttons">
      <!-- 冻结日志按钮 -->
      <el-button :type="isPaused ? 'success' : 'warning'" :icon="isPaused ? VideoPlay : VideoPause" @click="togglePause"
        circle class="floating-btn" :title="isPaused ? '恢复刷新' : '冻结日志'">
      </el-button>

      <!-- 滚动到底部按钮 -->
      <transition name="fade">
        <el-button v-if="showScrollToBottom" class="floating-btn" type="primary" circle :icon="ArrowDown"
          @click="scrollToBottom" />
      </transition>
    </div>
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
  showLink?: boolean;
}>();

// --- 状态变量 ---
const searchQuery = ref('');
const isPaused = ref(false);
const snapshotLogs = ref<Logger.Record[]>([]);
const sortKey = ref<'time' | 'name' | null>(null);
const sortOrder = ref<'asc' | 'desc'>('asc');
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const timeWidth = ref(170);
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
  return (timeWidth.value + checkboxWidth.value + 600) + 'px';
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

// --- 时间排序处理 ---
const handleTimeSort = (command: 'asc' | 'desc') =>
{
  sortKey.value = 'time';
  sortOrder.value = command;
};

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

    // 复制成功后清除选中状态
    selectedLogs.value.clear();
    selectedLogs.value = new Set(selectedLogs.value);
    selectAll.value = false;
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
const startResize = (e: MouseEvent | TouchEvent, col: 'time') =>
{
  const startX = 'clientX' in e ? e.clientX : e.touches[0].clientX;
  const startWidth = timeWidth.value;

  const onMove = (moveEvent: MouseEvent | TouchEvent) =>
  {
    const currentX = 'clientX' in moveEvent ? moveEvent.clientX : moveEvent.touches[0].clientX;
    const diff = currentX - startX;
    const newWidth = Math.max(50, startWidth + diff);
    timeWidth.value = newWidth;
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

// 渲染合并的内容：来源 + 消息内容
const renderCombinedContent = (record: Logger.Record) =>
{
  const prefix = `[${record.type[0].toUpperCase()}]`;
  const code = Logger.code(record.name, { colors: 3 });
  const label = renderColor(code, record.name, ';1');
  const nameHtml = converter.ansi_to_html(`${prefix} ${label}`);

  let content = record.content;
  const isErrorLike = record.type !== 'info' && record.type !== 'success';
  if (isErrorLike && content.includes(' at '))
  {
    content = formatStackTrace(content);
  }
  const contentHtml = converter.ansi_to_html(content);

  return `${nameHtml} ${contentHtml}`;
};

// --- 复制事件处理 ---
const formatCopyText = (record: Logger.Record) =>
{
  const time = Time.template(showTime, new Date(record.timestamp));
  const prefix = `[${record.type[0].toUpperCase()}]`;
  const cleanContent = record.content.replace(/\u001b\[[0-9;]*m/g, '');
  return `${time} ${prefix} ${record.name} ${cleanContent}`;
};

// 暴露搜索框给父组件使用
defineExpose({
  searchQuery
});

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
  padding: 8px 16px;
  background-color: var(--k-card-bg);
  border-bottom: 1px solid var(--k-border-color);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  z-index: 20;

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
  font-size: 11px;
  user-select: none;
  flex-shrink: 0;
  color: var(--k-text-active);
}

.header-cell {
  padding: 6px 10px;
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
  padding: 0 6px 0 8px;
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
  line-height: 1.3;
  /* 行内行高 */
  padding: 0;
  /* 移除内边距，通过margin控制日志间距 */
  margin-bottom: 0;
  /* 不同日志之间无额外间距 */
  border-bottom: 1px solid transparent;
  font-size: 0.85em;
  /* 整体日志内容缩小至 85% */

  &:hover {
    background-color: rgba(128, 128, 128, 0.1);
  }
}

.time-col {
  width: var(--time-width);
  flex-shrink: 0;
  padding: 0 8px 0 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-right: 1px solid var(--k-border-color);
  color: var(--terminal-timestamp);
}

.content-col {
  flex-grow: 1;
  padding: 0 12px 0 8px;
  white-space: pre-wrap;
  word-break: break-all;
  min-width: 0;
}

.level-dropdown,
.time-dropdown {
  height: 100%;
  display: flex;
  align-items: center;
}

.time-filter-trigger {
  cursor: pointer;
  user-select: none;
  transition: color 0.2s;

  &:hover {
    color: var(--k-primary);
  }
}

.copy-btn {
  flex-shrink: 0;
}

.log-cell :deep(*) {
  font-family: inherit;
}

/* 右下角悬浮按钮组 */
.floating-buttons {
  position: absolute;
  right: 20px;
  bottom: 20px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  /* 按钮居中对齐 */
  gap: 16px;
  /* 按钮之间的间距 */
}

/* 悬浮按钮通用样式 */
.floating-btn {
  width: 56px !important;
  /* 加大一倍：默认32px -> 56px */
  height: 56px !important;
  min-width: 56px !important;
  max-width: 56px !important;
  /* 严格限制宽度 */
  min-height: 56px !important;
  max-height: 56px !important;
  /* 严格限制高度 */
  padding: 0 !important;
  /* 移除内边距 */
  margin: 0 !important;
  /* 移除外边距 */
  border-radius: 50% !important;
  /* 确保圆形 */
  font-size: 24px !important;
  /* 图标大小 */
  line-height: 1 !important;
  /* 行高 */
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  /* 内容居中 */
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  transition: all 0.3s ease;

  &:hover {
    transform: scale(1.1);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
  }

  /* 覆盖Element Plus的图标样式 */
  :deep(.el-icon) {
    font-size: 24px !important;
    margin: 0 !important;
  }
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
    padding: 6px 8px;
  }

  .resizer {
    width: 16px;
    /* 手机端加大触摸区域 */
    right: -8px;
  }

  .floating-buttons {
    right: 12px;
    bottom: 12px;
  }
}
</style>
