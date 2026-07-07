# 角色状态管理脚本

一个简洁的角色状态管理框架，每个角色可以有一个或多个状态变量，每个状态按连续数值区间或离散值匹配不同 content，并为当前分支提供更新指南。

## 功能特性

### 1. 自动解析状态定义

- **从 prompt 中提取**：使用 `<character_states>` 标签在 prompt 中定义状态
- **支持多个状态**：每个角色可以有一个或多个状态变量
- **状态分支 content**：每个状态可按 `min/max` 或 `value` 匹配不同 content
- **分支更新指南**：当前命中分支的 `instruction` 会附在聊天尾部状态信息中
- **缺省值为 0**：缺失状态参与分支匹配时按 0 处理，可用 `<character_states_init>` 写入初始值

### 2. 状态更新

- **LLM API 格式触发**：状态更新由 LLM API 输出中的 `_.set("角色名.状态名",oldvalue,newvalue)` 格式触发
- **支持多个更新**：一次可以更新多个状态
- **自动应用**：脚本自动解析并应用状态更新

### 3. Prompt 变量替换

- **状态注入**：在 prompt 发送前自动注入当前状态信息
- **分支匹配**：根据状态值自动匹配对应分支的 content

## 使用方法

### 1. 在 Prompt 中定义状态

在角色描述、世界书或其他 prompt 位置使用 `<character_states>` 标签定义状态：

**JSON 格式（默认）：**

```json
<character_states>
{
  "name": "character_states",
  "characters": [
    {
      "name": "角色名",
      "states": [
        {
          "name": "好感度",
          "ranges": [
            {
              "min": 0,
              "max": 30,
              "content": "角色对用户态度冷淡，说话语气生硬",
              "instruction": "若用户持续体贴或帮助角色，可提高好感度；若冒犯角色，应降低好感度。"
            },
            {"min": 31, "max": 70, "content": "角色对用户态度正常，保持礼貌"},
            {"min": 71, "max": 100, "content": "角色对用户态度友好，语气亲切"}
          ]
        },
        {
          "name": "关系阶段",
          "ranges": [
            {
              "value": "stranger",
              "content": "角色与用户仍保持距离，交流偏谨慎",
              "instruction": "若用户表现稳定可靠，可将关系阶段更新为 curious；若越界或威胁角色，可更新为 guarded。"
            },
            {"value": "curious", "content": "角色开始对用户产生兴趣，愿意多交流"}
          ]
        }
      ]
    }
  ]
}
</character_states>
```

**YAML 格式（需启用"使用 YAML 格式解析状态定义"开关）：**

```yaml
<character_states>
name: character_states
characters:
  - name: 角色名
    states:
      - name: 好感度
        ranges:
          - min: 0
            max: 30
            content: 角色对用户态度冷淡，说话语气生硬
            instruction: 若用户持续体贴或帮助角色，可提高好感度；若冒犯角色，应降低好感度。
          - min: 31
            max: 70
            content: 角色对用户态度正常，保持礼貌
          - min: 71
            max: 100
            content: 角色对用户态度友好，语气亲切
      - name: 关系阶段
        ranges:
          - value: stranger
            content: 角色与用户仍保持距离，交流偏谨慎
            instruction: 若用户表现稳定可靠，可将关系阶段更新为 curious；若越界或威胁角色，可更新为 guarded。
          - value: curious
            content: 角色开始对用户产生兴趣，愿意多交流
</character_states>
```

**注意**：

- 启用 YAML 模式后，`JSON` 格式将不再被识别（请确保标签内格式与开关一致）
- 每个角色可以定义多个状态
- 每个状态可以有多个状态分支
- 连续分支使用 `min`、`max` 和 `content`
- 离散分支使用 `value` 和 `content`，`value` 支持字符串、数字和布尔值
- `instruction` 可选，只会注入聊天尾部，用于提示 LLM 如何从当前分支转移
- 缺失状态参与匹配时按 0 处理

### 2. 配置脚本设置

在脚本设置界面中：

1. 启用"角色状态管理"
2. 启用"在聊天末尾注入当前状态信息（缓存友好）"（可选）

