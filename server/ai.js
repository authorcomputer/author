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

const DEFAULT_ASK = `Give feedback on this draft: what works, what drags, and the two or three highest-leverage changes. Quote short passages when pointing at something specific. End with one sentence on what the piece wants to be.`

// the first user turn carries the draft; ask a question or leave it blank for
// general feedback
function firstTurn(text, question) {
  const q = String(question || '').trim()
  const ask = q
    ? `The writer asks: "${q}"\nAnswer their question about the draft directly, quoting from it where useful.`
    : DEFAULT_ASK
  return `<draft>\n${text.slice(0, 150000)}\n</draft>\n\n${ask}`
}

export async function aiFeedback(req, res) {
  const { text, question, turns } = req.body || {}
  if (!text || !text.trim()) return res.status(400).json({ error: 'empty draft' })

  let messages
  if (Array.isArray(turns) && turns.length) {
    // a running conversation. normalize defensively: coerce roles, drop blank
    // turns, keep the most recent 40, and make the window start on a user turn
    // (the draft is stitched into that opening turn)
    let picked = turns
      .map((t) => ({
        role: t && t.role === 'assistant' ? 'assistant' : 'user',
        content: String((t && t.content) || '').slice(0, 20000),
      }))
      .filter((t) => t.content.trim())
    if (picked.length > 40) picked = picked.slice(-40)
    while (picked.length && picked[0].role !== 'user') picked.shift()
    // fold any adjacent same-role turns together so the thread strictly
    // alternates (Anthropic requires it); dropping blanks above can leave two
    // in a row
    const alt = []
    for (const t of picked) {
      const last = alt[alt.length - 1]
      if (last && last.role === t.role) last.content += '\n\n' + t.content
      else alt.push(t)
    }
    if (!alt.length || alt[alt.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'expected a question' })
    }
    messages = alt.map((t, i) => ({
      role: t.role,
      content: i === 0 ? firstTurn(text, t.content) : t.content,
    }))
  } else {
    messages = [{ role: 'user', content: firstTurn(text, question) }]
  }

  await streamText(res, {
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: VOICE,
    messages,
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

// the proof reads for exactly what the writer asked — each check is its
// own errand, and the schema only admits the kinds that were requested
const PROOF_CHECKS = {
  spelling: 'spelling errors and typos',
  grammar: 'grammar problems — agreement, tense, punctuation',
  repetition: 'repeated or leaned-on words and phrases',
  cliche: 'clichés and tired phrasing',
  clarity: 'confusing or convoluted sentences a reader would have to re-read',
  brevity: 'needless words — places where fewer words would say more',
  hedging: 'excessive hedging that saps confidence (maybe, I think, probably, sort of)',
}

export async function aiChecks(req, res) {
  const { text, checks, custom } = req.body || {}
  if (!text || !text.trim()) return res.status(400).json({ error: 'empty draft' })
  // one line, no matter what arrives — the errand list below is line-shaped,
  // so a newline in the ask must not smuggle in a second errand
  const ask = String(custom || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  const sent = Array.isArray(checks) ? checks : null
  let picked = [...new Set((sent || []).filter((c) => PROOF_CHECKS[c]))]
  if (sent === null && !ask) {
    // a client from before the picker (a tab that outlived a deploy) sends
    // no checks field at all — give it the full read it was built for
    picked = Object.keys(PROOF_CHECKS)
  }
  if (!picked.length && !ask)
    // an explicit-but-empty or unrecognized pick is a real error — naming a
    // check the server doesn't know must fail loudly, not pass as "clean"
    return res.status(400).json({ error: 'pick something to read for' })
  const errands = [
    ...picked.map((c) => `- ${c}: ${PROOF_CHECKS[c]}`),
    ...(ask ? [`- custom: ${ask}`] : []),
  ].join('\n')
  const kinds = [...picked, ...(ask ? ['custom'] : [])]
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: VOICE,
      messages: [
        {
          role: 'user',
          content: `<draft>\n${text.slice(0, 100000)}\n</draft>\n\nRead this draft for ONLY the following, and nothing else:\n${errands}\n\nFor each issue: quote the exact excerpt from the draft (short, verbatim so it can be found by search), classify it by the check name, explain the problem in a few words, and give a suggested fix. Report every real issue; skip stylistic nitpicks that are clearly intentional voice. If the draft is clean for these checks, return an empty list.`,
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
                    kind: { type: 'string', enum: kinds },
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
