# sidekick

A Claude Code mod: a small pane where a Haiku-powered sidekick narrates, in one very short plain-English sentence at a time, what Claude Code is doing.

- Watches your prompts, every tool call (including helper agents), blocked/failed calls, and turn endings.
- Batches events and asks Haiku for one sentence (max ~12 words) at most every ~2.5s; falls back to a canned phrase if the model call fails.
- `/sidekick` reopens the pane, `/sidekick off` pauses narration (stops Haiku calls), `/sidekick on` resumes.

Install: copy this folder to your mods folder (`~/.claude/dev-mods/<session>/sidekick` with hot reload) or run `claude --plugin-dir mods/sidekick`.
Check: `claude plugin validate mods/sidekick && claude plugin test mods/sidekick`.
