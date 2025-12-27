<template>
  <k-layout>
    <!-- 在标题旁边添加搜索框 -->
    <template #actions>
      <el-input v-model="searchQuery" placeholder="搜索日志内容或来源..." clearable size="default" :prefix-icon="Search"
        class="search-input" style="width: 300px;" />
    </template>

    <logs ref="logsRef" class="layout-logger" :logs="store.logs" show-link></logs>
  </k-layout>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue';
import { store } from '@koishijs/client';
import { ElInput } from 'element-plus';
import { Search } from '@element-plus/icons-vue';
import Logs from './logs.vue';

// 搜索框状态
const searchQuery = ref('');
const logsRef = ref<InstanceType<typeof Logs>>();

// 同步搜索框到logs组件
watch(searchQuery, (newVal) =>
{
  if (logsRef.value)
  {
    logsRef.value.searchQuery = newVal;
  }
});
</script>
