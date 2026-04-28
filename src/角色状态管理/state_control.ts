const VARIABLE_TYPE = 'chat' as const;
const STATE_PATH_PREFIX = 'character_states';

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

function getStatePath(characterName: string, stateName: string): string {
  return `${STATE_PATH_PREFIX}.${characterName}.${stateName}`;
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
  initialValues?: Record<string, number>,
): void {
  const variableOption = { type: VARIABLE_TYPE };
  const variables = getVariables(variableOption);

  let hasChanges = false;
  const initialized: string[] = [];
  const existing: string[] = [];

  stateNames.forEach(stateName => {
    const statePath = getStatePath(characterName, stateName);
    if (!_.has(variables, statePath)) {
      // 如果提供了初始值映射且该状态有初始值，使用提供的初始值；否则使用 0
      const initialValue = initialValues?.[stateName] ?? 0;
      const source = initialValues?.[stateName] !== undefined ? '自定义初始值' : '默认值(0)';
      _.set(variables, statePath, initialValue);
      hasChanges = true;
      initialized.push(`${statePath} = ${initialValue} (${source})`);
    } else {
      existing.push(statePath);
    }
  });

  if (hasChanges) {
    replaceVariables(variables, variableOption);
  }

  if (initialized.length > 0) {
    devLog(`新初始化状态: ${initialized.join(', ')}`);
  }
  if (existing.length > 0) {
    devLog(`已存在状态（已跳过）: ${existing.map(p => `${p} = ${_.get(variables, p)}`).join(', ')}`);
  }
}

export function parseStateUpdates(text: string): Array<{ characterName: string; stateName: string; delta: number; oldValue: number; newValue: number }> {
  const updates: Array<{ characterName: string; stateName: string; delta: number; oldValue: number; newValue: number }> = [];
  const pattern = /_\.set\s*\(\s*(["'])([^"']+)\.([^"']+)\1\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/gi;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const characterName = match[2].trim();
    const stateName = match[3].trim();
    const oldValue = parseFloat(match[4]);
    const newValue = parseFloat(match[5]);

    if (!isNaN(oldValue) && !isNaN(newValue)) {
      const delta = newValue - oldValue;
      updates.push({ characterName, stateName, delta, oldValue, newValue });
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
      if (!afterStart.match(/^_\.set\s*\(\s*(["'])([^"']+)\.([^"']+)\1\s*,\s*[\d.]+\s*,\s*[\d.]+\s*\)/)) {
        const charStateMatch = afterStart.match(/["']([^"']+)\.([^"']+)["']/);
        const identifier = charStateMatch ? `${charStateMatch[1]}.${charStateMatch[2]}` : '未知';
        devWarn(`检测到未闭合的 _.set() 表达式（可能是消息被截断）: ${identifier}。该表达式将被忽略。`);
        break;
      }
    }
  }

  return updates;
}

export function applyStateUpdate(characterName: string, stateName: string, delta: number): void {
  const variableOption = { type: VARIABLE_TYPE };
  const variables = getVariables(variableOption);
  const statePath = getStatePath(characterName, stateName);
  const currentValue = _.get(variables, statePath, 0);
  const newValue = currentValue + delta;
  _.set(variables, statePath, newValue);
  replaceVariables(variables, variableOption);
  devLog(`状态更新: ${statePath} = ${currentValue} -> ${newValue} (delta: ${delta > 0 ? '+' : ''}${delta})`);
}

export function getCurrentStateValue(characterName: string, stateName: string): number {
  const variableOption = { type: VARIABLE_TYPE };
  const variables = getVariables(variableOption);
  const statePath = getStatePath(characterName, stateName);
  return _.get(variables, statePath, 0);
}

export function getStateObject(stateValue: number, ranges: Array<{ min: number; max: number; content: string }>): { min: number; max: number; content: string } | null {
  for (const range of ranges) {
    if (stateValue >= range.min && stateValue <= range.max) {
      return range;
    }
  }
  return null;
}

export function parseAllStateDefinitionsFromPrompt(
  promptText: string,
): Array<{
  characterName: string;
  states: Array<{ name: string; ranges: Array<{ min: number; max: number; content: string }> }>;
  tagContent: string; // 完整的标签内容，用于替换
}> {
  const CHARACTER_STATES_TAG = /<character_states>([\s\S]*?)<\/character_states>/gi;
  const matches = [...promptText.matchAll(CHARACTER_STATES_TAG)];

  if (matches.length === 0) {
    return [];
  }

  const allDefinitions: Array<{
    characterName: string;
    states: Array<{ name: string; ranges: Array<{ min: number; max: number; content: string }> }>;
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
          states: Array<{
            name: string;
            ranges: Array<{
              min: number;
              max: number;
              content: string;
            }>;
          }>;
        }>;
      } = JSON.parse(content);

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
      console.error('解析状态定义失败:', error);
      continue;
    }
  }

  return allDefinitions;
}

/**
 * 把 <character_states> 标签替换为仅含状态定义的稳定文本
 * （状态名 + 各区间 min/max/content）。当前数值由 buildCurrentStatesText 单独输出。
 */
export function replaceCharacterStatesTagsInText(
  text: string,
  stateDefinitions: Array<{
    characterName: string;
    states: Array<{ name: string; ranges: Array<{ min: number; max: number; content: string }> }>;
    tagContent: string;
  }>,
): string {
  if (stateDefinitions.length === 0) {
    return text;
  }

  const tagGroups = new Map<string, Array<{ characterName: string; states: Array<{ name: string; ranges: Array<{ min: number; max: number; content: string }> }> }>>();

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
        const rangeLines = stateDef.ranges.map(
          range => `  [${range.min}, ${range.max}]: ${range.content}`,
        );
        allStateContents.push(`${char.characterName}.${stateDef.name}:\n${rangeLines.join('\n')}`);
      });
    }

    const replacement = allStateContents.length > 0
      ? `<character_states>\n${allStateContents.join('\n\n')}\n</character_states>`
      : '<character_states>\n</character_states>';
    result = result.replace(tagContent, replacement);
  }

  return result;
}

