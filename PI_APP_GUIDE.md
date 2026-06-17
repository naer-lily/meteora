# Pi 上下文组织与扩展开发指南

> 面向需要深度利用 Pi SDK/扩展体系进行**迭代式非对话应用**开发的场景。
> Pi 本身是代码 Agent，消息历史 = 代码库增量变更记录，不是聊天对话。

---

## 一、上下文组织方式

Pi 发给 LLM 的上下文由以下层次拼接而成：

```
┌─────────────────────────────────────────────────┐
│ System Prompt                                    │
│ ├─ 内置 prompt（编码助手行为规范）                 │
│ ├─ SYSTEM.md / APPEND_SYSTEM.md 覆盖或追加        │
│ ├─ before_agent_start 逐轮注入（链式改写）         │
│ ├─ 工具列表 + promptSnippet + promptGuidelines    │
│ ├─ Skills 摘要列表（XML 格式, 仅名称+描述）        │
│ └─ before_provider_request 可二次改写             │
├─────────────────────────────────────────────────┤
│ 上下文文件 (AGENTS.md / CLAUDE.md)                │
│ ├─ 从 cwd 向上递归加载，全部拼接                  │
│ └─ SDK 可注入虚拟文件，无需真实 .md 文件           │
├─────────────────────────────────────────────────┤
│ Messages（会话历史）                              │
│ ├─ Compaction 摘要（如有压缩）                     │
│ ├─ 用户消息 → 助手消息 → 工具调用 → 工具结果       │
│ ├─ 扩展注入的 custom_message                      │
│ └─ context 事件可逐轮过滤/改写消息列表             │
└─────────────────────────────────────────────────┘
```

### 1.1 上下文文件

Pi 启动时自动加载并拼接以下 `.md` 文件：

| 来源 | 路径 | 作用域 |
|------|------|--------|
| 全局 | `~/.pi/agent/AGENTS.md` | 所有项目 |
| 祖先目录 | cwd 向上递归 | 当前项目及父目录 |
| 当前目录 | `./AGENTS.md` 或 `./CLAUDE.md` | 当前项目 |

```bash
pi --no-context-files    # 禁用
```

SDK 方式注入虚拟上下文文件：

```typescript
const loader = new DefaultResourceLoader({
  agentsFilesOverride: (current) => ({
    agentsFiles: [
      ...current.agentsFiles,
      { path: "/virtual/rules.md", content: "..." },
    ],
  }),
});
```

### 1.2 系统提示词

| 文件 | 作用 |
|------|------|
| `.pi/SYSTEM.md` / `~/.pi/agent/SYSTEM.md` | **替换**默认 system prompt |
| `.pi/APPEND_SYSTEM.md` / `~/.pi/agent/APPEND_SYSTEM.md` | **追加**到默认 prompt 后 |

```bash
pi --system-prompt "你是一个..."          # CLI 替换
pi --append-system-prompt "额外的指令..."  # CLI 追加
```

SDK 方式：

```typescript
const loader = new DefaultResourceLoader({
  systemPromptOverride: () => "自定义 system prompt 全文",
});
```

### 1.3 工具描述注入

自定义工具通过两个字段控制其在系统提示词中的呈现：

```typescript
pi.registerTool({
  name: "my_tool",
  label: "显示名",
  description: "给 LLM 看的描述",
  promptSnippet: "一句话概要，显示在工具列表中",       // 不设此项则不在列表中出现
  promptGuidelines: [
    "使用 my_tool 来...",   // 追加到 Guidelines 区，需明确写出工具名
  ],
  parameters: Type.Object({ ... }),
  async execute(toolCallId, params, signal, onUpdate, ctx) { ... },
});
```

`promptGuidelines` 只在工具处于 active 状态时包含，通过 `pi.setActiveTools([...])` 控制。

### 1.4 Skills（渐进式加载）

Skills 遵循 Agent Skills 标准。System prompt 中只注入技能名称+描述的 XML 列表，LLM 通过 `read` 工具按需加载完整 SKILL.md。

```
skill-name/
├── SKILL.md          # 必需：frontmatter(name, description) + 指令
├── scripts/          # 辅助脚本
├── references/       # 按需加载的参考文档
└── assets/           # 资源
```

