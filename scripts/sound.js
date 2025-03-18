const https = require('https');
const querystring = require('querystring');
const fs = require('fs');
const path = require('path');

/*
Usage:
Basic: yarn run sound "text to convert to speech"
With voice: yarn run sound --voice nova "text to convert to speech"
With model: yarn run sound --model tts-1-hd "text to convert to speech"
With both: yarn run sound --voice nova --model tts-1-hd "text to convert to speech"

Voices: alloy (default), echo, fable, nova, onyx, shimmer
Models: tts-1 (default), tts-1-hd
*/

const loadDevVars = () => {
  try {
    const devVarsPath = path.join(__dirname, '..', '.dev.vars');
    const content = fs.readFileSync(devVarsPath, 'utf8');
    return content.split('\n').reduce((vars, line) => {
      const [key, value] = line.split('=');
      if (key && value) vars[key.trim()] = value.trim().replaceAll('"', '');
      return vars;
    }, {});
  } catch (error) {
    console.warn('Warning: Could not load .dev.vars file');
    return {};
  }
};

const devVars = loadDevVars();
const USERNAME = process.env.AUTH_USERNAME || devVars.AUTH_USERNAME || 'USERNAME';
const PASSWORD = process.env.AUTH_PASSWORD || devVars.AUTH_PASSWORD || 'PASSWORD';
const hostname = process.env.BASE_URL || devVars.BASE_URL || 'localhost:3000';

let voice = 'alloy';
let model = 'tts-1';
let args = process.argv.slice(2);

// Parse command line arguments
while (args.length > 0 && args[0].startsWith('--')) {
  const flag = args.shift();

  if (flag === '--voice' && args.length > 0) {
    voice = args.shift();
  } else if (flag === '--model' && args.length > 0) {
    model = args.shift();
  } else {
    console.error(`Unknown flag: ${flag}`);
    process.exit(1);
  }
}

const prompt = args.join(' ');

if (!prompt) {
  console.error('Please provide text to convert to speech. Usage: node sound.js [--voice VOICE] [--model MODEL] "text to speak"');
  process.exit(1);
}

// Create output directory if it doesn't exist
const outputDir = path.join(__dirname, '..', 'output');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// Generate filename based on prompt and timestamp
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const filePrefix = prompt.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '_');
const filename = path.join(outputDir, `${filePrefix}_${timestamp}.mp3`);

console.log(`Converting text to speech: "${prompt}"`);
console.log(`Voice: ${voice}, Model: ${model}`);

const queryParams = querystring.stringify({
  prompt,
  voice,
  model
});

const req = https.request(
  {
    hostname,
    path: `/sound/open?${queryParams}`,
    method: 'GET',
    auth: `${USERNAME}:${PASSWORD}`,
  },
  (res) => {
    if (res.statusCode !== 200) {
      console.error(`Error: Received status code ${res.statusCode}`);
      res.on('data', chunk => {
        console.error(chunk.toString());
      });
      return;
    }

    console.log(`Saving audio to ${filename}`);
    const fileStream = fs.createWriteStream(filename);

    res.pipe(fileStream);

    fileStream.on('finish', () => {
      console.log('Audio file saved successfully!');
      fileStream.close();
    });
  }
);

req.on('error', (error) => {
  console.error('Error:', error.message);
});

req.end();
