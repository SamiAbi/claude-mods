import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, Timer } from 'claude-code'

import type { Activity, Helper, HelperStatus, HistoryEntry, HistoryHelper, Step, StepStatus, Thumb } from '../types'

const NAME = 'bottom-line'
const PLAN_TOOL = 'mcp__bottom-line__plan'
const PLAN_MATCH = /^mcp__bottom-line__plan$/
const HISTORY_PANE = 'bottom-line-history'
const SETTINGS_PANE = 'bottom-line-settings'
const KEEP = 1000
const TICK = 120
const FLASH = 1500

const isOn = atom({ plugin: 'bottom-line', key: 'isOn' } as const, true)
const isWorking = atom({ plugin: 'bottom-line', key: 'isWorking' } as const, false)
const steps = atom({ plugin: 'bottom-line', key: 'steps' } as const, [])
const activity = atom({ plugin: 'bottom-line', key: 'activity' } as const, [])
const clock = atom({ plugin: 'bottom-line', key: 'clock' } as const, 0)
const turnSince = atom({ plugin: 'bottom-line', key: 'turnSince' } as const, 0)
const stepSince = atom({ plugin: 'bottom-line', key: 'stepSince' } as const, 0)
const turnTitle = atom({ plugin: 'bottom-line', key: 'turnTitle' } as const, '')
const doneAt = atom({ plugin: 'bottom-line', key: 'doneAt' } as const, {})
const finish = atom({ plugin: 'bottom-line', key: 'finish' } as const, null)
const openStep = atom({ plugin: 'bottom-line', key: 'openStep' } as const, null)
const openHelper = atom({ plugin: 'bottom-line', key: 'openHelper' } as const, null)
const turnNow = atom({ plugin: 'bottom-line', key: 'turnNow' } as const, '')
const helpers = atom({ plugin: 'bottom-line', key: 'helpers' } as const, [])
const openHistory = atom({ plugin: 'bottom-line', key: 'openHistory' } as const, null)
const skills = atom({ plugin: 'bottom-line', key: 'skills' } as const, [])
const pendingSkills = atom({ plugin: 'bottom-line', key: 'pendingSkills' } as const, [])
const images = atom({ plugin: 'bottom-line', key: 'images' } as const, [])
const pendingImages = atom({ plugin: 'bottom-line', key: 'pendingImages' } as const, [])
const turnTexts = atom({ plugin: 'bottom-line', key: 'turnTexts' } as const, [])
const turnTools = atom({ plugin: 'bottom-line', key: 'turnTools' } as const, [])
const summaries = atom({ plugin: 'bottom-line', key: 'summaries' } as const, [])
const hiddenTexts = atom({ plugin: 'bottom-line', key: 'hiddenTexts' } as const, [])
const hiddenTools = atom({ plugin: 'bottom-line', key: 'hiddenTools' } as const, [])

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const PULSE = ['╸', '━', '╸', ' ']
const BAR = 18
const DOTS = ['', '.', '..', '...']
const TWINKLE = ['✦', '✦', '✧', '✧']
const OPEN_ACTIONS = 8
const HISTORY_KEEP = 50

const THUMB_ROWS = 4
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|heic|tiff?|bmp)$/i

// Tools that keep the plan, not do the work: never an action of their own.
const PLAN_KEEPING = ['TodoWrite', 'TaskUpdate', 'TaskCreate', 'TaskList', 'TaskGet', PLAN_TOOL]

// Every base64 picture in a row's blocks, a tool result's own blocks included.
type FoundImage = { data: string; toolUseId?: string }
const imageBlocks = (content: unknown, toolUseId?: string): FoundImage[] => {
  if (!Array.isArray(content)) return []
  return content.flatMap((block: unknown): FoundImage[] => {
    if (!block || typeof block !== 'object') return []
    const b = block as { type?: unknown; source?: { type?: unknown; data?: unknown }; content?: unknown; tool_use_id?: unknown }
    if (b.type === 'image' && b.source?.type === 'base64' && typeof b.source.data === 'string') {
      return [{ data: b.source.data, toolUseId }]
    }
    if (b.type === 'tool_result') return imageBlocks(b.content, typeof b.tool_use_id === 'string' ? b.tool_use_id : undefined)
    return []
  })
}

// A small PNG of one picture, whatever its kind, made by the Mac's own sips in the
// person's cache (a day's worth kept); its box is as wide as its shape asks.
async function makeThumb(
  $: EngineInterface,
  data: string,
  id: string,
): Promise<{ file?: string; png?: string; columns: number } | null> {
  const script = [
    'd="$HOME/Library/Caches/bottom-line"; mkdir -p "$d" && find "$d" -type f -mtime +1 -delete',
    'i="$d/$1.src"; o="$d/$1.png"',
    'base64 -D -o "$i" && sips -s format png -Z 320 "$i" --out "$o" >/dev/null 2>&1 && rm -f "$i"',
    'sips -g pixelWidth -g pixelHeight "$o" | awk -v o="$o" \'/pixelWidth/{w=$2} /pixelHeight/{h=$2} END{printf "%s\\t%s\\t%s", o, w, h}\'',
  ].join('\n')
  try {
    const ran = await $.process.run(['/bin/sh', '-c', script, 'sh', id], { stdin: data, timeoutMs: 20000 })
    const [file, width, height] = ran.stdout.trim().split('\t')
    const w = Number(width)
    const h = Number(height)
    if (ran.exitCode === 0 && file && w > 0 && h > 0) return { file, columns: boxColumns(w, h) }
  } catch {
    // No shell or no sips (Linux, Windows): a PNG can still be shown as it is.
  }

  return pngAsItIs(data)
}

// A terminal cell is about twice as tall as it is wide.
const boxColumns = (width: number, height: number) =>
  Math.max(4, Math.min(24, Math.round((THUMB_ROWS * 2 * width) / height)))

// A PNG small enough to hand the terminal whole (1 MiB), sized from its own header.
const PNG_SIGNATURE = 'iVBORw0KGgo'
const pngAsItIs = (data: string) => {
  if (!data.startsWith(PNG_SIGNATURE) || (data.length * 3) / 4 > 1024 * 1024) return null
  try {
    const head = atob(data.slice(0, 32))
    const word = (at: number) =>
      ((head.charCodeAt(at) << 24) | (head.charCodeAt(at + 1) << 16) | (head.charCodeAt(at + 2) << 8) | head.charCodeAt(at + 3)) >>> 0
    const width = word(16)
    const height = word(20)
    if (!(width > 0) || !(height > 0)) return null

    return { png: data, columns: boxColumns(width, height) }
  } catch {
    return null
  }
}

// Add a skill once, keeping the order skills were first used in.
const withSkill = (list: string[], name: string) => (list.includes(name) ? list : [...list, name])

