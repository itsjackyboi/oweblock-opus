import { expect, mock, test } from 'claude-code/testing'

const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

test('narrates a tool call through a small model', async ($, on) => {
  mock.clock(on, { now: 100000 })
  let heard: (text: string) => void = () => {}
  const asked = new Promise<string>(resolve => {
    heard = resolve
  })

  on('tool.call', () => ({ result: 'ok', text: 'ok' }) as never)
  on('model.complete', (_$, e) => {
    heard(`${e.model}|${e.prompt}`)

    return { value: { isAnswered: true, text: 'Reading a file.', usage } } as never
  })

  await $.tool.call({ tool: 'Read', file_path: '/a/b.ts' } as never)
  const request = await asked
  for (let i = 0; i < 500; i++) {
    await Promise.resolve() // let the narration finish writing its line
  }

  expect(request).toContain('haiku|')
  expect(request).toContain('Read: /a/b.ts')
})
