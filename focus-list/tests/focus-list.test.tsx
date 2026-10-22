import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'focus-list',
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
    plugin: 'focus-list',
    component: 'AssistantMessage',
    requestId,
    surface: 'terminal',
    props: { text, isFirstOfReply: true },
  }) as const

const PLAN = 'mcp__focus-list__plan'

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
  on('command.register', () => ({ value: { command: 'focus-list' } }))
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
  expect(await after.find({ type: 'Text', text: /Run the tests/ })).toBeDefined()
  await after.unmount()

  await $.turn.start({ text: 'next one', turnId: 't2' })
  const fresh = await $.ui.mount({ ...BAND, requestId: 'band3' })
  expect(await fresh.find({ type: 'Text', text: /Done/ })).toBeUndefined()
  expect(await fresh.find({ type: 'Text', text: /Run the tests/ })).toBeUndefined()
})
