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
          <input v-model="settings.use_yaml" type="checkbox" />
          <label>使用 YAML 格式解析状态定义</label>
        </div>

        <div class="flex-container">
          <input v-model="settings.dev_mode" type="checkbox" />
          <label>开发模式（显示详细日志）</label>
        </div>

        <hr class="sysHR" />

        <!-- 查看所有状态按钮 -->
        <div v-if="settings.enabled" class="flex-container">
          <button class="menu_button" style="width: 100%" @click="showAllStates">查看所有角色状态</button>
        </div>

        <div v-if="settings.enabled" class="flex-container">
          <button class="menu_button" style="width: 100%" @click="exportStates">导出当前聊天角色状态</button>
        </div>

        <div v-if="settings.enabled" class="flex-container" style="gap: 8px">
          <button
            class="menu_button"
            style="box-sizing: border-box; width: calc((100% - 8px) / 2)"
            @click="selectImportFile('merge')"
          >
            导入并合并
          </button>
          <button
            class="menu_button"
            style="box-sizing: border-box; width: calc((100% - 8px) / 2)"
            @click="selectImportFile('replace')"
          >
            导入并覆盖
          </button>
          <input
            ref="importFileInput"
            type="file"
            accept="application/json,.json"
            style="display: none"
            @change="importStates"
          />
        </div>

        <hr v-if="settings.enabled" class="sysHR" />

        <div class="flex-container">
          <small>
            <strong>状态定义：</strong>从 prompt 中的 <code>&lt;character_states&gt;</code> 标签自动解析。
            <br />
            <strong>JSON 格式（默认）：</strong>
            <br />
            <code
              >&lt;character_states&gt;{ &quot;name&quot;: &quot;character_states&quot;, &quot;characters&quot;: [{
              &quot;name&quot;: &quot;角色名&quot;, &quot;states&quot;: [{ &quot;name&quot;: &quot;状态名&quot;,
              &quot;ranges&quot;: [{ &quot;min&quot;: 0, &quot;max&quot;: 30, &quot;content&quot;: &quot;内容&quot; }]
              }] }] }&lt;/character_states&gt;</code
            >
            <br />
            <br />
            <strong>YAML 格式（需开启 YAML 开关）：</strong>
            <br />
            <code>
              &lt;character_states&gt; name: character_states characters: &nbsp;&nbsp;- name: 角色名
              &nbsp;&nbsp;&nbsp;&nbsp;states: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;- name: 状态名
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;ranges:
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;- min: 0
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;max: 30
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;content: "内容"
              &lt;/character_states&gt;
            </code>
            <br />
            <br />
            <strong>状态初始化：</strong>在任意 assistant 消息中使用
            <code>&lt;character_states_init&gt;</code> 标签定义初始值。只要标签中存在某个角色的
            <code>_.set</code> 条目，就会自动初始化该角色。
            <br />
            <code
              >&lt;character_states_init&gt;&lt;br /&gt;_.set(&quot;角色名.状态名&quot;, 0, 50);&lt;br
              /&gt;&lt;/character_states_init&gt;</code
            >
            <br />
            <br />
            <strong>状态更新：</strong><code>_.set(&quot;角色名.状态名&quot;, oldvalue, newvalue)</code>
            <br />
            <strong>变量路径：</strong><code>character_states.角色名.状态名</code>
            <br />
            <strong>导入导出：</strong>导出的是当前聊天变量中的
            <code>character_states</code>
            数值快照，不包含状态区间定义；导入仅会合并或覆盖该路径，不会修改当前聊天中的其他变量。
            <br />
            <br />
            <br />
            <strong>说明：</strong>
            <br />
            - 启用 YAML 后，请确保 &lt;character_states&gt; 内为 YAML 格式
            <br />
            - 初始化使用差值逻辑：初始值 = newValue - oldValue（与状态更新保持一致）
            <br />
            - <code>&lt;character_states&gt;</code> 标签会在发送前被替换为当前匹配区间的 content
            <br />
            - 当前状态值与边界通过&quot;在聊天末尾注入当前状态信息&quot;开关，作为 system 消息追加到聊天末端
            <br />
            - 只有 <code>&lt;character_states_init&gt;</code> 标签内的
            <code>_.set</code> 用于初始化，其他位置作为状态更新处理
          </small>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useSettingsStore } from './settings';
import {
  type CharacterStatesImportMode,
  countCharacterStates,
  createCharacterStatesSnapshot,
  getAllCharactersStates,
  getCharacterStatesSnapshotImportWarnings,
  importCharacterStatesSnapshot,
  normalizeCharacterStatesSnapshot,
  serializeCharacterStatesSnapshot,
} from './state_control';

const { settings } = storeToRefs(useSettingsStore());
const importFileInput = ref<HTMLInputElement | null>(null);
const pendingImportMode = ref<CharacterStatesImportMode>('merge');

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

function createSnapshotFilename(snapshot: ReturnType<typeof createCharacterStatesSnapshot>): string {
  const filenamePart = snapshot.character_name || snapshot.chat_id || 'current-chat';
  const safeFilenamePart = filenamePart.replace(/[\\/:*?"<>|]/g, '_');
  const exportedAt = snapshot.exported_at?.replace(/[:.]/g, '-') || new Date().toISOString().replace(/[:.]/g, '-');
  return `character-states-${safeFilenamePart}-${exportedAt}.json`;
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportStates(): void {
  const snapshot = createCharacterStatesSnapshot();
  const stateCount = countCharacterStates(snapshot.states);

  if (stateCount === 0) {
    toastr.info('暂无角色状态数据可导出', '状态导出');
    return;
  }

  downloadTextFile(createSnapshotFilename(snapshot), serializeCharacterStatesSnapshot(snapshot));
  toastr.success(`已导出 ${Object.keys(snapshot.states).length} 个角色、${stateCount} 个状态`, '状态导出');
}

function selectImportFile(mode: CharacterStatesImportMode): void {
  pendingImportMode.value = mode;
  importFileInput.value?.click();
}

async function importStates(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  try {
    const rawSnapshot = JSON.parse(await file.text());
    const snapshot = normalizeCharacterStatesSnapshot(rawSnapshot);
    const warnings = getCharacterStatesSnapshotImportWarnings(snapshot);

    if (warnings.length > 0 && !confirm(`${warnings.join('\n')}\n\n仍要导入吗？`)) {
      return;
    }

    if (
      pendingImportMode.value === 'replace' &&
      !confirm('导入并覆盖会替换当前聊天的全部 character_states，确定继续吗？')
    ) {
      return;
    }

    const result = importCharacterStatesSnapshot(snapshot, pendingImportMode.value);
    const modeText = pendingImportMode.value === 'replace' ? '覆盖' : '合并';
    toastr.success(`已${modeText}导入 ${result.characterCount} 个角色、${result.stateCount} 个状态`, '状态导入');
  } catch (error) {
    console.error('导入角色状态失败:', error);
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, '状态导入失败');
  }
}
</script>

<style scoped></style>
