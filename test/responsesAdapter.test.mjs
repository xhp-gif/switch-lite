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

  it('并行工具调用：连续 function_call 合并为单条 assistant 消息，tool 消息紧跟其后', () => {
    // 复现 v0.6.0 Codex 接 Kimi 报错：一轮两个并行 exec_command 调用，
    // 旧实现拆成两条 assistant 消息，触发严格网关
    // "an assistant message with 'tool_calls' must be followed by tool messages" 400
    const codexReq = {
      model: 'k3-256k',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '读取一下项目代码' }],
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '我来看下项目结构。' }],
        },
        {
          type: 'function_call',
          id: 'tool_aaa',
          call_id: 'tool_aaa',
          name: 'exec_command',
          arguments: '{"cmd":"Get-Content README.md"}',
        },
        {
          type: 'function_call',
          id: 'tool_bbb',
          call_id: 'tool_bbb',
          name: 'exec_command',
          arguments: '{"cmd":"Get-ChildItem"}',
        },
        {
          type: 'function_call_output',
          call_id: 'tool_aaa',
          output: 'README 内容',
        },
        {
          type: 'function_call_output',
          call_id: 'tool_bbb',
          output: '目录列表',
        },
      ],
    };

    const openaiReq = JSON.parse(responsesToOpenAIChat(codexReq));

    // [user, assistant文本, assistant(tool_calls x2), tool, tool]
    assert.equal(openaiReq.messages.length, 5);
    assert.equal(openaiReq.messages[2].role, 'assistant');
    assert.equal(openaiReq.messages[2].tool_calls.length, 2);
    assert.deepEqual(
      openaiReq.messages[2].tool_calls.map((t) => t.id),
      ['tool_aaa', 'tool_bbb'],
    );
    assert.equal(openaiReq.messages[3].role, 'tool');
    assert.equal(openaiReq.messages[3].tool_call_id, 'tool_aaa');
    assert.equal(openaiReq.messages[4].role, 'tool');
    assert.equal(openaiReq.messages[4].tool_call_id, 'tool_bbb');

    // 严格网关不变量：每条 assistant 的 tool_calls 后必须紧跟响应全部 id 的 tool 消息
    for (let i = 0; i < openaiReq.messages.length; i++) {
      const m = openaiReq.messages[i];
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        const followed = openaiReq.messages.slice(i + 1, i + 1 + m.tool_calls.length);
        assert.ok(
          followed.every((x) => x.role === 'tool'),
          `消息 ${i} 的 tool_calls 后必须是 tool 消息`,
        );
        const answered = new Set(followed.map((x) => x.tool_call_id));
        for (const tc of m.tool_calls) {
          assert.ok(answered.has(tc.id), `tool_call ${tc.id} 缺少响应消息`);
        }
      }
    }
  });

  it('孤儿 function_call_output：找不到对应调用时丢弃，避免严格网关 400', () => {
    const codexReq = {
      model: 'k3-256k',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hi' }],
        },
        // local_shell_call 被剥离后残留的 output：没有对应 function_call
        {
          type: 'function_call_output',
          call_id: 'shell_orphan',
          output: '残留输出',
        },
        {
          type: 'function_call',
          id: 'tool_ok',
          call_id: 'tool_ok',
          name: 'exec_command',
          arguments: '{}',
        },
        {
          type: 'function_call_output',
          call_id: 'tool_ok',
          output: 'ok',
        },
      ],
    };

    const openaiReq = JSON.parse(responsesToOpenAIChat(codexReq));

    // 孤儿 tool 消息被丢弃：[user, assistant(tool_calls), tool]
    assert.equal(openaiReq.messages.length, 3);
    assert.equal(openaiReq.messages[1].role, 'assistant');
    assert.equal(openaiReq.messages[1].tool_calls[0].id, 'tool_ok');
    assert.equal(openaiReq.messages[2].role, 'tool');
    assert.equal(openaiReq.messages[2].tool_call_id, 'tool_ok');
  });

  it('缺省预算：Codex 未传 max_output_tokens 时注入默认 max_tokens 并携带 stream_options', () => {
    const openaiReq = JSON.parse(
      responsesToOpenAIChat({ model: 'k3-256k', input: 'hi', stream: true }),
    );
    assert.equal(openaiReq.max_tokens, 32768, '应注入默认 max_tokens（思考模型会消耗输出预算）');
    assert.deepEqual(openaiReq.stream_options, { include_usage: true });

    // 显式预算原样透传，不加 stream_options（非流式）
    const explicit = JSON.parse(
      responsesToOpenAIChat({ model: 'k3-256k', input: 'hi', stream: false, max_output_tokens: 4096 }),
    );
    assert.equal(explicit.max_tokens, 4096);
    assert.equal(explicit.stream_options, undefined);
  });

  it('思考内容：reasoning_content 转为 Responses reasoning 条目，不混入 assistant 正文', async () => {
    const chunks = [];
    const mockRes = {
      write(data) {
        chunks.push(data);
      },
      end() {
        chunks.push('[END]');
      },
    };
    const transformer = createOpenAIToResponsesStreamTransformer(mockRes, 'k3-256k');
    transformer.write(
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '先看目录结构' } }] })}\n\n`,
    );
    transformer.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: '好的' } }] })}\n\n`,
    );
    transformer.write('data: [DONE]\n\n');
    transformer.end();

    const fullOutput = chunks.join('');
    assert.ok(fullOutput.includes('event: response.output_item.added'), '应有 output_item.added');
    assert.ok(fullOutput.includes('"type":"reasoning"'), '应产生 reasoning 条目');
    assert.ok(fullOutput.includes('event: response.reasoning_summary_text.delta'), '应有 reasoning delta');
    assert.ok(fullOutput.includes('"delta":"先看目录结构"'), '思考内容应在 reasoning delta 里');
    assert.ok(fullOutput.includes('event: response.output_text.delta'), '正文仍走 output_text.delta');
    assert.ok(!fullOutput.includes('先看目录结构\\n好的'), '思考内容不能拼进正文');

    // 正文消息内容只包含 content 部分
    const doneMatch = fullOutput.match(/event: response\.output_item\.done\ndata: (.*)\n/g) || [];
    const msgDone = doneMatch.find((s) => s.includes('"type":"message"'));
    assert.ok(msgDone && msgDone.includes('"text":"好的"'), 'message 条目只含正文');
  });

  it('截断响应：finish_reason=length 标记 incomplete，不再伪装正常完成', async () => {
    const chunks = [];
    const mockRes = {
      write(data) {
        chunks.push(data);
      },
      end() {
        chunks.push('[END]');
      },
    };
    const transformer = createOpenAIToResponsesStreamTransformer(mockRes, 'k3-256k');
    transformer.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: '想了一半' }, finish_reason: 'length' }], usage: { prompt_tokens: 5, completion_tokens: 32768 } })}\n\n`,
    );
    transformer.write('data: [DONE]\n\n');
    transformer.end();

    const fullOutput = chunks.join('');
    assert.ok(fullOutput.includes('event: response.incomplete'), '应发 response.incomplete 事件');
    assert.ok(fullOutput.includes('"status":"incomplete"'), '状态应为 incomplete');
    assert.ok(fullOutput.includes('"max_output_tokens"'), '应带 incomplete_details 原因');
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
    const transformer = createOpenAIToResponsesStreamTransformer(mockRes, 'glm-5.3');

    const line = Buffer.from(
      `data: {"choices":[{"delta":{"content":"英文术语解释"}}]}\n\n`,
      'utf8',
    );
    // 在"术"字 3 字节的中间切开，模拟 TCP 分片边界（Codex 接 GLM 乱码的场景）
    const cut = line.indexOf(Buffer.from('术语解释', 'utf8')) + 1;
    transformer.write(line.slice(0, cut));
    transformer.write(line.slice(cut));
    transformer.write('data: [DONE]\n\n');
    transformer.end();

    const fullOutput = chunks.join('');
    assert.ok(fullOutput.includes('术语解释'), '多字节字符应完整还原');
    assert.ok(!fullOutput.includes('\uFFFD'), '不应出现 U+FFFD 替换符');
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
