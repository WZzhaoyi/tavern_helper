<template>
  <div class="chat-depth-control-settings">
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>聊天深度控制</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <div class="flex-container">
          <input id="chat_depth_enabled" v-model="settings.enabled" type="checkbox" />
          <label for="chat_depth_enabled">启用深度控制</label>
        </div>

        <div class="flex-container">
          <label for="chat_depth_max">最大历史深度</label>
          <input
            id="chat_depth_max"
            v-model.number="settings.max_depth"
            type="number"
            min="1"
            class="text_pole"
            style="width: 80px"
          />
        </div>

        <small>限制发送给 AI 的聊天消息数量，为 Chat Example 留出空间。</small>

        <hr class="sysHR" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useSettingsStore } from './settings';

const { settings } = storeToRefs(useSettingsStore());
</script>

<style scoped></style>
