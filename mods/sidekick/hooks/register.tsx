import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Line } from '../types'

const PANE = 'sidekick'
const MODEL = 'haiku'
const MIN_GAP_MS = 2500
const MAX_LINES = 60

const lines = atom({ plugin: 'sidekick', key: 'lines' } as const, [] as Line[])
const isThinking = atom({ plugin: 'sidekick', key: 'isThinking' } as const, false)

const SYSTEM = [
  'You are a tiny sidekick narrating what a coding assistant is doing, for someone who is not technical.',
  'You get a short list of raw events. Reply with ONE sentence, at most 12 words, plain everyday English.',
  'No jargon, no file paths, no code, no quotes, no emoji. Say what is happening and why, like "Looking through the project for the login code."',
  'If several events are similar, sum them up together. Never ask questions. Reply with the sentence only.',
].join(' ')

const clip = (value: unknown, max: number): string => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''

  return text.length > max ? `${text.slice(0, max)}...` : text
}

// What we know about a tool call, cut down to what a narrator needs.
const describeCall = (e: Record<string, unknown>): string => {
  const who = e.agentId === undefined ? '' : '(helper agent) '
  const tool = String(e.tool)
  const detail =
    clip(e.description, 100) ||
    clip(e.command, 100) ||
    clip(e.file_path, 100) ||
    clip(e.path, 100) ||
    clip(e.pattern, 80) ||
    clip(e.query, 80) ||
    clip(e.url, 100) ||
    clip(e.prompt, 100)

  return `${who}${tool}${detail === '' ? '' : `: ${detail}`}`
}

// Used when the model call fails, so the pane never goes quiet.
const fallback = (event: string): string => {
  const tool = event.replace(/^\(helper agent\) /, '').split(':')[0] ?? ''
  const table: Record<string, string> = {
    Read: 'Reading a file.',
    Edit: 'Changing a file.',
    Write: 'Writing a file.',
    Bash: 'Running a command.',
    Grep: 'Searching the code.',
    Glob: 'Looking for files.',
    WebFetch: 'Reading a web page.',
    WebSearch: 'Searching the web.',
    Agent: 'Handing work to a helper.',
    Task: 'Handing work to a helper.',
  }

  return table[tool] ?? `Using ${tool}.`
}

let nextId = 1
let logText = ''

async function trace($: any, what: string, e: any): Promise<void> {
  logText += `${what} surface=${String(e.surface)} viewport=${JSON.stringify(e.viewport ?? null)}\n`
  await $.fs.write('/tmp/sidekick-trace.log', logText)
}
let queue: string[] = []
let isBusy = false
let isOff = false
let lastAt = 0
let timer: { cancel: () => void } | null = null

async function push($: any, text: string, isNote: boolean): Promise<void> {
  const line: Line = { id: nextId++, text, isNote }
  await update($, lines, list => [...list, line].slice(-MAX_LINES))
}

async function flush($: any): Promise<void> {
  timer = null
  if (isBusy || isOff || queue.length === 0) {
    return
  }

  isBusy = true
  const batch = queue.slice(-8)
  queue = []
  await update($, isThinking, () => true)

  let text = fallback(batch[batch.length - 1] ?? '')
  let how = 'fallback'
  try {
    const recent = (await read($, lines)).filter(l => !l.isNote).slice(-3).map(l => l.text)
    const prompt =
      (recent.length > 0 ? `Already said (do not repeat): ${recent.join(' | ')}\n\n` : '') +
      `Events:\n${batch.map(b => `- ${b}`).join('\n')}`
    const r = await $.model.complete({
      model: MODEL,
      system: SYSTEM,
      prompt,
      maxTokens: 60,
      effort: 'low',
      timeoutMs: 10000,
    })
    if (r.isAnswered && r.text.trim() !== '') {
      text = clip(r.text.split('\n')[0], 140)
      how = 'haiku'
    } else if (!r.isAnswered) {
      how = `fallback(${r.reason})`
    }
  } catch {
    // keep the fallback sentence
  }

  await push($, text, false)
  $.ui.status(`Sidekick: ${text}`)
  $.ui.toast(text, { timeoutMs: 6000 })
  $.ui.log(`Sidekick: ${text}`)
  void trace($, `narrated via ${how}: ${text}`, {})
  await update($, isThinking, () => false)
  lastAt = await $.clock.now()
  isBusy = false
  if (queue.length > 0) {
    schedule($)
  }
}

