import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { HTTPException } from 'hono/http-exception';
import { streamText } from 'hono/streaming';
import { cors } from 'hono/cors';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

const MAX_TOKENS = 512;

const ASK_PROMPT = `
# Japanese Language Expert
Generate 3-5 Japanese-English sentences pairs using the specific word/topic provided by the user.
Each sentence pair must follow the schema: {jp: "Japanese sentence", en: "English sentence", jp_reading: "Japanese sentence reading in hiragana"}
The user's input will be in the following format: [word]::[reading]::[meaning;meaning;...]
Respect maximum token limit: ${MAX_TOKENS} tokens
**Requirements for Each Sentence Pair:**
1. Include the exact user-provided word/topic at least once
2. Have furigana annotations for ALL kanji characters in the format: kanji[furigana]
3. Be grammatically correct and natural-sounding
4. Be culturally appropriate
5. Be relevant to the user-provided word/topic
6. If there are multiple possible translations, provide the most common one
7. If there are multiple possible readings for a kanji, provide the most common one
This revised prompt provides a clear, structured framework to generate high-quality, accurate Japanese-English sentence pairs.
`;

const EXPLAIN_PROMPT = `# Japanese Language Expert Prompt
As a Japanese language expert, provide concise explanations including:
1. **Word Info:** Japanese writing, pronunciation with furigana, word type
2. **Meaning:** Primary/secondary translations, similar terms and differences
3. **Usage:** Common contexts, formality level, frequency
4. **Cultural Context:** Nuances, implications, background
5. **Examples:** 1-2 example sentences with translations
6. **Quick Tips:** Common mistakes, memory aids (if helpful)

## For Single Words:

**TL;DR**: **[Word (ふりがな, romaji)]** means **"[translation],"** specifically referring to **[specific meaning].**

### 1. Kanji Breakdown
- **[Kanji 1 (ふりがな, romaji)]** → "[meaning]"
- **[Kanji 2 (ふりがな, romaji)]** → "[meaning]"
  Together, **[full word (ふりがな, romaji)]** means **"[meaning],"** often implying **[nuance].**

### 2. Common Usages & Example Sentences
#### A. [Usage Category]
- **Example Sentences:**
  - **[Japanese sentence]**
    *([ふりがな], [romaji])*
    → "[English translation]"

### 3. Differences Between Similar Words
| **Word** | **Reading** | **Meaning** | **Usage** |
|----------|------------|-------------|------------|
| **[Word 1]** | "[Reading]" | [Meaning] | [Usage context] |
| **[Word 2]** | "[Reading]" | [Meaning] | [Usage context] |

### 4. Summary & When to Use
**Use [word] when [specific usage guidance]**

## For Phrases:

**TL;DR**: **[Phrase]** means **"[translation]."** This sentence [brief explanation of structure/function].

### 1. Sentence Breakdown
- **[Phrase component 1]**
  - **[Word (ふりがな, romaji)]** → "[meaning]"
  - **Combined**, this segment [functional explanation]

### 2. Common Usages & Example Sentences
#### A. [Usage Category]
- **Example Sentence:**
  - **[Japanese sentence]**
    *([ふりがな], [romaji])*
    → "[English translation]"

### 3. Differences Between Similar Constructions
| **Construction** | **Meaning** | **Usage** |
|-----------------|------------|------------|
| **[Construction 1]** | [Meaning] | [Usage context] |
| **[Construction 2]** | [Meaning] | [Usage context] |

### 4. Summary & When to Use
- **[Construction Pattern]:**
  Use the structure **"[pattern]"** to [explanation of when/how to use]
`;

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use(
  cors({
    origin: '*',
    allowHeaders: ['Authorization', 'Content-Type', 'Accept'],
    allowMethods: ['GET', 'OPTIONS'],
  })
);

app.use(
  basicAuth({
    verifyUser: (username, password, c) => {
      return username === c.env.AUTH_USERNAME && password === c.env.AUTH_PASSWORD;
    },
  })
);

const dictSchema = z.object({
  sentences: z.array(
    z.object({
      jp: z.string(),
      jp_reading: z.string(),
      en: z.string(),
    })
  ),
});

app.get('/ask/open', async (c) => {
  const prompt = c.req.query('prompt');

  if (!prompt) {
    throw new HTTPException(400, { message: 'Missing prompt' });
  }

  const openai = new OpenAI({ apiKey: c.env.OPENAI_KEY });

  const resp = await openai.beta.chat.completions.parse({
    messages: [
      { role: 'developer', content: ASK_PROMPT },
      { role: 'user', content: prompt },
    ],
    model: 'gpt-4o-mini-2024-07-18',
    response_format: zodResponseFormat(dictSchema, 'dict'),
    max_tokens: MAX_TOKENS,
  });

  if (resp.choices.length && resp.choices[0].message.parsed?.sentences.length) {
    return c.json(resp.choices[0].message.parsed.sentences);
  }

  throw new HTTPException(500, { message: 'Failed to generate sentences' });
});

app.get('/explain/open', async (c) => {
  const prompt = c.req.query('prompt');

  if (!prompt) {
    throw new HTTPException(400, { message: 'Missing prompt' });
  }
  const openai = new OpenAI({ apiKey: c.env.OPENAI_KEY });

  const streamResp = await openai.chat.completions.create({
    messages: [
      { role: 'developer', content: EXPLAIN_PROMPT },
      { role: 'user', content: prompt },
    ],
    model: 'gpt-4o-mini-2024-07-18',
    max_tokens: MAX_TOKENS,
    stream: true,
  });

  c.header('Content-Type', 'text/plain; charset=utf-8');
  c.header('Transfer-Encoding', 'chunked');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  return streamText(c, async (stream) => {
    for await (const message of streamResp) {
      const text = message.choices[0]?.delta.content ?? '';
      await Promise.all(
        Array.from(text).map(async (s) => {
          await stream.write(s);
          await stream.sleep(20);
        })
      );
    }
    stream.close();
  });
});

app.get('/ask/cf', async (c) => {
  const prompt = c.req.query('prompt');

  if (!prompt) {
    throw new HTTPException(400, { message: 'Missing prompt' });
  }

  const resp = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [
      { role: 'system', content: ASK_PROMPT },
      { role: 'user', content: prompt },
    ],
    max_tokens: MAX_TOKENS,
    temperature: 0,
    stream: false,
    response_format: {
      type: 'json_schema',
      json_schema: {
        type: 'object',
        properties: {
          sentences: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                jp: { type: 'string' },
                jp_reading: { type: 'string' },
                en: { type: 'string' },
              },
              required: ['jp', 'jp_reading', 'en'],
            },
          },
        },
        required: ['sentences'],
      },
    },
  });

  return c.json(resp);
});

export default app;
