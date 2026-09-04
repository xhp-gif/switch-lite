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

  it('UTF-8 边界：多字节字符跨 SSE 分片不产生乱码', async () => {
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

    const line = Buffer.from(
      `data: {"choices":[{"delta":{"content":"英文术语解释"}}]}\n\n`,
      'utf8',
    );
    // 在"术"字 3 字节的中间切开，模拟 TCP 分片边界
    const cut = line.indexOf(Buffer.from('术语解释', 'utf8')) + 1;
    transformer.write(line.slice(0, cut));
    transformer.write(line.slice(cut));
    transformer.write('data: [DONE]\n\n');
    transformer.end();

    const fullOutput = chunks.join('');
    assert.ok(fullOutput.includes('术语解释'), '多字节字符应完整还原');
    assert.ok(!fullOutput.includes('\uFFFD'), '不应出现 U+FFFD 替换符');
  });

  it('流式响应转换：finish_reason 之后迟到的 usage chunk 不丢失（message_delta 带最终 input_tokens）', async () => {
    const chunks = [];
    const mockRes = {
      write(data) {
        chunks.push(data);
      },
      end() {
        chunks.push('[END]');
      },
    };

    const transformer = createOpenAIToAnthropicStreamTransformer(mockRes, 'deepseek-v4-flash');
    transformer.write('data: {"choices":[{"index":0,"delta":{"content":"ok"}}]}\n\n');
    transformer.write('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n');
    // DeepSeek/千帆等会把 usage 放在 finish_reason 之后的独立 chunk
    transformer.write('data: {"choices":[],"usage":{"prompt_tokens":777,"completion_tokens":42}}\n\n');
    transformer.write('data: [DONE]\n\n');
    transformer.end();

    const fullOutput = chunks.join('');
    const deltaMatch = fullOutput.match(/event: message_delta\ndata: (.+)\n/);
    assert.ok(deltaMatch, '应产生 message_delta 事件');
    const delta = JSON.parse(deltaMatch[1]);
    assert.equal(delta.usage.input_tokens, 777, '迟到的 usage 应计入 message_delta');
    assert.equal(delta.usage.output_tokens, 42);
    assert.equal(delta.delta.stop_reason, 'end_turn');
    // message_delta 只能出现一次（finish_reason 不得提前收流）
    assert.equal((fullOutput.match(/event: message_delta/g) || []).length, 1);
  });

  it('请求转换：tool_choice 与 stop_sequences 映射到 OpenAI 格式', () => {
    const base = {
      model: 'glm-5.2',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'read_file', input_schema: { type: 'object' } }],
    };
    const any = JSON.parse(anthropicToOpenAI({ ...base, tool_choice: { type: 'any' } }));
    assert.equal(any.tool_choice, 'required');
    const forced = JSON.parse(anthropicToOpenAI({ ...base, tool_choice: { type: 'tool', name: 'read_file' } }));
    assert.deepEqual(forced.tool_choice, { type: 'function', function: { name: 'read_file' } });
    // 无工具时不映射（避免严格网关 400）
    const noTools = JSON.parse(anthropicToOpenAI({ ...base, tools: undefined, tool_choice: { type: 'any' } }));
    assert.equal(noTools.tool_choice, undefined);

    const stopped = JSON.parse(anthropicToOpenAI({ ...base, stop_sequences: ['\n\n', 'END'] }));
    assert.deepEqual(stopped.stop, ['\n\n', 'END']);
  });

  it('请求转换：文本 + 图片合成单条多部分消息，保持原始块顺序', () => {
    const req = {
      model: 'glm-5.2',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '看这张图' },
            { type: 'image', source: { media_type: 'image/png', data: 'aW1n' } },
            { type: 'text', text: '有什么问题' },
          ],
        },
      ],
    };
    const out = JSON.parse(anthropicToOpenAI(req));
    assert.equal(out.messages.length, 1, '文本+图片应是同一条消息');
    const content = out.messages[0].content;
    assert.equal(content.length, 3);
    assert.equal(content[0].type, 'text');
    assert.equal(content[0].text, '看这张图');
    assert.equal(content[1].type, 'image_url');
    assert.equal(content[1].image_url.url, 'data:image/png;base64,aW1n');
    assert.equal(content[2].type, 'text');
    assert.equal(content[2].text, '有什么问题');
  });
});