function schedule(arg: any): void {
  if (timer !== null || isOff) {
    return
  }
  timer = arg.clock.after(MIN_GAP_MS, () => void flush(arg))
}

async function enqueue($: any, event: string): Promise<void> {
  if (isOff) {
    return
  }
  queue.push(event)
  if (queue.length > 30) {
    queue = queue.slice(-30)
  }
  if (isBusy) {
    return
  }
  const now = await $.clock.now()
  if (now - lastAt >= MIN_GAP_MS) {
    void flush($)
  } else {
    schedule($)
  }
}


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sidekick',
      description: 'Open the sidekick pane, or "/sidekick off" / "/sidekick on" to pause or resume it',
    })
    void $.ui.open({ id: PANE, title: 'Sidekick' })

    return next(e)
  })

  on('command.run', { command: 'sidekick' }, async ($, e) => {
    const arg = clip((e as any).args ?? (e as any).argument ?? '', 20).toLowerCase()
    if (arg === 'off') {
      isOff = true
      queue = []

      return { text: 'Sidekick paused.' }
    }
    if (arg === 'on') {
      isOff = false
    }
    const opened = await $.ui.open({ id: PANE, title: 'Sidekick' })
    void trace($, `open isPlaced=${String(opened.isPlaced)}`, {})
    const where = opened.isPlaced
      ? 'in its pane'
      : `in the line above your prompt and under it (no pane here: ${opened.reason})`

    return { text: `Sidekick is watching, showing up ${where}.` }
  })

  on('prompt.submit', async ($, e, next) => {
    const text = clip(e.text, 120)
    if (text !== '') {
      void push($, `You: ${text}`, true)
      void enqueue($, `The user asked: ${text}`)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const what = describeCall(e as unknown as Record<string, unknown>)
    void enqueue($, what)
    const ran = await next(e)
    if (ran.deny !== undefined) {
      void enqueue($, `That was blocked: ${what}`)
    } else if (ran.isError === true) {
      void enqueue($, `That hit an error: ${what}`)
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const secs = Math.round(e.durationMs / 1000)
      void enqueue(
        $,
        e.isAborted
          ? 'The user stopped the work early.'
          : `Claude finished its turn after ${secs}s and replied: ${clip(e.answer, 160)}`,
      )
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    void trace($, 'render Pane', e)
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, lines)
    const thinking = await read($, isThinking)
    const room = Math.max(2, (e.viewport?.rows ?? 12) - 3)
    const shown = list.slice(-room)

    return (
      <Box flexDirection="column">
        {shown.length === 0 && <Text dimColor>Waiting for something to happen...</Text>}
        {shown.map((line, i) => (
          <Text key={String(line.id)} dimColor={line.isNote || i < shown.length - 1}>
            {line.isNote ? '' : '> '}
            {line.text}
          </Text>
        ))}
        {thinking && <Text dimColor>...</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    void trace($, 'render AbovePrompt', e)
    const list = (await read($, lines)).filter(l => !l.isNote)
    const thinking = await read($, isThinking)
    if (isOff || e.props.hasSurvey || (list.length === 0 && !thinking)) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const last = list[list.length - 1]

    return (
      <Box>
        <Text dimColor>Sidekick: {last === undefined ? '' : last.text}{thinking ? ' ...' : ''}</Text>
      </Box>
    )
  })
}
