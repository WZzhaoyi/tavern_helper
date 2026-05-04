import { useSettingsStore } from './settings';

let getDevMode: (() => boolean) | null = null;

export function setDevModeGetter(getter: () => boolean): void {
  getDevMode = getter;
}

export function devLog(...args: any[]): void {
  if (getDevMode?.()) {
    console.info('[聊天深度控制]', ...args);
  }
}

export function devWarn(...args: any[]): void {
  if (getDevMode?.()) {
    console.warn('[聊天深度控制]', ...args);
  }
}

eventOn(tavern_events.CHAT_COMPLETION_PROMPT_READY, (event_data: { chat: SillyTavern.SendingMessage[]; dryRun: boolean }) => {
  const { settings } = useSettingsStore();
  
  devLog('CHAT_COMPLETION_PROMPT_READY 事件触发', { enabled: settings.enabled, dryRun: event_data.dryRun });
  
  if (!settings.enabled || event_data.dryRun) {
    devLog('功能未启用或为干运行，跳过处理');
    return;
  }

  const chat = event_data.chat;
  devLog('原始消息数量:', chat.length);

  // 统计非系统消息数量
  const nonSystemCount = chat.filter(m => m.role !== 'system').length;
  devLog('非系统消息数量:', nonSystemCount, '最大深度:', settings.max_depth);

  if (nonSystemCount <= settings.max_depth) {
    devLog('消息数量未超过最大深度，无需处理');
    return;
  }

  // 计算需要清空的消息数量
  const toClearCount = nonSystemCount - settings.max_depth;
  devLog('需要清空的消息数量:', toClearCount);

  // 从后往前遍历，保留最新的 max_depth 条非系统消息
  // 清空旧消息的 content，而不是删除消息
  let nonSystemFound = 0;
  const clearedIndices: number[] = [];
  const clearedRoles: Record<string, number> = {};

  for (let i = chat.length - 1; i >= 0; i--) {
    if (chat[i].role !== 'system') {
      nonSystemFound++;
      if (nonSystemFound > settings.max_depth) {
        chat[i].content = '';
        clearedIndices.push(i);
        clearedRoles[chat[i].role] = (clearedRoles[chat[i].role] || 0) + 1;
      }
    }
  }

  const roleStats = Object.entries(clearedRoles).map(([role, count]) => `${role}:${count}`).join(', ');
  devLog(`已清空 ${clearedIndices.length} 条消息 [${clearedIndices.sort((a, b) => a - b).join(',')}] (${roleStats})`);
});