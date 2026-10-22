import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Activity, Step, StepStatus, Thumb } from '../types'

const NAME = 'focus-list'
const PLAN_TOOL = 'mcp__focus-list__plan'
const PLAN_MATCH = /^mcp__focus-list__plan$/
const KEEP = 1000
const TICK = 120
const FLASH = 1500

const isOn = atom({ plugin: 'focus-list', key: 'isOn' } as const, true)
const isWorking = atom({ plugin: 'focus-list', key: 'isWorking' } as const, false)
const steps = atom({ plugin: 'focus-list', key: 'steps' } as const, [])
const activity = atom({ plugin: 'focus-list', key: 'activity' } as const, [])
const clock = atom({ plugin: 'focus-list', key: 'clock' } as const, 0)
const turnSince = atom({ plugin: 'focus-list', key: 'turnSince' } as const, 0)
const stepSince = atom({ plugin: 'focus-list', key: 'stepSince' } as const, 0)
const doneAt = atom({ plugin: 'focus-list', key: 'doneAt' } as const, {})
const finish = atom({ plugin: 'focus-list', key: 'finish' } as const, null)
const skills = atom({ plugin: 'focus-list', key: 'skills' } as const, [])
const pendingSkills = atom({ plugin: 'focus-list', key: 'pendingSkills' } as const, [])
const images = atom({ plugin: 'focus-list', key: 'images' } as const, [])
const pendingImages = atom({ plugin: 'focus-list', key: 'pendingImages' } as const, [])
const turnTexts = atom({ plugin: 'focus-list', key: 'turnTexts' } as const, [])
const turnTools = atom({ plugin: 'focus-list', key: 'turnTools' } as const, [])
const summaries = atom({ plugin: 'focus-list', key: 'summaries' } as const, [])
const hiddenTexts = atom({ plugin: 'focus-list', key: 'hiddenTexts' } as const, [])
const hiddenTools = atom({ plugin: 'focus-list', key: 'hiddenTools' } as const, [])

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const PULSE = ['╸', '━', '╸', ' ']
const BAR = 18
const DOTS = ['', '.', '..', '...']
const TWINKLE = ['✦', '✦', '✧', '✧']

const THUMB_ROWS = 4
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|heic|tiff?|bmp)$/i

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
    'd="$HOME/Library/Caches/focus-list"; mkdir -p "$d" && find "$d" -type f -mtime +1 -delete',
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

