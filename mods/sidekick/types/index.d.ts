export type Line = { id: number; text: string; isNote: boolean }

declare module 'claude-code' {
  interface PluginState {
    sidekick: { lines: Line[]; isThinking: boolean }
  }
}
