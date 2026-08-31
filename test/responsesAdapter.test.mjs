import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  responsesToOpenAIChat,
  openAIToResponsesResponse,
  createOpenAIToResponsesStreamTransformer,
} from '../server/responsesAdapter.js';

describe('Responses ↔ OpenAI Chat Completions 协议适配器', () => {
  it('请求转换：将 Codex Responses 请求转为 OpenAI Chat Completions 格式', () => {
    const codexReq = {
      model: 'glm-5.3',
      instructions: 'You are Codex, an AI coding assistant.',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hi, can you check this code?' }],
        },
        {
          type: 'function_call',
          id: 'call_123',
          call_id: 'call_123',
          name: 'read_file',
          arguments: '{"path": "package.json"}',
        },
        {
          type: 'function_call_output',
          call_id: 'call_123',
          output: '{"name": "test"}',
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'I checked the file.' }],
        },
      ],
      tools: [
        {
          type: 'function',
          name: 'read_file',
          description: 'Read file contents',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      ],
      max_output_tokens: 4096,
      temperature: 0.7,
      stream: true,
    };

    const openaiStr = responsesToOpenAIChat(codexReq);
    const openaiReq = JSON.parse(openaiStr);

    assert.equal(openaiReq.model, 'glm-5.3');
    assert.equal(openaiReq.max_tokens, 4096);
    assert.equal(openaiReq.temperature, 0.7);
    assert.equal(openaiReq.stream, true);

    // 检查 instructions 转换为 system 消息
    assert.equal(openaiReq.messages[0].role, 'system');
    assert.equal(openaiReq.messages[0].content, 'You are Codex, an AI coding assistant.');

    // 检查普通 user 消息
    assert.equal(openaiReq.messages[1].role, 'user');
    assert.equal(openaiReq.messages[1].content, 'hi, can you check this code?');

    // 检查 assistant 的 function_call 转换为 tool_calls
    assert.equal(openaiReq.messages[2].role, 'assistant');
    assert.equal(openaiReq.messages[2].tool_calls.length, 1);
    assert.equal(openaiReq.messages[2].tool_calls[0].id, 'call_123');
    assert.equal(openaiReq.messages[2].tool_calls[0].function.name, 'read_file');
    assert.equal(openaiReq.messages[2].tool_calls[0].function.arguments, '{"path": "package.json"}');

    // 检查 function_call_output 转换为 tool 角色消息
    assert.equal(openaiReq.messages[3].role, 'tool');
    assert.equal(openaiReq.messages[3].tool_call_id, 'call_123');
    assert.equal(openaiReq.messages[3].content, '{"name": "test"}');

    // 检查 assistant 消息
    assert.equal(openaiReq.messages[4].role, 'assistant');
    assert.equal(openaiReq.messages[4].content, 'I checked the file.');

    // 检查工具声明
    assert.equal(openaiReq.tools.length, 1);
    assert.equal(openaiReq.tools[0].type, 'function');
    assert.equal(openaiReq.tools[0].function.name, 'read_file');
    assert.deepEqual(openaiReq.tools[0].function.parameters.required, ['path']);
  });

  it('非流式响应转换：将 OpenAI 响应转为 Responses API 格式', () => {
    const openaiResp = {
      id: 'chatcmpl-abc123',
      model: 'glm-5.3',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello from GLM-5.3!',
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

    const respStr = openAIToResponsesResponse(openaiResp, 'glm-5.3');
    const resp = JSON.parse(respStr);

    assert.equal(resp.object, 'response');
    assert.equal(resp.status, 'completed');
    assert.equal(resp.model, 'glm-5.3');
    assert.equal(resp.output.length, 1);
    assert.equal(resp.output[0].type, 'message');
    assert.equal(resp.output[0].role, 'assistant');
    assert.equal(resp.output[0].content[0].type, 'output_text');
    assert.equal(resp.output[0].content[0].text, 'Hello from GLM-5.3!');
    assert.equal(resp.usage.input_tokens, 15);
    assert.equal(resp.usage.output_tokens, 8);
    assert.equal(resp.usage.total_tokens, 23);
  });

  it('流式响应转换：OpenAI SSE 转换为 Responses API SSE 事件流', async () => {
    const chunks = [];
    const mockRes = {
      write(data) {
        chunks.push(data);
      },
      end() {
        chunks.push('[END]');
      },
    };

    const transformer = createOpenAIToResponsesStreamTransformer(mockRes, 'glm-5.3');

    // 模拟 OpenAI 流式 chunk
    transformer.write(
      `data: ${JSON.stringify({ id: 'chatcmpl-1', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hi' } }] })}\n\n`,
    );
    transformer.write(
      `data: ${JSON.stringify({ id: 'chatcmpl-1', choices: [{ index: 0, delta: { content: ' there!' } }] })}\n\n`,
    );
    transformer.write(
      `data: ${JSON.stringify({ id: 'chatcmpl-1', choices: [{ index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`,
    );
    transformer.write('data: [DONE]\n\n');
    transformer.end();

    const fullOutput = chunks.join('');
    assert.ok(fullOutput.includes('event: response.created'), '应产生 response.created 事件');
    assert.ok(fullOutput.includes('event: response.output_item.added'), '应产生 response.output_item.added 事件');
    assert.ok(fullOutput.includes('event: response.output_text.delta'), '应产生 response.output_text.delta 事件');
    assert.ok(fullOutput.includes('"delta":"Hi"'), '应包含 Hi 文本增量');
    assert.ok(fullOutput.includes('"delta":" there!"'), '应包含 there! 文本增量');
    assert.ok(fullOutput.includes('event: response.output_text.done'), '应产生 response.output_text.done 事件');
    assert.ok(fullOutput.includes('event: response.completed'), '应产生 response.completed 事件');
    assert.ok(fullOutput.includes('"input_tokens":10'), '应包含正确 input_tokens');
    assert.ok(fullOutput.includes('"output_tokens":5'), '应包含正确 output_tokens');
  });

  it('流式响应转换：工具调用 tool_calls 转为 Responses function_call 事件流', async () => {
    const chunks = [];
    const mockRes = {
      write(data) {
        chunks.push(data);
      },
      end() {
        chunks.push('[END]');
      },
    };

    const transformer = createOpenAIToResponsesStreamTransformer(mockRes, 'glm-5.3');

    transformer.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-2',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_999',
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"pa' },
                },
              ],
            },
          },
        ],
      })}\n\n`,
    );
    transformer.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-2',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: 'th":"a.js"}' },
                },
              ],
            },
          },
        ],
      })}\n\n`,
    );
    transformer.write(
      `data: ${JSON.stringify({
        choices: [{ index: 0, finish_reason: 'tool_calls' }],
      })}\n\n`,
    );
    transformer.write('data: [DONE]\n\n');
    transformer.end();

    const fullOutput = chunks.join('');
    assert.ok(fullOutput.includes('event: response.output_item.added'), '应产生 function_call item');
    assert.ok(fullOutput.includes('"name":"read_file"'), '应包含函数名 read_file');
    assert.ok(fullOutput.includes('event: response.function_call_arguments.delta'), '应产生 arguments delta');
    assert.ok(fullOutput.includes('event: response.function_call_arguments.done'), '应产生 arguments done');
    assert.ok(fullOutput.includes('"arguments":"{\\"path\\":\\"a.js\\"}"'), '应拼接完整 arguments');
  });

  it('多模态请求转换：Codex input_image / image_url 转为 OpenAI 多模态 messages 结构', () => {
    const codexReq = {
      model: 'glm-4v-plus',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: '这张图片是啥' },
            { type: 'input_image', image_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' },
          ],
        },
      ],
      stream: true,
    };

    const openaiStr = responsesToOpenAIChat(codexReq);
    const openaiReq = JSON.parse(openaiStr);

    assert.equal(openaiReq.messages.length, 1);
    assert.equal(openaiReq.messages[0].role, 'user');
    assert.ok(Array.isArray(openaiReq.messages[0].content));
    assert.deepEqual(openaiReq.messages[0].content[0], { type: 'text', text: '这张图片是啥' });
    assert.deepEqual(openaiReq.messages[0].content[1], {
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' },
    });
  });
});