### 3. 在 LLM 回复中使用状态更新命令

LLM 可以在回复中包含状态更新命令，格式为：

```
_.set("角色名.状态名",oldvalue,newvalue)
```

可以一次更新多个状态：

```
用户：你今天心情怎么样？

AI：我今天心情很好！_.set("角色名.好感度",50,55) _.set("角色名.信任度",60,65)
```

离散状态可以直接跳转：

```
AI：我愿意再听你说一会儿。_.set("角色名.关系阶段","stranger","curious")
```

脚本会自动解析并更新所有状态。

### 4. 在世界书中使用状态变量

在世界书或其他地方，可以使用状态变量，格式为 `{{character_states.角色名.状态名}}`：

```
[当前状态]
好感度: {{character_states.角色名.好感度}}
信任度: {{character_states.角色名.信任度}}
```

这些变量会在 prompt 组合时被替换为实际的状态值。

## 状态定义格式

### JSON 格式

```json
{
  "name": "character_states",
  "characters": [
    {
      "name": "角色名",
      "states": [
        {
          "name": "状态名",
          "ranges": [
            {"min": 最小值, "max": 最大值, "content": "连续分支内容", "instruction": "当前分支更新指南"},
            {"value": "离散值", "content": "离散分支内容", "instruction": "当前分支更新指南"}
          ]
        }
      ]
    }
  ]
}
```

**字段说明**：

- `name`: 固定为 `"character_states"`
- `characters`: 角色数组
  - `name`: 角色名称（必须与当前角色名匹配）
  - `states`: 状态数组（每个角色可以有多个状态）
    - `name`: 状态名称
    - `ranges`: 状态分支数组
      - `min`: 连续分支最小值（包含）
      - `max`: 连续分支最大值（包含）
      - `value`: 离散分支匹配值，支持字符串、数字和布尔值
      - `content`: 当前分支对应的内容文本
      - `instruction`: 当前分支对应的更新指南，会附在聊天尾部当前状态信息

### 分支匹配规则

- 状态值会按 `ranges` 顺序匹配
- 分支存在 `value` 时，使用严格相等匹配离散值
- 否则在状态值为数字时，用 `min <= 值 <= max` 匹配连续分支
- 找到第一个匹配分支后返回对应的 `content`，并把该分支的 `instruction` 附在尾部状态信息
- 如果状态值不匹配任何分支，content 返回 `null`，尾部状态仍显示当前值

## 配置选项

### 功能开关

- **启用角色状态管理**：总开关
- **在聊天末尾注入当前状态信息**：是否在每次生成前，把当前状态值作为一条 system 消息追加到聊天末尾。关闭后 LLM 仅看到状态定义（分支规则），看不到当前数值
- **开发模式（显示详细日志）**：是否在控制台显示详细的处理日志，用于调试

## 工作原理

1. **状态定义解析**：
   - 监听 prompt 组合完成事件
   - 从 prompt 中提取 `<character_states>` 标签内容
   - 解析 JSON 格式的状态定义
   - 根据当前角色名匹配对应的状态定义

2. **初始化**：
   - `<character_states_init>` 中的 `_.set()` 可为尚不存在的状态写入初始值
   - 已存在状态不会被初始化覆盖
   - 未写入快照的缺失状态参与匹配时按 0 处理

3. **状态更新**：
   - 监听 `MESSAGE_RECEIVED`、`MESSAGE_UPDATED`、`MESSAGE_EDITED`、`MESSAGE_SWIPED` 和 `MESSAGE_DELETED` 事件
   - 从消息文本中提取所有 `_.set()` 语句
   - 每个 assistant 楼层保存一份回复结束后的完整 `character_states` 快照
   - 新楼层基于上一份有效快照应用当前楼层的状态更新，再写回当前楼层
   - 历史消息编辑、删除或切换 swipe 时，从变动楼层开始清理后续快照并顺序重放
   - 旧聊天若只有聊天变量而没有楼层快照，会惰性迁移到当前分支末端 assistant 楼层作为锚点
   - 数值状态使用差值（delta）更新，避免 oldValue 不准确导致的问题
   - 离散状态直接写入 newValue，用于阶段、标签、布尔开关等跳转
   - 发送给 LLM 前会临时剥离 assistant 历史消息中包含 `_.set()` 更新命令的整行，避免历史更新语句污染上下文；聊天原文不会被改写

