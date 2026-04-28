<template>
  <div class="character-state-management-settings">
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>角色状态管理</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <div class="flex-container">
          <input v-model="settings.enabled" type="checkbox" />
          <label>启用角色状态管理</label>
        </div>

        <div class="flex-container">
          <input v-model="settings.inject_current_state_at_end" type="checkbox" />
          <label>在聊天末尾注入当前状态信息</label>
        </div>

        <div class="flex-container">
          <input v-model="settings.dev_mode" type="checkbox" />
          <label>开发模式（显示详细日志）</label>
        </div>

        <hr class="sysHR" />

        <!-- 查看所有状态按钮 -->
        <div v-if="settings.enabled" class="flex-container">
          <button @click="showAllStates" class="menu_button" style="width: 100%;">
            查看所有角色状态
          </button>
        </div>

        <hr v-if="settings.enabled" class="sysHR" />

        <div class="flex-container">
          <small>
            <strong>状态定义：</strong>从 prompt 中的 <code>&lt;character_states&gt;</code> 标签自动解析。
            <br />
            <code>&lt;character_states&gt;{ "name": "character_states", "characters": [{ "name": "角色名", "states": [{ "name": "状态名", "ranges": [{ "min": 0, "max": 30, "content": "内容" }] }] }] }&lt;/character_states&gt;</code>
            <br />
            <br />
            <strong>状态初始化：</strong>在任意 assistant 消息中使用 <code>&lt;character_states_init&gt;</code> 标签定义初始值。只要标签中存在某个角色的
            <code>_.set</code> 条目，就会自动初始化该角色。
            <br />
            <code>&lt;character_states_init&gt;<br />_.set("角色名.状态名", 0, 50);<br />&lt;/character_states_init&gt;</code>
            <br />
            <br />
            <strong>状态更新：</strong><code>_.set("角色名.状态名", oldvalue, newvalue)</code>
            <br />
            <strong>变量路径：</strong><code>character_states.角色名.状态名</code>
            <br />
            <br />
            <strong>说明：</strong>
            <br />
            - 初始化使用差值逻辑：初始值 = newValue - oldValue（与状态更新保持一致）
            <br />
            - <code>&lt;character_states&gt;</code> 标签会在发送前被替换为当前匹配区间的 content
            <br />
            - 当前状态值与边界通过"在聊天末尾注入当前状态信息"开关，作为 system 消息追加到聊天末端
            <br />
            - 只有 <code>&lt;character_states_init&gt;</code> 标签内的 <code>_.set</code> 用于初始化，其他位置作为状态更新处理
          </small>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useSettingsStore } from './settings';
import { getAllCharactersStates } from './state_control';

const { settings } = storeToRefs(useSettingsStore());

// 显示所有角色状态
function showAllStates() {
  const allStates = getAllCharactersStates();
  const characterNames = Object.keys(allStates);

  if (characterNames.length === 0) {
    toastr.info('暂无角色状态数据', '状态查询');
    return;
  }

  // 构建通知消息
  const messages: string[] = [];
  for (const characterName of characterNames) {
    const states = allStates[characterName];
    const stateEntries = Object.entries(states);
    if (stateEntries.length > 0) {
      const stateTexts = stateEntries.map(([stateName, value]) => `${stateName} = ${value}`);
      messages.push(`【${characterName}】\n${stateTexts.join(',')}`);
    }
  }

  const fullMessage = messages.join('\n\n');
  toastr.info(fullMessage, '所有角色状态');
}
</script>

<style scoped></style>
