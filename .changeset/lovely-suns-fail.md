---
"kilo-code": minor
---

Include changes from Roo Code v3.20.3

- Resolve diff editor race condition in multi-monitor setups (thanks @daniel-lxs!)
- Add logic to prevent auto-approving edits of configuration files
- Adjust searching and listing files outside of the workspace to respect the auto-approve settings
- Fix multi-file diff error handling and UI feedback (thanks @daniel-lxs!)
- Improve prompt history navigation to not interfere with text editing (thanks @daniel-lxs!)
- Fix errant maxReadFileLine default
- Limit search_files to only look within the workspace for improved security
- Force tar-fs >=2.1.3 for security vulnerability fix
- Add cache breakpoints for custom vertex models on Unbound (thanks @pugazhendhi-m!)
- Reapply reasoning for bedrock with fix (thanks @daniel-lxs!)
- Sync BatchDiffApproval styling with BatchFilePermission for UI consistency (thanks @samhvw8!)
- Add max height constraint to MCP execution response for better UX (thanks @samhvw8!)
- Prevent MCP 'installed' label from being squeezed #4630 (thanks @daniel-lxs!)
- Allow a lower context condesning threshold (thanks @SECKainersdorfer!)
- Avoid type system duplication for cleaner codebase (thanks @EamonNerbonne!)
- Temporarily revert thinking support for Bedrock models
- Improve performance of MCP execution block
- Add indexing status badge to chat view
- Add experimental multi-file edits (thanks @samhvw8!)
- Move concurrent reads setting to context settings with default of 5
- Improve MCP execution UX (thanks @samhvw8!)
- Add magic variables support for MCPs with `workspaceFolder` injection (thanks @NamesMT!)
- Add prompt history navigation via arrow up/down in prompt field
- Add support for escaping context mentions (thanks @KJ7LNW!)
- Add DeepSeek R1 support to Chutes provider
- Add reasoning budget support to Bedrock models for extended thinking
- Add mermaid diagram support buttons (thanks @qdaxb!)
- Update XAI models and pricing (thanks @edwin-truthsearch-io!)
- Update O3 model pricing
- Add manual OpenAI-compatible format specification and parsing (thanks @dflatline!)
- Add core tools integration tests for comprehensive coverage
- Add JSDoc documentation for ClineAsk and ClineSay types (thanks @hannesrudolph!)
- Populate whenToUse descriptions for built-in modes
- Fix file write tool with early relPath & newContent validation checks (thanks @Ruakij!)
- Fix TaskItem display and copy issues with HTML tags in task messages (thanks @forestyoo!)
- Fix OpenRouter cost calculation with BYOK (thanks @chrarnoldus!)
- Fix terminal busy state reset after manual commands complete
- Fix undefined output on multi-file apply_diff operations (thanks @daniel-lxs!)