// The skills line: the names that fit the width, the rest counted.
const fitSkills = (names: string[], room: number) => {
  const shown: string[] = []
  let used = 0
  for (const name of names) {
    const cost = name.length + (shown.length > 0 ? 3 : 0)
    if (shown.length > 0 && used + cost > room - 10) break
    shown.push(name)
    used += cost
  }

  return { shown, more: names.length - shown.length }
}

// A bar with no end known: a bright run that sweeps across and back.
const sweep = (frame: number) => {
  const run = 4
  const span = BAR - run
  const step = frame % (span * 2)
  const from = step <= span ? step : span * 2 - step

  return { before: from, run, after: BAR - from - run }
}

// What Claude is told; with its text left on screen, the first line says so.
const planText = (isTextHidden: boolean) =>
  [
    '# Bottom line',
    isTextHidden
      ? 'While you work, the person does not see your text or your tool calls. They see only your plan, live, and when you finish, only your final message.'
      : 'While you work, the person follows your plan, live, above the prompt.',
    `- For every prompt, even a question or a one-step task, your very first action is to call ${PLAN_TOOL} with every step, in plain words, the first one in_progress (a question is two steps at least: finding the answer, then writing it). Call it again each time a step finishes or the next one starts, always with the whole list and exactly one step in_progress until all are done. Change the plan when you learn more.`,
    isTextHidden
      ? '- Your final message is the only text the person reads. Make it a complete, short summary: what you did, what you found, and anything they must do or decide.'
      : '- End with a complete, short summary: what you did, what you found, and anything they must do or decide.',
  ].join('\n')

const PLAN_SPEC = {
  name: 'plan',
  description:
    'Show the person your plan for this task, live. Send the whole list every time: each step in plain words with its status. Exactly one step is in_progress while you work.',
  inputSchema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'The step, in a few plain words' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['title', 'status'],
        },
      },
    },
    required: ['steps'],
  },
  isDeferred: false,
} as const

const short = (text: string, room: number) =>
  text.length > room ? `${text.slice(0, Math.max(1, room - 1))}…` : text

const base = (path: unknown) =>
  typeof path === 'string' ? (path.split('/').pop() ?? path) : ''

