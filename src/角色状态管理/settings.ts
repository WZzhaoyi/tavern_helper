import { klona } from 'klona';

/**
 * 状态分支定义：可按连续数值区间或离散值匹配
 */
export const StateRange = z.object({
  min: z.number().optional(), // 最小值（包含）
  max: z.number().optional(), // 最大值（包含）
  value: z.union([z.string(), z.number(), z.boolean()]).optional(), // 离散值
  content: z.string(), // 该分支对应的内容
  instruction: z.string().optional(), // 当前分支对应的更新指南
});

/**
 * 状态定义：每个状态可以有多个连续或离散分支
 */
export const StateDefinition = z.object({
  name: z.string(), // 状态名称
  ranges: z.array(StateRange), // 不同状态分支对应的 content
});

export const Settings = z
  .object({
    // 是否启用角色状态管理
    enabled: z.boolean().default(true),
    // 是否在聊天末尾追加一条 system 消息，写入当前角色状态
    inject_current_state_at_end: z.boolean().default(true),
    // 是否使用 YAML 格式解析 <character_states> 标签内容
    use_yaml: z.boolean().default(false),
    // 导入导出状态快照时是否包含 Summarize 摘要
    include_summarize_in_snapshot: z.boolean().default(true),
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
