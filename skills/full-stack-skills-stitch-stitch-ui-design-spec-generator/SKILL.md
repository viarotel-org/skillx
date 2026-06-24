---
name: stitch-ui-design-spec-generator
description: Translates user requirements into structured Design Specs for Theme, Color, and Typography.
allowed-tools:
  - "stitch*:*"
  - "Read"
  - "Write"
---


# Design Spec Generator

**Constraint**: Only use this skill when the user explicitly mentions "Stitch" or when orchestrating a Stitch design task.

This skill acts as a **Creative Director**. It takes a high-level user request and outputs a structured **Design Specification**.

## Input

Input may be either:

*   **User Request** (one-shot): e.g., "A cyberpunk login page" or "A clean medical dashboard".
*   **PRD document or PRD summary**: When the user provides a PRD file path or pasted PRD content, first extract **function overview** and **page/screen list** (and any visual/theme preferences from non-functional requirements), then apply the Logic Rules below to produce the design spec. For the full PRD-driven workflow (spec-generator → framework spec → prompt-architect → MCP), see [docs/prd-to-stitch-workflow.md](../../docs/prd-to-stitch-workflow.md).

## Output Format (JSON)
The skill must produce a JSON block like this:

```json
{
  "theme": "DARK" | "LIGHT",
  "primaryColor": "Hex Code",
  "font": "Font Name",
  "roundness": "High" | "Medium" | "Low",
  "density": "COMPACT" | "COMFORTABLE" | "SPACIOUS",
  "designMode": "WIREFRAME" | "HIGH_FIDELITY",
  "styleKeywords": ["Keyword1", "Keyword2"],
  "deviceType": "MOBILE" | "TABLET" | "DESKTOP" | "SMART_WATCH"
}
```

## Logic Rules
1.  **Analyze Tone**:
    *   "Corporate/Medical/Finance" -> Clean, Blue/Grey, Low Roundness, Inter font.
    *   "Creative/Gaming" -> Dark Mode, Neon colors, High Contrast.
    *   "Lifestyle/Food" -> Warm colors, High Roundness, Serif fonts.
2.  **Determine Device**:
    *   "Dashboard/Admin" -> DESKTOP.
    *   "App/Instagram-like" -> MOBILE.
    *   "Watch Face" -> SMART_WATCH.
    *   Default to MOBILE if unspecified.
3.  **Determine Mode**:
    *   "Sketch/Blueprint/Draft" -> WIREFRAME.
    *   Default to HIGH_FIDELITY.

## Usage
Call this skill *internally* (by thinking) before creating a project or generating a prompt.

## 国内适配

- 支持中文文档和中文注释
- 示例代码兼容国内开发环境
- 提供中文 FAQ 和常见问题解答

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