存放位置：`~/.pi/agent/skills/`、`~/.agents/skills/`、`.pi/skills/`、`.agents/skills/`

```json
// settings.json 可引入其他工具的 skills
{ "skills": ["~/.claude/skills", "~/.codex/skills"] }
```

### 1.5 Prompt Templates（提示词模板）

Markdown 文件，通过 `/name` 展开，支持参数：

```markdown
---
description: 模板描述
argument-hint: "<必填> [选填]"
---
内容，支持 $1 $2 位置参数、${1:-default} 默认值、${@:N} 切片
```

存放：`~/.pi/agent/prompts/*.md`、`.pi/prompts/*.md`

### 1.6 运行时上下文动态控制

三个关键事件控制发送给 LLM 的上下文：

**`before_agent_start`** — 每轮 prompt 开始前：

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  return {
    message: {
      customType: "my-context",
      content: "注入的持久化上下文",
      display: true,           // TUI 中可见
    },
    systemPrompt: event.systemPrompt + "\n额外指令",  // 链式改写
  };
});
// event.systemPromptOptions 可查看当前工具列表、上下文文件、skills 等
```

**`context`** — 每次 LLM 调用前过滤消息历史：

```typescript
pi.on("context", async (event, ctx) => {
  // event.messages 是深拷贝，安全修改
  const filtered = event.messages.filter(keepPredicate);
  return { messages: filtered };
});
```

**`before_provider_request`** — 最终序列化后、发送前检查/替换 payload：

```typescript
pi.on("before_provider_request", (event, ctx) => {
  // 检查 event.payload，可 return 替换后的 payload
});
```

### 1.7 Session 树状结构与会话管理

Session 以 JSONL 文件存储，每条记录有 `id` + `parentId`，天然形成**树**：

```
[entry A] ─── [entry B] ─── [entry C] ─┬─ [entry D] ───  ← 当前叶子 (active branch)
                                        │
                                        └─ [entry E] ───  ← 分支
```

**核心操作**（都是原地操作，不创建新文件）：

| 操作 | 命令/API | 效果 |
|------|----------|------|
| 查看树 | `/tree` 或 `sessionManager.getTree()` | 查看所有历史节点 |
| 跳转分支 | `/tree` 选中节点 或 `navigateTree(id)` | 在当前文件内切换到另一个分支 |
| Fork | `/fork` 或 `ctx.fork(id)` | 从某个历史点创建**新会话文件** |
| Clone | `/clone` 或 `ctx.fork(id, {position:"at"})` | 复制当前分支到新文件 |
| 分支摘要 | `branchWithSummary()` | 切换时自动总结被放弃的分支 |

SDK 操作示例：

```typescript
// 打开已有会话
const sm = SessionManager.open("/path/to/session.jsonl");
// 树内导航
const result = await session.navigateTree(targetId, {
  summarize: true,
  customInstructions: "总结要点",
  label: "checkpoint-1",
});
```

### 1.8 消息注入

扩展可通过三种方式向上下文注入消息：

```typescript
// 1. before_agent_start 中注入（参与该轮 LLM 上下文）
pi.on("before_agent_start", async (event, ctx) => ({
  message: { customType: "x", content: "...", display: true },
}));

// 2. 发送自定义消息（带投递时机控制）
pi.sendMessage(
  { customType: "x", content: "...", display: true },
  {
    triggerTurn: true,        // 如 agent 空闲则立即触发 LLM
    deliverAs: "steer",       // steer=当前turn结束后 | followUp=agent完全停止后 | nextTurn=下轮
  }
);

