# Meteora

基于 [Pi](https://github.com/earendil-works/pi-mono) 的交互式小说创作项目模板。

## 快速开始

```bash
# 复制模板到你的项目目录
cp -r template/ my-novel/
cd my-novel
pi
```

Pi 启动后自动加载 `.pi/SYSTEM.md` 作为系统提示词，以及 `.pi/extensions/` 下的工具扩展。

## 内置扩展

| 扩展 | 功能 |
|------|------|
| `questionnaire` | 多题问答，AI 通过选项或自由输入向用户提问 |
| `todo` | 写作任务追踪，支持增/查/勾/清 |
| `git-checkpoint` | 每轮自动 git 快照，fork 时可回滚 |
| `enable-tools` | 自动启用 grep/find/ls 搜索工具 |

## 使用 Gemini 的注意事项

如果你用 Gemini API（通过 opencode Zen 或直连），注意空回复、400 错误通常不是账号被封，而是 Google 对 system instruction 的语义审查。

### 核心问题：AGENTS.md 被自动拼接为 system 角色

Pi 启动时会**自动加载**当前目录及祖先目录的 `AGENTS.md`，拼接在 `SYSTEM.md` 之后，且 role 仍为 `system`。这意味着 AGENTS.md 里的所有内容——角色设定、文风偏好、NSFW 写作规范——都会被直接发送给 Google 作为 system instruction 的一部分。

Google 的分类器会扫描整个 system instruction，命中敏感关键词则拦截响应。**原始的 SYSTEM.md 本身是干净的**，问题出在 AGENTS.md 的自动注入。

### 对策：用普通文件替代 AGENTS.md

将项目的创作上下文（角色、文风、禁忌等）写入一个普通文件（推荐 `README.md` 或 `PROJECT.md`），**不使用 AGENTS.md**。

AI 启动后通过 `ls` 发现该文件，再用 `read` 工具主动读取——此时内容作为 tool_result 出现在消息流中，而非 system instruction。Google 对 conversation 内容的审查比 system instruction 宽松得多。

### 辅助：反指纹扩展

`template/.pi/extensions/0-gemini-noise.ts` 提供两个功能：
- 在 system prompt 开头注入大量随机字符（ST 社区防429技法），破坏上下文指纹哈希
- 注入 `safetySettings=BLOCK_NONE`（Pi 的 Google provider 默认不设此项）

扩展默认启用，噪声通过 `/reroll-noise` 手动刷新。

## 致谢

系统提示词 `SYSTEM.md` 参考了阿梦的 DS 通用预设的组织结构，其预设本身借鉴了贝露凛慏、haruki、xianwang 等 SillyTavern 社区前辈的设计。

## 许可

本项目采用双协议：

- **代码**（`.pi/extensions/` 下的 TypeScript 扩展）使用 [GPL 3.0](LICENSE)
- **提示词与文档**（`SYSTEM.md`、Skills 等）使用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
