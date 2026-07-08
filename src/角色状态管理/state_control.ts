import YAML from 'yaml';

const VARIABLE_TYPE = 'chat' as const;
const STATE_PATH_PREFIX = 'character_states';
const SUMMARIZE_MEMORY_SOURCE = 'sillytavern.memory' as const;
const SUMMARIZE_EXTENSION_PROMPT_ID = '1_memory';
const SUMMARIZE_DEFAULT_TEMPLATE = '[Summary: {{summary}}]';
const STATE_UPDATE_FORMAT_TEXT =
  '状态变化时，在回复末尾追加更新命令；每条命令必须单独成行。\n格式：_.set("角色名.状态名", 旧值, 新值)';
const STATE_UPDATE_VALUE_PATTERN = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|true|false|-?\d+(?:\.\d+)?)`;
const STATE_UPDATE_PATTERN_TEXT = String.raw`_\.set\s*\(\s*(["'])([^"']+)\.([^"']+)\1\s*,\s*(${STATE_UPDATE_VALUE_PATTERN})\s*,\s*(${STATE_UPDATE_VALUE_PATTERN})\s*\)`;
export const CHARACTER_STATES_SNAPSHOT_KIND = 'tavern_helper.character_states.snapshot';
export const CHARACTER_STATES_SNAPSHOT_VERSION = 1;

export type CharacterStateValue = string | number | boolean;
export type CharacterStatesData = Record<string, Record<string, CharacterStateValue>>;
export type CharacterStatesImportMode = 'merge' | 'replace';
export type CharacterStatesMessageSnapshot = {
  message_id: number;
  states: CharacterStatesData;
};
export type StateBranch = {
  min?: number;
  max?: number;
  value?: CharacterStateValue;
  content: string;
  instruction?: string;
};
export type StateDefinition = {
  name: string;
  ranges: StateBranch[];
};
export type SummarizeMemorySnapshot = {
  source: typeof SUMMARIZE_MEMORY_SOURCE;
  message_id?: number;
  content: string;
};
export type CharacterStatesSnapshot = {
  kind: typeof CHARACTER_STATES_SNAPSHOT_KIND;
  version: typeof CHARACTER_STATES_SNAPSHOT_VERSION;
  exported_at?: string;
  chat_id?: string;
  character_name?: string;
  producer?: {
    name: string;
    version?: string;
  };
  states: CharacterStatesData;
  summarize?: SummarizeMemorySnapshot;
};

const SafeStateKeySchema = z
  .string()
  .min(1)
  .refine(key => !['__proto__', 'prototype', 'constructor'].includes(key), {
    message: '状态快照中包含不安全的键名',
  });
const CharacterStateValueSchema = z.union([z.number().finite(), z.string(), z.boolean()]);
const CharacterStatesDataSchema = z.record(SafeStateKeySchema, z.record(SafeStateKeySchema, CharacterStateValueSchema));
const SummarizeMemorySnapshotSchema = z.object({
  source: z.literal(SUMMARIZE_MEMORY_SOURCE),
  message_id: z.number().int().nonnegative().optional(),
  content: z.string().min(1),
});
const CharacterStatesSnapshotV1Schema = z
  .object({
    kind: z.literal(CHARACTER_STATES_SNAPSHOT_KIND),
    version: z.literal(1),
    exported_at: z.string().optional(),
    chat_id: z.string().optional(),
    character_name: z.string().optional(),
    producer: z
      .object({
        name: z.string(),
        version: z.string().optional(),
      })
      .optional(),
    states: CharacterStatesDataSchema,
    summarize: SummarizeMemorySnapshotSchema.optional(),
  })
  .passthrough();

let getDevMode: (() => boolean) | null = null;

export function setDevModeGetter(getter: () => boolean): void {
  getDevMode = getter;
}

export function devLog(...args: any[]): void {
  if (getDevMode?.()) {
    console.info(...args);
  }
}

export function devWarn(...args: any[]): void {
  if (getDevMode?.()) {
    console.warn(...args);
  }
}

function cloneCharacterStates(states: CharacterStatesData): CharacterStatesData {
  return _.cloneDeep(states);
}

function normalizeCharacterStatesData(data: unknown): CharacterStatesData {
  const result = CharacterStatesDataSchema.safeParse(data);
  return result.success ? result.data : {};
}

function getMessageById(message_id: number): ChatMessage | undefined {
  return getChatMessages(message_id)[0];
}

export function getLatestAssistantMessage(beforeMessageId = Infinity): ChatMessage | undefined {
  const messages = getChatMessages('0-{{lastMessageId}}');
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === 'assistant' && message.message_id !== 0 && message.message_id < beforeMessageId) {
      return message;
    }
  }
  return undefined;
}

export function getMessageStateSnapshot(message_id: number): CharacterStatesMessageSnapshot | undefined {
  const message = getMessageById(message_id);
  if (!message) {
    return undefined;
  }

  const states = normalizeCharacterStatesData(_.get(message.data, STATE_PATH_PREFIX));
  if (countCharacterStates(states) === 0) {
    return undefined;
  }

  return {
    message_id,
    states,
  };
}

export function findLatestStateSnapshotBefore(end_message_id: number): CharacterStatesMessageSnapshot | undefined {
  const messages = getChatMessages('0-{{lastMessageId}}');
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.message_id >= end_message_id) {
      continue;
    }

    const snapshot = getMessageStateSnapshot(message.message_id);
    if (snapshot) {
      return {
        ...snapshot,
        states: cloneCharacterStates(snapshot.states),
      };
    }
  }

  return undefined;
}

export function getLatestStateSnapshot(): CharacterStatesMessageSnapshot | undefined {
  return findLatestStateSnapshotBefore(getLastMessageId() + 1);
}

export function getLatestCharacterStatesData(): CharacterStatesData {
  const latestSnapshot = getLatestStateSnapshot();
  if (latestSnapshot) {
    return cloneCharacterStates(latestSnapshot.states);
  }

  // 仅兼容旧聊天：无任何楼层快照时，聊天变量可作为首次迁移种子。
  return getChatVariablesCharacterStatesData();
}

export function getChatVariablesCharacterStatesData(): CharacterStatesData {
  return normalizeCharacterStatesData(_.get(getVariables({ type: VARIABLE_TYPE }), STATE_PATH_PREFIX));
}

export function syncChatVariablesFromStates(states: CharacterStatesData): void {
  updateVariablesWith(
    variables => {
      _.set(variables, STATE_PATH_PREFIX, cloneCharacterStates(states));
      return variables;
    },
    { type: VARIABLE_TYPE },
  );
}

export function syncChatVariablesFromLatestSnapshot(): boolean {
  const latestSnapshot = getLatestStateSnapshot();
  if (latestSnapshot) {
    syncChatVariablesFromStates(latestSnapshot.states);
    return true;
  }
  return false;
}

export async function writeMessageStateSnapshot(message_id: number, states: CharacterStatesData): Promise<void> {
  const message = getMessageById(message_id);
  if (!message) {
    return;
  }

  await setChatMessages(
    [
      {
        message_id,
        data: {
          ...message.data,
          [STATE_PATH_PREFIX]: cloneCharacterStates(states),
        },
      },
    ],
    { refresh: 'none' },
  );
}

export async function clearMessageStateSnapshotsFrom(message_id: number): Promise<void> {
  const messages = getChatMessages('0-{{lastMessageId}}').filter(message => message.message_id >= message_id);
  if (messages.length === 0) {
    return;
  }

  await setChatMessages(
    messages.map(message => ({
      message_id: message.message_id,
      data: _.omit(message.data, STATE_PATH_PREFIX),
    })),
    { refresh: 'none' },
  );
}

function getCurrentSnapshotContext(): Pick<CharacterStatesSnapshot, 'chat_id' | 'character_name'> {
  let chat_id: string | undefined;
  let character_name: string | undefined;

  try {
    chat_id = SillyTavern.getCurrentChatId();
  } catch (error) {
    devWarn('获取当前聊天 ID 失败:', error);
  }

  try {
    character_name = getCurrentCharacterName() ?? undefined;
  } catch (error) {
    devWarn('获取当前角色名失败:', error);
  }

  return { chat_id, character_name };
}

export function countCharacterStates(states: CharacterStatesData): number {
  return Object.values(states).reduce((count, characterStates) => count + Object.keys(characterStates).length, 0);
}

export type CreateCharacterStatesSnapshotOptions = {
  includeSummarize?: boolean;
};

export function getLatestSummarizeMemorySnapshot(): SummarizeMemorySnapshot | undefined {
  try {
    const messages = getChatMessages('0-{{lastMessageId}}');
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      const content = message.extra?.memory;
      if (typeof content === 'string' && content.trim()) {
        return {
          source: SUMMARIZE_MEMORY_SOURCE,
          message_id: message.message_id,
          content,
        };
      }
    }
  } catch (error) {
    devWarn('读取 Summarize 摘要失败:', error);
  }

  return undefined;
}

export function createCharacterStatesSnapshot({
  includeSummarize = true,
}: CreateCharacterStatesSnapshotOptions = {}): CharacterStatesSnapshot {
  const context = getCurrentSnapshotContext();
  const summarize = includeSummarize ? getLatestSummarizeMemorySnapshot() : undefined;

  return {
    kind: CHARACTER_STATES_SNAPSHOT_KIND,
    version: CHARACTER_STATES_SNAPSHOT_VERSION,
    exported_at: new Date().toISOString(),
    chat_id: context.chat_id,
    character_name: context.character_name,
    producer: {
      name: '角色状态管理',
    },
    states: getLatestCharacterStatesData(),
    ...(summarize ? { summarize } : {}),
  };
}

export function serializeCharacterStatesSnapshot(snapshot: CharacterStatesSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

export function normalizeCharacterStatesSnapshot(rawSnapshot: unknown): CharacterStatesSnapshot {
  const snapshotParseResult = z
    .object({
      kind: z.literal(CHARACTER_STATES_SNAPSHOT_KIND),
      version: z.number().int(),
    })
    .passthrough()
    .safeParse(rawSnapshot);

  if (snapshotParseResult.success) {
    const { version } = snapshotParseResult.data;
    if (version > CHARACTER_STATES_SNAPSHOT_VERSION) {
      throw new Error(`不支持的角色状态快照版本: v${version}，当前最高支持 v${CHARACTER_STATES_SNAPSHOT_VERSION}`);
    }

    if (version === 1) {
      return CharacterStatesSnapshotV1Schema.parse(rawSnapshot);
    }

    throw new Error(`不支持的角色状态快照版本: v${version}`);
  }

  const legacyStatesParseResult = CharacterStatesDataSchema.safeParse(rawSnapshot);
  if (legacyStatesParseResult.success) {
    return {
      kind: CHARACTER_STATES_SNAPSHOT_KIND,
      version: CHARACTER_STATES_SNAPSHOT_VERSION,
      producer: {
        name: 'legacy',
      },
      states: legacyStatesParseResult.data,
    };
  }

  throw new Error('导入文件不是有效的角色状态快照');
}

export function getCharacterStatesSnapshotImportWarnings(snapshot: CharacterStatesSnapshot): string[] {
  const context = getCurrentSnapshotContext();
  const warnings: string[] = [];

  if (snapshot.chat_id && context.chat_id && snapshot.chat_id !== context.chat_id) {
    warnings.push(`快照来自聊天 ${snapshot.chat_id}，当前聊天是 ${context.chat_id}`);
  }

  if (snapshot.character_name && context.character_name && snapshot.character_name !== context.character_name) {
    warnings.push(`快照来自角色 ${snapshot.character_name}，当前角色是 ${context.character_name}`);
  }

  return warnings;
}

function formatSummarizeMemoryPrompt(content: string): string {
  const template = SillyTavern.extensionSettings?.memory?.template;
  const templateText =
    typeof template === 'string' && template.includes('{{summary}}') ? template : SUMMARIZE_DEFAULT_TEMPLATE;
  return templateText.replace(/{{summary}}/g, content);
}

function refreshActiveSummarizeMemoryPrompt(content: string): void {
  const prompt = SillyTavern.extensionPrompts?.[SUMMARIZE_EXTENSION_PROMPT_ID];
  if (!prompt) {
    return;
  }

  SillyTavern.setExtensionPrompt(
    SUMMARIZE_EXTENSION_PROMPT_ID,
    formatSummarizeMemoryPrompt(content),
    prompt.position === -1 ? -1 : 1,
    prompt.depth,
    prompt.scan,
    prompt.role,
    prompt.filter,
  ).catch(error => devWarn('刷新 Summarize 摘要注入失败:', error));
}

async function importSummarizeMemorySnapshot(snapshot: SummarizeMemorySnapshot): Promise<number> {
  const messages = getChatMessages('0-{{lastMessageId}}');
  if (messages.length === 0) {
    throw new Error('当前聊天没有可写入 Summarize 摘要的楼层');
  }

  // SillyTavern 内置 Summarize 会默认把摘要保存到倒数第二楼；只有一楼时保存到第 0 楼。
  const targetMessage = messages[Math.max(0, messages.length - 2)];
  await setChatMessages(
    [
      {
        message_id: targetMessage.message_id,
        extra: {
          ...targetMessage.extra,
          memory: snapshot.content,
        },
      },
    ],
    { refresh: 'none' },
  );
  refreshActiveSummarizeMemoryPrompt(snapshot.content);
  return targetMessage.message_id;
}

export async function importCharacterStatesSnapshot(
  rawSnapshot: unknown,
  mode: CharacterStatesImportMode,
  { includeSummarize = true }: { includeSummarize?: boolean } = {},
): Promise<{
  snapshot: CharacterStatesSnapshot;
  characterCount: number;
  stateCount: number;
  summarizeImported: boolean;
  summarizeImportError?: string;
  summarizeMessageId?: number;
}> {
  const snapshot = normalizeCharacterStatesSnapshot(rawSnapshot);
  const stateCount = countCharacterStates(snapshot.states);
  const shouldImportStates = stateCount > 0 || !snapshot.summarize;

  if (shouldImportStates) {
    const currentStates = getLatestCharacterStatesData();
    const importedStates =
      mode === 'replace' ? cloneCharacterStates(snapshot.states) : _.merge({}, currentStates, snapshot.states);

    const latestMessage = getLatestAssistantMessage();
    if (!latestMessage) {
      syncChatVariablesFromStates(importedStates);
      devLog('当前聊天尚无 assistant 消息，已将导入状态暂存到聊天变量，后续 assistant 楼层会写入快照');
    } else {
      await writeMessageStateSnapshot(latestMessage.message_id, importedStates);
      syncChatVariablesFromStates(importedStates);
    }
  }

  let summarizeMessageId: number | undefined;
  let summarizeImportError: string | undefined;
  if (includeSummarize && snapshot.summarize) {
    try {
      summarizeMessageId = await importSummarizeMemorySnapshot(snapshot.summarize);
    } catch (error) {
      summarizeImportError = error instanceof Error ? error.message : String(error);
      devWarn('导入 Summarize 摘要失败:', error);
    }
  }

  return {
    snapshot,
    characterCount: Object.keys(snapshot.states).length,
    stateCount,
    summarizeImported: summarizeMessageId !== undefined,
    summarizeImportError,
    summarizeMessageId,
  };
}

/**
 * 初始化角色状态
 * @param characterName 角色名称
 * @param stateNames 状态名称列表
 * @param initialValues 可选的初始值映射，key 为状态名称，value 为初始值。如果某个状态未提供初始值，则默认为 0
 */
export function initializeStates(
  characterName: string,
  stateNames: string[],
  initialValues?: Record<string, CharacterStateValue>,
  states: CharacterStatesData = getLatestCharacterStatesData(),
): CharacterStatesData {
  const nextStates = cloneCharacterStates(states);
  const initialized: string[] = [];
  const existing: string[] = [];

  stateNames.forEach(stateName => {
    if (!_.has(nextStates, [characterName, stateName])) {
      const initialValue = initialValues?.[stateName] ?? 0;
      const source = initialValues?.[stateName] !== undefined ? '自定义初始值' : '默认值(0)';
      _.set(nextStates, [characterName, stateName], initialValue);
      initialized.push(`${characterName}.${stateName} = ${initialValue} (${source})`);
    } else {
      existing.push(`${characterName}.${stateName}`);
    }
  });

  if (initialized.length > 0) {
    devLog(`新初始化状态: ${initialized.join(', ')}`);
  }
  if (existing.length > 0) {
    devLog(`已存在状态（已跳过）: ${existing.map(p => `${p} = ${_.get(nextStates, p)}`).join(', ')}`);
  }

  return nextStates;
}

function parseSetValue(rawValue: string): CharacterStateValue | undefined {
  const value = rawValue.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : undefined;
}

export function parseStateUpdates(text: string): Array<{
  characterName: string;
  stateName: string;
  oldValue: CharacterStateValue;
  newValue: CharacterStateValue;
}> {
  const updates: Array<{
    characterName: string;
    stateName: string;
    oldValue: CharacterStateValue;
    newValue: CharacterStateValue;
  }> = [];
  const pattern = new RegExp(STATE_UPDATE_PATTERN_TEXT, 'gi');
  const fullPattern = new RegExp(`^${STATE_UPDATE_PATTERN_TEXT}`, 'i');
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const characterName = match[2].trim();
    const stateName = match[3].trim();
    const oldValue = parseSetValue(match[4]);
    const newValue = parseSetValue(match[5]);

    if (oldValue !== undefined && newValue !== undefined) {
      updates.push({ characterName, stateName, oldValue, newValue });
    }
  }

  const allSetStarts: number[] = [];
  const setStartPattern = /_\.set\s*\(/gi;
  let setStartMatch;
  while ((setStartMatch = setStartPattern.exec(text)) !== null) {
    allSetStarts.push(setStartMatch.index);
  }

  const matchedEnds = new Set<number>();
  pattern.lastIndex = 0;
  while ((match = pattern.exec(text)) !== null) {
    matchedEnds.add(match.index + match[0].length);
  }

  const lastMatchedEnd = matchedEnds.size > 0 ? Math.max(...matchedEnds) : -1;
  for (const startPos of allSetStarts) {
    if (startPos > lastMatchedEnd) {
      const afterStart = text.substring(startPos);
      if (!fullPattern.test(afterStart)) {
        const charStateMatch = afterStart.match(/["']([^"']+)\.([^"']+)["']/);
        const identifier = charStateMatch ? `${charStateMatch[1]}.${charStateMatch[2]}` : '未知';
        devWarn(`检测到未闭合的 _.set() 表达式（可能是消息被截断）: ${identifier}。该表达式将被忽略。`);
        break;
      }
    }
  }

  return updates;
}

export function stripStateUpdateCommandsFromText(text: string): string {
  const stateUpdatePattern = new RegExp(STATE_UPDATE_PATTERN_TEXT, 'i');
  return text
    .split('\n')
    .filter(line => !stateUpdatePattern.test(line))
    .join('\n')
    .trimEnd();
}

export function applyStateUpdateToStates(
  states: CharacterStatesData,
  characterName: string,
  stateName: string,
  oldValue: CharacterStateValue,
  newValue: CharacterStateValue,
): CharacterStatesData {
  const nextStates = cloneCharacterStates(states);
  if (typeof oldValue === 'number' && typeof newValue === 'number') {
    const currentValue = _.get(nextStates, [characterName, stateName], 0);
    const numericCurrentValue = typeof currentValue === 'number' ? currentValue : 0;
    _.set(nextStates, [characterName, stateName], numericCurrentValue + newValue - oldValue);
  } else {
    _.set(nextStates, [characterName, stateName], newValue);
  }
  return nextStates;
}

export function getCurrentStateValue(characterName: string, stateName: string): CharacterStateValue {
  return _.get(getLatestCharacterStatesData(), [characterName, stateName], 0);
}

function getStateValueFromStates(
  states: CharacterStatesData,
  characterName: string,
  stateName: string,
): CharacterStateValue {
  return _.get(states, [characterName, stateName], 0);
}

export function getStateBranch(stateValue: CharacterStateValue, ranges: StateBranch[]): StateBranch | null {
  for (const branch of ranges) {
    if (branch.value !== undefined && branch.value === stateValue) {
      return branch;
    }
    if (
      typeof stateValue === 'number' &&
      branch.min !== undefined &&
      branch.max !== undefined &&
      stateValue >= branch.min &&
      stateValue <= branch.max
    ) {
      return branch;
    }
  }
  return null;
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function parseAllStateDefinitionsFromPrompt(
  promptText: string,
  useYaml: boolean = false,
): Array<{
  characterName: string;
  states: StateDefinition[];
  tagContent: string; // 完整的标签内容，用于替换
}> {
  const CHARACTER_STATES_TAG = /<character_states>([\s\S]*?)<\/character_states>/gi;
  const matches = [...promptText.matchAll(CHARACTER_STATES_TAG)];

  if (matches.length === 0) {
    return [];
  }

  const allDefinitions: Array<{
    characterName: string;
    states: StateDefinition[];
    tagContent: string;
  }> = [];

  for (const match of matches) {
    const content = match[1].trim();
    if (!content) {
      continue;
    }

    try {
      const stateConfig: {
        name?: string;
        characters?: Array<{
          name: string;
          states: StateDefinition[];
        }>;
      } = useYaml ? YAML.parse(content) : JSON.parse(content);

      if (stateConfig.name !== 'character_states' || !stateConfig.characters) {
        continue;
      }

      for (const character of stateConfig.characters) {
        if (!character || !character.states || character.states.length === 0) {
          continue;
        }

        allDefinitions.push({
          characterName: character.name,
          states: character.states.map(state => ({
            name: state.name,
            ranges: state.ranges,
          })),
          tagContent: match[0], // 完整的标签，包括 <character_states>...</character_states>
        });
      }
    } catch (error) {
      devWarn('解析状态定义失败:', error);
      continue;
    }
  }

  return allDefinitions;
}

/**
 * 把定义用 <character_states> 标签替换为当前匹配分支的 content。
 * instruction 仅附在聊天尾部的当前状态信息中，这里不重复。
 */
export function replaceCharacterStatesTagsInText(
  text: string,
  stateDefinitions: Array<{
    characterName: string;
    states: StateDefinition[];
    tagContent: string;
  }>,
  states: CharacterStatesData = getLatestCharacterStatesData(),
): string {
  if (stateDefinitions.length === 0) {
    return text;
  }

  const tagGroups = new Map<
    string,
    Array<{
      characterName: string;
      states: StateDefinition[];
    }>
  >();

  for (const def of stateDefinitions) {
    if (!tagGroups.has(def.tagContent)) {
      tagGroups.set(def.tagContent, []);
    }
    tagGroups.get(def.tagContent)!.push({
      characterName: def.characterName,
      states: def.states,
    });
  }

  let result = text;
  for (const [tagContent, characters] of tagGroups.entries()) {
    const allStateContents: string[] = [];
    for (const char of characters) {
      char.states.forEach(stateDef => {
        const stateValue = getStateValueFromStates(states, char.characterName, stateDef.name);
        const stateBranch = getStateBranch(stateValue, stateDef.ranges);
        if (stateBranch) {
          const stateName = escapeXmlAttribute(`${char.characterName}.${stateDef.name}`);
          const contentText = stateBranch.content.trim();
          allStateContents.push(
            contentText ? `<state name="${stateName}">\n${escapeXmlText(contentText)}\n</state>` : `<state name="${stateName}" />`,
          );
        }
      });
    }

    const replacement =
      allStateContents.length > 0
        ? `<character_states type="content">\n${allStateContents.join('\n')}\n</character_states>`
        : '<character_states type="content">\n</character_states>';
    result = result.replace(tagContent, replacement);
  }

  return result;
}

/**
 * 构造当前角色状态 XML 块（更新格式 + 值 + 边界 + 当前分支指南），用于在聊天末端追加为一条 system 消息。
 * content 已由 replaceCharacterStatesTagsInText 在前缀输出，此处不重复。
 */
export function buildCurrentStatesText(
  stateDefinitions: Array<{
    characterName: string;
    states: StateDefinition[];
  }>,
  states: CharacterStatesData = getLatestCharacterStatesData(),
): string | null {
  if (stateDefinitions.length === 0) {
    return null;
  }

  const stateEntries: string[] = [];
  const processedChars = new Set<string>();
  for (const def of stateDefinitions) {
    if (processedChars.has(def.characterName)) continue;
    processedChars.add(def.characterName);

    for (const stateDef of def.states) {
      const stateValue = getStateValueFromStates(states, def.characterName, stateDef.name);
      const stateBranch = getStateBranch(stateValue, stateDef.ranges);
      const rangeBranches = stateDef.ranges.filter(branch => branch.min !== undefined && branch.max !== undefined);
      const valueText = String(stateValue);
      const instructionText = stateBranch?.instruction?.trim();
      const attrs = [
        `name="${escapeXmlAttribute(`${def.characterName}.${stateDef.name}`)}"`,
        `value="${escapeXmlAttribute(valueText)}"`,
      ];

      if (rangeBranches.length > 0 && typeof stateValue === 'number') {
        const globalMin = Math.min(...rangeBranches.map(r => r.min!));
        const globalMax = Math.max(...rangeBranches.map(r => r.max!));
        attrs.push(`min="${globalMin}"`, `max="${globalMax}"`);
      }

      stateEntries.push(
        instructionText
          ? `<instruction ${attrs.join(' ')}>\n${escapeXmlText(instructionText)}\n</instruction>`
          : `<instruction ${attrs.join(' ')} />`,
      );
    }
  }

  if (stateEntries.length === 0) {
    return null;
  }

  const updateFormatEntry = `<update_format>\n${escapeXmlText(STATE_UPDATE_FORMAT_TEXT)}\n</update_format>`;
  return `<character_states type="current">\n${[updateFormatEntry, ...stateEntries].join('\n')}\n</character_states>`;
}

export function getAllStatesDisplay(
  characterName: string,
  stateDefinitions: StateDefinition[],
): Array<{ name: string; value: CharacterStateValue; content: string | null }> {
  return stateDefinitions.map(stateDef => {
    const stateValue = getCurrentStateValue(characterName, stateDef.name);
    const stateBranch = getStateBranch(stateValue, stateDef.ranges);
    if (stateBranch) {
      return {
        name: stateDef.name,
        value: stateValue,
        content: stateBranch.content,
      };
    }
    return {
      name: stateDef.name,
      value: stateValue,
      content: null,
    };
  });
}

export function getAllCharactersStates(): Record<string, Record<string, CharacterStateValue>> {
  const characterStates: Record<string, Record<string, CharacterStateValue>> = {};
  const statesData = getLatestCharacterStatesData();
  if (!statesData || typeof statesData !== 'object') {
    return characterStates;
  }

  for (const characterName in statesData) {
    const characterData = statesData[characterName];
    if (characterData && typeof characterData === 'object') {
      const states: Record<string, CharacterStateValue> = {};
      for (const stateName in characterData) {
        const value = characterData[stateName];
        if (['number', 'string', 'boolean'].includes(typeof value)) {
          states[stateName] = value;
        }
      }
      if (Object.keys(states).length > 0) {
        characterStates[characterName] = states;
      }
    }
  }

  return characterStates;
}

/**
 * 从 <character_states_init> 标签收集尚不存在状态的初始值。
 * 数值状态使用 delta = newValue - oldValue，离散状态直接使用 newValue。
 */
export function getAllInitialValuesFromInitTag(
  chat: SillyTavern.SendingMessage[],
  states: CharacterStatesData = getLatestCharacterStatesData(),
): Record<string, Record<string, CharacterStateValue>> {
  const CHARACTER_STATES_INIT_TAG = /<character_states_init>([\s\S]*?)<\/character_states_init>/gi;
  const allUpdates: Array<{ characterName: string; stateName: string; value: CharacterStateValue }> = [];

  for (const message of chat) {
    if (message.role !== 'assistant' || !message.content) {
      continue;
    }

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

    if (!contentText) {
      continue;
    }

    const matches = [...contentText.matchAll(CHARACTER_STATES_INIT_TAG)];
    if (matches.length === 0) {
      continue;
    }

    for (const match of matches) {
      const tagContent = match[1].trim();
      if (!tagContent) continue;

      const updates = parseStateUpdates(tagContent);

      for (const update of updates) {
        if (!_.has(states, [update.characterName, update.stateName])) {
          allUpdates.push({
            characterName: update.characterName,
            stateName: update.stateName,
            value:
              typeof update.oldValue === 'number' && typeof update.newValue === 'number'
                ? update.newValue - update.oldValue
                : update.newValue,
          });
        }
      }
    }
  }

  const result: Record<string, Record<string, CharacterStateValue>> = {};
  for (const update of allUpdates) {
    if (!result[update.characterName]) {
      result[update.characterName] = {};
    }
    if (result[update.characterName][update.stateName] === undefined) {
      result[update.characterName][update.stateName] = update.value;
    }
  }

  return result;
}