// 3. 模拟用户消息
pi.sendUserMessage("继续", { deliverAs: "steer" });
```

### 1.9 Compaction（上下文压缩）

当对话历史超过 token 限制时自动触发。压缩后，较早的消息被摘要替换，LLM 看到的是：

```
[system prompt] → [compaction summary] → [compaction之后的近期消息]
```

压缩摘要结构：

```markdown
## Goal / ## Progress / ## Key Decisions / ## Next Steps / ## Critical Context
<read-files> ... </read-files>
<modified-files> ... </modified-files>
```

自定义压缩：

```typescript
pi.on("session_before_compact", async (event, ctx) => {
  const { preparation } = event;
  // preparation.messagesToSummarize - 需压缩的消息
  // preparation.previousSummary - 前次压缩摘要（如有）

  // 可使用自己的模型做摘要：
  const text = serializeConversation(convertToLlm(preparation.messagesToSummarize));
  const summary = await myModel.summarize(text);

  return {
    compaction: {
      summary,
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
    }
  };
  // 返回 { cancel: true } 则取消本次压缩
});
```

压缩设置（`settings.json`）：

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

### 1.10 状态持久化

扩展状态通过 `appendEntry` 写入 session（不参与 LLM 上下文）：

```typescript
pi.appendEntry("my-state", { key: "value" });

// 重启后从 session 重建
pi.on("session_start", async (_event, ctx) => {
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === "my-state") {
      rebuildFrom(entry.data);
    }
  }
});
```

---

## 二、生命周期与扩展开发

### 2.1 完整生命周期

```
Pi 启动
  │
  ├─► 扩展工厂函数执行（sync 或 async）
  │     pi.registerTool() / pi.registerCommand() / pi.on(...) / pi.registerProvider()
  │     async 工厂返回前 pi 会等待，保证注册的资源在 session_start 前就绪
  │
  ├─► project_trust（仅用户/全局/CLI -e 扩展参与）
  ├─► session_start { reason: "startup" }
  └─► resources_discover { reason: "startup" }

━━━━━━ 用户发送 prompt ━━━━━━
  │
  ├─► 扩展命令 /xxx 检查 ─ 命中则跳过后续流程
  ├─► input ── 可拦截/转换/处理
  ├─► skill/template 展开
  ├─► before_agent_start ── 注入消息, 改写 system prompt
  ├─► agent_start
  ├─► message_start / message_update (流式) / message_end
  │
  │   ┌───── Turn 循环（LLM 调用工具时重复）──────┐
  │   │  ├─► turn_start                           │
  │   │  ├─► context ── 过滤/改写消息               │
  │   │  ├─► before_provider_request               │
  │   │  ├─► after_provider_response               │
  │   │  │                                         │
  │   │  │  LLM 调用工具:                           │
  │   │  │    ├─► tool_execution_start              │
  │   │  │    ├─► tool_call ── 可 block              │
  │   │  │    ├─► tool_execution_update             │
  │   │  │    ├─► tool_result ── 可 patch 结果       │
  │   │  │    └─► tool_execution_end                │
  │   │  │                                         │
  │   │  └─► turn_end                              │
  │                                                │
  └─► agent_end

━━━━━━ 会话切换 ━━━━━━
  │
  ├─► /new 或 /resume:
  │     ├─► session_before_switch ── 可 cancel
  │     ├─► session_shutdown
  │     ├─► session_start { reason: "new" | "resume" }
  │     └─► resources_discover
  │
  ├─► /fork 或 /clone:
  │     ├─► session_before_fork ── 可 cancel
  │     ├─► session_shutdown
  │     ├─► session_start { reason: "fork" }
  │     └─► resources_discover
  │
  ├─► /compact:
  │     ├─► session_before_compact ── 可 cancel/自定义
  │     └─► session_compact
  │
  ├─► /tree:
  │     ├─► session_before_tree ── 可 cancel/自定义摘要
  │     └─► session_tree
  │
  └─► 退出 (Ctrl+C / SIGHUP):
        └─► session_shutdown { reason: "quit" }
```

### 2.2 扩展基础写法

扩展是默认导出工厂函数，接收 `ExtensionAPI`：

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// 同步
export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => { ... });
}

// 异步 — 用于启动时初始化（拉取远程配置、动态注册 provider 等）
export default async function (pi: ExtensionAPI) {
  const config = await fetch("...");
  pi.registerProvider("custom", { ... });
}
```

**可用 imports**：

| 包 | 用途 |
|---|------|
| `@earendil-works/pi-coding-agent` | ExtensionAPI, ExtensionContext, 事件类型 |
| `typebox` | 工具参数 schema 定义 |
| `@earendil-works/pi-ai` | StringEnum（Google 兼容枚举） |
| `@earendil-works/pi-tui` | TUI 组件（自定义渲染） |
| Node.js builtins | `node:fs`, `node:path` 等 |