4. **当前 content 替换**：
   - 在 `CHAT_COMPLETION_PROMPT_READY` 事件中，把定义用 `<character_states>` 标签原地替换为 `<character_states type="content">`，其中只包含当前匹配分支的 content（不暴露其他分支）
   - 连续状态在区间内数值波动不影响该文本，仅在跨分支转移时变化
   - 当前分支的 content 为空时，输出自闭合 `<state name="角色.状态名" />`

5. **当前状态末端注入**：
   - 在 `CHAT_COMPLETION_PROMPT_READY` 事件中，直接修改 `event_data.chat`，把"当前状态值、数值边界和当前分支指南"作为一条 system 消息追加到聊天末尾
   - 由 `inject_current_state_at_end` 开关控制
   - 状态信息格式：

```xml
<character_states type="current">
<instruction name="角色.状态名1" value="值1" min="..." max="...">
当前分支 instruction
</instruction>
<instruction name="角色.状态名2" value="阶段值" />
</character_states>
```

没有 `instruction` 的状态使用自闭合 `<instruction />`，只提供当前值。

6. **变量替换**：
   - 在世界书或其他地方使用 `{{character_states.角色名.状态名}}` 格式的变量
   - 酒馆会在 prompt 组合时自动替换这些变量为实际值

7. **楼层快照同步**：
   - 当前状态以最新有效楼层快照为准
   - 聊天变量中的 `character_states` 只作为末端备份，便于兼容旧模板和设置界面
   - 只有旧聊天没有任何楼层快照时，聊天变量才会作为首次迁移种子
   - 当最后有效 assistant 楼层快照更新时，同步刷新聊天变量备份

## 示例

### 完整的状态定义示例

```json
<character_states>
{
  "name": "character_states",
  "characters": [
    {
      "name": "神乐光",
      "states": [
        {
          "name": "好感度",
          "ranges": [
            {"min": 0, "max": 20, "content": "角色对用户非常冷淡，几乎不愿意交流"},
            {"min": 21, "max": 40, "content": "角色对用户态度冷淡，保持距离"},
            {
              "min": 41,
              "max": 60,
              "content": "角色对用户态度正常，保持礼貌",
              "instruction": "若用户表达尊重或提供帮助，可小幅提高好感度；若用户失礼，可降低好感度。"
            },
            {"min": 61, "max": 80, "content": "角色对用户态度友好，愿意交流"},
            {"min": 81, "max": 100, "content": "角色对用户非常友好，关系亲密"}
          ]
        },
        {
          "name": "情绪",
          "ranges": [
            {"min": 0, "max": 30, "content": "角色情绪低落，说话语气沉重"},
            {"min": 31, "max": 70, "content": "角色情绪稳定，表现正常"},
            {"min": 71, "max": 100, "content": "角色心情愉悦，说话轻松愉快"}
          ]
        },
        {
          "name": "关系阶段",
          "ranges": [
            {
              "value": "stranger",
              "content": "角色与用户仍保持距离，交流偏谨慎",
              "instruction": "若用户表现稳定可靠，可将关系阶段更新为 curious；若越界或威胁角色，可更新为 guarded。"
            },
            {
              "value": "curious",
              "content": "角色开始对用户产生兴趣，愿意多交流",
              "instruction": "若双方出现明确信任事件，可将关系阶段更新为 trusted。"
            },
            {"value": "guarded", "content": "角色对用户保持戒备，优先保护自己"}
          ]
        }
      ]
    }
  ]
}
</character_states>
```

### LLM 回复示例

```
用户：你今天感觉怎么样？

AI：我今天心情很好，感觉很有活力！_.set("神乐光.好感度",50,55) _.set("神乐光.情绪",60,75) _.set("神乐光.关系阶段","stranger","curious")
```

