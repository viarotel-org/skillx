---
name: viarotel-create-skill
description: "Use when: creating new Agent Skills from scratch, converting raw prompts/task descriptions/custom rules into standardized Skill files, or refactoring existing skills to strictly comply with Viarotel's official Skill format specification. Automatically generates valid YAML frontmatter, structured Markdown body with fixed section hierarchy, trigger conditions, working rules, domain preferences, anti-patterns and review checklist."
argument-hint: "Paste raw prompt text, custom requirements, rule sets, or specification data that needs to be converted into a Viarotel-standard Skill"
---

# Viarotel Skill Creator

## Skill Objective

Process unstructured input (raw user prompts, custom coding/tool rules, task requirements, arbitrary specification documents) and transform it into fully compliant, production-ready Skill documents that strictly follow Viarotel's official Skill format standard. Preserve 100% of original business and functional logic while enforcing consistent structural formatting across all Viarotel agent skills.

## Trigger Conditions

Activate this skill whenever the task requires:
- Creating new Viarotel-compliant Agent Skills from user requirements
- Converting plain text prompts or scattered rule sets into standardized Skill format
- Refactoring existing non-compliant or partial Skills to align with Viarotel's official template
- Generating reusable Skill definitions from engineering guidelines or business processes
- Standardizing Skill documentation across all Viarotel-maintained projects

If input contains project-specific local rule overrides, embed them directly into the corresponding sections of the output Skill. This creator skill only enforces Viarotel's structural format rules; all functional logic from user input must be preserved exactly as provided.

## Working Rules

1. Fully parse all input content first, extracting core purpose, applicable scenarios, mandatory constraints, preferred behaviors, forbidden practices, and validation requirements.
2. Generate valid top YAML frontmatter wrapped with triple dashes `---` containing the three required Viarotel standard fields: `name`, `description`, `argument-hint`.
3. Follow the fixed mandatory Markdown section order exactly as defined in Viarotel's reference template, never reordering or omitting core headers.
4. Map every constraint, requirement and restriction from input to the appropriate corresponding section:
   - Usage scenarios → Trigger Conditions (unordered list)
   - Universal execution rules → Working Rules (numbered list)
   - Domain-specific logic → Dedicated domain preference subsections
   - Forbidden practices → Anti-Patterns (unordered list)
   - Pre-completion validation steps → Review Checklist (checkbox list)
5. Preserve all original business and functional logic without modification, simplification or omission; only restructure formatting and hierarchy.
6. If input lacks content for a mandatory standard section, populate it with generic Viarotel-aligned boilerplate appropriate for the skill's domain.
7. Final output must be a self-contained, complete Markdown Skill document ready for immediate use, with no additional explanatory text outside the skill content itself.

## Standard Frontmatter Generation Rules

### name Field

- Follow Viarotel's official kebab-case naming convention: all lowercase, single hyphens between words
- No spaces, uppercase letters, underscores or special characters
- Short, descriptive identifier reflecting the skill's core function (e.g., `viarotel-create-skill`, `api-doc-generator`)

### description Field

- Single quoted string following Viarotel's standard structure: "Use when: [trigger scenarios + domain keywords]. Core rules: [3-5 high-level governing behaviors]."

### argument-hint Field
- Clear instruction telling users exactly what input to provide when invoking this skill

## Mandatory Body Section Format Standards
### Skill Objective
Single paragraph defining the specific end goal this skill enforces for AI agent behavior, consistent with Viarotel's engineering style.

### Trigger Conditions
Bullet list of all matching task types that activate the skill; always include the Viarotel standard priority rule: "If a project provides a local `AGENTS.md` or project-specific skill, follow those rules first, with this skill acting as the base layer."

### Working Rules

Numbered list of universal cross-domain hard constraints that apply in all execution contexts.

### Domain Preference Subsections

Group specialized domain logic under level 2 headings with level 3 subheadings for granular rules, mirroring the section layout of Viarotel's official reference skill template.

### Anti-Patterns

Unordered bullet list explicitly listing forbidden behaviors, using consistent prohibition language matching Viarotel's style.

### Review Checklist

Checkbox list `[ ]` of validation items the agent must verify before marking any task complete.

## Format & Output Preferences

- Strictly match the indentation, list formatting and heading hierarchy of Viarotel's official reference skill template
- Maintain formal, consistent engineering tone identical to Viarotel's existing skill documents
- Do not inject any custom rules or logic not present in the original user input
- Retain all original domain terminology and technical keywords unchanged

## Anti-Patterns

Avoid the following when creating or converting Viarotel Skills:
1. Reordering or removing any mandatory core Markdown body sections defined in the Viarotel standard
2. Generating invalid YAML frontmatter (missing triple dash wrappers, malformed quoted strings, non-kebab-case `name` values)
3. Discarding, modifying or simplifying any functional rules, constraints or logic present in the original user input
4. Mixing multiple unrelated skill definitions into a single output document
5. Adding explanatory commentary or notes outside of the final standardized Skill markdown
6. Placing rule items into incorrect mismatched sections (e.g. forbidden practices inside Working Rules)
7. Using inconsistent heading levels, list styles or formatting that deviates from Viarotel's reference template
8. Omitting the Review Checklist section even if the original input contains no explicit validation steps

## Review Checklist

Before delivering the final Viarotel-standard Skill file, confirm all items below:
- [ ] Valid YAML frontmatter wrapped with `---` including all three required fields: `name`, `description`, `argument-hint`
- [ ] `name` field strictly follows Viarotel's lowercase kebab-case naming convention
- [ ] Skill body follows Viarotel's fixed official section order with no mandatory headers missing
- [ ] All logic, constraints and requirements extracted from input are mapped to the correct corresponding sections
- [ ] Trigger Conditions fully cover all applicable use cases mentioned in the original input
- [ ] All forbidden behaviors are explicitly listed in the Anti-Patterns section
- [ ] Complete Review Checklist has been generated with all relevant validation items
- [ ] All formatting strictly matches Viarotel's official reference skill template
- [ ] 100% of original business and functional logic from user input has been preserved without modification or omission