import { klona } from 'klona';

/**
 * 状态范围定义：不同数值区间对应不同的content
 */
export const StateRange = z.object({
  min: z.number(), // 最小值（包含）
  max: z.number(), // 最大值（包含）
  content: z.string(), // 该区间对应的内容
});

/**
 * 状态定义：每个状态可以有多个数值区间
 */
export const StateDefinition = z.object({
  name: z.string(), // 状态名称
  ranges: z.array(StateRange), // 不同数值区间对应的content
});

export const Settings = z
  .object({
    // 是否启用角色状态管理
    enabled: z.boolean().default(true),
    // 是否在聊天末尾追加一条 system 消息，写入当前角色状态。
    // 末端追加不会污染前缀缓存命中率（旧字段名为 inject_state_info）。
    inject_current_state_at_end: z.boolean().default(true),
    // 开发模式：是否打印详细日志
    dev_mode: z.boolean().default(false),
  })
  .prefault({});

export type SettingsType = z.infer<typeof Settings>;
export type StateDefinitionType = z.infer<typeof StateDefinition>;
export type StateRangeType = z.infer<typeof StateRange>;

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref(Settings.parse(getVariables({ type: 'script', script_id: getScriptId() })));

  watchEffect(() => {
    insertOrAssignVariables(klona(settings.value), { type: 'script', script_id: getScriptId() });
  });

  return { settings };
});
