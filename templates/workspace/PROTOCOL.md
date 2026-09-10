# miniclaw Workspace Protocol

> Agent-facing rules. miniclaw fills in the placeholders and injects this file into every Run, whichever engine is used (Claude Code or Codex), through the same channel as the memory protocol.
> These rules tell you where things go. miniclaw's policy engine enforces them independently; a blocked write comes back as a tool error.
> Design and rationale: `docs/WORKSPACE.md`. When this file changes, update `docs/WORKSPACE.md` §8.

## 1. Your paths for this Run

| Name | Path | Kind | Survives the Run? |
|------|------|------|-------------------|
| Workspace (your cwd) | `{{workspace}}` | {{workspace_kind}} | {{workspace_lifetime}} |
| Scratch | `{{run_tmp}}` | always temporary | No. Deleted automatically, possibly right after the Run |
| Output | `{{out_dir}}` | deliverables | Yes. Kept with the Run record |

The same paths are in the environment as `MINICLAW_WORKSPACE`, `MINICLAW_RUN_TMP` and `MINICLAW_OUT`. `TMPDIR` points inside the scratch area.

Workspace kinds:

- `tmp`: a fresh temporary directory miniclaw created for this Run or conversation. It is deleted a few days after the Run ends.
- `saved`: a directory the user chose to keep. Changes here are permanent. Treat it as the user's data.
- `external`: the user's own directory (for example a git repository). Changes here are permanent and may be visible to other tools.

## 2. Where to write

1. Put working files in the workspace and throwaway files in scratch.
2. **Anything the user asked for goes to Output.** Reports, exports, generated files, screenshots the user wants, and every artifact your task instructions require: write them to `{{out_dir}}` and list their file names in your final reply. Files left only in the workspace or scratch of a `tmp` Run will be deleted. (Exception: when the task tells you to write into the user's own folders, write there.)
3. Do not write outside the workspace, scratch and Output unless the task explicitly asks for it. miniclaw will ask the user to confirm such writes.
4. In a `saved` or `external` workspace, change only what the task needs. Do not delete or reorganise existing files unless asked.

## 3. What not to touch

- Other Runs' directories under `.../workspace/tmp/`, and other saved workspaces under `.../workspace/saved/`.
- miniclaw's own data: `.../runs/`, `.../state/`, and the memory directory (use the memory protocol for memory).
- Never write credentials, tokens or passwords into any file.

## 4. Keeping things

- You cannot make the workspace permanent yourself. If the whole workspace looks worth keeping, say so in your final reply and suggest `/workspace save <name>`.
- Facts worth remembering across Runs belong in the memory inbox, not in workspace files.
- Do not rely on files from an earlier Run being present in a `tmp` workspace. If you need earlier results, look in that Run's Output or ask the user.
