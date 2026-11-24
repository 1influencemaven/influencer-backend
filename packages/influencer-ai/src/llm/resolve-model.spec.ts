import { withOllamaDefaults } from './resolve-model';

describe('withOllamaDefaults', () => {
  const env = { ollamaNumCtx: 8192, ollamaNumPredict: 3072, ollamaKeepAlive: '30m' };

  function capture() {
    const calls: { input: unknown; init?: RequestInit }[] = [];
    const baseFetch = (async (input: unknown, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response('{}');
    }) as typeof fetch;
    return { calls, baseFetch };
  }

  it('injects context, output cap and keep_alive', async () => {
    const { calls, baseFetch } = capture();
    await withOllamaDefaults(env, baseFetch)('http://ollama/api/chat', {
      method: 'POST',
      body: JSON.stringify({ model: 'qwen2.5:7b', messages: [], options: { temperature: 0 } }),
    });
    expect(JSON.parse(calls[0].init!.body as string)).toEqual({
      model: 'qwen2.5:7b',
      messages: [],
      keep_alive: '30m',
      options: { num_ctx: 8192, num_predict: 3072, temperature: 0 },
    });
  });

  it('lets per-call options override the defaults', async () => {
    const { calls, baseFetch } = capture();
    await withOllamaDefaults(env, baseFetch)('http://ollama/api/chat', {
      method: 'POST',
      body: JSON.stringify({ options: { num_predict: 500 }, keep_alive: '5m' }),
    });
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.options).toEqual({ num_ctx: 8192, num_predict: 500 });
    expect(body.keep_alive).toBe('5m');
  });

  it('passes non-JSON bodies through untouched', async () => {
    const { calls, baseFetch } = capture();
    const init = { method: 'GET' };
    await withOllamaDefaults(env, baseFetch)('http://ollama/api/tags', init);
    expect(calls[0].init).toBe(init);
  });
});
