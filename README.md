# claude-mods

Mods for [Claude Code](https://claude.com/claude-code): small add-ons that change how Claude looks and behaves in the terminal. Each mod is its own folder here, and each installs on its own.

## The mods

### focus-list

While Claude works, its text and tool calls are hidden. Above the prompt you see a live plan instead:

```
⠹ Working · 1 of 3 done  ━━━━━━╸───────────  1m 4s
  ✓ Read the code
  ⠹ Write the fix · 23s
    └ Build the app
  → Next: Run the tests

  ✦ Skills  simplify · code-review
```

- A spinner, a progress bar that fills as steps finish, and a timer for the whole task and for the current step.
- The line under the current step says exactly what Claude is doing right now.
- The next step is marked **→ Next:**.
- Once Claude uses a skill, a skills line appears at the bottom: every skill used in the task, each once, the newest lit and twinkling. Skills you start with `/name` count too; skills used by Claude's helpers (subagents) do not.
- When Claude finishes, only its summary stays in the conversation, and the finished list stays above the prompt until your next prompt, ending with `✦ Used` and the skills it used.

Claude gets a small plan tool of its own (it never asks for permission) and an instruction to send its plan first and end with a full summary.

- `/focus-list` turns it on or off. Your choice is remembered.
- `ctrl+o` still shows Claude's full work.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install focus-list --marketplace SamiAbi/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (the user scope is first).

From a shell:

```
claude plugin install focus-list --marketplace SamiAbi/claude-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `SamiAbi/claude-mods`, then **Add plugin**.

## License

MIT. See [LICENSE](LICENSE).
