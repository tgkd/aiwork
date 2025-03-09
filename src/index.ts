import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { HTTPException } from 'hono/http-exception';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

const JP_BASE_PROMPT = `
Generate 3-5 Japanese-English sentences pairs using the specific word/topic provided by the user.
Schema of pair:
{jp: "Japanese sentence", en: "English sentence", expl: "Explanation of the sentence pair"}
Each pair must:
1. Include the exact user-provided word/topic at least once
2. Have furigana annotations for ALL kanji characters in the format: kanji[furigana]
3. Be grammatically correct and natural-sounding
4. Be culturally appropriate
5. Be relevant to the user-provided word/topic
6. If there are multiple possible translations, provide the most common one
7. If there are multiple possible readings for a kanji, provide the most common one
8. If there is explanatory text, provide it in English only
`;

const CF_JP_BASE_PROMPT = JP_BASE_PROMPT.concat(`
  USER-PROVIDED WORD/TOPIC: {{prompt}}
`);

const app = new Hono<{ Bindings: CloudflareBindings }>();

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
      en: z.string(),
      expl: z.string().optional(),
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
      { role: 'system', content: JP_BASE_PROMPT },
      { role: 'user', content: prompt },
    ],
    model: 'gpt-4o-mini-2024-07-18',
    response_format: zodResponseFormat(dictSchema, 'dict'),
  });

  if (resp.choices.length && resp.choices[0].message.parsed?.sentences.length) {
    return c.json(resp.choices[0].message.parsed.sentences);
  }

  throw new HTTPException(500, { message: 'Failed to generate sentences' });
});

app.get('/ask/cf', async (c) => {
  const prompt = c.req.query('prompt');

  if (!prompt) {
    throw new HTTPException(400, { message: 'Missing prompt' });
  }

  const resp = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    prompt: CF_JP_BASE_PROMPT.replace('{{prompt}}', prompt),
    max_tokens: 100,
    temperature: 0,
    stream: false,
    response_format: {
      type: 'json_schema',
      json_schema: {
        type: 'object',
        properties: {
          jp_sentences: {
            type: 'array',
            items: { type: 'string' },
          },
          en_sentences: {
            type: 'array',
            items: { type: 'string' },
          },
          explanations: { type: 'string', nullable: true },
        },
        required: ['jp_sentences', 'en_sentences'],
      },
    },
  });

  return c.json(resp);
});

export default app;
