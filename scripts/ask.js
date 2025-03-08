const https = require('https');
const querystring = require('querystring');
const fs = require('fs');
const path = require('path');

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

const prompt = process.argv.slice(2).join(' ');

if (!prompt) {
  console.error('Please provide a prompt. Usage: node ask.js "your question here"');
  process.exit(1);
}

const options = {
  hostname,
  path: `/ask?${querystring.stringify({ prompt })}`,
  method: 'GET',
  auth: `${USERNAME}:${PASSWORD}`,
};

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log(data);
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
});

req.end();
