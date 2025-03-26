const https = require('https');
const querystring = require('querystring');
const fs = require('fs');
const path = require('path');

/*
Usage:
- Vocabulary explanation: yarn run explain --vocab "実現"
- Grammar explanation: yarn run explain --grammar "ても"
- Default (vocabulary): yarn run explain "実現"
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

let type = 'vocabulary';
let promptArgs = process.argv.slice(2);

if (promptArgs[0] === '--vocab' || promptArgs[0] === '--grammar') {
  type = promptArgs[0] === '--vocab' ? 'vocabulary' : 'grammar';
  promptArgs = promptArgs.slice(1);
}

const prompt = promptArgs.join(' ');

if (!prompt) {
  console.error('Please provide a prompt. Usage: node explain.js [--vocab|--grammar] "word or grammar pattern"');
  process.exit(1);
}

const makeRequest = () => {
  const req = https.request(
    {
      hostname,
      path: `/explain/open?${querystring.stringify({ prompt, type })}`,
      method: 'GET',
      auth: `${USERNAME}:${PASSWORD}`,
    },
    (res) => {
      console.log(`Status: ${res.statusCode}`);

      res.on('data', (chunk) => {
        process.stdout.write(chunk);
      });

      res.on('end', () => {
        console.log('\n--- End of response ---');
      });
    }
  );

  req.on('error', (error) => {
    console.error('Error:', error.message);
  });

  req.end();
};

makeRequest();
