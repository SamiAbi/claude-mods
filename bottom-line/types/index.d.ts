export type StepStatus = 'pending' | 'in_progress' | 'completed'
export type Step = { id: string; title: string; status: StepStatus }
// One thing Claude did: its tool call, the step it was on (by title), or the helper
// that did it (by id), when, and how it went.
export type Activity = {
  id: string
  title: string
  at: number
  step?: string
  helper?: string
  endAt?: number
  failed?: string
}
export type Finish = { at: number; isAborted: boolean }
// A thumbnail: a small PNG file the Mac made, or, where it could not, the PNG's own bytes.
export type Thumb = { id: string; name: string; columns: number; file?: string; png?: string }
// A helper: a subagent, or a shell command left running in the background. It belongs
// to the task (turn) and the step it started in, or to the helper that started it.
export type HelperStatus = 'running' | 'done' | 'failed' | 'stopped'
export type Helper = {
  id: string
  kind: 'agent' | 'shell'
  name: string
  job: string
  turn: string
  step?: string
  parent?: string
  at: number
  endAt?: number
  status: HelperStatus
  now?: string
}
// One finished task, as the history panel lists it.
export type HistoryHelper = { name: string; job: string; kind: 'agent' | 'shell'; seconds: number; status: HelperStatus }
export type HistoryStep = { title: string; status: StepStatus; failures: number; helpers?: HistoryHelper[] }
export type HistoryEntry = {
  id: string
  at: number
  seconds: number
  title: string
  isAborted: boolean
  steps: HistoryStep[]
  skills: string[]
  images: number
  summary: string
}

declare module 'claude-code' {
  interface PluginState {
    'bottom-line': {
      isOn: boolean
      isWorking: boolean
      steps: Step[]
      activity: Activity[]
      clock: number
      turnSince: number
      stepSince: number
      turnTitle: string
      turnNow: string
      doneAt: Record<string, number>
      finish: Finish | null
      openStep: string | null
      openHelper: string | null
      openHistory: string | null
      skills: string[]
      pendingSkills: string[]
      images: Thumb[]
      pendingImages: Thumb[]
      helpers: Helper[]
      turnTexts: string[]
      turnTools: string[]
      summaries: string[]
      hiddenTexts: string[]
      hiddenTools: string[]
    }
  }
}
