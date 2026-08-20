import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  anthropicToOpenAI,
  openAIToAnthropicResponse,
  createOpenAIToAnthropicStreamTransformer,
} from '../server/anthropicAdapter.js';

describe('Anthropic ↔ OpenAI 协议适配器', () => {
  it('请求转换：将 Anthropic Messages 请求转为 OpenAI Chat Completions 格式', () => {
    const anthropicReq = {
      model: 'glm-5.2',
      system: 'You are an AI programming assistant.',
      messages: [
        { role: 'user', content: 'hi, can you check this code?' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Sure, let me check.' },
            {
              type: 'tool_use',
              id: 'call_123',
              name: 'read_file',
              input: { path: 'package.json' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_123',
              content: '{"name": "test"}',
            },
          ],
        },
      ],
      tools: [
        {
          name: 'read_file',
          description: 'Read file contents',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      ],
      max_tokens: 2048,
      temperature: 0.5,
    };

    const openaiStr = anthropicToOpenAI(anthropicReq);
    const openaiReq = JSON.parse(openaiStr);

    assert.equal(openaiReq.model, 'glm-5.2');
    assert.equal(openaiReq.max_tokens, 2048);
    // temperature 不转发：Claude Code 分类器固定发 temperature:0，
    // 而 K3/DeepSeek-R1/GLM 思考模型只接受默认值 1，转发会 400（“分类器错误”）
    assert.equal(openaiReq.temperature, undefined);
    assert.equal(openaiReq.top_p, undefined);
    // 小预算（≤2048）辅助请求注入关思考，避免思考型模型耗尽预算/超时（“分类器不可用”）
    assert.equal(openaiReq.reasoning_effort, 'none');
    assert.equal(openaiReq.thinking.type, 'disabled');

    // 大预算（主对话）不注入，保留思考能力
    const bigStr = anthropicToOpenAI({ ...anthropicReq, max_tokens: 16384 });
    const bigReq = JSON.parse(bigStr);
    assert.equal(bigReq.reasoning_effort, undefined);
    assert.equal(bigReq.thinking, undefined);

    // 检查系统提示词
    assert.equal(openaiReq.messages[0].role, 'system');
    assert.equal(openaiReq.messages[0].content, 'You are an AI programming assistant.');

    // 检查普通消息
    assert.equal(openaiReq.messages[1].role, 'user');
    assert.equal(openaiReq.messages[1].content, 'hi, can you check this code?');

    // 检查 assistant 的 tool_calls
    assert.equal(openaiReq.messages[2].role, 'assistant');
    assert.equal(openaiReq.messages[2].content, 'Sure, let me check.');
    assert.equal(openaiReq.messages[2].tool_calls.length, 1);
    assert.equal(openaiReq.messages[2].tool_calls[0].id, 'call_123');
    assert.equal(openaiReq.messages[2].tool_calls[0].function.name, 'read_file');

    // 检查 tool_result 转换为 tool 角色消息
    assert.equal(openaiReq.messages[3].role, 'tool');
    assert.equal(openaiReq.messages[3].tool_call_id, 'call_123');
    assert.equal(openaiReq.messages[3].content, '{"name": "test"}');

    // 检查工具声明
    assert.equal(openaiReq.tools.length, 1);
    assert.equal(openaiReq.tools[0].type, 'function');
    assert.equal(openaiReq.tools[0].function.name, 'read_file');
    assert.deepEqual(openaiReq.tools[0].function.parameters.required, ['path']);
  });

  it('非流式响应转换：将 OpenAI 响应转为 Anthropic Messages 格式', () => {
    const openaiResp = {
      id: 'chatcmpl-abc123',
      model: 'glm-5.2',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello from GLM-5.2!',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 8,
        total_tokens: 23,
      },
    };

    const anthropicStr = openAIToAnthropicResponse(openaiResp, 'glm-5.2');
    const anthropicResp = JSON.parse(anthropicStr);

    assert.equal(anthropicResp.type, 'message');
    assert.equal(anthropicResp.role, 'assistant');
    assert.equal(anthropicResp.model, 'glm-5.2');
    assert.equal(anthropicResp.content.length, 1);
    assert.equal(anthropicResp.content[0].type, 'text');
    assert.equal(anthropicResp.content[0].text, 'Hello from GLM-5.2!');
    assert.equal(anthropicResp.stop_reason, 'end_turn');
    assert.equal(anthropicResp.usage.input_tokens, 15);
    assert.equal(anthropicResp.usage.output_tokens, 8);
  });

  it('流式响应转换：OpenAI SSE 转换为 Anthropic SSE 事件流', async () => {
    const chunks = [];
    const mockRes = {
      write(data) {
        chunks.push(data);
      },
      end() {
        chunks.push('[END]');
      },
    };

    const transformer = createOpenAIToAnthropicStreamTransformer(mockRes, 'glm-5.2');

    // 模拟 OpenAI 流式 chunk
    transformer.write(
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"}}]}\n\n',
    );
    transformer.write(
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":" there!"}}]}\n\n',
    );
    transformer.write(
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
    );
    transformer.write('data: [DONE]\n\n');
    transformer.end();

    const fullOutput = chunks.join('');
    assert.ok(fullOutput.includes('event: message_start'), '应产生 message_start 事件');
    assert.ok(fullOutput.includes('event: content_block_start'), '应产生 content_block_start 事件');
    assert.ok(fullOutput.includes('event: content_block_delta'), '应产生 content_block_delta 事件');
    assert.ok(fullOutput.includes('"text":"Hi"'), '应包含 Hi 文本增量');
    assert.ok(fullOutput.includes('"text":" there!"'), '应包含 there! 文本增量');
    assert.ok(fullOutput.includes('event: message_delta'), '应产生 message_delta 事件');
    assert.ok(fullOutput.includes('event: message_stop'), '应产生 message_stop 事件');
  });
});
