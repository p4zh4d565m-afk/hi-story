# Obsidian 单向读取使用说明

## 数据归属

| 数据 | 主要编辑与保存位置 |
| --- | --- |
| 人物、世界观、长期大纲 | Obsidian Markdown |
| 正文、章节历史、章纲快照 | hi-story SQLite |
| 运行期事实、伏笔 | hi-story SQLite |
| AI 会话、程序状态 | hi-story SQLite 的归属范围；现有 localStorage 数据待后续专项迁移 |

本阶段只有 **Obsidian → hi-story** 单向读取。hi-story 不会创建、修改或删除仓库中的任何文件，也不会把原有人物、世界观或大纲数据回写到 Obsidian。

## 最小目录规范

在一个 Obsidian 仓库或小说项目目录中建立以下目录：

```text
小说项目/
├─ 人物/
│  └─ 林砚.md
├─ 世界观/
│  └─ 灵脉规则.md
└─ 大纲/
   └─ 长期大纲.md
```

也支持英文目录 `characters/`、`world/`、`outlines/`。扫描会忽略隐藏目录、Obsidian 配置目录、附件/图片目录、符号链接和非 Markdown 文件。

模板位于 `resources/obsidian-templates/`。文件可不写 frontmatter，此时名称取文件名、类别取所在目录。推荐格式：

```yaml
---
type: character
name: 林砚
tags: [主角, 剑修]
---
```

`type` 可用 `character`、`world`、`outline`（也兼容人物、世界观、大纲）。frontmatter 会覆盖目录类别。单个文件编码或 YAML 损坏时，该文件会被跳过，其他资料继续读取。

## 配置与浏览

1. 在 hi-story 中选择小说项目。
2. 点击左上角的“📚 Obsidian 资料”。
3. 选择仓库或项目目录并保存。
4. 在只读面板按人物、世界观或大纲浏览；Obsidian 修改后点击“刷新”。

目录未配置、已移动或不可访问时，面板会显示提示，但 SQLite 中的正文和原有模块仍可正常加载和使用。每个小说项目独立保存自己的目录，快速切换项目不会复用上一个项目的资料。

## AI 上下文

读取到的资料会用于 AI 对话、写章、审稿和自动修订。每次最多注入约 3500 token，并限制单篇摘录长度，不会一次发送整个仓库。人物、世界观和长期大纲冲突时优先参考 Obsidian；正文事实、伏笔等运行期状态仍以 SQLite 为准。
