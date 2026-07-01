import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic() // reads ANTHROPIC_API_KEY
const MODEL = process.env.AUTHOR_MODEL || 'claude-opus-4-8'

const VOICE = `You are the writing companion inside "author", a quiet writing app.
You are a sharp, kind editor. You are concise and concrete. You never pad, never flatter,
and never use bullet-point corporate voice unless the writing calls for it.`

// Stream plain text chunks to the response.
async function streamText(res, params) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')
  try {
    const stream = client.messages.stream(params)
    stream.on('text', (t) => res.write(t))
    await stream.finalMessage()
    res.end()
  } catch (e) {
    console.error('ai stream error', e)
    if (!res.headersSent) res.status(500)
    res.end('\n\n[ai error: ' + (e?.message || 'unknown') + ']')
  }
}

export async function aiFeedback(req, res) {
  const { text, question } = req.body || {}
  if (!text || !text.trim()) return res.status(400).json({ error: 'empty draft' })
  const ask = question && question.trim()
    ? `The writer asks: "${question.trim()}"\nAnswer their question about the draft directly, quoting from it where useful.`
    : `Give feedback on this draft: what works, what drags, and the two or three highest-leverage changes. Quote short passages when pointing at something specific. End with one sentence on what the piece wants to be.`
  await streamText(res, {
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: VOICE,
    messages: [
      {
        role: 'user',
        content: `<draft>\n${text.slice(0, 150000)}\n</draft>\n\n${ask}`,
      },
    ],
  })
}

export async function aiCommand(req, res) {
  const { instruction, selection, context } = req.body || {}
  if (!instruction) return res.status(400).json({ error: 'no instruction' })
  const hasSelection = selection && selection.trim().length > 0
  const prompt = hasSelection
    ? `<document_context>\n${(context || '').slice(0, 50000)}\n</document_context>\n\n<selection>\n${selection.slice(0, 50000)}\n</selection>\n\nInstruction: ${instruction}\n\nRewrite the selection according to the instruction. Match the document's voice. Respond with ONLY the replacement text — no preamble, no quotes around it, no commentary.`
    : `<document>\n${(context || '').slice(0, 100000)}\n</document>\n\nInstruction: ${instruction}\n\nContinue or produce the requested text so it can be inserted at the end of the document. Match the document's voice. Respond with ONLY the text to insert — no preamble, no commentary.`
  await streamText(res, {
    model: MODEL,
    max_tokens: 16000,
    system: VOICE,
    messages: [{ role: 'user', content: prompt }],
  })
}

export async function aiTitles(req, res) {
  const { text } = req.body || {}
  if (!text || !text.trim()) return res.status(400).json({ error: 'empty draft' })
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: VOICE,
      messages: [
        {
          role: 'user',
          content: `<draft>\n${text.slice(0, 100000)}\n</draft>\n\nPropose 8 title ideas for this draft. Vary the register: some plain, some evocative, one or two risky.`,
        },
      ],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              titles: { type: 'array', items: { type: 'string' } },
            },
            required: ['titles'],
            additionalProperties: false,
          },
        },
      },
    })
    const block = response.content.find((b) => b.type === 'text')
    res.json(JSON.parse(block.text))
  } catch (e) {
    console.error('ai titles error', e)
    res.status(500).json({ error: e?.message || 'ai error' })
  }
}

export async function aiChecks(req, res) {
  const { text } = req.body || {}
  if (!text || !text.trim()) return res.status(400).json({ error: 'empty draft' })
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: VOICE,
      messages: [
        {
          role: 'user',
          content: `<draft>\n${text.slice(0, 100000)}\n</draft>\n\nRun checks on this draft. Find spelling errors, grammar problems, repeated words, clichés, and confusing sentences. For each issue: quote the exact excerpt from the draft (short, verbatim so it can be found by search), classify it, explain the problem in a few words, and give a suggested fix. Report every real issue; skip stylistic nitpicks that are clearly intentional voice. If the draft is clean, return an empty list.`,
        },
      ],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              issues: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    excerpt: { type: 'string' },
                    kind: {
                      type: 'string',
                      enum: ['spelling', 'grammar', 'repetition', 'cliche', 'clarity', 'other'],
                    },
                    note: { type: 'string' },
                    suggestion: { type: 'string' },
                  },
                  required: ['excerpt', 'kind', 'note', 'suggestion'],
                  additionalProperties: false,
                },
              },
            },
            required: ['issues'],
            additionalProperties: false,
          },
        },
      },
    })
    const block = response.content.find((b) => b.type === 'text')
    res.json(JSON.parse(block.text))
  } catch (e) {
    console.error('ai checks error', e)
    res.status(500).json({ error: e?.message || 'ai error' })
  }
}
