import { IBP_SYSTEM_INSTRUCTIONS } from '../prompts/ibp.prompt';

const AgentMock = jest.fn().mockImplementation((config: { instructions: string }) => ({
  instructions: config.instructions,
  getInstructions: () => config.instructions,
}));

jest.mock('@mastra/core/agent', () => ({
  Agent: AgentMock,
}));

jest.mock('../llm/resolve-model', () => ({
  resolveMastraModel: () => 'ollama/llama3.2:3b',
}));

describe('createIbpAgent', () => {
  beforeEach(() => {
    AgentMock.mockClear();
  });

  it('binds immutable HU-TM-004 system instructions (not Settings business text)', async () => {
    const { createIbpAgent } = await import('./ibp.agent');

    const agent = createIbpAgent({
      AI_LLM_PROVIDER: 'ollama',
      AI_LLM_MODEL: 'llama3.2:3b',
      REDIS_URL: 'redis://127.0.0.1:6379',
    } as never);

    expect(AgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ibp-generation',
        instructions: IBP_SYSTEM_INSTRUCTIONS,
      }),
    );
    expect(agent.getInstructions()).toBe(IBP_SYSTEM_INSTRUCTIONS);
    expect(String(agent.getInstructions())).toContain('NEVER invent followers');
    expect(String(agent.getInstructions())).not.toContain(
      'Prioritize targetSectors',
    );
  });
});
