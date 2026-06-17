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

## 致谢

系统提示词 `SYSTEM.md` 参考了 [阿梦的 DS 通用预设](https://github.com/) 的组织结构，其预设本身借鉴了贝露凛慏、haruki、xianwang 等 SillyTavern 社区前辈的设计。

## 许可

MIT
