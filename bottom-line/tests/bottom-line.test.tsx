import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'bottom-line',
  component: 'AbovePrompt',
  requestId: 'band',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns: 70,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const reply = (requestId: string, text: string) =>
  ({
    plugin: 'bottom-line',
    component: 'AssistantMessage',
    requestId,
    surface: 'terminal',
    props: { text, isFirstOfReply: true },
  }) as const

const PLAN = 'mcp__bottom-line__plan'

test('while working: a live plan with now and next, no text; after: the summary only', async ($, on) => {
  let at = 1_000
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('clock.now', () => ({ value: at }))
  on('clock.every', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'bottom-line' } }))
  on('tool.register', () => ({ value: { tool: PLAN } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'build it', turnId: 't1' })

  // Before any plan, the steps taken are the list.
  at = 2_000
  await $.tool.call({ tool: 'Read', file_path: '/a/notes.md' })
  const early = await $.ui.mount(BAND)
  expect(await early.find({ type: 'Text', text: /Reading notes.md/ })).toBeDefined()
  // Before a plan the bar still moves: its bright run sits elsewhere a few frames on.
  const runAt = async () => (await early.findAll({ type: 'Text' })).map(t => t.text).find(t => t.startsWith('─') || t.startsWith('  ─')) ?? ''
  const first = await runAt()
  await early.unmount()
  at += 5 * 120
  const later = await $.ui.mount({ ...BAND, requestId: 'band-later' })
  expect((await later.findAll({ type: 'Text' })).some(t => t.text.includes('━━━━'))).toBe(true)
  expect((await later.findAll({ type: 'Text' })).map(t => t.text)).not.toContain(first)
  await later.unmount()

  await $.tool.call({
    tool: PLAN,
    steps: [
      { title: 'Read the code', status: 'completed' },
      { title: 'Write the fix', status: 'in_progress' },
      { title: 'Run the tests', status: 'pending' },
    ],
  } as never)
  at = 65_000
  await $.tool.call({ tool: 'Bash', command: 'swift build', description: 'Build the app' })

  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /1 of 3 done/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /Write the fix/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /└ Build the app/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /Next:/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /1m 4s/ })).toBeDefined()
  await band.unmount()

  await $.session.append({
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'Let me look first.' }] },
    door: 'response',
    origin: { kind: 'model', model: 'm' },
    uuid: 'a1',
  } as never)
  const working = await $.ui.mount(reply('a1', 'Let me look first.'))
  expect(await working.find({ type: 'Text', text: /engine/ })).toBeUndefined()
  await working.unmount()

  await $.turn.complete({
    answer: 'All done: the fix works.',
    durationMs: 5,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  })

  const old = await $.ui.mount(reply('a1', 'Let me look first.'))
  expect(await old.find({ type: 'Text', text: /engine/ })).toBeUndefined()
  const summary = await $.ui.mount(reply('a2', 'All done: the fix works.'))
  expect(await summary.find({ type: 'Text', text: /engine/ })).toBeDefined()
  // The finished list stays until the next prompt: the step it ended on is ticked, one never begun is not.
  const after = await $.ui.mount({ ...BAND, requestId: 'band2' })
  expect(await after.find({ type: 'Text', text: /Working/ })).toBeUndefined()
  expect(await after.find({ type: 'Text', text: /2 of 3 done/ })).toBeDefined()
  expect(await after.find({ type: 'Text', text: /^Done$/ })).toBeDefined()
  expect(await after.find({ type: 'Button', text: /Run the tests/ })).toBeDefined()
  await after.unmount()

  await $.turn.start({ text: 'next one', turnId: 't2' })
  const fresh = await $.ui.mount({ ...BAND, requestId: 'band3' })
  expect(await fresh.find({ type: 'Text', text: /Done/ })).toBeUndefined()
  expect(await fresh.find({ type: 'Button', text: /Run the tests/ })).toBeUndefined()
})