扩展通过 jiti 加载，TypeScript 无需编译。

### 2.3 存放位置

| 位置 | 作用域 | 热重载 |
|------|--------|--------|
| `~/.pi/agent/extensions/*.ts` | 全局 | ✓ `/reload` |
| `~/.pi/agent/extensions/*/index.ts` | 全局（子目录） | ✓ |
| `.pi/extensions/*.ts` | 项目 | ✓（需信任项目） |
| `.pi/extensions/*/index.ts` | 项目（子目录） | ✓ |
| `settings.json` 的 `extensions` 数组 | 额外路径 | ✓ |
| `pi -e ./path.ts` | 临时测试 | ✗ |

### 2.4 核心 API

#### 事件订阅

```typescript
pi.on("event_name", async (event, ctx) => {
  // 返回值语义因事件而异（见 2.5）
});
```

#### 注册工具

```typescript
pi.registerTool({
  name: "my_tool",
  label: "显示名",
  description: "LLM 可见描述",
  promptSnippet: "一句话（工具列表显示）",
  promptGuidelines: ["指南文字，需写清工具名..."],
  parameters: Type.Object({ ... }),
  prepareArguments(args) { return args; }, // 历史兼容适配
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    onUpdate?.({ content: [{ type: "text", text: "进度..." }] });
    return {
      content: [{ type: "text", text: "结果" }],
      details: {},
    };
  },
  // 可选 TUI 渲染
  renderCall(args, theme, context) { ... },
  renderResult(result, options, theme, context) { ... },
});
```

工具注册可在扩展加载时或运行时（`session_start`、命令处理器等）调用，立即生效，无需 `/reload`。

**覆盖内置工具**：注册与内置工具同名的工具即可覆盖。`renderCall`/`renderResult` 未定义时继承内置渲染器。

**并行安全**：如果工具涉及文件写入，使用 `withFileMutationQueue()` 参与同一文件的排队，防止竞态。

#### 注入消息

```typescript
// 自定义消息 — 可选触发或不触发 LLM
pi.sendMessage(
  { customType: "x", content: "...", display: true },
  { triggerTurn: false, deliverAs: "nextTurn" }
);

// 模拟用户消息 — 总是触发 LLM
pi.sendUserMessage("内容");
// 流式期间必须指定 deliverAs
pi.sendUserMessage("内容", { deliverAs: "steer" });  // 或 "followUp"
```

#### 注册命令

```typescript
pi.registerCommand("cmd", {
  description: "描述",
  getArgumentCompletions: (prefix) => [...],  // 可选，Tab 补全
  handler: async (args, ctx) => {
    await ctx.waitForIdle();              // 等待 agent 空闲
    await ctx.newSession({ ... });         // 创建新会话
    await ctx.fork("entry-id", { ... });   // Fork 到新文件
    await ctx.navigateTree("id", { ... }); // 树内导航
    await ctx.reload();                    // 重载扩展
  },
});
```

#### 状态持久化

```typescript
pi.appendEntry("custom-type", data);   // 写入自定义条目

// session_start 中重建
pi.on("session_start", async (_event, ctx) => {
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === "custom-type") {
      // entry.data 即持久化的数据
    }
  }
});
```

#### 用户交互

```typescript
// 阻塞式（TUI + RPC）
const choice = await ctx.ui.select("标题:", ["选项A", "选项B"]);
const ok = await ctx.ui.confirm("确认?", "描述");
const text = await ctx.ui.input("输入:", "placeholder");
const editor = await ctx.ui.editor("编辑:", "预填充");

// 非阻塞（TUI + RPC）
ctx.ui.notify("消息", "info");  // info | warning | error
ctx.ui.setStatus("key", "状态文字");
ctx.ui.setWidget("key", ["行1", "行2"]);  // 编辑器上方小部件

// TUI 专属
ctx.ui.setEditorComponent((tui, theme, kb) => new CustomEditor(...));
ctx.ui.setFooter(...);
const result = await ctx.ui.custom<ReturnType>((tui, theme, kb, done) => {
  done(value); // 关闭组件并返回值
});
```

