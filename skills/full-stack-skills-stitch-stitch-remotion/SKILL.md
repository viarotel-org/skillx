---
name: stitch-remotion
description: Generate walkthrough videos from Stitch projects using Remotion. Retrieves screens via Stitch MCP list_projects list_screens get_screen downloads screenshots, builds Remotion composition with transitions and text overlays. Use with stitch-mcp-* for project/screen discovery.
allowed-tools:
  - "stitch*:*"
  - "remotion*:*"
  - "Bash"
  - "Read"
  - "Write"
  - "web_fetch"
---


# Stitch to Remotion Walkthrough Videos

**Constraint**: Only use this skill when the user explicitly mentions "Stitch" and walkthrough video or Remotion.

You are a **video production specialist** creating walkthrough videos from Stitch app designs. Combine Stitch MCP (or **stitch-mcp-list-projects**, **stitch-mcp-list-screens**, **stitch-mcp-get-screen**) to get screens with Remotion for programmatic video: transitions, zoom, text overlays.

## Prerequisites

- Stitch MCP Server (https://stitch.withgoogle.com/docs/mcp/guide/)
- Remotion MCP or Remotion CLI; Node.js and npm
- A Stitch project with designed screens

## Retrieval and Networking

1. **Discover prefixes**: Run `list_tools` for Stitch and Remotion MCP prefixes.
2. **Project/screen lookup**: Use `[stitch_prefix]:list_projects` (filter view=owned), then `[stitch_prefix]:list_screens` with projectId; identify screens for the walkthrough.
3. **Screen metadata**: For each screen call `[stitch_prefix]:get_screen`; get `screenshot.downloadUrl`, `htmlCode.downloadUrl`, width, height, title, description.
4. **Asset download**: Download screenshots (e.g. via web_fetch or Bash curl); save to `assets/screens/{screen-name}.png` in walkthrough order.
5. **Manifest**: Create `screens.json` with projectName, screens array (id, title, description, imagePath, width, height, duration).

## Video Composition Strategy

- **ScreenSlide.tsx**: Single screen (imageSrc, title, description, width, height); zoom/fade; configurable duration (e.g. 3–5 s).
- **WalkthroughComposition.tsx**: Sequence of ScreenSlides; transitions (fade/slide from `@remotion/transitions`); text overlays.
- **Config**: Frame rate (e.g. 30 fps), dimensions (match Stitch or scale), total duration.

Use Remotion `spring()` for zoom; use `@remotion/transitions` (fade, slide) between screens.

### Common Patterns (align with official)

- **Simple slide show**: 3–5 s per screen, cross-fade, bottom text overlay (screen title), progress bar at top.
- **Feature highlight**: Zoom into regions; animated circles/arrows; slow-motion on key interactions; before/after comparisons.
- **User flow**: Sequential screens with directional slides; numbered steps overlay; highlight actions (clicks, taps); connect screens with animated paths.

### Optional: Voiceover and dynamic text

- **Voiceover**: Generate script from screen descriptions; use TTS or recorded audio; sync screen timing with narration.
- **Dynamic text**: Download `htmlCode.downloadUrl` per screen; parse HTML for headings/buttons/labels; generate timed callouts in the composition.

## Execution Steps

1. **Gather assets**: List Stitch project → list screens → get_screen for each → download screenshots → build screens.json.
2. **Remotion setup**: Use existing Remotion project or `npm create video@latest -- --blank` in e.g. `video/`; install `@remotion/transitions` etc.
3. **Build components**: ScreenSlide.tsx (useCurrentFrame, spring, zoom/fade); WalkthroughComposition.tsx (Sequence, manifest); update remotion.config.ts.
4. **Preview**: `npm run dev` in video/; adjust timing and transitions.
5. **Render**: `npx remotion render WalkthroughComposition output.mp4` (or use Remotion MCP if available).

## Integration with This Repo

- **Stitch screens**: Use **stitch-mcp-list-projects**, **stitch-mcp-list-screens**, **stitch-mcp-get-screen** to resolve projectId/screenId and get download URLs.
- **Design consistency**: If DESIGN.md exists (from **stitch-design-md**), use screen titles/descriptions for overlay text.

## File Structure

```
project/
├── video/
│   ├── src/
│   │   ├── WalkthroughComposition.tsx
│   │   ├── ScreenSlide.tsx
│   │   └── Root.tsx
│   ├── public/assets/screens/   # Stitch screenshots
│   ├── remotion.config.ts
│   └── package.json
├── screens.json                 # Screen manifest
└── output.mp4
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Blurry screenshots | Use full-resolution screenshot URLs |
| Misaligned text | Match composition size to screen dimensions |
| Choppy animations | Increase fps; tune spring damping |
| Build fails | Check Node/Remotion version; install deps |

## Keywords

**English:** Stitch, Remotion, walkthrough, video, screenshots, transitions.  
**中文关键词：** Stitch、Remotion、走查视频、转场。

## References

- [Remotion docs](https://www.remotion.dev/docs/)
- [Remotion transitions](https://www.remotion.dev/docs/transitions)
- [Remotion Skills](https://github.com/remotion-dev/remotion/tree/main/packages/skills) — animation, composition patterns, performance; install with `npx skills add remotion-dev/skills`.
- [Remotion MCP](https://www.remotion.dev/docs/ai/mcp) — programmatic render and preview.
- [Stitch MCP](https://stitch.withgoogle.com/docs/mcp/guide/)
- [Examples](examples/usage.md)
- [Screens Manifest Example](examples/screens.json)
- Full templates in [google-labs-code/stitch-skills](https://github.com/google-labs-code/stitch-skills).

## 能力边界

### ✅ 适用场景
- 当你需要使用此技能对应的技术栈时
- 当项目需要遵循最佳实践时
- 当需要快速上手或深入理解核心概念时

### ⚠️ 需要注意
- 复杂业务逻辑需要结合具体场景调整
- 性能优化需要根据实际数据量评估

### ❌ 不适用场景
- 不相关的技术栈或框架
- 需要完全自定义的特殊场景

## 常见陷阱 (Gotchas)

1. **版本兼容性**：注意框架版本与依赖库的兼容性，不同版本 API 可能有差异
2. **配置文件格式**：配置文件格式错误是最常见的问题，建议使用编辑器的语法检查
3. **环境变量**：确保所有必要的环境变量已正确设置，敏感信息不要硬编码
4. **依赖冲突**：多版本共存时注意依赖冲突，使用 lock 文件锁定版本
5. **性能陷阱**：大数据量场景下注意性能优化，避免 N+1 查询等常见问题

## 使用流程

### Step 1: 环境准备
确保开发环境已安装必要的依赖和工具。

### Step 2: 配置初始化
根据项目需求进行基础配置。

### Step 3: 核心功能使用
按照示例代码实现核心功能。

### Step 4: 测试验证
运行测试确保功能正常。

### Step 5: 部署上线
完成开发后进行部署和监控。
