# skillx

[![同步技能](https://github.com/viarotel/skillx/actions/workflows/sync-skills.yml/badge.svg)](https://github.com/viarotel/skillx/actions/workflows/sync-skills.yml)

一个可预测的本地及订阅 AI 智能体技能集中管理中心。

`skillx` 将手动维护的本地技能与订阅的远程技能统一管理在同一个仓库中。它会验证 YAML 来源列表、克隆已配置的仓库、发现所有包含 `SKILL.md` 的目录、过滤发现的技能，然后将受管理的副本连同清单和运行摘要一起写入 `skills/`。

## 功能特性

- 本地技能存储可从仓库相对目录订阅。
- 支持从 Git 仓库订阅远程技能。
- 递归发现 `SKILL.md`，包括 `.curated/` 等点前缀目录。
- 生成技能目录支持 `flat`（扁平）和 `nested`（嵌套）两种输出模式。
- 每个来源支持 include 和 exclude glob 过滤器。
- 支持跨来源的内容哈希去重，来源顺序决定优先级。
- 基于 `.skills-sync/manifest.json` 的保守式清理策略。
- 支持 dry-run（预演）模式，在正式写入前验证克隆、过滤器和目标路径。
- 支持 GitHub Actions 自动化，用于提交后技能同步与发布自动化。

## 技术栈

- Node.js `>=20`
- pnpm `10.32.1`
- ECMAScript 模块
- 使用 `yaml` 解析 YAML
- 使用 `minimatch` 进行 Glob 匹配
- 使用 Vitest 进行测试
- 使用 ESLint 和 `@antfu/eslint-config` 进行代码规范检查
- 使用 release-please 进行发布自动化

## 工作原理

```txt
skills-sources.yaml
        |
        v
scripts/sync-skills.mjs
        |
    +-- 以有限并发将已启用来源克隆到 .skills-sync/tmp/
        +-- 发现包含 SKILL.md 的目录
        +-- 应用 includes/excludes 过滤器
        +-- 以扁平或嵌套模式规划生成目标路径
    +-- 暂存计划中的副本，默认跳过符号链接
        +-- 原子替换 skills/ 中受管理的目录
        +-- 写入 .skills-sync/manifest.json 和运行摘要
```

同步流程在写入生成输出前会规划所有已启用来源，再将计划中的副本提交到 `skills/`。它只移除之前记录在清单中且当前不再活跃的生成目录，未知目录和受保护的 id 不会被改动。订阅仓库中的符号链接会被跳过并在同步摘要中单独报告，不会被复制到生成的技能中。

## 快速开始

安装依赖：

```sh
pnpm install
```

验证订阅配置：

```sh
pnpm validate
```

预演同步，不实际修改生成的技能目录：

```sh
pnpm sync:dry-run
```

执行真实同步：

```sh
pnpm sync
```

运行测试和代码规范检查：

```sh
pnpm test
pnpm lint
```

`pnpm sync:dry-run` 仍会克隆远程仓库，因此需要网络访问，耗时可能比纯本地验证更长。

## 配置说明

技能订阅通过 `skills-sources.yaml` 进行配置。

```yaml
version: 1

defaults:
  branch: main
  path: skills
  mode: flat
  enabled: true
  preserveOnFailure: false
  cloneTimeoutMs: 300000
  cloneMaxAttempts: 3
  sourceConcurrency: 3
  includes: []
  excludes: []

deduplicate: true

sources:
  - id: skillx
    type: local
    location: skillx
    path: .

  - id: openai
    type: remote
    location: https://github.com/openai/skills.git
    branch: main
    path: skills
```

### 去重（Deduplicate）

`deduplicate` 是一个顶层开关，用于移除所有已配置来源中的重复技能。

```yaml
deduplicate: true
```

或使用显式对象形式：

```yaml
deduplicate:
  enabled: true
  strategy: content-hash
```

规则：

- 为保持向后兼容，去重默认关闭。
- 仅比较 `SKILL.md` 的字节内容。
- 名称、来源 id、目录路径和生成目标 id 不影响重复检测。
- 来源优先级遵循 `skills-sources.yaml` 中 `sources` 数组的顺序。
- 当两个技能的 `SKILL.md` 内容哈希相同时，第一个来源优先，后续重复项被跳过。
- 禁用去重时，行为不变，所有选中的技能均会被生成。

### 来源字段说明

| 字段 | 是否必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 来源 id，必须使用小写短横线命名（kebab-case），且不能与受保护 id 冲突。 |
| `type` | 否 | 来源类型，`remote` 或 `local`，默认为 `remote`。 |
| `location` | 是 | `remote` 类型时为传给 `git clone` 的 Git URL；`local` 类型时为仓库相对的源目录。 |
| `branch` | 否 | 远程来源的克隆分支，默认为 `main`，本地来源忽略此字段。 |
| `path` | 否 | 来源位置内包含技能的目录，默认为 `skills`。当来源位置本身就是技能根目录时使用 `.`。 |
| `mode` | 否 | `flat` 将每个发现的技能写为独立生成目录；`nested` 将技能分组保存在 `skills/<source-id>/` 下。 |
| `enabled` | 否 | 禁用的来源会被跳过，默认为 `true`。 |
| `preserveOnFailure` | 否 | 来源失败时保留上一次的清单条目和生成目标，默认为 `false`，即未显式启用保留时会移除过时的生成技能。 |
| `cloneTimeoutMs` | 否 | Git 克隆超时时间（毫秒），默认为 `300000`。 |
| `cloneMaxAttempts` | 否 | 可重试 Git 失败的最大克隆次数，默认为 `3`。 |
| `sourceConcurrency` | 否 | 并发规划的最大来源数量，默认为 `3`。 |
| `includes` | 否 | 用于选择技能路径的相对 glob 模式，为空时包含所有发现的技能。 |
| `excludes` | 否 | 从选中集合中排除的相对 glob 模式，排除规则优先于包含规则。 |

顶层字段说明：

| 字段 | 是否必填 | 说明 |
| --- | --- | --- |
| `deduplicate` | 否 | 全局去重配置，接受 `true`、`false` 或 `{ enabled, strategy }`，目前唯一支持的策略为 `content-hash`。 |

### 输出模式

本仓库在 `skills-sources.yaml` 中将 `flat` 作为默认模式，因此生成的技能路径是订阅仓库的权威快照。上游移除的技能会在下次成功同步后从生成输出中删除。

`flat` 模式下，发现的技能路径会被转义为独立的目标 id：

```txt
openai + .curated/aspnet-core -> skills/openai-curated-aspnet-core
openai + .                    -> skills/openai
```

`nested` 模式下，所有选中的技能保留在来源 id 目录下：

```txt
openai + .curated/aspnet-core -> skills/openai/.curated/aspnet-core
openai + .                    -> skills/openai
```

扁平模式在转义后会检查生成目标冲突，若两个来源路径映射到相同目标 id，则立即失败。

启用去重时，扁平或嵌套模式只保留按配置来源顺序首个出现该 `SKILL.md` 内容哈希的技能。

### 本地来源与受保护输入

来源 id 不再需要 `local-` 或 `remote-` 前缀，使用 `type` 字段描述来源类型即可，目录名称只需聚焦于技能集合名称。本仓库将手动维护的本地来源输入存放在 `skillx/` 下，并将整个目录树作为单一本地来源订阅，生成输出仍写入 `skills/`：

```txt
skillx/
  escrcpy/
    SKILL.md
  viarotel/
    SKILL.md

skills/
  skillx-escrcpy/
    SKILL.md
  skillx-viarotel/
    SKILL.md
```

验证器始终包含默认受保护 id `subscribe`。可额外配置 `protectedIds` 用于永远不会被作为过时输出移除的生成目录，来源 id 与这些模式匹配时也会被拒绝。

## 项目结构

```txt
.
├── .github/workflows/       # 统一的同步与发布自动化工作流
├── .skills-sync/            # 生成的清单、摘要及临时同步工作区
├── scripts/
│   ├── sync-skills.mjs      # 主同步命令
│   ├── validate-skills-config.mjs
│   └── skills-sync/         # 配置、文件系统、Git、日志及摘要辅助模块
├── skillx/                  # 手动维护的本地来源输入
├── skills/                  # 生成的技能输出
├── tests/                   # 覆盖配置及同步规划逻辑的 Vitest 测试
├── skills-sources.yaml      # 订阅来源列表
├── release-please-config.json
└── package.json
```

## 生成文件

`pnpm sync` 会写入以下生成文件：

- `.skills-sync/manifest.json`：受管理的来源元数据、提交记录、目标 id、已选技能路径，以及用于去重和保留来源恢复的每个技能内容哈希。
- `.skills-sync/summary.md`：人类可读的同步报告。
- `.skills-sync/summary.json`：机器可读的同步报告。

临时克隆和暂存数据会在 `.skills-sync/tmp/` 下创建，每次运行后清理，除非使用了 `--keep-temp` 选项。

## 命令列表

| 命令 | 说明 |
| --- | --- |
| `pnpm validate` | 验证 `skills-sources.yaml`。 |
| `pnpm sync:dry-run` | 克隆已启用来源并验证同步计划，不修改生成的技能目录或清单。 |
| `pnpm sync` | 将已启用来源同步到 `skills/` 并写入生成的元数据。 |
| `pnpm test` | 运行 Vitest 测试套件。 |
| `pnpm lint` | 运行 ESLint（远程生成的技能会被 lint 配置忽略）。 |
| `pnpm lint:fix` | 运行 ESLint 并自动修复。 |

还可通过脚本使用额外的同步选项：

```sh
pnpm sync -- --config ./skills-sources.yaml --verbose
pnpm sync -- --dry-run --keep-temp
```

`validate-skills-config.mjs` 支持 `--config` 参数用于验证指定的 YAML 文件。

## 测试说明

测试套件聚焦于同步契约的验证：

- 配置默认值及验证错误。
- 来源 id 与受保护 id 验证。
- 安全相对路径验证。
- 递归技能发现。
- Include 和 exclude 过滤。
- 扁平与嵌套目标规划。
- 内容哈希去重、禁用行为一致性及保留来源去重恢复。
- 过时生成目录检测。
- 未知目录报告。
- 路径遍历防护。

运行方式：

```sh
pnpm test
```

## GitHub Actions

### 同步技能（Sync Skills）

`.github/workflows/sync-skills.yml` 在手动触发或推送到 `main` 分支且涉及 `skills-sources.yaml` 或 `skillx/` 下文件时运行。它会安装依赖、验证来源配置、运行测试和代码检查、执行 `pnpm sync`、上传同步摘要产物，并将变更后的 `skills/` 内容及 `.skills-sync/manifest.json` 提交回默认分支。

同步任务成功后，仅当 `pnpm sync` 实际修改了 `skills/` 内容或 `.skills-sync/manifest.json` 时，同一工作流才会运行 release-please。由于推送触发器限定在 `skills-sources.yaml` 和 `skillx/**`，纯生成式同步提交不会重新触发工作流。同步提交使用 `chore: sync skills subscriptions` 作为提交信息，`release-please-config.json` 中的发布行为配置确保这些 chore 提交仍会为根 Node 包创建或更新发布 PR、变更日志及标签流程。

## 贡献指南

1. 手动维护的本地来源输入放在 `skillx/<name>/`，生成副本写入 `skills/`。
2. 在 `skills-sources.yaml` 中使用 `type` 和 `location` 添加或修改本地及远程订阅。
3. 同步前运行 `pnpm validate`。
4. 修改过滤器、路径、模式或来源 id 时使用 `pnpm sync:dry-run`。
5. 修改同步行为时运行 `pnpm test`。
6. 提交 PR 或推送共享变更前运行 `pnpm lint`。

来源 id 和生成目录名称应保持小写短横线命名（kebab-case）。请避免手动编辑生成的技能目录，应通过更新本地来源目录、来源仓库或订阅过滤器来进行修改。

## 许可证

Apache-2.0，详见 `LICENSE` 文件。