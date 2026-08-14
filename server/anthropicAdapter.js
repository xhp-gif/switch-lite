import crypto from 'node:crypto';

export function anthropicToOpenAI(body, targetModel = '') {
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return body;
    }
  }
  if (!body || typeof body !== 'object') return body;

  const model = targetModel || body.model;
  const out = {
    model,
    messages: [],
    stream: body.stream !== false,
  };

  if (typeof body.max_tokens === 'number') out.max_tokens = body.max_tokens;
  if (typeof body.temperature === 'number') out.temperature = body.temperature;
  if (typeof body.top_p === 'number') out.top_p = body.top_p;

  // 1. 系统提示词处理
  if (body.system) {
    let systemText = '';
    if (typeof body.system === 'string') {
      systemText = body.system;
    } else if (Array.isArray(body.system)) {
      systemText = body.system
        .map((s) => (typeof s === 'string' ? s : s?.text || ''))
        .filter(Boolean)
        .join('\n\n');
    }
    if (systemText) {
      out.messages.push({ role: 'system', content: systemText });
    }
  }

  // 2. 消息列表转换
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (!msg) continue;
      const role = msg.role === 'assistant' ? 'assistant' : 'user';

      if (typeof msg.content === 'string') {
        out.messages.push({ role, content: msg.content });
        continue;
      }

      if (!Array.isArray(msg.content)) {
        out.messages.push({ role, content: String(msg.content ?? '') });
        continue;
      }

      // 复合内容处理（文本、工具调用、工具返回结果、图片等）
      let textParts = [];
      let toolCalls = [];

      for (const block of msg.content) {
        if (!block || typeof block !== 'object') continue;

        if (block.type === 'text') {
          textParts.push(block.text || '');
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id || `call_${crypto.randomBytes(8).toString('hex')}`,
            type: 'function',
            function: {
              name: block.name || 'tool',
              arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}),
            },
          });
        } else if (block.type === 'tool_result') {
          // 工具执行结果在 OpenAI 中作为独立的 tool 角色消息
          let contentStr = '';
          if (typeof block.content === 'string') {
            contentStr = block.content;
          } else if (Array.isArray(block.content)) {
            contentStr = block.content.map((b) => (b?.type === 'text' ? b.text : JSON.stringify(b))).join('\n');
          } else {
            contentStr = JSON.stringify(block.content ?? '');
          }

          out.messages.push({
            role: 'tool',
            tool_call_id: block.tool_use_id || '',
            content: contentStr,
          });
        } else if (block.type === 'image') {
          // 图片转为 OpenAI image_url 格式
          const mediaType = block.source?.media_type || 'image/jpeg';
          const data = block.source?.data || '';
          out.messages.push({
            role,
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${mediaType};base64 street,${data}` },
              },
            ],
          });
        }
      }

      if (toolCalls.length > 0) {
        out.messages.push({
          role: 'assistant',
          content: textParts.join('\n') || null,
          tool_calls: toolCalls,
        });
      } else if (textParts.length > 0) {
        out.messages.push({ role, content: textParts.join('\n') });
      }
    }
  }

  // 3. 工具声明转换
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    out.tools = body.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.input_schema || { type: 'object', properties: {} },
      },
    }));
  }

  return JSON.stringify(out);
}

/**
 * 将 OpenAI 非流式响应转换为 Anthropic Messages 响应
 */
export function openAIToAnthropicResponse(openAIBody, reqModel = '') {
  let data = openAIBody;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return openAIBody;
    }
  }

  const choice = data.choices?.[0] || {};
  const msg = choice.message || {};
  const content = [];

  if (msg.content) {
    content.push({ type: 'text', text: msg.content });
  }

  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      let parsedInput = {};
      try {
        parsedInput = JSON.parse(tc.function?.arguments || '{}');
      } catch {
        parsedInput = { raw: tc.function?.arguments };
      }
      content.push({
        type: 'tool_use',
        id: tc.id || `call_${crypto.randomBytes(8).toString('hex')}`,
        name: tc.function?.name || 'tool',
        input: parsedInput,
      });
    }
  }

  const promptTokens = Number(data.usage?.prompt_tokens) || 0;
  const completionTokens = Number(data.usage?.completion_tokens) || 0;

  return JSON.stringify({
    id: data.id ? `msg_${data.id}` : `msg_${crypto.randomBytes(12).toString('hex')}`,
    type: 'message',
    role: 'assistant',
    model: data.model || reqModel || 'unknown',
    content,
    stop_reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: promptTokens,
      output_tokens: completionTokens,
    },
  });
}

/**
 * 流式转换器：读取 OpenAI SSE 流，转换为 Anthropic SSE 事件流写入 res
 */
export function createOpenAIToAnthropicStreamTransformer(res, reqModel = '') {
  const msgId = `msg_${crypto.randomBytes(12).toString('hex')}`;
  let sentStart = false;
  let textBlockStarted = false;
  let currentBlockIndex = 0;
  let activeToolIndexMap = new Map(); // tool_call index in chunk -> content_block index in Anthropic
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let buffer = '';

  function sendEvent(eventType, eventData) {
    res.write(`event: ${eventType}\ndata: ${JSON.stringify(eventData)}\n\n`);
  }

  function ensureMessageStart(modelName) {
    if (!sentStart) {
      sentStart = true;
      sendEvent('message_start', {
        type: 'message_start',
        message: {
          id: msgId,
          type: 'message',
          role: 'assistant',
          model: modelName || reqModel || 'unknown',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: totalInputTokens,
            output_tokens: 1,
          },
        },
      });
    }
  }

  function handleOpenAIChunk(chunkStr) {
    const lines = chunkStr.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || !line.startsWith('data:')) continue;
      const dataStr = line.slice(5).trim();
      if (dataStr === '[DONE]') {
        finishStream('end_turn');
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(dataStr);
      } catch {
        continue;
      }

      const model = parsed.model || reqModel;
      ensureMessageStart(model);

      if (parsed.usage) {
        if (parsed.usage.prompt_tokens) totalInputTokens = parsed.usage.prompt_tokens;
        if (parsed.usage.completion_tokens) totalOutputTokens = parsed.usage.completion_tokens;
      }

      const choice = parsed.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta || {};

      // 1. 处理推理思考内容 (DeepSeek R1 / GLM reasoning)
      const reasoning = delta.reasoning_content || delta.reasoning;
      if (reasoning) {
        if (!textBlockStarted) {
          textBlockStarted = true;
          sendEvent('content_block_start', {
            type: 'content_block_start',
            index: currentBlockIndex,
            content_block: { type: 'text', text: '' },
          });
        }
        sendEvent('content_block_delta', {
          type: 'content_block_delta',
          index: currentBlockIndex,
          delta: { type: 'text_delta', text: reasoning },
        });
      }

      // 2. 处理普通文本增量
      if (delta.content) {
        if (!textBlockStarted) {
          textBlockStarted = true;
          sendEvent('content_block_start', {
            type: 'content_block_start',
            index: currentBlockIndex,
            content_block: { type: 'text', text: '' },
          });
        }
        sendEvent('content_block_delta', {
          type: 'content_block_delta',
          index: currentBlockIndex,
          delta: { type: 'text_delta', text: delta.content },
        });
      }

      // 3. 处理工具调用增量
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const tcIdx = tc.index ?? 0;
          if (!activeToolIndexMap.has(tcIdx)) {
            // 如果前面有文本块未关闭，先关闭文本块
            if (textBlockStarted) {
              sendEvent('content_block_stop', {
                type: 'content_block_stop',
                index: currentBlockIndex,
              });
              textBlockStarted = false;
              currentBlockIndex += 1;
            }

            const toolBlockIdx = currentBlockIndex++;
            activeToolIndexMap.set(tcIdx, toolBlockIdx);

            sendEvent('content_block_start', {
              type: 'content_block_start',
              index: toolBlockIdx,
              content_block: {
                type: 'tool_use',
                id: tc.id || `call_${crypto.randomBytes(8).toString('hex')}`,
                name: tc.function?.name || 'tool',
                input: {},
              },
            });
          }

          const targetBlockIdx = activeToolIndexMap.get(tcIdx);
          if (tc.function?.arguments) {
            sendEvent('content_block_delta', {
              type: 'content_block_delta',
              index: targetBlockIdx,
              delta: {
                type: 'input_json_delta',
                partial_json: tc.function.arguments,
              },
            });
          }
        }
      }

      // 4. 处理结束原因
      if (choice.finish_reason) {
        const reason = choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn';
        finishStream(reason);
        return;
      }
    }
  }

  let streamEnded = false;

  function finishStream(stopReason = 'end_turn') {
    if (streamEnded) return;
    streamEnded = true;

    // 关闭所有未闭合的 content block
    if (textBlockStarted) {
      sendEvent('content_block_stop', {
        type: 'content_block_stop',
        index: currentBlockIndex,
      });
      textBlockStarted = false;
    }
    for (const [, bIdx] of activeToolIndexMap.entries()) {
      sendEvent('content_block_stop', {
        type: 'content_block_stop',
        index: bIdx,
      });
    }
    activeToolIndexMap.clear();

    sendEvent('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: stopReason,
        stop_sequence: null,
      },
      usage: {
        output_tokens: totalOutputTokens || 20,
      },
    });

    sendEvent('message_stop', {
      type: 'message_stop',
    });
  }

  return {
    write(chunk) {
      buffer += chunk.toString('utf8');
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        if (part.trim()) handleOpenAIChunk(part);
      }
    },
    end() {
      if (buffer.trim()) handleOpenAIChunk(buffer);
      if (!sentStart) ensureMessageStart(reqModel);
      finishStream('end_turn');
      res.end();
    },
  };
}
