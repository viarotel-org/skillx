# tencentmap-jsapi-gl-skill

[中文文档](README_zh.md)

This repository provides AI assistant **Skills** for [tencentmap-jsapi-gl-skill](https://lbs.qq.com/webApi/javascriptGL/glGuide/glOverview). Use them with [Claude](https://claude.ai), [Cursor](https://cursor.com), [CodeBuddy](https://codebuddy.ai), or other clients that support skills so the AI can reference accurate API docs and examples when you work with Tencent Map.

## Included Skills

| Skill | Description |
|-------|-------------|
| **tencentmap-jsapi-gl-skill** | Tencent Map JSAPI GL: Map initialization, overlays (markers, polylines, polygons), events, layers, controls, visualization, tools, search, routing, geocoding, administrative districts, IP location, geometric calculations, 3D model display, performance optimization, etc. For 2D and 3D map development using WebGL. |

## How to Use

### 1. Clone the repo

```bash
git clone https://github.com/TencentLBS/tencentmap-jsapi-gl-skill.git
cd tencentmap-jsapi-gl-skill
```

### 2. Register the skill with your AI assistant

Link or copy this repo directory into your environment's skills folder so the AI can load its docs during conversations.

**Claude Desktop (local)**

- Skills directory is usually: `~/.claude/skills/`
- Register via symlink (recommended):
  ```bash
  ln -sfn "$(pwd)" ~/.claude/skills/tencentmap-jsapi-gl-skill
  ```
- Or copy this repo folder into `~/.claude/skills/` and rename it to `tencentmap-jsapi-gl-skill`.

**Cursor**

- Skills directory is usually: `~/.cursor/skills/`
- Register via symlink (recommended):
  ```bash
  ln -sfn "$(pwd)" ~/.cursor/skills/tencentmap-jsapi-gl-skill
  ```
- Or copy this repo folder into `~/.cursor/skills/` and rename it to `tencentmap-jsapi-gl-skill`.

**CodeBuddy**

- Skills directory is usually: `~/.codebuddy/skills/`
- Register via symlink (recommended):
  ```bash
  ln -sfn "$(pwd)" ~/.codebuddy/skills/tencentmap-jsapi-gl-skill
  ```
- Or copy this repo folder into `~/.codebuddy/skills/` and rename it to `tencentmap-jsapi-gl-skill`.

### 3. Use it in chat

When your questions mention “Tencent Map”, “TMap”, “jsapi-gl”, or similar, the assistant will use this skill’s docs to give answers and code that match the Tencent Map JSAPI.

## Repo structure

```
.
├── SKILL.md            # Skill entry and index
├── references/         # API reference docs and demos
│   ├── jsapigl/        # JS API GL documentation and demos
│   └── visualization/  # Visualization API documentation and demos
├── scripts/            # Helper scripts (temp key申请等)
├── tempkey-guide.md    # 临时体验 Key 申请流程
└── README.md
```

`SKILL.md` lists all reference files so the AI can load them as needed.