#### 工具管理

```typescript
pi.getAllTools();        // 所有已注册工具元数据
pi.getActiveTools();     // 当前活跃工具名称数组
pi.setActiveTools([...]);// 设置活跃工具
```

#### 模型和思考级别

```typescript
pi.setModel(model);                   // 切换模型
pi.setThinkingLevel("high");          // off|minimal|low|medium|high|xhigh
pi.getThinkingLevel();
```

#### Provider 注册

```typescript
pi.registerProvider("name", {
  baseUrl: "https://...",
  apiKey: "$ENV_VAR",
  api: "anthropic-messages",
  models: [{ id: "...", ... }],
  // oauth 可选
});
pi.unregisterProvider("name");
```

异步工厂中注册 provider 会在启动前完成，对 `pi --list-models` 也可见。

### 2.5 事件返回值语义

不同事件有不同的链式处理规则：

| 事件 | 链式规则 | 返回值 |
|------|----------|--------|
| `before_agent_start` | 链式：system prompt 逐轮改写，消息累积 | `{ message?, systemPrompt? }` |
| `context` | 链式：每个处理器看到前一处理器结果 | `{ messages: filtered[] }` |
| `tool_call` | 顺序，任一个 `block` 则停止 | `{ block: true, reason? }` 或无返回值 |
| `tool_result` | 链式 Patch：content/details/isError 逐次累积 | `{ content?, details?, isError? }` |
| `session_before_compact` | 顺序，任一个 `cancel` 则取消 | `{ cancel: true }` 或 `{ compaction: {...} }` |
| `session_before_switch` | 顺序，任一个 `cancel` 则取消 | `{ cancel: true }` |
| `session_before_fork` | 顺序，任一个 `cancel` 则取消 | `{ cancel: true }` |
| `session_before_tree` | 顺序，任一个 `cancel` 则取消 | `{ cancel: true }` 或 `{ summary: {...} }` |
| `input` | 链式转换，`handled` 短路 | `{ action: "continue"\|"transform"\|"handled", text? }` |
| `user_bash` | 顺序，第一有效结果胜出 | `{ operations? }` 或 `{ result? }` |
| `before_provider_request` | 链式，每个可替换 payload | `undefined`（不变）或新 payload |
| `message_end` | 顺序，可替换消息 | `{ message: newMessage }`（role 须一致） |
| 其余事件 | 观察者模式，返回值忽略 | void |

### 2.6 ExtensionContext 关键字段

```typescript
ctx.mode         // "tui" | "rpc" | "json" | "print"
ctx.hasUI        // true = TUI 或 RPC
ctx.cwd          // 当前工作目录
ctx.isProjectTrusted()  // 项目是否被信任
ctx.sessionManager  // 只读会话状态（getEntries/getBranch/getLeaf/...)
ctx.modelRegistry   // 模型注册表
ctx.model           // 当前模型
ctx.signal          // 当前 AbortSignal（agent 活跃时可用）
ctx.isIdle()        // agent 是否空闲
ctx.abort()         // 中止当前操作
ctx.shutdown()      // 请求优雅关闭
ctx.getContextUsage()  // 当前上下文用量
ctx.compact({...})     // 手动触发压缩
ctx.getSystemPrompt()  // 获取当前 system prompt
```

### 2.7 Event Bus（扩展间通信）

```typescript
pi.events.on("my:event", (data) => { ... });
pi.events.emit("my:event", { ... });

// SDK 中可传入共享 eventBus
const eventBus = createEventBus();
const loader = new DefaultResourceLoader({ eventBus });
eventBus.on("my-extension:status", (data) => console.log(data));
```

### 2.8 SDK 编程模式

四种使用 Pi 的方式：

#### (A) 单 Session（简单场景）

```typescript
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(), // 或 .create(cwd) 持久化
  tools: ["read", "write", "edit", "bash"],
  customTools: [myTool],
  resourceLoader: myLoader,     // 扩展到自定义上下文的入口
});

session.subscribe((event) => {
  // 流式输出、工具执行等事件
});

await session.prompt("开始任务");
// 等待 agent 完成（所有工具调用 + 最终回复）
```

