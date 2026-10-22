export type StepStatus = 'pending' | 'in_progress' | 'completed'
export type Step = { id: string; title: string; status: StepStatus }
// One thing Claude did: its tool call, the step it was on (by title), when, and how it went.
export type Activity = {
  id: string
  title: string
  at: number
  step?: string
  endAt?: number
  failed?: string
}
export type Finish = { at: number; isAborted: boolean }
// A thumbnail: a small PNG file the Mac made, or, where it could not, the PNG's own bytes.
export type Thumb = { id: string; name: string; columns: number; file?: string; png?: string }
// One finished task, as the history panel lists it.
export type HistoryStep = { title: string; status: StepStatus; failures: number }
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
      doneAt: Record<string, number>
      finish: Finish | null
      openStep: string | null
      openHistory: string | null
      skills: string[]
      pendingSkills: string[]
      images: Thumb[]
      pendingImages: Thumb[]
      turnTexts: string[]
      turnTools: string[]
      summaries: string[]
      hiddenTexts: string[]
      hiddenTools: string[]
    }
  }
}
