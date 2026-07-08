/**
 * 角色状态管理脚本
 *
 * 角色状态以 assistant 楼层的 data.character_states 快照为准。
 * 聊天变量 character_states 只作为末端备份，以及旧聊天首次迁移的种子。
 * 历史编辑、删除或切换 swipe 时，从变动楼层开始清理并重放后续 assistant 楼层。
 */

import { createScriptIdDiv, teleportStyle } from '@util/script';
import indexVue from './index.vue';
import { useSettingsStore } from './settings';
import {
  type CharacterStatesData,
  applyStateUpdateToStates,
  buildCurrentStatesText,
  clearMessageStateSnapshotsFrom,
  countCharacterStates,
  devLog,
  findLatestStateSnapshotBefore,
  getAllInitialValuesFromInitTag,
  getChatVariablesCharacterStatesData,
  getLatestAssistantMessage,
  getLatestCharacterStatesData,
  getLatestStateSnapshot,
  initializeStates,
  parseAllStateDefinitionsFromPrompt,
  parseStateUpdates,
  replaceCharacterStatesTagsInText,
  setDevModeGetter,
  stripStateUpdateCommandsFromText,
  syncChatVariablesFromLatestSnapshot,
  syncChatVariablesFromStates,
  writeMessageStateSnapshot,
} from './state_control';

// 创建设置界面
const app = createApp(indexVue).use(createPinia());
let $app: ReturnType<typeof createScriptIdDiv>;
let style: ReturnType<typeof teleportStyle>;

