export type StepStatus = 'pending' | 'in_progress' | 'completed'
export type Step = { id: string; title: string; status: StepStatus }
export type Activity = { title: string; at: number }
export type Finish = { at: number; isAborted: boolean }

declare module 'claude-code' {
  interface PluginState {
    'focus-list': {
      isOn: boolean
      isWorking: boolean
      steps: Step[]
      activity: Activity[]
      clock: number
      turnSince: number
      stepSince: number
      doneAt: Record<string, number>
      finish: Finish | null
      turnTexts: string[]
      turnTools: string[]
      summaries: string[]
      hiddenTexts: string[]
      hiddenTools: string[]
    }
  }
}
