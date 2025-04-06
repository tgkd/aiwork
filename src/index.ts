import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { HTTPException } from 'hono/http-exception';
import { streamText } from 'hono/streaming';
import { cors } from 'hono/cors';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { SpeechCreateParams } from 'openai/resources/audio/speech.mjs';

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

const EXPLAIN_GRAMMAR = `
**[Pattern/Phrase]** means **"[translation]"** and functions to [grammatical role/purpose].

### Structure Analysis
- **[Component 1]**: [function explanation]
- **[Component 2]**: [function explanation]
- **Pattern formula:** [X + Y + Z pattern notation]

### Usage Examples
- **Basic usage:**
  - **[Japanese sentence]**
    *([ふりがな], [romaji])*
    → "[English translation]"

- **Variation:**
  - **[Japanese sentence]**
    *([ふりがな], [romaji])*
    → "[English translation]"

### Related Constructions
**[Related Pattern 1]**
- Meaning: [meaning]
- When to use: [context]
- Difference: [how it differs from main pattern]

**[Related Pattern 2]**
- Meaning: [meaning]
- When to use: [context]
- Difference: [how it differs from main pattern]

### Usage Rules
- **Correct structure:** [specific syntactic requirements]
- **Common mistakes:** [errors to avoid]
- **Register awareness:** [formality considerations]
`;

const generateWordExplanationPrompt = (prompt: string) => {
  // Check if the prompt contains kanji characters
  const containsKanji = /[\u4e00-\u9faf]/.test(prompt);

  let basePrompt = `
**[Word (ふりがな, romaji)]** - *[part of speech]*
Means **"[primary translation]"** or **"[secondary translation],"** specifically referring to **[precise meaning]**.`;

  // Add kanji analysis section if the word contains kanji
  if (containsKanji) {
    basePrompt += `

### Kanji Analysis
For each kanji in the word:
- **[Kanji 1 (ふりがな, romaji)]** → Strokes: [number], JLPT: [level]
  - **Readings**: On: [on'yomi], Kun: [kun'yomi]
  - **Core meaning:** "[core meaning]"

- **[Kanji 2 (ふりがな, romaji)]** → Strokes: [number], JLPT: [level]
  - **Readings**: On: [on'yomi], Kun: [kun'yomi]
  - **Core meaning:** "[core meaning]"

**Combined meaning:** "[compound meaning]" with nuance of **[specific connotation]**`;
  }

  // Add usage examples
  basePrompt += `

### Usage Examples
- **Casual context:**
  - **[Japanese sentence]**
    *([ふりがな], [romaji])*
    → "[English translation]"

- **Formal context:**
  - **[Japanese sentence]**
    *([ふりがな], [romaji])*
    → "[English translation]"`;

  // Add common compounds if word contains kanji
  if (containsKanji) {
    basePrompt += `

### Common Compounds
- **[Compound 1]** ([reading]) - "[meaning]"
- **[Compound 2]** ([reading]) - "[meaning]"
- **[Compound 3]** ([reading]) - "[meaning]"`;
  }

  // Add similar words comparison
  basePrompt += `

### Similar Words Comparison
**[Similar Word 1]**
- Reading: [reading]
- Meaning: [core meaning]
- Usage: [when/how used]
- Nuance: [specific connotation]

**[Similar Word 2]**
- Reading: [reading]
- Meaning: [core meaning]
- Usage: [when/how used]
- Nuance: [specific connotation]

### Usage Summary
- **Standard usage:** [typical context]
- **Special considerations:** [politeness level, gender associations]
- **Common collocations:** [words/phrases often used with it]`;

  // Add mnemonic if word contains kanji
  if (containsKanji) {
    basePrompt += `
- **Mnemonic:** [memorable image/story to help remember the kanji]`;
  }

  return basePrompt;
};

const SPEECH_INSTRUCTIONS =
  `
Voice: Clear, authoritative, and composed, projecting confidence and professionalism.
Tone: Neutral and informative, maintaining a balance between formality and approachability.
Punctuation: Structured with commas and pauses for clarity, ensuring information is digestible and well-paced.
Delivery: Steady and measured, with slight emphasis on key figures and deadlines to highlight critical points.
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

function findKanji(text: string): string[] {
  return Array.from(
    new Set(
      Array.from(text).filter((char) => {
        const code = char.charCodeAt(0);
        return code >= 0x4e00 && code <= 0x9faf;
      })
    )
  );
}

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

/*
export enum ExplainRequestType {
  V = "word", // aka "explain word prompt"
  G = "grammar", // aka "sentence"
}
*/

app.get('/explain/open', async (c) => {
  const prompt = c.req.query('prompt');
  const type = c.req.query('type') || 'vocabulary';

  if (!prompt) {
    throw new HTTPException(400, { message: 'Missing prompt' });
  }

  let promptTemplate;
  if (type === 'vocabulary') {
    promptTemplate = generateWordExplanationPrompt(prompt || '');
  } else {
    promptTemplate = EXPLAIN_GRAMMAR;
  }

  const openai = new OpenAI({ apiKey: c.env.OPENAI_KEY });

  const streamResp = await openai.chat.completions.create({
    messages: [
      { role: 'developer', content: promptTemplate },
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

app.get('/sound/open', async (c) => {
  const prompt = c.req.query('prompt');
  const voice = (c.req.query('voice') || 'nova') as SpeechCreateParams['voice'];

  if (!prompt) {
    throw new HTTPException(400, { message: 'Missing prompt' });
  }

  const openai = new OpenAI({ apiKey: c.env.OPENAI_KEY });

  try {
    const response = await openai.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice: voice,
      input: prompt,
      instructions: SPEECH_INSTRUCTIONS,
    });

    const audioData = await response.arrayBuffer();

    c.header('Content-Type', 'audio/mpeg');
    c.header('Content-Length', audioData.byteLength.toString());
    c.header('Cache-Control', 'no-cache');

    return c.body(audioData);
  } catch (error) {
    console.error('Error generating speech:', error);
    throw new HTTPException(500, { message: 'Failed to generate speech' });
  }
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