$(() => {
  const settingsStore = useSettingsStore();

  setDevModeGetter(() => settingsStore.settings.dev_mode);

  // 加载设置界面
  $app = createScriptIdDiv();
  $('#extensions_settings2').append($app);
  style = teleportStyle();
  app.mount($app[0]);

  let snapshotWriteDepth = 0;

  async function withSnapshotWrite<T>(task: () => Promise<T>): Promise<T> {
    snapshotWriteDepth++;
    try {
      return await task();
    } finally {
      snapshotWriteDepth--;
    }
  }

  function getSendingMessageText(message: SillyTavern.SendingMessage): string {
    if (typeof message.content === 'string') {
      return message.content;
    }

    return message.content
      .map(c => {
        if (typeof c === 'string') return c;
        if (c.type === 'text') return c.text;
        return '';
      })
      .join('\n');
  }

  function setSendingMessageText(message: SillyTavern.SendingMessage, text: string): void {
    if (typeof message.content === 'string') {
      message.content = text;
      return;
    }

    const newContent = [...message.content];
    if (newContent.length > 0 && typeof newContent[0] === 'object' && newContent[0].type === 'text') {
      newContent[0] = { ...newContent[0], text };
    } else {
      newContent[0] = { type: 'text', text };
    }
    message.content = newContent as any;
  }

  function stripStateUpdateCommandsFromPrompt(chat: SillyTavern.SendingMessage[]): void {
    let strippedCount = 0;
    for (const message of chat) {
      if (message.role !== 'assistant' || !message.content) continue;

      const contentText = getSendingMessageText(message);
      if (!contentText) continue;

      const strippedText = stripStateUpdateCommandsFromText(contentText);
      if (strippedText !== contentText) {
        setSendingMessageText(message, strippedText);
        strippedCount++;
      }
    }

    if (strippedCount > 0) {
      devLog(`已在发送前剥离 ${strippedCount} 条 assistant 消息中的状态更新命令`);
    }
  }

  function mergeStates(...sources: CharacterStatesData[]): CharacterStatesData {
    const merged: CharacterStatesData = {};
    for (const source of sources) {
      for (const [characterName, states] of Object.entries(source)) {
        merged[characterName] = { ...(merged[characterName] ?? {}), ...states };
      }
    }
    return merged;
  }

  function buildInitialStatesBefore(message_id: number, seedStates: CharacterStatesData = {}): CharacterStatesData {
    const messages = getChatMessages('0-{{lastMessageId}}')
      .filter(message => message.message_id < message_id)
      .map(
        (message): SillyTavern.SendingMessage => ({
          role: message.role,
          content: message.message,
        }),
      );
    const initialValues = getAllInitialValuesFromInitTag(messages, seedStates);
    const states: CharacterStatesData = {};

    for (const [characterName, characterInitialValues] of Object.entries(initialValues)) {
      states[characterName] = { ...characterInitialValues };
    }

    return states;
  }

  function getBaseStatesForMessage(message_id: number, { useChatVariableSeed = false } = {}): CharacterStatesData {
    const baseSnapshot = findLatestStateSnapshotBefore(message_id);
    if (baseSnapshot) {
      return baseSnapshot.states;
    }

    const seedStates = useChatVariableSeed ? getChatVariablesCharacterStatesData() : {};
    const initialStates = buildInitialStatesBefore(message_id, seedStates);

    return mergeStates(seedStates, initialStates);
  }

  async function rebuildMessageSnapshot(
    message_id: number,
    { log = true, useChatVariableSeed = false } = {},
  ): Promise<boolean> {
    if (!settingsStore.settings.enabled || message_id === 0) return false;

    const message = getChatMessages(message_id)[0];
    if (!message || message.role !== 'assistant') return false;

    const messageText = message.message || '';
    if (!messageText) return false;

    const baseStates = getBaseStatesForMessage(message_id, { useChatVariableSeed });
    const updates = parseStateUpdates(messageText);
    let nextStates = baseStates;

    updates.forEach(update => {
      nextStates = applyStateUpdateToStates(
        nextStates,
        update.characterName,
        update.stateName,
        update.oldValue,
        update.newValue,
      );
    });

    await withSnapshotWrite(() => writeMessageStateSnapshot(message_id, nextStates));
    if (message_id === getLatestAssistantMessage()?.message_id) {
      syncChatVariablesFromStates(nextStates);
    }
    if (log && updates.length > 0) {
      devLog(`已写入消息 ${message_id} 的角色状态快照，包含 ${updates.length} 个状态更新`);
    }
    return true;
  }

  let rebuildQueue = Promise.resolve();

  function enqueueRebuild(task: () => Promise<void>): void {
    rebuildQueue = rebuildQueue.then(task).catch(error => {
      console.error('重建角色状态快照失败:', error);
    });
  }

  async function migrateLegacySnapshotIfNeeded(beforeMessageId = Infinity): Promise<void> {
    if (!settingsStore.settings.enabled || getLatestStateSnapshot()) return;

    const legacyStates = getChatVariablesCharacterStatesData();
    if (countCharacterStates(legacyStates) === 0) return;

    const latestAssistantMessage = getLatestAssistantMessage(beforeMessageId);
    if (!latestAssistantMessage) return;

    await withSnapshotWrite(() => writeMessageStateSnapshot(latestAssistantMessage.message_id, legacyStates));
    syncChatVariablesFromStates(legacyStates);
    devLog(`已将旧聊天变量迁移为消息 ${latestAssistantMessage.message_id} 的角色状态快照`);
  }

  async function writeSnapshotAndBackup(message_id: number, states: CharacterStatesData): Promise<void> {
    await withSnapshotWrite(() => writeMessageStateSnapshot(message_id, states));
    syncChatVariablesFromStates(states);
  }

  async function rebuildSnapshotsFrom(message_id: number): Promise<void> {
    if (!settingsStore.settings.enabled) return;

    await withSnapshotWrite(() => clearMessageStateSnapshotsFrom(message_id));
    const messages = getChatMessages('0-{{lastMessageId}}').filter(message => message.message_id >= message_id);
    let rebuilt = 0;

    for (const message of messages) {
      if (message.role !== 'assistant' || message.message_id === 0) {
        continue;
      }

      if (await rebuildMessageSnapshot(message.message_id, { log: false })) {
        rebuilt++;
      }
    }

    syncChatVariablesFromLatestSnapshot();
    devLog(`已从消息 ${message_id} 开始重建角色状态快照，共重建 ${rebuilt} 层`);
  }

  eventOn(tavern_events.CHAT_COMPLETION_PROMPT_READY, (event_data: { chat: SillyTavern.SendingMessage[]; dryRun: boolean }) => {
    if (event_data.dryRun || !settingsStore.settings.enabled) return;

    const promptText = event_data.chat.map(getSendingMessageText).join('\n');

    let currentStates = getLatestCharacterStatesData();
    const allInitialValues = getAllInitialValuesFromInitTag(event_data.chat, currentStates);
    const charactersFromInit = Object.keys(allInitialValues);

    if (charactersFromInit.length > 0) {
      devLog(`从 <character_states_init> 标签中找到 ${charactersFromInit.length} 个角色需要初始化: ${charactersFromInit.join(', ')}`);
    }

    for (const characterName of charactersFromInit) {
      const initialValues = allInitialValues[characterName];
      const stateNames = Object.keys(initialValues);
      currentStates = initializeStates(characterName, stateNames, initialValues, currentStates);
    }
    if (charactersFromInit.length > 0) {
      const snapshotMessageId = getLatestAssistantMessage()?.message_id;
      if (snapshotMessageId !== undefined) {
        const initializedStates = currentStates;
        enqueueRebuild(() => writeSnapshotAndBackup(snapshotMessageId, initializedStates));
      } else {
        syncChatVariablesFromStates(currentStates);
      }
    }

    const allDefinitions = parseAllStateDefinitionsFromPrompt(promptText, settingsStore.settings.use_yaml);
    stripStateUpdateCommandsFromPrompt(event_data.chat);
    if (allDefinitions.length === 0) {
      return;
    }

    for (let i = 0; i < event_data.chat.length; i++) {
      const message = event_data.chat[i];
      if (!message.content) continue;

      const contentText = getSendingMessageText(message);
      if (!contentText) continue;

      const CHARACTER_STATES_TAG = /<character_states>/i;
      if (!CHARACTER_STATES_TAG.test(contentText)) {
        continue;
      }

      const replacedContent = replaceCharacterStatesTagsInText(contentText, allDefinitions, currentStates);
      if (replacedContent !== contentText) {
        setSendingMessageText(message, replacedContent);
        devLog(`已替换消息 ${i} 中的 <character_states> 标签`);
      }
    }

    if (settingsStore.settings.inject_current_state_at_end) {
      const stateInfoText = buildCurrentStatesText(allDefinitions, currentStates);
      if (stateInfoText) {
        event_data.chat.push({
          role: 'system',
          content: stateInfoText,
        });
        devLog('已在聊天末尾追加当前角色状态信息');
      }
    }
  });

  eventOn(tavern_events.MESSAGE_RECEIVED, (message_id: number) => {
    enqueueRebuild(async () => {
      const isFirstAssistantMessage = getLatestAssistantMessage(message_id) === undefined;
      await migrateLegacySnapshotIfNeeded(message_id);
      await rebuildMessageSnapshot(message_id, { useChatVariableSeed: isFirstAssistantMessage });
    });
  });

  eventOn(tavern_events.MESSAGE_UPDATED, (message_id: number) => {
    if (snapshotWriteDepth > 0) return;
    enqueueRebuild(() => rebuildSnapshotsFrom(message_id));
  });

  eventOn(tavern_events.MESSAGE_EDITED, (message_id: number) => {
    enqueueRebuild(() => rebuildSnapshotsFrom(message_id));
  });

  eventOn(tavern_events.MESSAGE_SWIPED, (message_id: number) => {
    enqueueRebuild(() => rebuildSnapshotsFrom(message_id));
  });

  eventOn(tavern_events.MESSAGE_SWIPE_DELETED, event_data => {
    enqueueRebuild(() => rebuildSnapshotsFrom(event_data.messageId));
  });

  eventOn(tavern_events.MESSAGE_DELETED, (message_id: number) => {
    enqueueRebuild(() => rebuildSnapshotsFrom(message_id));
  });

  eventOn(tavern_events.CHAT_CHANGED, () => {
    if (!syncChatVariablesFromLatestSnapshot()) {
      enqueueRebuild(migrateLegacySnapshotIfNeeded);
    }
  });

  enqueueRebuild(migrateLegacySnapshotIfNeeded);
});

$(window).on('pagehide', () => {
  app.unmount();
  style.destroy();
  $app.remove();
});
