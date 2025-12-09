<script lang="ts" setup>
import { send, store } from '@koishijs/client'
import { computed, reactive, ref } from 'vue'
import type {} from 'element-plus'
import type {} from '../lib'

const keyword = ref('')

const showDialog = ref(false)

const newDownload = reactive({
  name: '',
  urls: '',
})

function resetNewDownload() {
  newDownload.name = ''
  newDownload.urls = ''
  showDialog.value = false
}

function createDownload() {
  send('fonts/download', newDownload.name, newDownload.urls.trim().split('\n'))
  resetNewDownload()
}

type Download = typeof store.fonts.downloads[0]

const disable = (download: Download) =>
  download.files.some((file) => file.finished)

const disableOne = (file) => file.finished || file.cancel

const indeterminate = (file) => file.failure || file.cancel

const status = (file): 'success' | 'warning' | 'exception' => {
  if (file.failure) return 'exception'
  if (file.cancel) return 'warning'
  if (file.finished) return 'success'
}

const percentage = (file) =>
  file.contentLength ? Math.floor((file.downloaded / file.contentLength) * 100) : file.finished ? 100 : 0

function cancel(name, paths) {
  send('fonts/cancel', name, paths)
}

function deleteFonts(name, fonts) {
  send('fonts/delete', name, fonts)
}

function groupByFamily(data) {
  const grouped = {}
  data.forEach((item) => {
    if (!grouped[item.family]) {
      grouped[item.family] = { family: item.family, size: 0, children: [] }
    }
    grouped[item.family].children.push(item)
    grouped[item.family].size += item.size
  })
  return Object.values(grouped)
}

const activeNames = ref([])

const filteredFonts = computed(() => {
  const searchTerm = keyword.value.trim().toLowerCase()

  if (!searchTerm) {
    return groupByFamily(store.fonts.fonts)
  }

  const filteredFonts = store.fonts.fonts.filter((font) => {
    return (
      font.family?.toLowerCase().includes(searchTerm) ||
      font.fileName?.toLowerCase().includes(searchTerm) ||
      font.path?.toLowerCase().includes(searchTerm) ||
      font.format?.toLowerCase().includes(searchTerm) ||
      font.id?.toLowerCase().includes(searchTerm)
    )
  })

  return groupByFamily(filteredFonts)
})

</script>

<template>
  <k-layout>
    <div class="container">
      <div class="my-4 flex items-center px-4">
        <el-input class="flex-1"
                  v-model="keyword"
                  clearable
                  placeholder="输入关键词搜索…"
                  #suffix>
          <k-icon name="search" />
        </el-input>

        <el-button class="ml-4" @click="showDialog = true">新建下载</el-button>
      </div>

      <el-dialog v-model="showDialog">
        <template #title>新建下载</template>
        <template #default>
          <el-input class="my-2" v-model="newDownload.name" placeholder="输入字体名称" />
          <el-input class="my-2"
                    v-model="newDownload.urls"
                    placeholder="输入下载链接，以回车分隔不同路径"
                    type="textarea"
                    :autosize="{ minRows: 4, maxRows: 16 }" />
        </template>
        <template #footer>
          <el-button @click="resetNewDownload">取消</el-button>
          <el-button type="primary" @click="createDownload">确定</el-button>
        </template>
      </el-dialog>

      <!-- Download -->
      <template v-if="Object.keys(store.fonts.downloads).length">
        <el-scrollbar class="downloads-scrollbar" ref="downloadsRef">
          <el-card class="download-card" shadow="never">
            <template #header>
              <div class="text-bold">下载中</div>
            </template>
            <div>
              <el-collapse v-model="activeNames">
                <el-collapse-item v-for="download in store.fonts.downloads"
                                  :name="download.name"
                                  :key="download.name"
                                  :show-arrow="true">
                  <template #title>
                    <div class="item-title paths">
                      <span>{{ download.name }}</span>
                      <el-button class="button-container"
                                 :disabled="disable(download)"
                                 :plain="disable(download)"
                                 @click.stop="cancel(download.name, [])">
                        取消
                      </el-button>
                    </div>
                  </template>
                  <el-row class="paths" v-for="file in download.files">
                    <el-col :span="4"></el-col>
                    <el-col :span="16">
                      <el-progress class="file-progress"
                                   :percentage="percentage(file)"
                                   :indeterminate="indeterminate(file)"
                                   :status="status(file)" />
                    </el-col>
                    <el-col :span="4" class="button-container">
                      <el-button @click="cancel(download.name, [file.url])"
                                 :disabled="disableOne(file)"
                                 :plain="disableOne(file)">
                        取消
                      </el-button>
                    </el-col>
                  </el-row>
                </el-collapse-item>
              </el-collapse>
            </div>
          </el-card>
        </el-scrollbar>
      </template>

      <el-scrollbar class="fonts-list" ref="rootRef">
        <template v-if="filteredFonts.length === 0">
          <el-empty :description="keyword.trim() ? '未找到字体' : '暂无字体'" />
        </template>

        <el-table v-if="filteredFonts.length !== 0"
                  :data="filteredFonts"
                  row-kay="family"
                  class="fonts-list is-always-shadow"
                  ref="rootRef"
                  border>
          <el-table-column type="expand">
            <template #default="scope">
              <el-table :data="scope.row.children" border>
                <el-table-column label="文件名" prop="fileName" />
                <el-table-column label="路径" prop="path" />
                <el-table-column label="唯一标识" prop="id" />
                <el-table-column label="大小" prop="size" />
                <el-table-column label="操作">
                  <template #default="scope">
                    <el-button @click="deleteFonts(scope.row.family, [scope.row])" plain>
                      <k-icon name="delete" />
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
            </template>
          </el-table-column>
          <el-table-column label="字体名" prop="family" />
          <el-table-column label="大小" prop="size" />
          <el-table-column label="操作">
            <template #default="scope">
              <el-button @click="deleteFonts(scope.row.family, scope.row.children)" plain>
                <k-icon name="delete" />
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-scrollbar>
    </div>
  </k-layout>
</template>

<style lang="scss" scoped>
.container {
  max-width: 800px;
  height: calc(100% - 30px);
  display: flex;
  margin-left: auto;
  margin-right: auto;
  flex-direction: column;
}

.download-card {
  :deep(.el-card__body) {
    padding: 0;
    height: 100%;
  }
}

.item-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 0 16px;
  position: relative;

  span {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    margin-left: 0;
  }

  .button-container {
    margin-left: auto;
  }
}

.downloads-scrollbar {
  width: 100%;
  max-height:40%;
  margin-bottom: 20px;
}

:deep(.el-table__expanded-cell) {
  padding: 0;
}

.fonts-list {
  width: 100%;
  flex-grow: 1;
  overflow: auto;
}

.paths {
  align-items: center;
}

.button-container {
  opacity: 0;
}

.paths:hover .button-container {
  opacity: 1;
}
</style>
