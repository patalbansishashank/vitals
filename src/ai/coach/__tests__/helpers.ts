import { createChatModel, presetCapabilities, getPreset, type Capabilities, type ChatModel } from '../../providers';
import { fakeFetch, instantSleep, sse, type FakeFetch } from '../../testing/fakeFetch';

/** An OpenAI-chat style streamed text reply carrying `content`. */
export const textReply = (content: string | object) => ({
  text: sse(
    { choices: [{ index: 0, delta: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    'data: [DONE]\n\n',
  ),
});

export function modelWith(replies: Parameters<typeof fakeFetch>[0], caps: Partial<Capabilities> = {}): { model: ChatModel; ff: FakeFetch } {
  const ff = fakeFetch(replies);
  const preset = getPreset('openrouter')!;
  const model = createChatModel({
    preset: 'openrouter',
    apiKey: 'test-key-0000',
    capabilities: { ...presetCapabilities(preset), vision: true, ...caps },
    deps: { fetch: ff.fetch, sleep: instantSleep().sleep },
  });
  return { model, ff };
}
