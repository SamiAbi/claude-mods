# claude-mods

Mods for [Claude Code](https://claude.com/claude-code): small add-ons that change how Claude looks and behaves in the terminal. Each mod is its own folder here, and each installs on its own.

## The mods

### bottom-line

While Claude works, its text and tool calls are hidden. Above the prompt you see a live plan instead:

```
⠹ Working · 1 of 3 done  ━━━━━━╸───────────  1m 4s
  ✓ Read the code
  ⠹ Write the fix · 23s
    └ Build the app
  → Next: Run the tests

  ✦ Skills  simplify · code-review
  ▣ Images  ┌────────┐ ┌────┐
            │picture │ │pic │
            └────────┘ └────┘
```

- A spinner, a progress bar that fills as steps finish, and a timer for the whole task and for the current step.
- The line under the current step says exactly what Claude is doing right now.
- The next step is marked **→ Next:**.
- Once Claude uses a skill, a skills line appears at the bottom: every skill used in the task, each once, the newest lit and twinkling. Skills you start with `/name` count too; skills used by Claude's helpers (subagents) do not.
- Once a picture is in play, an images row shows thumbnails: pictures you paste or drag into your prompt, pictures Claude opens, and screenshots it takes. The newest that fit are shown, the rest counted.
- When Claude finishes, only its summary stays in the conversation, and the finished list stays above the prompt until your next prompt, ending with `✦ Used`, the skills it used, and its pictures.

Claude gets a small plan tool of its own (it never asks for permission) and an instruction to send its plan first and end with a full summary.

**Failures are marked.** When a command or test fails, a red `✗` line under the step says what failed and why (the exit code and the last thing it printed), and the step counts it: `· ✗ 1 failed`. If Claude fixes it and moves on, the step still gets its `✓` but keeps `· 1 failed try`, in the finished list too.

**Click a step to see its actions.** Each step with actions has a `▸`. Click it and the actions open under the step, each with `✓` or `✗` and how long it took. Click again to close. Clicks work in Claude Code's fullscreen mode. A clicked row is never left highlighted.

**Helpers.** When Claude starts a helper (a subagent, such as a review or a code search) or leaves a shell command running in the background (a dev server, a long build), it stands under the step that started it:

```
  ⠹ Review for bugs · 22s
    ⚇ ⠹ code-review · Review the diff · 12s
        └ Running git diff
    ⚇ ✓ Explore · Find the callers · 4s
    ▶ ⠹ Start the dev server · 3m
```

`⚇` is a helper, `▶` a background command; a running one says what it is doing now. Click one to see all its actions. Helpers a helper starts stand one level in. Once a step is done its finished helpers fold into a count (`✓ Review for bugs · 2 helpers`; click the step to see them), and anything still running stays visible, after the task too (`still running · 3m`), until it ends. The history keeps each task's helpers under their steps.

**History.** `/bottom-line history` opens a panel beside the chat with your past tasks, newest first, one line each: when, how long, the task, and how many steps. Click a task to open it: its steps (with failed tries), the skills and pictures it used, and the first line of its summary. The last 50 tasks are kept.

**Settings.** In Claude Code's plugin settings, bottom-line has five switches, all on by default:

| Switch | Off means |
| --- | --- |
| Hide Claude's text while it works | Claude's messages and tool steps show as usual; the list still shows |
| Skills line | no `✦ Skills` line |
| Images row | no `▣ Images` row, and no thumbnails are made |
| Helpers | no helper or background-command rows |
| Keep the finished list | the list goes away as soon as Claude finishes |

- `/bottom-line` turns the whole mod on or off. Your choice is remembered.
- `ctrl+o` still shows Claude's full work.

### Pictures in the images row

Thumbnails are real pictures where the terminal can draw them. Claude Code draws them by itself in **kitty**, **Ghostty** and **iTerm2** (3.5 or later, in fullscreen rendering). In any other terminal the row shows each picture's name instead, like `[dock.png]`.

If your terminal can draw kitty-protocol pictures but Claude Code does not know it (terminals built on Ghostty's engine, for example), turn pictures on yourself in `~/.claude/settings.json` and start a new session:

```json
{
  "env": {
    "CLAUDE_CODE_FORCE_TERMINAL_IMAGES": "1"
  }
}
```

Only do this where the terminal really draws pictures; elsewhere you would see stray symbols.

- **macOS:** any picture kind (PNG, JPG, HEIC, GIF, …) becomes a small thumbnail, made by the Mac's own `sips` and kept a day in `~/Library/Caches/bottom-line`.
- **Linux and Windows:** PNG pictures (most screenshots) show as they are, up to 1 MB; other kinds are left out of the row.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install bottom-line --marketplace SamiAbi/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (the user scope is first).

From a shell:

```
claude plugin install bottom-line --marketplace SamiAbi/claude-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `SamiAbi/claude-mods`, then **Add plugin**.

## License

MIT. See [LICENSE](LICENSE).