test('skills: a strip while working, the newest lit, each once; a still line when done; cleared by the next prompt', async ($, on) => {
  let at = 1_000
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('clock.now', () => ({ value: at }))
  on('clock.every', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'bottom-line' } }))
  on('tool.register', () => ({ value: { tool: PLAN } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const texts = async (requestId: string) => {
    const ui = await $.ui.mount({ ...BAND, requestId })
    const all = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    await ui.unmount()
    return all
  }

  // A skill typed as /name before the turn counts for that turn.
  await $.skill.prompt({ skill: 'simplify', text: 'Simplify the code.' })
  await $.turn.start({ text: '/simplify', turnId: 't1' })
  expect((await texts('b1')).some(t => t.includes('Skills'))).toBe(true)

  // Skills Claude loads itself join in order; a repeat appears once; the newest is the lit one.
  await $.tool.call({ tool: 'Skill', skill: 'code-review' } as never)
  await $.tool.call({ tool: 'Skill', skill: 'simplify' } as never)
  at += 500
  const working = await texts('b2')
  const line = working.find(t => t.includes('Skills')) ?? ''
  expect(line).toContain('simplify · code-review')
  expect(line.indexOf('simplify')).toBe(line.lastIndexOf('simplify'))

  // A subagent's skill is not this task's.
  await $.tool.call({ tool: 'Skill', skill: 'pdf', agentId: 'helper' } as never)
  expect((await texts('b3')).some(t => t.includes('pdf'))).toBe(false)

  await $.turn.complete({ answer: 'Done.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  const after = await texts('b4')
  expect(after.some(t => t.includes('Used') && t.includes('simplify · code-review'))).toBe(true)

  await $.turn.start({ text: 'next', turnId: 't2' })
  expect((await texts('b5')).some(t => t.includes('simplify'))).toBe(false)
})

test('images: your picture and the ones Claude opens show as thumbnails, still when done, cleared next prompt', async ($, on) => {
  let at = 1_000
  const made: string[] = []
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('clock.now', () => ({ value: at }))
  on('clock.every', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'bottom-line' } }))
  on('tool.register', () => ({ value: { tool: PLAN } }))
  // Stands for sips: a wide picture for the first, a square one after.
  on('process.run', (_, e) => {
    const argv = (e as { argv: string[] }).argv
    // Only the thumbnail maker stands here; the one-time copy of old saves finds nothing.
    if (!String(argv[2]).includes('sips')) {
      return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const id = String(argv[4])
    made.push(id)
    const size = made.length === 1 ? '640\t320' : '300\t300'
    return { value: { exitCode: 0, stdout: `/cache/${id}.png\t${size}`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  const picture = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }
  const images = async (requestId: string) => {
    const ui = await $.ui.mount({ ...BAND, requestId })
    const found = (await ui.findAll({ type: 'Image' } as never)) as unknown as { props?: { source?: { file?: string }; columns?: number; alt?: string } }[]
    await ui.unmount()
    return found
  }

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // Your picture, pasted with the prompt before the turn starts, is this turn's.
  await $.session.append({ message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'look' }, picture] }, door: 'prompt', origin: { kind: 'person' }, uuid: 'u1' } as never)
  await $.turn.start({ text: 'look', turnId: 't1' })

  // A picture Claude opens comes back in the tool's result.
  await $.tool.call({ tool: 'Read', file_path: '/x/dock.png', tool_use_id: 'r1' } as never)
  await $.session.append({ message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r1', content: [picture] }] }, door: 'tool-result', origin: { kind: 'tool', tool: 'Read' }, uuid: 'u2' } as never)

  const working = await images('i1')
  expect(working).toHaveLength(2)

  await $.turn.complete({ answer: 'Done.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await images('i2')).toHaveLength(2)

  await $.turn.start({ text: 'next', turnId: 't2' })
  expect(await images('i3')).toHaveLength(0)
  expect(made).toHaveLength(2)
})

test("the plan tool's own rows stay hidden after the turn, as every other tool row does", async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('clock.now', () => ({ value: 1_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'bottom-line' } }))
  on('tool.register', () => ({ value: { tool: PLAN } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: PLAN, tool_use_id: 'p1', steps: [{ title: 'Do it', status: 'in_progress' }] } as never)
  await $.turn.complete({ answer: 'Done.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })

  const row = await $.ui.mount({
    plugin: 'bottom-line',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'p1',
    props: { tool_use_id: 'p1', tool: PLAN, input: {}, isRunning: false, isErrored: false, isInterrupted: false },
  } as never)
  expect(await row.find({ type: 'Text', text: /engine/ })).toBeUndefined()
})

test('without sips (Linux, Windows) a PNG still shows as it is, sized from its header; other kinds do not', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('clock.now', () => ({ value: 1_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'bottom-line' } }))
  on('tool.register', () => ({ value: { tool: PLAN } }))
  on('process.run', () => {
    throw new Error('no /bin/sh here')
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))

  const wide = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAATklEQVR4nO3PUQkAIBTAwBfHOMY2liH8OITBAtzm7PV1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjx2ASo0AJfYQ3FsAAAAAElFTkSuQmCC'
  const block = (media: string, data: string) => ({ type: 'image', source: { type: 'base64', media_type: media, data } })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'look', turnId: 't1' })
  await $.session.append({ message: { type: 'user', role: 'user', content: [block('image/png', wide), block('image/jpeg', '/9j/4AAQSkZJRg==')] }, door: 'prompt', origin: { kind: 'person' }, uuid: 'u1' } as never)

  const ui = await $.ui.mount({ ...BAND, requestId: 'x1' })
  const found = (await ui.findAll({ type: 'Image' } as never)) as unknown as { props?: { columns?: number } }[]
  expect(found).toHaveLength(1)
})

// The engine's stand-ins most tests below share; `memory` keeps what the mod stores.
const standIns = (on: On, at: () => number, memory = new Map<string, unknown>()) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('clock.now', () => ({ value: at() }))
  on('clock.every', () => ({ value: undefined }))
  on('store.get', (_, e) => ({ value: memory.get((e as { key: string }).key) }))
  on('store.set', (_, e) => {
    memory.set((e as { key: string }).key, (e as { value: unknown }).value)
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'bottom-line' } }))
  on('tool.register', () => ({ value: { tool: PLAN } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
}

test('a failed command: a red line and a count under its step; a press opens the step; the finished list keeps the count', async ($, on) => {
  let at = 1_000
  standIns(on, () => at)
  // The test run takes three seconds and fails.
  on('tool.call', (_, e) => {
    if ((e as { tool: string }).tool !== 'Bash') return { result: {} }
    at += 3_000
    return { result: {}, isError: true, text: 'Exit code 1\nbuilding…\nExecuted 10 tests, with 2 failures' }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'fix it', turnId: 't1' })
  await $.tool.call({ tool: PLAN, steps: [{ title: 'Write the fix', status: 'completed' }, { title: 'Run the tests', status: 'in_progress' }] } as never)
  await $.tool.call({ tool: 'Bash', command: 'swift test', description: 'Run swift test', tool_use_id: 'b1' } as never)

  const band = await $.ui.mount({ ...BAND, requestId: 'f1' })
  const texts = (await band.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.some(t => t.includes('✗ 1 failed'))).toBe(true)
  expect(texts.some(t => t.includes('exit 1 · Executed 10 tests'))).toBe(true)

  // A press on the step opens its actions under it, each with how it went.
  await band.press({ key: 'step:plan:1' })
  const opened = (await band.findAll({ type: 'Text' })).map(t => t.text)
  expect(opened.some(t => t.includes('✗ Run swift test') && t.includes('3s'))).toBe(true)
  await band.press({ key: 'step:plan:1' })
  expect((await band.findAll({ type: 'Text' })).some(t => t.text.includes('✗ Run swift test 3s'))).toBe(false)
  await band.unmount()

  await $.turn.complete({ answer: 'Fixed.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  const after = await $.ui.mount({ ...BAND, requestId: 'f2' })
  expect(await after.find({ type: 'Button', text: /Run the tests · 1 failed try/ })).toBeDefined()
})

test('settings: text left on screen, no skills line, no finished list', { options: { hideText: false, skillsLine: false, keepFinished: false } }, async ($, on) => {
  standIns(on, () => 1_000)
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Skill', skill: 'simplify' } as never)

  const message = await $.ui.mount({ plugin: 'bottom-line', surface: 'terminal', component: 'AssistantMessage', requestId: 'm1', props: { text: 'Let me look.', isFirstOfReply: true } } as never)
  expect(await message.find({ type: 'Text', text: /engine/ })).toBeDefined()
  const band = await $.ui.mount({ ...BAND, requestId: 's1' })
  expect((await band.findAll({ type: 'Text' })).some(t => t.text.includes('Skills'))).toBe(false)
  expect((await band.findAll({ type: 'Text' })).some(t => t.text.includes('Working'))).toBe(true)
  await band.unmount()

  await $.turn.complete({ answer: 'Done.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  const after = await $.ui.mount({ ...BAND, requestId: 's2' })
  expect(await after.find({ type: 'Text', text: /engine/ })).toBeDefined()
})

test('history: each finished task is kept; /bottom-line history lists them, a press opens one', async ($, on) => {
  let at = 1_000
  const memory = new Map<string, unknown>()
  standIns(on, () => at, memory)
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const [turnId, prompt] of [['t1', 'Review the change'], ['t2', 'Add the images row']] as const) {
    await $.turn.start({ text: prompt, turnId })
    await $.tool.call({ tool: PLAN, steps: [{ title: 'Read it', status: 'completed' }, { title: 'Write the summary', status: 'in_progress' }] } as never)
    at += 72_000
    await $.turn.complete({ answer: `All good for ${prompt}.\nMore detail.`, durationMs: 5, isAborted: false, turnId, reason: 'answer' })
  }

  const ran = await $.command.run({ command: 'bottom-line', args: 'history' } as never)
  expect(JSON.stringify(ran)).toContain('History opened')

  const pane = await $.ui.mount({
    plugin: 'bottom-line',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'bottom-line-history',
    props: { title: 'History', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  })
  const rows = await pane.findAll({ type: 'Button' })
  expect(rows).toHaveLength(2)
  expect(rows[0]?.text).toContain('Add the images row')
  expect(rows[0]?.text).toContain('1m 12s')

  await pane.press({ key: 'task:t2' })
  const opened = (await pane.findAll({ type: 'Text' })).map(t => t.text)
  expect(opened.some(t => t.includes('Write the summary'))).toBe(true)
  expect(opened.some(t => t.includes('2 of 2 done'))).toBe(true)
  expect(opened.some(t => t.includes('“All good for Add the images row.”'))).toBe(true)
})