const since = (from: number, to: number) => {
  const seconds = Math.max(0, Math.round((to - from) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

const clockTime = (at: number) => {
  const when = new Date(at)
  return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

// One plain line for what a tool call is doing.
const describe = (tool: string, input: Record<string, unknown>) => {
  switch (tool) {
    case 'Read':
      return `Reading ${base(input.file_path)}`
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return `Editing ${base(input.file_path ?? input.notebook_path)}`
    case 'Bash':
      return typeof input.description === 'string'
        ? input.description
        : `Running ${String(input.command ?? '')}`
    case 'Grep':
    case 'Glob':
      return `Searching for ${String(input.pattern ?? '')}`
    case 'WebSearch':
      return `Searching the web: ${String(input.query ?? '')}`
    case 'WebFetch':
      return 'Reading a web page'
    case 'Agent':
      return `Asking a helper: ${String(input.description ?? '')}`
    case 'Skill':
      return `Using the ${String(input.skill ?? '')} skill`
    default:
      return `Using ${tool.replace(/^mcp__[^_]+__/, '')}`
  }
}

// Why a call failed, in one line: the exit code where there is one, and the last
// thing it said (a test run's verdict comes last).
const failureReason = (text: string | undefined) => {
  const lines = (text ?? '').split('\n').map(line => line.trim()).filter(line => line.length > 0)
  if (lines.length === 0) return 'failed'
  const exit = /^exit code (\d+)$/i.exec(lines[0] ?? '')
  const last = lines[lines.length - 1] ?? ''
  if (exit && lines.length > 1) return `exit ${exit[1]} · ${last}`
  return exit ? `exit ${exit[1]}` : last
}

const capped = <T,>(list: T[]) => list.slice(-KEEP)
const trimmed = (text: string) => text.trim()
const isStatus = (value: unknown): value is StepStatus =>
  value === 'pending' || value === 'in_progress' || value === 'completed'

// A new plan: note which steps just finished (they flash) and when the current one began.
const setPlan = async ($: EngineInterface, next: Step[]) => {
  const at = await $.clock.now()
  const before = await read($, steps)
  const was = (id: string) => before.find(step => step.id === id)
  const finished = next.filter(step => step.status === 'completed' && was(step.id)?.status !== 'completed')
  const current = next.find(step => step.status === 'in_progress')
  const wasCurrent = before.find(step => step.status === 'in_progress')

  if (finished.length > 0) {
    await update($, doneAt, map => ({ ...map, ...Object.fromEntries(finished.map(step => [step.id, at])) }))
  }
  if (current && current.title !== wasCurrent?.title) await update($, stepSince, () => at)
  await update($, steps, () => next)
}

const isHidden = async ($: EngineInterface, text: string) => {
  const key = trimmed(text)
  if ((await read($, summaries)).includes(key)) return false
  if (await read($, isWorking)) return true

  return (await read($, hiddenTexts)).includes(key)
}

// The task just finished, kept for the history panel (newest first, fifty kept).
async function keepInHistory($: EngineInterface, id: string, isAborted: boolean, answer: string) {
  const at = await read($, turnSince)
  const ended = await $.clock.now()
  const list = await read($, steps)
  const recent = (await read($, activity)).filter(action => action.helper === undefined)
  const failuresOf = (title: string) => recent.filter(action => action.step === title && action.failed).length
  const turn = await read($, turnNow)
  const team = (await read($, helpers)).filter(helper => helper.turn === turn)
  const lastTitle = list[list.length - 1]?.title
  const helpersOf = (title: string) => historyHelpers(team, title, title === lastTitle)
  const firstStep = list[0]?.title ?? recent[0]?.title ?? 'Task'
  const asked = (await read($, turnTitle)) || firstStep
  const entry: HistoryEntry = {
    id,
    at,
    seconds: Math.max(0, Math.round((ended - at) / 1000)),
    title: short(asked, 80),
    isAborted,
    steps:
      list.length > 0
        ? list.map(step => ({
            title: step.title,
            status: step.status,
            failures: failuresOf(step.title),
            ...(helpersOf(step.title).length > 0 ? { helpers: helpersOf(step.title) } : {}),
          }))
        : recent.slice(-30).map(action => ({
            title: action.title,
            status: 'completed' as const,
            failures: action.failed ? 1 : 0,
          })),
    skills: await read($, skills),
    images: (await read($, images)).length,
    summary: short((answer.split('\n').find(line => line.trim().length > 0) ?? '').trim(), 200),
  }
  const before = await $.store.get('history')
  const kept = Array.isArray(before) ? (before as HistoryEntry[]) : []
  await $.store.set('history', [entry, ...kept.filter(old => old.id !== id)].slice(0, HISTORY_KEEP))
}

// A step's helpers as the history keeps them; the last step also takes those started
// before any plan (they belong to no step).
const historyHelpers = (team: Helper[], title: string, takesLoose: boolean): HistoryHelper[] =>
  team
    .filter(helper => !helper.parent && (helper.step === title || (takesLoose && helper.step === undefined)))
    .map(helper => ({
      name: helper.name,
      job: helper.job,
      kind: helper.kind,
      seconds: Math.max(0, Math.round(((helper.endAt ?? helper.at) - helper.at) / 1000)),
      status: helper.status,
    }))

// How a helper ended, from its loop's reason or its notice's status word.
const helperEnd = (word: string): HelperStatus =>
  word === 'answer' || word === 'completed' ? 'done' : word === 'aborted' || word === 'killed' ? 'stopped' : 'failed'

// A new helper: of the task shown, under the step Claude is on, or under the helper that
// started it.
async function addHelper($: EngineInterface, fresh: Pick<Helper, 'id' | 'kind' | 'name' | 'job'> & { parent?: string }) {
  const team = await read($, helpers)
  if (team.some(helper => helper.id === fresh.id)) return
  const parent = fresh.parent && team.some(helper => helper.id === fresh.parent) ? fresh.parent : undefined
  const current = (await read($, steps)).find(step => step.status === 'in_progress')
  const helper: Helper = {
    id: fresh.id,
    kind: fresh.kind,
    name: fresh.name,
    job: fresh.job,
    turn: await read($, turnNow),
    ...(parent ? { parent } : current ? { step: current.title } : {}),
    at: await $.clock.now(),
    status: 'running',
  }
  await update($, helpers, list => (list.some(one => one.id === helper.id) ? list : [...list, helper].slice(-60)))
}

// A helper ended. Only its mark changes here: a notice reaches the mod where it has one
// second, so the history is written a moment later, outside it.
async function endHelper($: EngineInterface, id: string, status: HelperStatus) {
  const at = await $.clock.now()
  await update($, helpers, list =>
    list.map(one => (one.id === id && one.status === 'running' ? { ...one, status, endAt: at } : one)),
  )
  $.clock.after(50, () => {
    void settleHelpers($)
  })
}

// Ended helpers of a task no longer being worked on: written into that task's history,
// and, for a task no longer shown, let go.
async function settleHelpers($: EngineInterface) {
  const shown = await read($, turnNow)
  const working = await read($, isWorking)
  const team = await read($, helpers)
  const turns = [...new Set(team.filter(one => one.status !== 'running' && (one.turn !== shown || !working)).map(one => one.turn))]
  if (turns.length === 0) return

  const before = await $.store.get('history')
  const kept = Array.isArray(before) ? (before as HistoryEntry[]) : []
  const patched = kept.map(entry => {
    if (!turns.includes(entry.id)) return entry
    const ofTask = team.filter(one => one.turn === entry.id)
    const lastTitle = entry.steps[entry.steps.length - 1]?.title
    return {
      ...entry,
      steps: entry.steps.map(step => {
        const helpersNow = historyHelpers(ofTask, step.title, step.title === lastTitle)
        return helpersNow.length > 0 ? { ...step, helpers: helpersNow } : step
      }),
    }
  })
  await $.store.set('history', patched)
  await update($, helpers, list => list.filter(one => one.turn === shown || one.status === 'running'))
}

// The task id and how it ended, from a background task's notice.
const taskNotice = (text: string) => {
  const id = /<task-id>([^<]+)<\/task-id>/.exec(text)?.[1]?.trim()
  const status = /<status>([^<]+)<\/status>/.exec(text)?.[1]?.trim()
  return id && status ? { id, status } : null
}

const rowText = (content: unknown) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .map(block => (block && typeof block === 'object' && 'text' in block ? String((block as { text: unknown }).text) : ''))
          .join('\n')
      : ''

// The mod was called focus-list before: once, its saved history and on/off choice come
// along from that name's own file (where a shell can read it).
async function bringOldSaves($: EngineInterface) {
  if ((await $.store.get('movedFromFocusList')) === true) return
  await $.store.set('movedFromFocusList', true)
  try {
    const ran = await $.process.run(['/bin/sh', '-c', 'cat "$HOME"/.claude/plugins/store/focus-list_*.json 2>/dev/null | head -c 4000000'])
    if (ran.exitCode !== 0 || !ran.stdout.trim().startsWith('{')) return
    const old = JSON.parse(ran.stdout) as { isOn?: unknown; history?: unknown }
    if ((await $.store.get('history')) === undefined && Array.isArray(old.history)) await $.store.set('history', old.history)
    if ((await $.store.get('isOn')) === undefined && typeof old.isOn === 'boolean') await $.store.set('isOn', old.isOn)
  } catch {
    // Nothing to bring: a fresh start under the new name.
  }
}

// What each of Claude's tool calls is called, for naming the pictures it brings back.
const toolNames = new Map<string, string>()

// The animation's heartbeat: runs only while Claude works.
let ticker: Timer | undefined

function startTicking($: EngineInterface) {
  ticker?.cancel()
  ticker = $.clock.every(TICK, () => {
    void $.clock.now().then(at => update($, clock, () => at))
  })
}

function stopTicking() {
  ticker?.cancel()
  ticker = undefined
}

export const register: Register = (on, options) => {
  const isTextHidden = options.hideText !== false
  const hasSkillsLine = options.skillsLine !== false
  const hasImagesRow = options.imagesRow !== false
  const keepsFinished = options.keepFinished !== false
  const hasHelpers = options.helpers !== false

  on('session.start', async ($, e, next) => {
    await bringOldSaves($)
    const stored = await $.store.get('isOn')
    await update($, isOn, () => stored !== false)
    await $.command.register({
      name: NAME,
      description: 'The bottom line: no argument turns it on or off; "history" opens your past tasks; "settings" its switches',
      argumentHint: '[history | settings]',
    })
    await $.tool.register(PLAN_SPEC)
    if (await read($, isWorking)) startTicking($)

    return next(e)
  })

  on('command.run', { command: NAME }, async ($, e) => {
    const asked = e.args.trim().toLowerCase()
    if (asked === 'history') {
      await $.ui.open({ id: HISTORY_PANE, title: 'History' })

      return { text: 'History opened beside the chat.' }
    }
    if (asked === 'settings') {
      await $.ui.open({ id: SETTINGS_PANE, title: 'Bottom line settings' })
      const rows = (await $.config.list()).filter(row => row.key.startsWith(`${NAME}.`))

      return {
        text:
          rows.length === 0
            ? `Settings opened beside the chat. Change them in ~/.claude/settings.json under "pluginConfigs" → "${NAME}@inline" → "options".`
            : `Settings opened beside the chat: ${rows.map(row => `${row.label} ${row.value === false ? 'off' : 'on'}`).join(' · ')}.`,
      }
    }

    const turnOn = !(await read($, isOn))
    await update($, isOn, () => turnOn)
    await $.store.set('isOn', turnOn)

    return {
      text: turnOn
        ? 'Bottom line is on. While Claude works you see a live plan; when it finishes, only the summary.'
        : 'Bottom line is off. Claude’s work shows as usual.',
    }
  }).catch(() => ({ text: 'Bottom line could not do that. Try again.' }))

  // Ask Claude to keep its plan up to date and to end with a full summary.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, isOn))) return composed

    return {
      sections: [...composed.sections, { id: `${NAME}:plan`, text: planText(isTextHidden), scope: 'session' }],
    }
  })

  // The plan tool only draws; it never needs the person's yes.
  on('tool.check', { tool: PLAN_MATCH }, () => ({ decision: 'allow' }))

  on('tool.call', { tool: PLAN_MATCH }, async ($, e) => {
    if (e.agentId === undefined) await update($, turnTools, list => capped([...list, e.tool_use_id]))
    const input = e as unknown as { steps?: unknown }
    const list = Array.isArray(input.steps) ? input.steps : []
    const plan: Step[] = list.map((step, at) => ({
      id: `plan:${at}`,
      title: String((step as { title?: unknown })?.title ?? ''),
      status: isStatus((step as { status?: unknown })?.status) ? (step as { status: StepStatus }).status : 'pending',
    }))
    await setPlan($, plan)
    const done = plan.filter(step => step.status === 'completed').length

    return { result: `Plan shown: ${done} of ${plan.length} done.` }
  }).catch(() => ({ result: 'The plan could not be shown; carry on.' }))

  // A skill the person typed as /name expands before its turn starts: hold it for that turn.
  // Skills Claude loads itself are caught at the Skill tool call, on the main loop alone.
  on('skill.prompt', async ($, e, next) => {
    if ((await read($, isOn)) && !(await read($, isWorking))) {
      await update($, pendingSkills, list => withSkill(list, e.skill))
    }

    return next(e)
  })

  // A helper starts: kept under the step Claude is on (or the helper that started it).
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (!hasHelpers || started.deny !== undefined || !started.agentId || !(await read($, isOn))) return started
    await addHelper($, {
      id: started.agentId,
      kind: 'agent',
      name: e.subagentType,
      job: e.description,
      ...(e.parentAgentId ? { parent: e.parentAgentId } : {}),
    })

    return started
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    // A helper's own run starting: one with no spawn of its own (a forked skill) is
    // found in the session's agents.
    if (e.agentId !== undefined) {
      if (hasHelpers && (await read($, isOn))) {
        const id = e.agentId
        const known = (await read($, helpers)).find(helper => helper.id === id)
        if (known) {
          await update($, helpers, list =>
            list.map(helper => (helper.id === id ? { ...helper, status: 'running' as const, endAt: undefined } : helper)),
          )
        } else {
          const info = (await $.agent.list()).find(agent => agent.id === id)
          if (info) {
            await addHelper($, {
              id,
              kind: 'agent',
              name: info.type,
              job: info.description,
              ...(info.parentId ? { parent: info.parentId } : {}),
            })
          }
        }
      }

      return next(e)
    }
    if (await read($, isOn)) {
      const at = await $.clock.now()
      await update($, steps, () => [])
      await update($, activity, () => [])
      await update($, doneAt, () => ({}))
      await update($, finish, () => null)
      await update($, openStep, () => null)
      await update($, openHelper, () => null)
      await update($, turnNow, () => e.turnId)
      // Helpers of earlier tasks: the ended ones written into their history and let go; the
      // running ones stay until they end (their task's history waits on them).
      await settleHelpers($)
      await update($, turnTitle, () => (e.text.split('\n').find(line => line.trim().length > 0) ?? '').trim())
      const typed = await read($, pendingSkills)
      await update($, skills, () => typed)
      await update($, pendingSkills, () => [])
      const given = await read($, pendingImages)
      await update($, images, () => given)
      await update($, pendingImages, () => [])
      await update($, turnTexts, () => [])
      await update($, turnTools, () => [])
      await update($, turnSince, () => at)
      await update($, stepSince, () => at)
      await update($, clock, () => at)
      await update($, isWorking, () => true)
      startTicking($)
    }

    return next(e)
  })

  // Keep every text block the model writes this turn, so it stays hidden afterwards.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId !== undefined || !(await read($, isOn))) return stored

    // A background task's notice says how a helper or a background command ended.
    if (hasHelpers && e.message.role === 'user') {
      const notice = taskNotice(rowText(e.message.content))
      if (notice) await endHelper($, notice.id, helperEnd(notice.status))
    }

    // Pictures you give and pictures Claude's tools bring back: thumbnails for the list.
    // One given before its turn starts is held for that turn, as a typed skill is.
    if (hasImagesRow && (e.door === 'prompt' || e.door === 'tool-result')) {
      const found = imageBlocks(e.message.content)
      const isTurn = await read($, isWorking)
      for (const [index, picture] of found.entries()) {
        const id = `${e.uuid}-${index}`.replace(/[^A-Za-z0-9-]/g, '')
        const made = await makeThumb($, picture.data, id)
        if (made === null) continue
        const name = picture.toolUseId ? (toolNames.get(picture.toolUseId) ?? 'image') : 'your image'
        const thumb: Thumb = { id, name, ...made }
        if (isTurn) await update($, images, list => [...list, thumb].slice(-20))
        else await update($, pendingImages, list => [...list, thumb].slice(-20))
      }
    }

    if (e.door !== 'response' || !(await read($, isWorking))) return stored

    const content = Array.isArray(e.message.content) ? e.message.content : []
    const texts = content.flatMap(block =>
      block && typeof block === 'object' && 'type' in block && block.type === 'text' && 'text' in block
        ? [trimmed(String(block.text))]
        : [],
    )
    if (texts.length > 0) await update($, turnTexts, list => capped([...list, ...texts]))

    return stored
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    // A helper's own action: kept under the helper, the newest its "now".
    if (e.agentId !== undefined) {
      const id = e.agentId
      if (!hasHelpers || PLAN_KEEPING.includes(e.tool) || !(await read($, helpers)).some(helper => helper.id === id)) {
        return next(e)
      }
      const title = describe(e.tool, e as unknown as Record<string, unknown>)
      const doing: Activity = { id: e.tool_use_id, title, at: await $.clock.now(), helper: id }
      await update($, activity, list => [...list, doing].slice(-300))
      await update($, helpers, list => list.map(helper => (helper.id === id ? { ...helper, now: title } : helper)))
      const ran = await next(e)
      const endAt = await $.clock.now()
      const failed = ran.isError === true ? failureReason(ran.text) : undefined
      await update($, activity, list =>
        list.map(action => (action.id === e.tool_use_id ? { ...action, endAt, ...(failed ? { failed } : {}) } : action)),
      )

      return ran
    }
    if (!(await read($, isWorking))) return next(e)

    const input = e as unknown as Record<string, unknown>
    await update($, turnTools, list => capped([...list, e.tool_use_id]))
    toolNames.set(
      e.tool_use_id,
      e.tool === 'Read' && IMAGE_FILE.test(String(input.file_path ?? ''))
        ? base(input.file_path)
        : /screenshot|zoom/i.test(e.tool)
          ? 'screenshot'
          : e.tool.replace(/^mcp__[^_]+__/, ''),
    )

    if (e.tool === 'TodoWrite') {
      const todos = Array.isArray(input.todos) ? input.todos : []
      await setPlan(
        $,
        todos.map((todo, at) => ({
          id: `todo:${at}`,
          title: String(todo?.content ?? ''),
          status: isStatus(todo?.status) ? todo.status : 'pending',
        })),
      )
    } else if (e.tool === 'TaskUpdate') {
      const id = String(input.taskId ?? '')
      const status = input.status
      const list = await read($, steps)
      await setPlan(
        $,
        status === 'deleted'
          ? list.filter(step => step.id !== id)
          : list.map(step =>
              step.id !== id
                ? step
                : {
                    ...step,
                    ...(isStatus(status) ? { status } : {}),
                    ...(typeof input.subject === 'string' ? { title: input.subject } : {}),
                  },
            ),
      )
    }
    if (e.tool === 'Skill' && typeof input.skill === 'string') {
      const name = input.skill
      await update($, skills, list => withSkill(list, name))
    }

    // Each action is kept with the step it belongs to, when it ended and how it went.
    const isAction = !PLAN_KEEPING.includes(e.tool)
    if (isAction) {
      const current = (await read($, steps)).find(step => step.status === 'in_progress')
      const doing: Activity = {
        id: e.tool_use_id,
        title: describe(e.tool, input),
        at: await $.clock.now(),
        ...(current ? { step: current.title } : {}),
      }
      await update($, activity, list => [...list, doing].slice(-200))
    }

    const ran = await next(e)

    if (isAction) {
      const endAt = await $.clock.now()
      const failed = ran.isError === true ? failureReason(ran.text) : undefined
      await update($, activity, list =>
        list.map(action => (action.id === e.tool_use_id ? { ...action, endAt, ...(failed ? { failed } : {}) } : action)),
      )
    }

    // A command left running in the background is a helper until its notice says it ended;
    // one Claude stops ends there.
    if (hasHelpers && e.tool === 'Bash' && ran.deny === undefined && !ran.isError) {
      const backgroundId = (ran.result as { backgroundTaskId?: unknown } | undefined)?.backgroundTaskId
      if (typeof backgroundId === 'string') {
        await addHelper($, {
          id: backgroundId,
          kind: 'shell',
          name: typeof input.description === 'string' ? input.description : short(String(input.command ?? ''), 40),
          job: '',
        })
      }
    }
    if (hasHelpers && e.tool === 'TaskStop' && ran.deny === undefined && !ran.isError) {
      const stopped = input.task_id ?? input.shell_id
      if (typeof stopped === 'string') await endHelper($, stopped, 'stopped')
    }

    if (e.tool === 'TaskCreate' && ran.deny === undefined && !ran.isError) {
      const task = (ran.result as { task?: { id?: string; subject?: string } } | undefined)?.task
      if (task?.id) {
        const step: Step = { id: task.id, title: task.subject ?? String(input.subject ?? ''), status: 'pending' }
        await update($, steps, list => [...list, step])
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  // The turn is over: hide what it wrote, keep only its final message, and file it in the history.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      if (hasHelpers) await endHelper($, e.agentId, helperEnd(e.reason))

      return next(e)
    }
    if (await read($, isWorking)) {
      stopTicking()
      const answer = trimmed(e.answer)
      const texts = await read($, turnTexts)
      const kept = texts.filter(text => text.length > 0 && answer.includes(text))
      const gone = texts.filter(text => !kept.includes(text))
      const tools = await read($, turnTools)

      await update($, summaries, list => capped([...list, ...kept, ...(answer ? [answer] : [])]))
      await update($, hiddenTexts, list => capped([...list, ...gone]))
      await update($, hiddenTools, list => capped([...list, ...tools]))

      // The list stays, finished, until the next prompt: an answered turn
      // finished the step it was on (the summary, as a rule).
      const at = await $.clock.now()
      if (!e.isAborted) {
        await update($, steps, list =>
          list.map(step => (step.status === 'in_progress' ? { ...step, status: 'completed' as const } : step)),
        )
      }
      await keepInHistory($, e.turnId, e.isAborted, answer)
      await update($, clock, () => at)
      await update($, finish, () => ({ at, isAborted: e.isAborted }))
      await update($, isWorking, () => false)
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    stopTicking()

    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!isTextHidden || !(await read($, isOn)) || !(await isHidden($, e.props.text))) return next(e)

    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await read($, isOn)) || e.props.isExpanded) return next(e)
    const hide =
      e.props.tool === PLAN_TOOL ||
      (isTextHidden &&
        ((await read($, isWorking)) || (await read($, hiddenTools)).includes(e.props.tool_use_id)))
    if (!hide) return next(e)

    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!(await read($, isOn)) || e.props.isExpanded) return next(e)
    const hide =
      e.props.tool === PLAN_TOOL ||
      (isTextHidden &&
        ((await read($, isWorking)) || (await read($, hiddenTools)).includes(e.props.tool_use_id)))
    if (!hide) return next(e)

    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!(await read($, isOn)) || e.props.isExpanded) return next(e)
    const hidden = await read($, hiddenTools)
    const isWork = isTextHidden && (await read($, isWorking))
    const hide =
      isWork ||
      e.props.calls.every(
        call =>
          call.tool === PLAN_TOOL ||
          (isTextHidden && call.tool_use_id !== undefined && hidden.includes(call.tool_use_id)),
      )
    if (!hide) return next(e)

    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  // A click on a step or a task opens it; it must not leave the row lit. The engine marks
  // the row a click lands on until Esc, so the ring is kept off this mod's rows.
  on('ui.focus', async ($, e, next) => {
    if (e.origin.kind === 'person' && e.plugin === NAME && /^(step|task|setting|helper):/.test(e.element ?? '')) return {}

    return next(e)
  })

  // The live plan, above the prompt, while Claude works; still, once it is done.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isOn))) return next(e)
    const ended = await read($, finish)
    const working = await read($, isWorking)
    if (!working && (ended === null || !keepsFinished)) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const at = await read($, clock)
    const list = await read($, steps)
    const everything = await read($, activity)
    const recent = everything.filter(action => action.helper === undefined)
    const opened = await read($, openStep)
    const openedHelper = await read($, openHelper)
    const turnId = await read($, turnNow)
    const team = hasHelpers ? (await read($, helpers)).filter(helper => helper.turn === turnId) : []
    const used = hasSkillsLine ? await read($, skills) : []
    const skillRows = used.length > 0 ? 2 : 0
    const pictures = hasImagesRow ? await read($, images) : []
    const Picture = e.surface === 'terminal' ? $.ui.resolve(e).Image : undefined
    const imageRows = pictures.length > 0 && Picture ? THUMB_ROWS + 1 : 0
    const frame = Math.floor(at / TICK)
    const spin = SPINNER[frame % SPINNER.length]
    const width = Math.max(20, e.props.bodyColumns - 8)

    // A failure's reason takes the room its action's name leaves on the line.
    const reasonRoom = (title: string) => Math.max(12, width - Math.min(title.length, width / 2) - 8)
    const actionsOf = (title: string) => recent.filter(action => action.step === title)
    const failuresOf = (title: string) => actionsOf(title).filter(action => action.failed)

    // The helpers a step started (by title); undefined: those started before any plan.
    const stepHelpers = (title: string | undefined) => team.filter(helper => !helper.parent && helper.step === title)

    // A step's row is a button: a press opens its actions under it, another closes them.
    const stepButton = (step: Step, children: RenderChildren[], isDim: boolean) => {
      const hasActions = actionsOf(step.title).length > 0 || stepHelpers(step.title).length > 0
      const mark = !hasActions ? '  ' : opened === step.title ? '▾ ' : '▸ '

      return (
        <Button
          key={`step:${step.id}`}
          plain
          dimColor={isDim}
          onPress={() => update($, openStep, current => (current === step.title ? null : step.title))}
        >
          {mark}
          {children}
        </Button>
      )
    }

    // Actions, each with how it went and how long it took; the newest kept.
    const actionLines = (actions: Activity[], pad: string) => {
      const shown = actions.slice(-OPEN_ACTIONS)
      const earlier = actions.length - shown.length
      const room = Math.max(12, width - pad.length - 8)

      return [
        ...(earlier > 0 ? [<Text dimColor>{`${pad}  … ${plural(earlier, 'earlier action', 'earlier actions')}`}</Text>] : []),
        ...shown.map(action =>
          action.failed ? (
            <Text>
              {pad}
              <Text color="error">✗ {short(action.title, room)}</Text>
              <Text dimColor> {action.endAt ? since(action.at, action.endAt) : ''}</Text>
            </Text>
          ) : action.endAt ? (
            <Text dimColor>
              {pad}
              <Text color="success">✓</Text> {short(action.title, room)} {since(action.at, action.endAt)}
            </Text>
          ) : (
            <Text>
              {pad}
              <Text color="claude">{spin}</Text> {short(action.title, room)}
              <Text dimColor> {since(action.at, at)}</Text>
            </Text>
          ),
        ),
      ]
    }

    // The opened step's actions.
    const openedActions = (step: Step) => (opened === step.title ? actionLines(actionsOf(step.title), '    ') : [])

    // A helper's row: what it is (⚇ a subagent, ▶ a background command), how it stands and
    // for how long; a running one says what it does now. A press opens its actions; the
    // helpers it started stand one level in, deeper ones counted.
    const helperBlock = (helper: Helper, depth: number): RenderChildren[] => {
      const pad = `    ${'    '.repeat(depth)}`
      const isRunning = helper.status === 'running'
      const isOpen = openedHelper === helper.id
      const started = team.filter(one => one.parent === helper.id)
      const state =
        helper.status === 'running' ? (
          <Text color="claude">{spin}</Text>
        ) : helper.status === 'done' ? (
          <Text color="success">✓</Text>
        ) : helper.status === 'failed' ? (
          <Text color="error">✗</Text>
        ) : (
          <Text color="warning">■</Text>
        )
      const time = `${isRunning && !working ? 'still running · ' : ''}${since(helper.at, helper.endAt ?? at)}`
      const jobRoom = Math.max(10, width - pad.length - helper.name.length - time.length - 12)

      return [
        <Button
          key={`helper:${helper.id}`}
          plain
          dimColor={!isRunning}
          onPress={() => update($, openHelper, current => (current === helper.id ? null : helper.id))}
        >
          {pad}
          <Text dimColor>{helper.kind === 'agent' ? '⚇' : '▶'}</Text>
          {' '}
          {state}
          {' '}
          <Text bold={isRunning}>{short(helper.name, 28)}</Text>
          {helper.job ? <Text dimColor>{` · ${short(helper.job, jobRoom)}`}</Text> : ''}
          <Text dimColor>{` · ${time}`}</Text>
          {depth >= 1 && started.length > 0 ? <Text dimColor>{` · ${plural(started.length, 'helper', 'helpers')}`}</Text> : ''}
        </Button>,
        ...(isOpen
          ? actionLines(everything.filter(action => action.helper === helper.id), `${pad}    `)
          : isRunning && helper.now
            ? [<Text dimColor>{`${pad}    └ ${short(helper.now, Math.max(10, width - pad.length - 6))}`}</Text>]
            : []),
        ...(depth < 1 ? started.flatMap(one => helperBlock(one, depth + 1)) : []),
      ]
    }

    // A step's helpers: all of them on the step Claude is on (or one opened); elsewhere the
    // running ones, the rest folded into a count on the step's row.
    const isWhole = (step: Step) => (working && step.status === 'in_progress') || opened === step.title
    const helperRows = (step: Step) =>
      stepHelpers(step.title)
        .filter(helper => isWhole(step) || helper.status === 'running')
        .flatMap(helper => helperBlock(helper, 0))
    const foldedHelpers = (step: Step) => {
      if (isWhole(step)) return ''
      const folded = stepHelpers(step.title).filter(helper => helper.status !== 'running').length
      return folded > 0 ? <Text dimColor>{` · ${plural(folded, 'helper', 'helpers')}`}</Text> : ''
    }
    const looseHelpers = stepHelpers(undefined).flatMap(helper => helperBlock(helper, 0))

    const openedRows = (() => {
      const stepRows = opened === null ? 0 : Math.min(actionsOf(opened).length, OPEN_ACTIONS + 1)
      const helperRowsNow = list.reduce((sum, step) => sum + helperRows(step).length, 0) + looseHelpers.length
      return stepRows + helperRowsNow
    })()

    // The task's pictures as thumbnails, the newest that fit; the rest counted.
    const imageLine = (isLive: boolean) => {
      if (imageRows === 0 || !Picture) return []
      const room = Math.max(10, e.props.bodyColumns - 22)
      const shown: Thumb[] = []
      let used = 0
      for (const picture of [...pictures].reverse()) {
        if (shown.length > 0 && used + picture.columns + 1 > room) break
        shown.unshift(picture)
        used += picture.columns + 1
      }
      const earlier = pictures.length - shown.length

      return [
        <Text> </Text>,
        <Box flexDirection="row">
          <Text>
            {'  '}
            <Text color="claude">▣</Text> <Text bold={isLive} dimColor={!isLive}>Images</Text>
            {'  '}
          </Text>
          {shown.flatMap((picture, index) => [
            ...(index > 0 ? [<Text> </Text>] : []),
            <Picture
              key={picture.id}
              source={picture.file ? { file: picture.file, format: 'png' } : { png: picture.png ?? '' }}
              columns={picture.columns}
              rows={THUMB_ROWS}
              alt={`[${short(picture.name, Math.max(3, picture.columns - 2))}]`}
            />,
          ])}
          {earlier > 0 ? <Text dimColor> +{earlier} earlier</Text> : ''}
        </Box>,
      ]
    }

    // While working the newest skill twinkles; once done the line is still.
    const skillLine = (label: string, isLive: boolean) => {
      if (used.length === 0) return []
      const { shown, more } = fitSkills(used, Math.max(20, e.props.bodyColumns - label.length - 6))
      const newest = used[used.length - 1]
      const mark = isLive ? TWINKLE[Math.floor(at / TICK / 2) % TWINKLE.length] : '✦'

      return [
        <Text> </Text>,
        <Text>
          {'  '}
          <Text color="claude">{mark}</Text> <Text bold={isLive} dimColor={!isLive}>{label}</Text>
          {'  '}
          {shown.flatMap((name, index) => [
            ...(index > 0 ? [<Text dimColor> · </Text>] : []),
            isLive && name === newest ? <Text color="claude">{name}</Text> : <Text dimColor>{name}</Text>,
          ])}
          {more > 0 ? <Text dimColor> +{more} more</Text> : ''}
        </Text>,
      ]
    }

    if (!working && ended !== null) {
      const room = Math.max(2, e.props.maxRows - 1 - skillRows - imageRows - openedRows)
      const rows: Step[] =
        list.length > 0
          ? list
          : recent.map(action => ({ id: `did:${action.id}`, title: action.title, status: 'completed' }))
      const done = rows.filter(step => step.status === 'completed').length
      const hidden = Math.max(0, rows.length - room)
      const shown = rows.slice(hidden)
      const failedTries = (step: Step) => {
        const count = list.length > 0 ? failuresOf(step.title).length : 0
        return count > 0 ? <Text color="error"> · {plural(count, 'failed try', 'failed tries')}</Text> : ''
      }

      return (
        <Box flexDirection="column">
          <Text>
            <Text color={ended.isAborted ? 'warning' : 'success'}>{ended.isAborted ? '■' : '✓'} </Text>
            <Text bold>{ended.isAborted ? 'Stopped' : 'Done'}</Text>
            <Text dimColor>
              {list.length > 0 ? ` · ${done} of ${rows.length} done` : ''} · {since(await read($, turnSince), ended.at)}
            </Text>
          </Text>
          {hidden > 0 && <Text dimColor>  … {hidden} more above</Text>}
          {shown.flatMap(step => [
            step.status === 'completed'
              ? stepButton(step, [<Text color="success">✓</Text>, ` ${short(step.title, width)}`, failedTries(step), foldedHelpers(step)], true)
              : step.status === 'in_progress'
                ? stepButton(step, [<Text color="warning">■</Text>, ` ${short(step.title, width)}`, failedTries(step), foldedHelpers(step)], true)
                : stepButton(step, [`○ ${short(step.title, width)}`, foldedHelpers(step)], true),
            ...openedActions(step),
            ...(list.length > 0 ? helperRows(step) : []),
          ])}
          {looseHelpers}
          {skillLine('Used', false)}
          {imageLine(false)}
        </Box>
      )
    }

    const flashes = await read($, doneAt)
    const turnStart = await read($, turnSince)
    const stepStart = await read($, stepSince)
    const room = Math.max(3, e.props.maxRows - 1 - skillRows - imageRows - openedRows)
    const now = recent[recent.length - 1]
    const nowLine = now ? (
      <Text dimColor>
        {'    └ '}
        {short(now.title, width - 4)}
      </Text>
    ) : null

    // No plan yet: the actions taken so far are the list, a failed one marked.
    if (list.length === 0) {
      const done = recent.slice(Math.max(0, recent.length - room + 1), -1)
      const bar = sweep(frame)

      return (
        <Box flexDirection="column">
          <Text>
            <Text color="claude">{spin} </Text>
            <Text bold>Working</Text>
            <Text dimColor>{'  '}{'─'.repeat(bar.before)}</Text>
            <Text color="claude">{'━'.repeat(bar.run)}</Text>
            <Text dimColor>{'─'.repeat(bar.after)}  {since(turnStart, at)}</Text>
          </Text>
          {done.map(action =>
            action.failed ? (
              <Text>
                {'  '}
                <Text color="error">✗ {short(action.title, width / 2)}</Text>
                <Text dimColor> — {short(action.failed, reasonRoom(action.title))}</Text>
              </Text>
            ) : (
              <Text dimColor>
                {'  '}
                <Text color="success">✓</Text> {short(action.title, width)}
              </Text>
            ),
          )}
          {now ? (
            <Text>
              {'  '}
              <Text color="claude">{spin}</Text> <Text bold>{short(now.title, width - 8)}</Text>
              <Text dimColor> · {since(now.at, at)}</Text>
            </Text>
          ) : (
            <Text dimColor>
              {'  '}
              <Text color="claude">{spin}</Text> Making a plan{DOTS[Math.floor(frame / 3) % DOTS.length]}
            </Text>
          )}
          {looseHelpers}
          {skillLine('Skills', true)}
          {imageLine(true)}
        </Box>
      )
    }

    const done = list.filter(step => step.status === 'completed').length
    const currentAt = list.findIndex(step => step.status === 'in_progress')
    const current = list[currentAt]
    const nextAt = list.findIndex(
      (step, index) => step.status === 'pending' && index > Math.max(currentAt, -1),
    )
    const filled = Math.round((done / list.length) * BAR)
    const pulse = filled < BAR ? PULSE[frame % PULSE.length] : ''
    const empty = BAR - filled - (pulse ? 1 : 0)

    // The current step's newest failure stands under it, in red, until the step ends.
    const lastFailure = current ? failuresOf(current.title).at(-1) : undefined
    const failureLine = lastFailure ? (
      <Text>
        {'    '}
        <Text color="error">✗ {short(lastFailure.title, width / 2)}</Text>
        <Text dimColor> — {short(lastFailure.failed ?? '', reasonRoom(lastFailure.title))}</Text>
      </Text>
    ) : null

    // Keep the current and the next step in view; the done ones give way first.
    const fixedRows = 1 + (now && currentAt >= 0 ? 1 : 0) + (failureLine ? 1 : 0)
    const stepRoom = Math.max(2, room - fixedRows)
    const focus = currentAt >= 0 ? currentAt : Math.max(0, nextAt)
    const start = Math.max(0, Math.min(focus - 1, list.length - stepRoom))
    const shown = list.slice(start, start + stepRoom)

    return (
      <Box flexDirection="column">
        <Text>
          <Text color="claude">{done === list.length ? '✓' : spin} </Text>
          <Text bold>{done === list.length ? 'Wrapping up' : 'Working'}</Text>
          <Text dimColor>
            {' '}
            · {done} of {list.length} done{'  '}
          </Text>
          <Text color="claude">{'━'.repeat(filled)}</Text>
          <Text color="claude">{pulse}</Text>
          <Text dimColor>{'─'.repeat(Math.max(0, empty))}</Text>
          <Text dimColor>  {since(turnStart, at)}</Text>
        </Text>
        {start > 0 && <Text dimColor>  … {start} done above</Text>}
        {shown.flatMap(step => {
          const index = list.indexOf(step)
          const failures = failuresOf(step.title).length
          if (step.status === 'completed') {
            const isFresh = at - (flashes[step.id] ?? 0) < FLASH
            return [
              stepButton(
                step,
                [
                  <Text color="success">✓</Text>,
                  ' ',
                  isFresh ? <Text bold>{short(step.title, width)}</Text> : short(step.title, width),
                  failures > 0 ? <Text color="error"> · {plural(failures, 'failed try', 'failed tries')}</Text> : '',
                  foldedHelpers(step),
                ],
                !isFresh,
              ),
              ...openedActions(step),
              ...helperRows(step),
            ]
          }
          if (step.status === 'in_progress') {
            return [
              stepButton(
                step,
                [
                  <Text color="claude">{spin}</Text>,
                  ' ',
                  <Text bold>{short(step.title, width - 8)}</Text>,
                  <Text dimColor> · {since(stepStart, at)}</Text>,
                  failures > 0 ? <Text color="error"> · ✗ {failures} failed</Text> : '',
                ],
                false,
              ),
              ...(opened === step.title ? openedActions(step) : [...(failureLine ? [failureLine] : []), ...(nowLine ? [nowLine] : [])]),
              ...helperRows(step),
            ]
          }
          if (index === nextAt) {
            return [
              <Text>
                {'  '}
                <Text color="suggestion">→ Next:</Text> {short(step.title, width - 8)}
              </Text>,
            ]
          }
          return [<Text dimColor>  ○ {short(step.title, width)}</Text>, ...helperRows(step)]
        })}
        {looseHelpers}
        {skillLine('Skills', true)}
        {imageLine(true)}
      </Box>
    )
  })

  // The settings panel: the mod's four switches, a press flips one (the mod reloads with it).
  on('ui.render', { component: 'Pane', requestId: SETTINGS_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const rows = (await $.config.list()).filter(row => row.key.startsWith(`${NAME}.`))

    if (rows.length === 0) {
      return (
        <Box flexDirection="column">
          <Text>Claude Code does not list this mod's switches here.</Text>
          <Text dimColor>Set them in ~/.claude/settings.json:</Text>
          <Text dimColor>{`  "pluginConfigs": { "${NAME}@inline": { "options": { "skillsLine": false } } }`}</Text>
          <Text dimColor>The switches: hideText, skillsLine, imagesRow, helpers, keepFinished (all on by default).</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text dimColor>Click a switch to turn it on or off.</Text>
        <Text> </Text>
        {rows.flatMap(row => {
          const isOnNow = row.value !== false
          return [
            <Button
              key={`setting:${row.key}`}
              plain
              onPress={() => $.config.set({ key: row.key, value: !isOnNow })}
            >
              <Text color={isOnNow ? 'success' : undefined} dimColor={!isOnNow}>{isOnNow ? '● on ' : '○ off'}</Text>
              {`  ${row.label}`}
            </Button>,
            ...(row.description ? [<Text dimColor>{`        ${row.description}`}</Text>] : []),
            <Text> </Text>,
          ]
        })}
        <Text dimColor>The same switches are in /config, under bottom-line.</Text>
      </Box>
    )
  })

  // The history panel: past tasks newest first, one line each; a press opens one in place.
  on('ui.render', { component: 'Pane', requestId: HISTORY_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const stored = await $.store.get('history')
    const history = Array.isArray(stored) ? (stored as HistoryEntry[]) : []
    const opened = await read($, openHistory)
    const width = Math.max(30, e.props.bodyColumns)
    const titleRoom = Math.max(12, width - 30)

    if (history.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No tasks yet. Each task Claude finishes is kept here.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text dimColor>{plural(history.length, 'task', 'tasks')}, newest first</Text>
        <Text> </Text>
        {history.flatMap(entry => {
          const isOpen = opened === entry.id
          const doneSteps = entry.steps.filter(step => step.status === 'completed').length
          const row = (
            <Button
              key={`task:${entry.id}`}
              plain
              onPress={() => update($, openHistory, current => (current === entry.id ? null : entry.id))}
            >
              {isOpen ? '▾ ' : '▸ '}
              <Text color={entry.isAborted ? 'warning' : 'success'}>{entry.isAborted ? '■' : '✓'}</Text>
              {` ${clockTime(entry.at)}  `}
              <Text dimColor>{since(0, entry.seconds * 1000).padStart(6)}</Text>
              {`  ${short(entry.title, titleRoom)}`}
              <Text dimColor>{`  ${plural(entry.steps.length, 'step', 'steps')}`}</Text>
            </Button>
          )
          if (!isOpen) return [row]

          const extras = [
            ...(entry.skills.length > 0 ? [`✦ ${entry.skills.join(' · ')}`] : []),
            ...(entry.images > 0 ? [`▣ ${plural(entry.images, 'picture', 'pictures')}`] : []),
          ]

          return [
            row,
            ...entry.steps.flatMap(step => [
              <Text dimColor={step.status === 'completed'}>
                {'    '}
                {step.status === 'completed' ? (
                  <Text color="success">✓</Text>
                ) : step.status === 'in_progress' ? (
                  <Text color="warning">■</Text>
                ) : (
                  '○'
                )}{' '}
                {short(step.title, width - 8)}
                {step.failures > 0 ? <Text color="error"> · {plural(step.failures, 'failed try', 'failed tries')}</Text> : ''}
              </Text>,
              ...(step.helpers ?? []).map(helper => (
                <Text dimColor>
                  {'        '}
                  {helper.kind === 'agent' ? '⚇ ' : '▶ '}
                  {helper.status === 'done' ? (
                    <Text color="success">✓</Text>
                  ) : helper.status === 'failed' ? (
                    <Text color="error">✗</Text>
                  ) : helper.status === 'stopped' ? (
                    <Text color="warning">■</Text>
                  ) : (
                    '…'
                  )}
                  {` ${short(helper.name, 28)}${helper.job ? ` · ${short(helper.job, Math.max(10, width - 50))}` : ''} · ${
                    helper.status === 'running' ? 'still running' : since(0, helper.seconds * 1000)
                  }`}
                </Text>
              )),
            ]),
            <Text dimColor>{`    ${doneSteps} of ${entry.steps.length} done${extras.length > 0 ? `   ${extras.join('   ')}` : ''}`}</Text>,
            ...(entry.summary ? [<Text italic>{`    “${short(entry.summary, width - 8)}”`}</Text>] : []),
            <Text> </Text>,
          ]
        })}
      </Box>
    )
  })
}
