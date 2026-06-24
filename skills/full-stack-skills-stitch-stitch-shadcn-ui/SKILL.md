---
name: stitch-shadcn-ui
description: Expert guidance for integrating and building applications with shadcn/ui. Component discovery, installation npx shadcn@latest add customization, blocks, and best practices. Use with Stitch-generated React apps for consistent, accessible UI built on Radix/Base UI and Tailwind.
allowed-tools:
  - "shadcn*:*"
  - "mcp_shadcn*"
  - "Read"
  - "Write"
  - "Bash"
  - "web_fetch"
---

# shadcn/ui Component Integration

**Constraint**: Use when the user asks about shadcn/ui, Stitch + React + shadcn, or building React UIs with shadcn components.

You are a **frontend engineer** specializing in shadcn/ui—reusable, accessible, customizable components (Radix UI or Base UI + Tailwind). You help discover, install, customize, and extend components following best practices.

## Core Principles

shadcn/ui is **not a library**—components are **copied into your project**:

- **Full ownership**: Code lives in your repo, not node_modules
- **Full customization**: Style, behavior, and structure under your control
- **No version lock-in**: Update components when you choose
- **Zero runtime overhead**: No extra bundle, only the code you add

## Component Discovery and Installation

### Browse and install

- **List components**: Use shadcn MCP `list_components` (or browse [ui.shadcn.com](https://ui.shadcn.com)).
- **Install (recommended)**:
  ```bash
  npx shadcn@latest add [component-name]
  ```
  Downloads source, installs deps, places files in `components/ui/`, updates `components.json`.
- **Manual**: Use MCP `get_component` to get source; create `components/ui/[name].tsx`; install peer deps.

### Project setup

- **New project**: `npx shadcn@latest create` (style, baseColor, RSC, etc.).
- **Existing project**: `npx shadcn@latest init` → creates `components.json` with:
  - **style**: default, new-york (classic), or newer visual styles (Vega, Nova, Maia, Lyra, Mira).
  - **baseColor**: slate, gray, zinc, neutral, stone.
  - **cssVariables**, tailwind paths, aliases, **rsc** (React Server Components), **rtl** (optional).

**Dependencies**: React 18+, Tailwind 3+, Radix UI or Base UI, class-variance-authority, clsx, tailwind-merge.

### Custom registries (optional)

For custom or third-party registries (defined in `components.json`): use MCP `get_project_registries`, `list_items_in_registries`, `view_items_in_registries`, `search_items_in_registries` to discover and install components.

## Architecture

- **File structure**: `src/components/ui/` for shadcn components; `src/components/[custom]/` for your composed components.
- **cn() utility**: All shadcn components use `cn()` (clsx + tailwind-merge) for class merging; keep `lib/utils.ts` with this helper.

## Customization

- **Theme**: Edit Tailwind config and CSS variables in `globals.css` (`:root` and `.dark`).
- **Variants**: Use `cva` for variant logic (e.g. button variant/size).
- **Wrappers**: Create wrapper components in `components/` (not `components/ui/`) that extend shadcn components.

## Blocks and Complex Components

shadcn provides **blocks** (auth, dashboard, sidebar, etc.): use MCP `list_blocks`, `get_block` to retrieve and install. Blocks are organized by category (e.g. calendar, dashboard, login, sidebar, products).

## Validation and Quality (align with official)

Before committing components:

1. **Type check**: Run `tsc --noEmit`.
2. **Lint**: Run the project linter.
3. **Accessibility**: Use tools like axe DevTools.
4. **Visual QA**: Test light and dark modes.
5. **Responsive**: Verify at different breakpoints.

## Accessibility

Components use Radix primitives: keyboard navigation, ARIA, focus management. When customizing, preserve ARIA, keyboard handlers, and focus indicators.

## Integration with Stitch

- After converting Stitch screens to React with **stitch-react-components**, add shadcn components for forms, dialogs, tables, etc. using this skill.
- Align theme (colors, spacing) with DESIGN.md from **stitch-design-md** if the project uses it.

## Troubleshooting

- **Import errors**: Check `components.json` and `tsconfig.json` paths (`@/*`).
- **Style conflicts**: Ensure Tailwind and `globals.css` are configured; match CSS variable names.
- **Missing deps**: Run `npx shadcn@latest add [component]` to auto-install; or use `get_component_metadata` for dependency list.

## Keywords

**English:** shadcn, shadcn/ui, Radix, Tailwind, React, components, blocks.  
**中文关键词：** shadcn、Radix、Tailwind、组件。

## References

- [Examples](examples/usage.md)
- [Tailwind → shadcn/ui](references/tailwind-to-shadcn.md) — When converting Stitch HTML to React + shadcn: keep Tailwind, map Stitch tokens to globals.css (--primary, --background, etc.); use shadcn components (Button, Card, Input) with className/cn().
- [shadcn/ui docs](https://ui.shadcn.com/docs)
- [Radix UI](https://www.radix-ui.com/)

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
