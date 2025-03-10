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

const EXPLAIN_PROMPT = `
# Japanese Language Expert
As a Japanese language expert, provide concise explanations for Japanese words/phrases including:
1. **Word Information:** Japanese writing (in UTF-8 encoding), reading/pronunciation with furigana, word type
2. **Meaning:** Primary and secondary translations, similar terms and differences
3. **Usage:** Common contexts, formality level, frequency of use
4. **Cultural Context:** Nuances, implications, relevant background
5. **Examples:** 1-2 example sentences with translations showing proper usage
6. **Quick Tips:** Common mistakes, memory aids (if helpful)
7. **respect maximum token limit:** ${MAX_TOKENS} tokens
Format with clear headings, proper furigana for kanji, and concise explanations.
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
      { role: 'system', content: ASK_PROMPT },
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
      { role: 'system', content: EXPLAIN_PROMPT },
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