### 世界书条目示例

在世界书中可以这样使用状态变量：

```
[当前状态]
好感度: {{character_states.神乐光.好感度}}
情绪: {{character_states.神乐光.情绪}}

根据当前状态调整角色行为：
- 如果好感度 >= 80，角色对用户非常友好
- 如果情绪 >= 70，角色说话语气轻松
- 如果好感度 < 40，角色对用户态度冷淡
```

## 核心机制

### 1. 楼层快照

脚本会把每个 assistant 楼层处理完成后的完整 `character_states` 写入该楼层的 `data.character_states`。当前状态始终读取当前分支最新有效楼层快照。

- ✅ **分支天然一致**：切换 swipe 后读取当前分支的最新快照
- ✅ **回退天然一致**：删除后续楼层后，当前状态回到剩余历史的最新快照
- ✅ **少依赖内存账本**：刷新页面后仍能从聊天文件中的楼层快照恢复状态

聊天变量 `character_states` 只保存最新楼层快照的备份；只有旧聊天没有任何楼层快照时，它才会被惰性迁移为当前分支末端的快照锚点。

### 2. 重放机制

当历史消息被编辑、删除或切换 swipe 时，脚本会自动：

1. 清除变动楼层及之后的状态快照
2. 寻找变动楼层之前最近的有效快照
3. 顺序重放后续 assistant 楼层中的 `_.set()` 更新
4. 将每层重放后的完整状态重新写回对应楼层

这避免了旧实现中“回退旧 delta 再应用新 delta”的复杂账本问题。

### 3. 状态更新

数值状态使用 `delta = newValue - oldValue` 来计算更新量，然后应用 `currentValue + delta`。这样即使 LLM 提供的 `oldValue` 不准确，只要差值正确，更新就是正确的。

离散状态直接写入 `newValue`，适合阶段、立场、开关等不需要连续加减的变量：

```
_.set("神乐光.关系阶段","stranger","curious")
```

### 4. 并发处理保护

状态快照重建会进入串行队列，避免多个消息事件同时重放同一段历史。

## 注意事项

1. **状态定义位置**：`<character_states>` 标签可以放在角色描述、世界书或任何 prompt 位置
2. **状态更新命令**：LLM 需要在回复中包含 `_.set("角色名.状态名",oldvalue,newvalue)` 格式的命令才能触发更新
3. **变量格式**：在世界书中使用状态变量时，使用 `{{character_states.角色名.状态名}}` 格式
4. **自动解析**：状态定义会在每次 prompt 组合时自动解析和更新
5. **角色匹配**：状态定义中的角色名必须与当前角色名完全匹配
6. **分支重叠**：如果状态值同时匹配多个分支，会返回第一个匹配分支的 content
7. **分支覆盖**：建议确保常见状态值都有对应分支，避免 content 返回 null
8. **未闭合表达式**：如果消息被截断导致 `_.set()` 表达式未闭合，脚本会记录警告并忽略该表达式
9. **历史消息编辑**：编辑历史消息时，脚本会清理后续快照并从最近有效快照重放

## 功能

- ✅ **灵活的状态定义**：每个角色可以有多个状态，每个状态可以有多个连续或离散分支
- ✅ **精细的状态控制**：不同状态分支对应不同 content，实现精细的状态控制
- ✅ **无需手动配置**：状态定义直接从 prompt 中解析，无需在设置界面中手动添加
- ✅ **初始化可控**：缺失状态按 0 匹配，也可用 `<character_states_init>` 写入初始值
- ✅ **标准格式**：使用 `_.set()` 格式，与 MagVarUpdate 语法一致
- ✅ **简洁的设置界面**：使用 SillyTavern 原生控件，界面简洁易用
- ✅ **楼层快照**：每个 assistant 楼层保存回复结束后的完整状态，刷新后也能恢复
- ✅ **自动重放**：编辑、删除或切换 swipe 时从最近有效快照重放，确保状态一致性
- ✅ **混合更新**：数值状态使用差值更新，离散状态直接跳转
- ✅ **开发模式**：提供开发模式开关，方便调试和排查问题
