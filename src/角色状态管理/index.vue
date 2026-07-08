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
          <input v-model="settings.include_summarize_in_snapshot" type="checkbox" />
          <label>导入导出包含 Summarize 摘要</label>
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
            <strong>状态定义：</strong>在 prompt 中加入 <code>&lt;character_states&gt;</code> 标签。
            <br />
            <strong>JSON 示例：</strong>
            <br />
            <code
              >&lt;character_states&gt;{ &quot;name&quot;: &quot;character_states&quot;, &quot;characters&quot;: [{
              &quot;name&quot;: &quot;角色名&quot;, &quot;states&quot;: [{ &quot;name&quot;: &quot;状态名&quot;,
              &quot;ranges&quot;: [{ &quot;min&quot;: 0, &quot;max&quot;: 30, &quot;content&quot;: &quot;内容&quot;,
              &quot;instruction&quot;: &quot;更新指南&quot; }, { &quot;value&quot;: &quot;阶段名&quot;,
              &quot;content&quot;: &quot;阶段内容&quot;, &quot;instruction&quot;: &quot;更新指南&quot; }]
              }] }] }&lt;/character_states&gt;</code
            >
            <br />
            <br />
            <strong>分支规则：</strong><code>min/max</code> 用于数值区间，<code>value</code> 用于阶段值；当前匹配分支的
            <code>content</code> 会提供给 LLM，<code>instruction</code> 用作该分支的更新指南。
            <br />
            开启 YAML 后，可在 <code>&lt;character_states&gt;</code> 内使用等价 YAML。
            <br />
            <strong>状态初始化：</strong>在任意 assistant 消息中使用
            <code>&lt;character_states_init&gt;</code> 标签定义初始值。
            <br />
            <code
              >&lt;character_states_init&gt;&lt;br /&gt;_.set(&quot;角色名.状态名&quot;, 0, 50);&lt;br
              /&gt;&lt;/character_states_init&gt;</code
            >
            <br />
            <br />
            <strong>状态更新：</strong>让 LLM 在回复末尾追加
            <code>_.set(&quot;角色名.状态名&quot;, 旧值, 新值)</code>，每条更新命令单独成行。
            <br />
            <strong>变量路径：</strong><code>character_states.角色名.状态名</code>
            <br />
            <strong>导入导出：</strong>用于迁移当前聊天的角色状态和 Summarize 摘要，不包含状态定义。
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
  const includeSummarize = settings.value.include_summarize_in_snapshot;
  const snapshot = createCharacterStatesSnapshot({ includeSummarize });
  const stateCount = countCharacterStates(snapshot.states);
  const hasSummarize = Boolean(snapshot.summarize?.content);

  if (stateCount === 0 && (!includeSummarize || !hasSummarize)) {
    toastr.info('暂无角色状态数据或 Summarize 摘要可导出', '状态导出');
    return;
  }

  downloadTextFile(createSnapshotFilename(snapshot), serializeCharacterStatesSnapshot(snapshot));
  const summarizeText = hasSummarize ? '，并包含 Summarize 摘要' : '';
  toastr.success(
    `已导出 ${Object.keys(snapshot.states).length} 个角色、${stateCount} 个状态${summarizeText}`,
    '状态导出',
  );
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
    const snapshotStateCount = countCharacterStates(snapshot.states);
    const includeSummarize = settings.value.include_summarize_in_snapshot;
    const willImportStates = snapshotStateCount > 0 || !snapshot.summarize;

    if (warnings.length > 0 && !confirm(`${warnings.join('\n')}\n\n仍要导入吗？`)) {
      return;
    }

    if (
      pendingImportMode.value === 'replace' &&
      willImportStates &&
      !confirm('导入并覆盖会替换当前聊天的全部 character_states，确定继续吗？')
    ) {
      return;
    }

    const result = await importCharacterStatesSnapshot(snapshot, pendingImportMode.value, { includeSummarize });
    const modeText = pendingImportMode.value === 'replace' ? '覆盖' : '合并';
    const summarizeText = result.summarizeImported
      ? '，并写入 Summarize 摘要'
      : snapshot.summarize && !includeSummarize
        ? '，已跳过 Summarize 摘要'
        : result.summarizeImportError
          ? '，但 Summarize 摘要写入失败'
          : '';
    const successMessage = `已${modeText}导入 ${result.characterCount} 个角色、${result.stateCount} 个状态${summarizeText}`;
    if (result.summarizeImportError) {
      toastr.warning(successMessage, '状态导入');
    } else {
      toastr.success(successMessage, '状态导入');
    }
  } catch (error) {
    console.error('导入角色状态失败:', error);
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, '状态导入失败');
  }
}
</script>

<style scoped></style>
