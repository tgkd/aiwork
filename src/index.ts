export default {
  async fetch(request, env): Promise<Response> {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return new Response('Authentication required', {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Basic realm="AI Worker Access", charset="UTF-8"',
        },
      });
    }

    const encodedCredentials = authHeader.split(' ')[1];
    const decodedCredentials = atob(encodedCredentials);
    const [username, password] = decodedCredentials.split(':');

    if (username !== env.AUTH_USERNAME || password !== env.AUTH_PASSWORD) {
      return new Response('Invalid credentials', {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Basic realm="AI Worker Access", charset="UTF-8"',
        },
      });
    }

    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/ask') {
      return new Response('Not found', { status: 404 });
    }

    const prompt = url.searchParams.get('prompt');
    if (!prompt) {
      return new Response('Missing prompt parameter', { status: 400 });
    }

    const answer = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      prompt,
      stream: true,
    });

    return new Response(answer, {
      headers: { 'content-type': 'text/event-stream' },
    });
  },
} satisfies ExportedHandler<Env>;