/**
 * 构造"当前角色状态"文本，用于在聊天末端追加为一条 system 消息。
 */
export function buildCurrentStatesText(
  stateDefinitions: Array<{
    characterName: string;
    states: Array<{ name: string; ranges: Array<{ min: number; max: number; content: string }> }>;
  }>,
): string | null {
  if (stateDefinitions.length === 0) {
    return null;
  }

  const allStateTexts: string[] = [];
  const processedChars = new Set<string>();
  for (const def of stateDefinitions) {
    if (processedChars.has(def.characterName)) continue;
    processedChars.add(def.characterName);

    for (const stateDef of def.states) {
      const stateValue = getCurrentStateValue(def.characterName, stateDef.name);
      const stateObject = getStateObject(stateValue, stateDef.ranges);
      allStateTexts.push(
        stateObject?.content
          ? `${def.characterName}.${stateDef.name} = ${stateValue}（min=${stateObject.min} max=${stateObject.max}）\n${stateObject.content}`
          : `${def.characterName}.${stateDef.name} = ${stateValue}`,
      );
    }
  }

  if (allStateTexts.length === 0) {
    return null;
  }
  return `[角色状态: ${allStateTexts.join(', ')}]`;
}

export function getAllStatesDisplay(
  characterName: string,
  stateDefinitions: Array<{ name: string; ranges: Array<{ min: number; max: number; content: string }> }>,
): Array<{ name: string; value: number; content: string | null }> {
  return stateDefinitions.map(stateDef => {
    const stateValue = getCurrentStateValue(characterName, stateDef.name);
    const stateObject = getStateObject(stateValue, stateDef.ranges);
    if (stateObject) {
      return {
        name: stateDef.name,
        value: stateValue,
        content: stateObject.content,
      };
    }
    return {
      name: stateDef.name,
      value: stateValue,
      content: null,
    };
  });
}

export function getAllCharactersStates(): Record<string, Record<string, number>> {
  const variableOption = { type: VARIABLE_TYPE };
  const variables = getVariables(variableOption);
  const characterStates: Record<string, Record<string, number>> = {};
  const statesData = _.get(variables, STATE_PATH_PREFIX);
  if (!statesData || typeof statesData !== 'object') {
    return characterStates;
  }

  for (const characterName in statesData) {
    const characterData = statesData[characterName];
    if (characterData && typeof characterData === 'object') {
      const states: Record<string, number> = {};
      for (const stateName in characterData) {
        const value = characterData[stateName];
        if (typeof value === 'number') {
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
 * 从所有 assistant 消息的 <character_states_init> 标签中提取所有角色的状态初始值
 * 这是本次新增功能的自定义初始化值内容，只解析标签内的 _.set 语句
 * 
 * 统一逻辑：以 0 为基准，使用差值 delta = newValue - oldValue 作为初始值
 * 这样与状态更新逻辑保持一致（都是基于差值）
 * 
 * 示例：
 * - _.set("角色.状态", 0, 50) → delta = 50，初始值 = 50
 * - _.set("角色.状态", 10, 50) → delta = 40，初始值 = 40
 * 
 * @param chat 消息数组
 * @returns 按角色分组的初始值映射，key 为角色名称，value 为该角色的状态初始值映射
 */
export function getAllInitialValuesFromInitTag(
  chat: SillyTavern.SendingMessage[],
): Record<string, Record<string, number>> {
  const variableOption = { type: VARIABLE_TYPE };
  const variables = getVariables(variableOption);

  // 1. 扫描所有 assistant 消息，查找 <character_states_init> 标签
  const CHARACTER_STATES_INIT_TAG = /<character_states_init>([\s\S]*?)<\/character_states_init>/gi;
  const allUpdates: Array<{ characterName: string; stateName: string; delta: number }> = [];

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

    // 查找 <character_states_init> 标签
    const matches = [...contentText.matchAll(CHARACTER_STATES_INIT_TAG)];
    if (matches.length === 0) {
      continue;
    }

    devLog(`在 assistant 消息中找到 ${matches.length} 个 <character_states_init> 标签`);

    for (const match of matches) {
      const tagContent = match[1].trim();
      if (!tagContent) continue;

      // 解析标签内的 _.set 语句
      const updates = parseStateUpdates(tagContent);
      devLog(`从 <character_states_init> 标签中解析到 ${updates.length} 个 _.set 语句`);

      for (const update of updates) {
        const statePath = getStatePath(update.characterName, update.stateName);
        // 只收集不存在的状态（需要初始化的状态）
        if (!_.has(variables, statePath)) {
          allUpdates.push({
            characterName: update.characterName,
            stateName: update.stateName,
            delta: update.delta,
          });
          devLog(`收集初始值: ${update.characterName}.${update.stateName} = ${update.delta} (delta = ${update.newValue} - ${update.oldValue})`);
        } else {
          devLog(`跳过已存在的状态: ${update.characterName}.${update.stateName}`);
        }
      }
    }
  }

  // 2. 按角色分组
  const result: Record<string, Record<string, number>> = {};
  for (const update of allUpdates) {
    if (!result[update.characterName]) {
      result[update.characterName] = {};
    }
    // 如果同一个状态有多个更新，使用第一个（按出现顺序）
    if (!result[update.characterName][update.stateName]) {
      result[update.characterName][update.stateName] = update.delta;
    }
  }

  return result;
}
