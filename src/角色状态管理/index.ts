/**
 * 角色状态管理脚本
 *
 * 功能：
 * 1. 从 prompt 中自动解析状态定义（通过 <character_states> 标签）
 * 2. 每个角色可以有一个或多个状态变量，每个状态在不同数值区间有不同content
 * 3. 状态初始化：
 *    - 默认初始化为0
 *    - 可在任意 assistant 消息中使用 <character_states_init> 标签定义自定义初始值
 *    - 标签内的 _.set 语句会被解析，使用差值 delta = newValue - oldValue 作为初始值（统一逻辑）
 *    - 每个角色的每个状态只有在不存在时才初始化
 * 4. 状态更新由 LLM API 输出中的 _.set("角色名.状态名",oldvalue,newvalue) 触发
 * 5. 在 prompt 发送前：
 *    - 把 <character_states> 标签原地替换为**仅含静态定义**的稳定文本（跨轮恒定，缓存友好）
 *    - 把"当前状态数值"作为一条 system 消息追加到聊天**末端**（不污染前缀缓存）
 *
 * 缓存命中率说明：
 * - LLM API（如 Anthropic）的 prompt cache 是前缀匹配，前缀任何字节变化都会让后续上下文失去缓存
 * - 因此前缀区只放静态状态定义，把每轮都会变的当前数值放在末端
 * - 末端注入由 inject_current_state_at_end 开关控制
 *
 * 事件监听说明：
 * - CHAT_COMPLETION_PROMPT_READY: prompt准备完成，此时可以获取完整的消息数组（包括system消息），在此完成：
 *   1. 解析状态定义（每次生成前都重新解析，支持用户在不同消息中发送不同角色的状态定义）
 *   2. 初始化状态变量（从所有 assistant 消息的 <character_states_init> 标签中提取初始值，或默认为0）
 *   3. 直接修改消息内容，把 <character_states> 标签替换为静态状态定义文本
 *   4. 直接 push 一条 system 消息到 event_data.chat 末尾，写入当前状态数值
 * - MESSAGE_RECEIVED: 消息接收后，解析并应用状态更新（内置重复触发检测，跳过开场白）
 * - MESSAGE_UPDATED: 消息更新后，解析并应用状态更新（用户可能编辑消息，内置重复触发检测，跳过开场白）
 *
 * 冲突避免：
 * - 开场白（message_id = 0）中的状态更新语句不会被状态更新流程处理（跳过 message_id = 0）
 * - 初始化只在状态变量不存在时执行，不会覆盖已有状态
 * - <character_states_init> 标签仅用于初始化，不会被状态更新流程处理
 */

