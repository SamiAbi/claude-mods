export type StepStatus = 'pending' | 'in_progress' | 'completed'
export type Step = { id: string; title: string; status: StepStatus }
export type Activity = { title: string; at: number }
export type Finish = { at: number; isAborted: boolean }
// A thumbnail: a small PNG file the Mac made, or, where it could not, the PNG's own bytes.
export type Thumb = { id: string; name: string; columns: number; file?: string; png?: string }

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
