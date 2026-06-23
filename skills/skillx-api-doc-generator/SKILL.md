---
name: api-doc-generator
description: "Use when: parsing business attachments with data flow & business logic, generating standardized frontend integration-ready API documentation in Markdown. Follow strict fixed API section structure, label incomplete definitions, use semantic mock response data, document cross-api call dependencies, produce exportable docs for Confluence/Notion/Lark Docs."
argument-hint: "Attach or paste the raw business logic/data flow content that contains backend interface definitions"
---

# API Doc Generator Skill

## Skill Objective
Parse attached business materials, fully comprehend business logic and end-to-end data flow relationships, then output complete, standardized Markdown API documents that frontend engineers can directly use for joint debugging.

## Trigger Conditions
Activate this skill when the task requires:
- Reading & parsing attached business documents containing backend interface definitions, business processes or data flow logic
- Generating formal, frontend integration-ready API reference docs
- Organizing scattered interface definitions into unified structured documentation
- Formatting API specs compatible with Confluence, Notion or Lark Docs

## Working Rules
1. Fully parse all attached content first, map out the full business logic and cross-interface data flow before drafting docs.
2. Strictly follow the fixed mandatory output structure for every single API entry without omitting any required field.
3. Mark incomplete interface definitions clearly with a 【To Confirm】 tag and explicitly list all missing fields/information.
4. Populate response JSON examples with semantically reasonable mock values; avoid empty strings or null placeholders.
5. If sequential call dependencies exist between interfaces (e.g. login required before fetching resource list), add a top-level overview of the full call workflow at the start of the document.
6. Deliver final output as clean, copy-pasteable Markdown with consistent table formatting for all parameter & field explanations.

## Mandatory API Section Structure
Every individual API record must contain all of the below sections in order:
1. API Name / Functional Description
2. Request Method (GET / POST / PUT / DELETE etc.)
3. Full Request URL Path
4. Request Headers (list mandatory auth headers if authentication is required)
5. Request Parameters
    - Split into Query Params, Path Params, Request Body separately
    - For each parameter: data type, required flag, detailed description
6. Response Structure
    - Full valid JSON mock example
    - Supporting table with all response fields, types and explanations
7. Business Error Code Explanations
    - Table mapping error code values to readable failure meanings
8. Remarks
    - Special business logic, resource dependencies, required calling sequence notes

## Format & Output Preferences
- Use standard Markdown tables for all parameter, response field and error code explanations.
- Keep mock response data contextually matching the business domain; do not use generic placeholder values.
- Highlight incomplete interface specs with the label 【To Confirm】 plus a plain English note of missing information.
- Place cross-API dependency workflow overview at the very top of the full document before listing individual APIs.
- Ensure the final Markdown output has no broken formatting and can be directly imported to Confluence, Notion or Lark Docs without extra edits.

## Anti-Patterns
Avoid the following behaviors unless explicitly overridden by user requirements:
- Skip any mandatory section of the standard API document structure
- Use empty strings, null or meaningless dummy values for response mock data
- Omit notes for incomplete interface definitions without marking 【To Confirm】
- Ignore cross-interface calling dependencies and skip the top-level workflow overview
- Output non-Markdown formats or messy unstructured text that cannot be pasted to document platforms
- Mix Query, Path and Body parameters without clear separation

## Review Checklist
Before finalizing the API document output, verify all items below:
- [ ] Full business logic and data flow from attachments have been completely parsed
- [ ] Every API entry includes all 8 mandatory standard sections
- [ ] All incomplete interface definitions are tagged 【To Confirm】 with clear missing info notes
- [ ] Response JSON examples use business-semantic mock values instead of empty/null placeholders
- [ ] Cross-API call dependency overview is added at document top when sequential logic exists
- [ ] All parameters are split into Query / Path / Body with type, required flag and description tables
- [ ] Business error codes are listed with clear human-readable explanations
- [ ] Special logic, dependencies and call sequence notes are written in the Remarks section
- [ ] Output is clean standard Markdown compatible with Confluence, Notion and Lark Docs