#### (B) AgentSessionRuntime（需要会话切换/替换）

```typescript
import { createAgentSessionRuntime, createAgentSessionServices } from "...";

const createRuntime: CreateAgentSessionRuntimeFactory = async ({
  cwd, sessionManager, sessionStartEvent
}) => {
  const services = await createAgentSessionServices({ cwd });
  return {
    ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
    services,
  };
};

const runtime = await createAgentSessionRuntime(createRuntime, {
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  sessionManager: SessionManager.create(process.cwd()),
});

// 会话切换
await runtime.newSession();
await runtime.switchSession("/path/to/session.jsonl");
await runtime.fork("entry-id");
await runtime.fork("entry-id", { position: "at" }); // clone
```

#### (C) RPC 模式（进程隔离）

```bash
pi --mode rpc --no-session
```

通过 stdin/stdout JSONL 协议交互，适合跨语言集成。

#### (D) Interactive / Print 模式

```typescript
const mode = new InteractiveMode(runtime, { initialMessage: "..." });
await mode.run();

// 或
await runPrintMode(runtime, { mode: "text", initialMessage: "..." });
```

### 2.9 扩展加载与 Reload 生命周期注意事项

- **长生命周期资源**（进程、socket、文件监听器）不要在工厂函数中启动，应延后到 `session_start` 或首次使用时，并在 `session_shutdown` 中清理。
- **Session 替换后**（new/fork/resume 等），旧的扩展实例接收 `session_shutdown`，新实例接收 `session_start`。`withSession` 回调执行在新实例已启动后。
- **`ctx.reload()`** 触发 `session_shutdown` → `session_start(reason:"reload")` → `resources_discover`。reload 之后的代码仍在旧版本运行，应 `return` 终止。
- **SessionManager 对象在 session 替换后作废**，只能使用新 `ctx` 提供的引用。

---

## 附录 A：关键文档路径

| 文档 | 相对路径 |
|------|----------|
| 扩展 API（完整） | `packages/coding-agent/docs/extensions.md` |
| 生命周期钩子设计 | `packages/agent/docs/hooks.md` |
| 上下文压缩 | `packages/coding-agent/docs/compaction.md` |
| 会话格式 & SessionManager | `packages/coding-agent/docs/session-format.md` |
| 会话管理 & 树导航 | `packages/coding-agent/docs/sessions.md` |
| SDK 用法 | `packages/coding-agent/docs/sdk.md` |
| Skills | `packages/coding-agent/docs/skills.md` |
| Prompt Templates | `packages/coding-agent/docs/prompt-templates.md` |
| 扩展示例 | `packages/coding-agent/examples/extensions/` |
| SDK 示例 | `packages/coding-agent/examples/sdk/` |

## 附录 B：事件速查

| 事件 | 触发时机 | 可拦截 |
|------|----------|--------|
| `project_trust` | 启动/切目录 | 是 |
| `session_start` | 会话开始/重载 | 否 |
| `resources_discover` | session_start 后 | 否 |
| `session_before_switch` | /new、/resume | 是 |
| `session_before_fork` | /fork、/clone | 是 |
| `session_before_compact` | 压缩前 | 是 |
| `session_before_tree` | /tree 导航前 | 是 |
| `session_compact` / `session_tree` | 压缩/导航完成 | 否 |
| `session_shutdown` | 会话关闭前 | 否 |
| `input` | 用户输入后 | 是 |
| `before_agent_start` | prompt 发送前 | 否 |
| `agent_start` / `agent_end` | agent 循环 | 否 |
| `turn_start` / `turn_end` | 每轮 LLM 调用 | 否 |
| `context` | 每次 LLM 调用前 | 否 |
| `before_provider_request` | 请求发送前 | 否 |
| `after_provider_response` | 收到响应后 | 否 |
| `tool_call` | 工具执行前 | 是 |
| `tool_result` | 工具执行后 | 否 |
| `tool_execution_start/update/end` | 工具生命周期 | 否 |
| `message_start/update/end` | 消息生命周期 | 否 |
| `model_select` | 模型切换 | 否 |
| `thinking_level_select` | 思考级别变化 | 否 |
| `user_bash` | 用户输入 !command | 是 |