const PLAN = [
  '# Focus list',
  'While you work, the person does not see your text or your tool calls. They see only your plan, live, and when you finish, only your final message.',
  `- For every prompt, even a question or a one-step task, your very first action is to call ${PLAN_TOOL} with every step, in plain words, the first one in_progress (a question is two steps at least: finding the answer, then writing it). Call it again each time a step finishes or the next one starts, always with the whole list and exactly one step in_progress until all are done. Change the plan when you learn more.`,
  '- Your final message is the only text the person reads. Make it a complete, short summary: what you did, what you found, and anything they must do or decide.',
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const stored = await $.store.get('isOn')
    await update($, isOn, () => stored !== false)
    await $.command.register({
      name: NAME,
      description: 'Turn the focus list on or off (hide Claude’s work, show a live plan and the summary)',
    })
    await $.tool.register(PLAN_SPEC)
    if (await read($, isWorking)) startTicking($)

    return next(e)
  })

  on('command.run', { command: NAME }, async $ => {
    const turnOn = !(await read($, isOn))
    await update($, isOn, () => turnOn)
    await $.store.set('isOn', turnOn)

    return {
      text: turnOn
        ? 'Focus list is on. While Claude works you see a live plan; when it finishes, only the summary.'
        : 'Focus list is off. Claude’s work shows as usual.',
    }
  }).catch(() => ({ text: 'Focus list could not change. Try again.' }))

  // Ask Claude to keep its plan up to date and to end with a full summary.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, isOn))) return composed

    return {
      sections: [...composed.sections, { id: `${NAME}:plan`, text: PLAN, scope: 'session' }],
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

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && (await read($, isOn))) {
      const at = await $.clock.now()
      await update($, steps, () => [])
      await update($, activity, () => [])
      await update($, doneAt, () => ({}))
      await update($, finish, () => null)
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

    // Pictures you give and pictures Claude's tools bring back: thumbnails for the list.
    // One given before its turn starts is held for that turn, as a typed skill is.
    if (e.door === 'prompt' || e.door === 'tool-result') {
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
    if (e.agentId !== undefined || !(await read($, isWorking))) return next(e)

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
    if (!['TodoWrite', 'TaskUpdate', 'TaskCreate', 'TaskList', 'TaskGet', PLAN_TOOL].includes(e.tool)) {
      const doing: Activity = { title: describe(e.tool, input), at: await $.clock.now() }
      await update($, activity, list => [...list, doing].slice(-50))
    }

    const ran = await next(e)

    if (e.tool === 'TaskCreate' && ran.deny === undefined && !ran.isError) {
      const task = (ran.result as { task?: { id?: string; subject?: string } } | undefined)?.task
      if (task?.id) {
        const step: Step = { id: task.id, title: task.subject ?? String(input.subject ?? ''), status: 'pending' }
        await update($, steps, list => [...list, step])
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  // The turn is over: hide what it wrote, keep only its final message.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && (await read($, isWorking))) {
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
    if (!(await read($, isOn)) || !(await isHidden($, e.props.text))) return next(e)

    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await read($, isOn)) || e.props.isExpanded) return next(e)
    const hide =
      e.props.tool === PLAN_TOOL ||
      (await read($, isWorking)) ||
      (await read($, hiddenTools)).includes(e.props.tool_use_id)
    if (!hide) return next(e)

    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!(await read($, isOn)) || e.props.isExpanded) return next(e)
    const hide =
      e.props.tool === PLAN_TOOL ||
      (await read($, isWorking)) ||
      (await read($, hiddenTools)).includes(e.props.tool_use_id)
    if (!hide) return next(e)

    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!(await read($, isOn)) || e.props.isExpanded) return next(e)
    const hidden = await read($, hiddenTools)
    const hide =
      (await read($, isWorking)) ||
      e.props.calls.every(
        call => call.tool === PLAN_TOOL || (call.tool_use_id !== undefined && hidden.includes(call.tool_use_id)),
      )
    if (!hide) return next(e)

    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  // The live plan, above the prompt, while Claude works; still, once it is done.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isOn))) return next(e)
    const ended = await read($, finish)
    if (!(await read($, isWorking)) && ended === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const at = await read($, clock)
    const list = await read($, steps)
    const recent = await read($, activity)
    const used = await read($, skills)
    const skillRows = used.length > 0 ? 2 : 0
    const pictures = await read($, images)
    const Picture = e.surface === 'terminal' ? $.ui.resolve(e).Image : undefined
    const imageRows = pictures.length > 0 && Picture ? THUMB_ROWS + 1 : 0

    // The task's pictures as thumbnails, the newest that fit; the rest counted.
    const imageLine = (isLive: boolean) => {
      if (imageRows === 0 || !Picture) return []
      const room = Math.max(10, e.props.bodyColumns - 22)
      const shown: Thumb[] = []
      let width = 0
      for (const picture of [...pictures].reverse()) {
        if (shown.length > 0 && width + picture.columns + 1 > room) break
        shown.unshift(picture)
        width += picture.columns + 1
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

    if (ended !== null) {
      const width = Math.max(20, e.props.bodyColumns - 6)
      const room = Math.max(2, e.props.maxRows - 1 - skillRows - imageRows)
      const rows: Step[] =
        list.length > 0
          ? list
          : recent.map((step, index) => ({ id: `did:${index}`, title: step.title, status: 'completed' }))
      const done = rows.filter(step => step.status === 'completed').length
      const hidden = Math.max(0, rows.length - room)
      const shown = rows.slice(hidden)

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
          {shown.map(step =>
            step.status === 'completed' ? (
              <Text dimColor>
                {'  '}
                <Text color="success">✓</Text> {short(step.title, width)}
              </Text>
            ) : step.status === 'in_progress' ? (
              <Text dimColor>
                {'  '}
                <Text color="warning">■</Text> {short(step.title, width)}
              </Text>
            ) : (
              <Text dimColor>  ○ {short(step.title, width)}</Text>
            ),
          )}
          {skillLine('Used', false)}
          {imageLine(false)}
        </Box>
      )
    }
    const flashes = await read($, doneAt)
    const turnStart = await read($, turnSince)
    const stepStart = await read($, stepSince)
    const frame = Math.floor(at / TICK)
    const spin = SPINNER[frame % SPINNER.length]
    const width = Math.max(20, e.props.bodyColumns - 8)
    const room = Math.max(3, e.props.maxRows - 1 - skillRows - imageRows)
    const now = recent[recent.length - 1]
    const nowLine = now ? (
      <Text dimColor>
        {'    └ '}
        {short(now.title, width - 4)}
      </Text>
    ) : null

    // No plan yet: the steps taken so far are the list.
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
          {done.map(step => (
            <Text dimColor>
              {'  '}
              <Text color="success">✓</Text> {short(step.title, width)}
            </Text>
          ))}
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
          {skillLine('Skills', true)}
          {imageLine(true)}
        </Box>
      )
    }

    const done = list.filter(step => step.status === 'completed').length
    const currentAt = list.findIndex(step => step.status === 'in_progress')
    const nextAt = list.findIndex(
      (step, index) => step.status === 'pending' && index > Math.max(currentAt, -1),
    )
    const filled = Math.round((done / list.length) * BAR)
    const pulse = filled < BAR ? PULSE[frame % PULSE.length] : ''
    const empty = BAR - filled - (pulse ? 1 : 0)

    // Keep the current and the next step in view; the done ones give way first.
    const fixedRows = 1 + (now && currentAt >= 0 ? 1 : 0)
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
          if (step.status === 'completed') {
            const isFresh = at - (flashes[step.id] ?? 0) < FLASH
            return [
              <Text dimColor={!isFresh}>
                {'  '}
                <Text color="success">✓</Text> {isFresh ? <Text bold>{short(step.title, width)}</Text> : short(step.title, width)}
              </Text>,
            ]
          }
          if (step.status === 'in_progress') {
            return [
              <Text>
                {'  '}
                <Text color="claude">{spin}</Text> <Text bold>{short(step.title, width - 8)}</Text>
                <Text dimColor> · {since(stepStart, at)}</Text>
              </Text>,
              ...(nowLine ? [nowLine] : []),
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
          return [<Text dimColor>  ○ {short(step.title, width)}</Text>]
        })}
        {skillLine('Skills', true)}
        {imageLine(true)}
      </Box>
    )
  })
}