import { createScriptIdDiv, teleportStyle } from '@util/script';
import indexVue from './index.vue';
import { useSettingsStore } from './settings';
import {
  applyStateUpdate,
  buildCurrentStatesText,
  devLog,
  devWarn,
  getAllInitialValuesFromInitTag,
  initializeStates,
  parseAllStateDefinitionsFromPrompt,
  parseStateUpdates,
  replaceCharacterStatesTagsInText,
  setDevModeGetter,
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

  const processedMessages = new Map<
    number,
    {
      stateUpdatesHash: string;
      updates: Array<{ characterName: string; stateName: string; delta: number }>;
      processing?: boolean;
    }
  >();

  function initializeProcessedMessages(): void {
    if (!settingsStore.settings.enabled) return;

    try {
      const messages = getChatMessages('0-{{lastMessageId}}');
      let scannedCount = 0;

      for (const message of messages) {
        if (message.role !== 'assistant') continue;

        const messageText = message.message || '';
        if (!messageText) continue;

        const stateUpdatesText = extractStateUpdateStatements(messageText);
        const stateUpdatesHash = stateUpdatesText ? hashString(stateUpdatesText) : '';
        const updates = parseStateUpdates(messageText);
        const updatesToStore = updates.map(u => ({ characterName: u.characterName, stateName: u.stateName, delta: u.delta }));
        processedMessages.set(message.message_id, { stateUpdatesHash, updates: updatesToStore });

        if (updates.length > 0) {
          scannedCount++;
        }
      }

      if (scannedCount > 0) {
        devLog(`初始化：扫描了 ${messages.length} 条消息，发现 ${scannedCount} 条消息包含状态更新`);
      }
    } catch (error) {
      console.error('初始化历史消息扫描失败:', error);
    }
  }

  initializeProcessedMessages();

  function hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString();
  }

  function extractStateUpdateStatements(text: string): string {
    const pattern = /_\.set\s*\(\s*(["'])([^"']+)\.([^"']+)\1\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/gi;
    const statements: string[] = [];
    let match;

    while ((match = pattern.exec(text)) !== null) {
      statements.push(match[0]);
    }

    return statements.sort().join('\n');
  }

  function revertStateUpdates(updates: Array<{ characterName: string; stateName: string; delta: number }>): void {
    updates.forEach(update => {
      applyStateUpdate(update.characterName, update.stateName, -update.delta);
      devLog(`回退状态更新: ${update.characterName}.${update.stateName} (delta: ${-update.delta > 0 ? '+' : ''}${-update.delta})`);
    });
  }

  eventOn(tavern_events.CHAT_COMPLETION_PROMPT_READY, (event_data: { chat: SillyTavern.SendingMessage[]; dryRun: boolean }) => {
    if (event_data.dryRun || !settingsStore.settings.enabled) return;

    const promptText = event_data.chat.map(msg => {
      if (typeof msg.content === 'string') {
        return msg.content;
      } else {
        return msg.content
          .map(c => {
            if (typeof c === 'string') return c;
            if (c.type === 'text') return c.text;
            return '';
          })
          .join('\n');
      }
    }).join('\n');

    // 1. 初始化状态，从所有 assistant 消息的 <character_states_init> 标签中提取初始值
    // 只要 <character_states_init> 中存在某个角色的 _.set 条目就进行初始化，依次初始化所有角色
    const allInitialValues = getAllInitialValuesFromInitTag(event_data.chat);
    const charactersFromInit = Object.keys(allInitialValues);

    if (charactersFromInit.length > 0) {
      devLog(`从 <character_states_init> 标签中找到 ${charactersFromInit.length} 个角色需要初始化: ${charactersFromInit.join(', ')}`);
    }

    // 依次初始化所有在 <character_states_init> 中出现的角色
    for (const characterName of charactersFromInit) {
      const initialValues = allInitialValues[characterName];
      const stateNames = Object.keys(initialValues);
      devLog(`初始化角色 ${characterName} 的状态 (${stateNames.length} 个状态):`, initialValues);
      initializeStates(characterName, stateNames, initialValues);
    }

    // 2. 解析状态定义（用于后续的标签替换）
    const allDefinitions = parseAllStateDefinitionsFromPrompt(promptText);
    if (allDefinitions.length === 0) {
      return;
    }

    // 2. 处理 <character_states> 标签的替换
    for (let i = 0; i < event_data.chat.length; i++) {
      const message = event_data.chat[i];
      if (!message.content) continue;

      let contentText: string;
      if (typeof message.content === 'string') {
        contentText = message.content;
      } else {
        contentText = message.content
          .map(c => {
            if (typeof c === 'string') return c;
            if (c.type === 'text') return c.text;
            return '';
          })
          .join('\n');
      }
      if (!contentText) continue;

      const CHARACTER_STATES_TAG = /<character_states>/i;
      if (!CHARACTER_STATES_TAG.test(contentText)) {
        continue;
      }

      const replacedContent = replaceCharacterStatesTagsInText(contentText, allDefinitions);
      if (replacedContent !== contentText) {
        if (typeof message.content === 'string') {
          event_data.chat[i].content = replacedContent;
        } else {
          const newContent = [...message.content];
          if (newContent.length > 0 && typeof newContent[0] === 'object' && newContent[0].type === 'text') {
            newContent[0] = { ...newContent[0], text: replacedContent };
          } else {
            newContent[0] = { type: 'text', text: replacedContent };
          }
          event_data.chat[i].content = newContent as any;
        }
        devLog(`已替换消息 ${i} 中的 <character_states> 标签`);
      }
    }

    // 在聊天末尾追加一条 system 消息，写入"当前角色状态"。
    // 直接修改 event_data.chat 末尾元素，不会破坏前缀缓存命中率。
    // 旧实现使用 injectPrompts 在 CHAT_COMPLETION_PROMPT_READY 内调用，
    // 但该事件已经是 prompt 组装完成之后触发，injectPrompts 对本轮无效，
    // 因此改为直接 push 到 event_data.chat。
    if (settingsStore.settings.inject_current_state_at_end) {
      const stateInfoText = buildCurrentStatesText(allDefinitions);
      if (stateInfoText) {
        event_data.chat.push({
          role: 'system',
          content: stateInfoText,
        });
        devLog('已在聊天末尾追加当前角色状态信息');
      }
    }
  });

  function processMessageStateUpdates(message_id: number, eventType: 'received' | 'updated' = 'received'): void {
    if (!settingsStore.settings.enabled) return;

    // 跳过开场白（message_id = 0），因为其中的 <character_states_init> 标签已经用于初始化，不应再作为状态更新处理
    if (message_id === 0) {
      return;
    }

    const previousData = processedMessages.get(message_id);
    if (previousData?.processing) {
      devLog(`消息 ${message_id} (${eventType}) 正在处理中，跳过重复处理`);
      return;
    }

    try {
      const messages = getChatMessages('0-{{lastMessageId}}');
      const message = messages.find(m => m.message_id === message_id);
      if (!message || message.role !== 'assistant') return;

      const messageText = message.message || '';
      if (!messageText) return;

      const stateUpdatesText = extractStateUpdateStatements(messageText);
      const stateUpdatesHash = stateUpdatesText ? hashString(stateUpdatesText) : '';

      if (previousData?.stateUpdatesHash === stateUpdatesHash && !previousData.processing) {
        devLog(`消息 ${message_id} (${eventType}) 状态更新语句未变化（hash=${stateUpdatesHash}），跳过重复处理`);
        return;
      }

      if (previousData && previousData.stateUpdatesHash !== stateUpdatesHash) {
        devLog(`消息 ${message_id} (${eventType}) 状态更新语句变化检测: 旧hash=${previousData.stateUpdatesHash}, 新hash=${stateUpdatesHash}`);
      }

      const initialUpdates = previousData?.updates || [];
      processedMessages.set(message_id, { stateUpdatesHash, updates: initialUpdates, processing: true });

      if (previousData && previousData.stateUpdatesHash !== stateUpdatesHash && previousData.updates.length > 0) {
        devLog(`消息 ${message_id} 状态更新语句已变化，回退 ${previousData.updates.length} 个旧状态更新`);
        revertStateUpdates(previousData.updates);
      } else if (!previousData && eventType === 'updated') {
        const existingUpdates = parseStateUpdates(messageText);
        if (existingUpdates.length > 0) {
          devWarn(
            `消息 ${message_id} 是历史消息且包含状态更新，但之前未记录在 processedMessages 中。` +
              `如果之前已经应用过这些更新，可能会导致重复更新。建议重新加载页面以确保状态一致。`,
          );
        }
      }

      const updates = parseStateUpdates(messageText);
      if (updates.length === 0) {
        processedMessages.set(message_id, { stateUpdatesHash, updates: [] });
        return;
      }

      devLog(`解析到的状态更新 (消息 ${message_id}):`, updates.map(u => `${u.characterName}.${u.stateName} (delta: ${u.delta > 0 ? '+' : ''}${u.delta})`).join(', '));

      updates.forEach(update => {
        applyStateUpdate(update.characterName, update.stateName, update.delta);
      });

      const updatesToStore = updates.map(u => ({ characterName: u.characterName, stateName: u.stateName, delta: u.delta }));
      processedMessages.set(message_id, { stateUpdatesHash, updates: updatesToStore });

      devLog(`从消息 ${message_id} (${eventType}) 中提取到 ${updates.length} 个状态更新`);
    } catch (error) {
      console.error(`处理消息${eventType}事件失败:`, error);
      // 出错时清除处理标记
      const currentData = processedMessages.get(message_id);
      if (currentData) {
        processedMessages.set(message_id, { ...currentData, processing: false });
      }
    }
  }

  eventOn(tavern_events.MESSAGE_RECEIVED, (message_id: number) => {
    processMessageStateUpdates(message_id, 'received');
  });

  eventOn(tavern_events.MESSAGE_UPDATED, (message_id: number) => {
    processMessageStateUpdates(message_id, 'updated');
  });
});

$(window).on('pagehide', () => {
  app.unmount();
  style.destroy();
  $app.remove();
});
