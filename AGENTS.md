# AGENTS.md — Meteora 父工作区

## 项目定位

本工作区的目标是生成一个基于 Pi 的项目模板，用于**交互式小说创作**。

该模板即 `template/` 目录，它本身就是一个可独立运行的 Pi 项目。所有交付物都写在 `template/` 内部：

```
template/
├── AGENTS.md                  # 项目上下文文件（Pi 自动加载）
├── SYSTEM.md                  # 替换默认 system prompt，定义"小说创作助手"角色
├── APPEND_SYSTEM.md           # 追加到 system prompt 的补充指令
├── .pi/
│   ├── skills/                # 小说创作专用技能（世界观管理、角色档案、情节追踪等）
│   └── extensions/            # 小说创作专用扩展（章节管理、设定一致性检查、人物关系图生成等）
└── prompts/                   # 提示词模板（如 /new-chapter、/character-card 等）
```

用户将此模板 `pi` 启动后，即可获得一个开箱即用的交互式小说创作环境。

## 关键参考文档

| 文档 | 用途 |
|------|------|
| `PI_APP_GUIDE.md` | Pi 上下文组织与扩展开发完整指南（上下文层次、生命周期、SDK、事件） |
| `PI-DOC-REFERENCE.md` | Pi 官方文档/示例的本地路径速查 |

## Pi 文档路径

- 主文档：`C:\AA_YUUKI\ENV\node-v24.1.0-win-x64\node_modules\@earendil-works\pi-coding-agent\README.md`
- 扩展文档：`C:\AA_YUUKI\ENV\node-v24.1.0-win-x64\node_modules\@earendil-works\pi-coding-agent\docs`
- 示例：`C:\AA_YUUKI\ENV\node-v24.1.0-win-x64\node_modules\@earendil-works\pi-coding-agent\examples`

## 工作原则

- 始终使用中文回复
- 涉及 Pi 扩展/SDK/技能/主题开发时，先查阅上述 Pi 文档路径中的对应文档
- Meteora 子目录内的工作需谨慎，避免其提示词泄漏到当前上下文
