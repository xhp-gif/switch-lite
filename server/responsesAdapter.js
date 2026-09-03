import crypto from 'node:crypto';

/**
 * 将 Codex 发送的 Responses API 请求体转换为标准 OpenAI Chat Completions 格式
 */
export function responsesToOpenAIChat(body, targetModel = '') {
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

  if (typeof body.max_output_tokens === 'number') {
    out.max_tokens = body.max_output_tokens;
  } else if (typeof body.max_tokens === 'number') {
    out.max_tokens = body.max_tokens;
  } else {
    // Codex 未配置 model_max_output_tokens 时不带 max_tokens，上游会用很小的默认值；
    // Kimi K3 等思考模型的推理 token 也会消耗该预算，思考中途被截断就返回空内容，
    // 表现为任务干到一半静默停止。给一个宽松的缺省预算。
    out.max_tokens = 32768;
  }

  if (out.stream) {
    // 让上游在流末尾回传 usage：Codex 靠它做上下文预算，relay 靠它计量
    out.stream_options = { include_usage: true };
  }

  if (typeof body.temperature === 'number') {
    out.temperature = body.temperature;
  }
  if (typeof body.top_p === 'number') {
    out.top_p = body.top_p;
  }

  // 1. 系统提示词 (instructions -> role: 'system')
  if (body.instructions) {
    let sysText = '';
    if (typeof body.instructions === 'string') {
      sysText = body.instructions;
    } else if (Array.isArray(body.instructions)) {
      sysText = body.instructions
        .map((s) => (typeof s === 'string' ? s : s?.text || ''))
        .filter(Boolean)
        .join('\n\n');
    }
    if (sysText) {
      out.messages.push({ role: 'system', content: sysText });
    }
  }

  // 2. input 列表转换
  if (typeof body.input === 'string') {
    out.messages.push({ role: 'user', content: body.input });
  } else if (Array.isArray(body.input)) {
    // 严格网关（Moonshot/智谱等）要求 assistant 的 tool_calls 后必须紧跟对应的 tool 消息。
    // Codex 并行工具调用会把多条 function_call 连续放进 input：必须合并为同一条 assistant
    // 消息的 tool_calls 数组，拆成多条 assistant 消息会被判 "tool_call_ids did not have
    // response messages"（v0.6.0 接 Kimi 报错的根因）。
    let pendingToolCalls = null;
    const knownCallIds = new Set();
    const flushPendingToolCalls = () => {
      if (pendingToolCalls) {
        out.messages.push({ role: 'assistant', content: null, tool_calls: pendingToolCalls });
        pendingToolCalls = null;
      }
    };

    for (const item of body.input) {
      if (!item || typeof item !== 'object') continue;

      // 如果已经是传统消息格式 {role, content}
      if (!item.type && item.role) {
        flushPendingToolCalls();
        out.messages.push({
          role: item.role,
          content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content ?? ''),
        });
        continue;
      }

      // message 类型
      if (item.type === 'message') {
        flushPendingToolCalls();
        const role = item.role === 'assistant' ? 'assistant' : 'user';
        let textParts = [];
        let imageParts = [];

        if (typeof item.content === 'string') {
          textParts.push(item.content);
        } else if (Array.isArray(item.content)) {
          for (const part of item.content) {
            if (!part || typeof part !== 'object') continue;
            if (part.type === 'input_text' || part.type === 'output_text' || part.type === 'text') {
              if (part.text) textParts.push(part.text);
            } else if (part.type === 'input_image' || part.type === 'image_url' || part.type === 'image') {
              let url = '';
              if (typeof part.image_url === 'string') {
                url = part.image_url;
              } else if (part.image_url && typeof part.image_url === 'object' && part.image_url.url) {
                url = part.image_url.url;
              } else if (typeof part.url === 'string') {
                url = part.url;
              } else if (part.source && part.source.data) {
                const mediaType = part.source.media_type || 'image/jpeg';
                url = `data:${mediaType};base64,${part.source.data}`;
              } else if (part.data) {
                const mediaType = part.mime_type || part.media_type || 'image/jpeg';
                url = `data:${mediaType};base64,${part.data}`;
              }
              if (url) {
                imageParts.push({ type: 'image_url', image_url: { url } });
              }
            }
          }
        }

        if (imageParts.length > 0) {
          const content = [];
          if (textParts.length > 0) {
            content.push({ type: 'text', text: textParts.join('\n') });
          }
          content.push(...imageParts);
          out.messages.push({ role, content });
        } else {
          out.messages.push({ role, content: textParts.join('\n') });
        }
        continue;
      }

      // 顶级 input_image / image_url 项
      if (item.type === 'input_image' || item.type === 'image_url') {
        flushPendingToolCalls();
        let url = '';
        if (typeof item.image_url === 'string') {
          url = item.image_url;
        } else if (item.image_url && typeof item.image_url === 'object' && item.image_url.url) {
          url = item.image_url.url;
        } else if (typeof item.url === 'string') {
          url = item.url;
        } else if (item.source && item.source.data) {
          const mediaType = item.source.media_type || 'image/jpeg';
          url = `data:${mediaType};base64,${item.source.data}`;
        }
        if (url) {
          out.messages.push({
            role: 'user',
            content: [{ type: 'image_url', image_url: { url } }],
          });
        }
        continue;
      }

      // function_call / custom_tool_call 类型 (assistant 发起的工具调用历史)
      // 连续出现的调用先攒进 pendingToolCalls，遇到其他类型条目或 input 结束时统一落盘，
      // 保证一轮多个并行调用只产生一条 assistant 消息。
      if (item.type === 'function_call' || item.type === 'custom_tool_call') {
        const callId = item.call_id || item.id || `call_${crypto.randomBytes(6).toString('hex')}`;
        const name = item.name || 'custom_tool';
        let args = '';
        if (typeof item.arguments === 'string') args = item.arguments;
        else if (typeof item.input === 'string') args = item.input;
        else args = JSON.stringify(item.arguments ?? item.input ?? {});

        if (!pendingToolCalls) pendingToolCalls = [];
        pendingToolCalls.push({
          id: callId,
          type: 'function',
          function: {
            name,
            arguments: args,
          },
        });
        knownCallIds.add(callId);
        continue;
      }

      // function_call_output / custom_tool_call_output 类型 (工具执行结果)
      if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') {
        const callId = item.call_id || item.id || '';
        // 孤儿 tool 消息（找不到对应调用，如 local_shell_call 被剥离后的残留）同样会被
        // 严格网关 400，直接丢弃
        if (!callId || !knownCallIds.has(callId)) continue;
        flushPendingToolCalls();
        let contentStr = '';
        if (typeof item.output === 'string') {
          contentStr = item.output;
        } else {
          contentStr = JSON.stringify(item.output ?? '');
        }

        out.messages.push({
          role: 'tool',
          tool_call_id: callId,
          content: contentStr,
        });
        continue;
      }
    }
    flushPendingToolCalls();
  }

  // 3. 工具声明转换 (tools)
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    const validTools = [];
    for (const t of body.tools) {
      if (!t || typeof t !== 'object') continue;
      // 支持 standard function 格式或 flat 格式
      if (t.type === 'function') {
        if (t.function && t.function.name) {
          validTools.push(t);
        } else if (t.name) {
          validTools.push({
            type: 'function',
            function: {
              name: t.name,
              description: t.description || '',
              parameters: t.parameters || t.input_schema || { type: 'object', properties: {} },
            },
          });
        }
      }
    }
    if (validTools.length > 0) {
      out.tools = validTools;
    }
  }

  // tool_choice
  if (body.tool_choice) {
    out.tool_choice = body.tool_choice;
  }

  return JSON.stringify(out);
}

/**
 * 将 OpenAI 非流式响应转换为 Responses API 格式
 */
export function openAIToResponsesResponse(openAIBody, reqModel = '') {
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
  const output = [];
  const respId = data.id ? `resp_${data.id.replace(/^chatcmpl-/, '')}` : `resp_${crypto.randomBytes(12).toString('hex')}`;
  const now = Math.floor(Date.now() / 1000);

  // 思考模型的推理内容单独成条目，不混入 assistant 正文
  if (msg.reasoning_content) {
    output.push({
      type: 'reasoning',
      id: `rs_${crypto.randomBytes(8).toString('hex')}`,
      summary: [{ type: 'summary_text', text: String(msg.reasoning_content) }],
      content: [],
    });
  }

  if (msg.content) {
    output.push({
      type: 'message',
      id: `msg_${crypto.randomBytes(8).toString('hex')}`,
      role: 'assistant',
      status: 'completed',
      content: [
        {
          type: 'output_text',
          text: msg.content,
        },
      ],
    });
  }

  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      output.push({
        type: 'function_call',
        id: tc.id || `fc_${crypto.randomBytes(8).toString('hex')}`,
        call_id: tc.id || `call_${crypto.randomBytes(8).toString('hex')}`,
        name: tc.function?.name || 'tool',
        arguments: tc.function?.arguments || '{}',
        status: 'completed',
      });
    }
  }

  const promptTokens = Number(data.usage?.prompt_tokens) || 0;
  const completionTokens = Number(data.usage?.completion_tokens) || 0;
  const truncated = choice.finish_reason === 'length';

  return JSON.stringify({
    id: respId,
    object: 'response',
    created_at: now,
    status: truncated ? 'incomplete' : 'completed',
    ...(truncated ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
    model: data.model || reqModel || 'unknown',
    output,
    usage: {
      input_tokens: promptTokens,
      output_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  });
}

/**
 * 流式转换器：读取 OpenAI SSE 流，转换为 Responses API SSE 事件流写入 res
 */
export function createOpenAIToResponsesStreamTransformer(res, reqModel = '') {
  const respId = `resp_${crypto.randomBytes(12).toString('hex')}`;
  const msgId = `msg_${crypto.randomBytes(8).toString('hex')}`;
  const reasoningId = `rs_${crypto.randomBytes(8).toString('hex')}`;
  let sentCreated = false;
  let textOutputStarted = false;
  let textOutputIndex = 0;
  let accumulatedText = '';
  let reasoningStarted = false;
  let reasoningOutputIndex = 0;
  let accumulatedReasoning = '';
  let activeToolMap = new Map(); // tcIdx -> { outputIndex, id, callId, name, arguments }
  let nextOutputIndex = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let cachedTokens = 0;
  let buffer = '';
  let modelName = reqModel || 'unknown';
  let streamEnded = false;
  let finishReason = '';

  function sendEvent(eventType, eventData) {
    res.write(`event: ${eventType}\ndata: ${JSON.stringify(eventData)}\n\n`);
  }

  function ensureResponseCreated(model) {
    if (!sentCreated) {
      sentCreated = true;
      if (model) modelName = model;
      sendEvent('response.created', {
        type: 'response.created',
        response: {
          id: respId,
          object: 'response',
          created_at: Math.floor(Date.now() / 1000),
          status: 'in_progress',
          model: modelName,
          output: [],
          usage: null,
        },
      });
    }
  }

  function ensureTextOutputStarted() {
    if (!textOutputStarted) {
      textOutputStarted = true;
      textOutputIndex = nextOutputIndex++;
      sendEvent('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: textOutputIndex,
        item: {
          type: 'message',
          id: msgId,
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      });
      sendEvent('response.content_part.added', {
        type: 'response.content_part.added',
        output_index: textOutputIndex,
        content_index: 0,
        part: {
          type: 'output_text',
          text: '',
        },
      });
    }
  }

  function ensureReasoningStarted() {
    if (!reasoningStarted) {
      reasoningStarted = true;
      reasoningOutputIndex = nextOutputIndex++;
      sendEvent('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: reasoningOutputIndex,
        item: {
          type: 'reasoning',
          id: reasoningId,
          summary: [],
          content: [],
        },
      });
      sendEvent('response.reasoning_summary_part.added', {
        type: 'response.reasoning_summary_part.added',
        output_index: reasoningOutputIndex,
        summary_index: 0,
        part: { type: 'summary_text', text: '' },
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
        finishStream();
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(dataStr);
      } catch {
        continue;
      }

      const m = parsed.model || reqModel;
      ensureResponseCreated(m);

      if (parsed.usage) {
        if (parsed.usage.prompt_tokens) totalInputTokens = parsed.usage.prompt_tokens;
        if (parsed.usage.completion_tokens) totalOutputTokens = parsed.usage.completion_tokens;
        if (parsed.usage.prompt_tokens_details?.cached_tokens) {
          cachedTokens = parsed.usage.prompt_tokens_details.cached_tokens;
        }
      }

      const choice = parsed.choices?.[0];
      if (!choice) continue;

      if (choice.finish_reason) finishReason = choice.finish_reason;

      const delta = choice.delta || {};

      // 1. 普通文本内容（注意：reasoning_content 不在这里，见下）
      const textChunk = delta.content || '';
      if (textChunk) {
        ensureTextOutputStarted();
        accumulatedText += textChunk;
        sendEvent('response.output_text.delta', {
          type: 'response.output_text.delta',
          output_index: textOutputIndex,
          content_index: 0,
          delta: textChunk,
        });
      }

      // 1.5 思考模型的推理内容（Kimi K3 reasoning_content 等）转成 Responses reasoning 条目。
      // 不能并入正文：会被 Codex 当成 assistant 发言存进历史，模型看到自己的思考记录后
      // 常常把"思考结论"直接当回答输出、不再调用工具，表现为任务干一半就停。
      const reasoningChunk = delta.reasoning_content || delta.reasoning || '';
      if (reasoningChunk) {
        ensureReasoningStarted();
        accumulatedReasoning += reasoningChunk;
        sendEvent('response.reasoning_summary_text.delta', {
          type: 'response.reasoning_summary_text.delta',
          output_index: reasoningOutputIndex,
          summary_index: 0,
          delta: reasoningChunk,
        });
      }

      // 2. 处理工具调用增量
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const tcIdx = tc.index ?? 0;
          if (!activeToolMap.has(tcIdx)) {
            const outIdx = nextOutputIndex++;
            const callId = tc.id || `call_${crypto.randomBytes(8).toString('hex')}`;
            const name = tc.function?.name || 'tool';
            const toolInfo = {
              outputIndex: outIdx,
              id: tc.id || `fc_${crypto.randomBytes(8).toString('hex')}`,
              callId,
              name,
              arguments: '',
            };
            activeToolMap.set(tcIdx, toolInfo);

            sendEvent('response.output_item.added', {
              type: 'response.output_item.added',
              output_index: outIdx,
              item: {
                type: 'function_call',
                id: toolInfo.id,
                call_id: callId,
                name,
                arguments: '',
                status: 'in_progress',
              },
            });
          }

          const toolInfo = activeToolMap.get(tcIdx);
          if (tc.function?.arguments) {
            toolInfo.arguments += tc.function.arguments;
            sendEvent('response.function_call_arguments.delta', {
              type: 'response.function_call_arguments.delta',
              output_index: toolInfo.outputIndex,
              call_id: toolInfo.callId,
              delta: tc.function.arguments,
            });
          }
        }
      }
    }
  }

  function finishStream() {
    if (streamEnded) return;
    streamEnded = true;

    // 0. 关闭思考输出块
    if (reasoningStarted) {
      sendEvent('response.reasoning_summary_text.done', {
        type: 'response.reasoning_summary_text.done',
        output_index: reasoningOutputIndex,
        summary_index: 0,
        text: accumulatedReasoning,
      });
      sendEvent('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: reasoningOutputIndex,
        item: {
          type: 'reasoning',
          id: reasoningId,
          summary: accumulatedReasoning ? [{ type: 'summary_text', text: accumulatedReasoning }] : [],
          content: [],
        },
      });
    }

    // 1. 关闭文本输出块
    if (textOutputStarted) {
      sendEvent('response.output_text.done', {
        type: 'response.output_text.done',
        output_index: textOutputIndex,
        content_index: 0,
        text: accumulatedText,
      });
      sendEvent('response.content_part.done', {
        type: 'response.content_part.done',
        output_index: textOutputIndex,
        content_index: 0,
        part: {
          type: 'output_text',
          text: accumulatedText,
        },
      });
      sendEvent('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: textOutputIndex,
        item: {
          type: 'message',
          id: msgId,
          role: 'assistant',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              text: accumulatedText,
            },
          ],
        },
      });
    }

    // 2. 关闭所有工具调用块
    for (const [, toolInfo] of activeToolMap.entries()) {
      sendEvent('response.function_call_arguments.done', {
        type: 'response.function_call_arguments.done',
        output_index: toolInfo.outputIndex,
        call_id: toolInfo.callId,
        arguments: toolInfo.arguments,
      });
      sendEvent('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: toolInfo.outputIndex,
        item: {
          type: 'function_call',
          id: toolInfo.id,
          call_id: toolInfo.callId,
          name: toolInfo.name,
          arguments: toolInfo.arguments,
          status: 'completed',
        },
      });
    }

    // 3. 发送 response.completed / response.incomplete
    // 上游 length 截断（思考 token 烧完预算导致空响应是典型场景）必须如实标记，
    // 否则 Codex 把半截响应当正常完成，任务静默中断。
    const truncated = finishReason === 'length';
    const finalOutput = [];
    if (reasoningStarted) {
      finalOutput.push({
        type: 'reasoning',
        id: reasoningId,
        summary: accumulatedReasoning ? [{ type: 'summary_text', text: accumulatedReasoning }] : [],
        content: [],
      });
    }
    if (textOutputStarted) {
      finalOutput.push({
        type: 'message',
        id: msgId,
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: accumulatedText }],
      });
    }
    for (const [, toolInfo] of activeToolMap.entries()) {
      finalOutput.push({
        type: 'function_call',
        id: toolInfo.id,
        call_id: toolInfo.callId,
        name: toolInfo.name,
        arguments: toolInfo.arguments,
        status: 'completed',
      });
    }

    sendEvent(truncated ? 'response.incomplete' : 'response.completed', {
      type: truncated ? 'response.incomplete' : 'response.completed',
      response: {
        id: respId,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        status: truncated ? 'incomplete' : 'completed',
        ...(truncated ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
        model: modelName,
        output: finalOutput,
        usage: {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens || 1,
          total_tokens: totalInputTokens + (totalOutputTokens || 1),
          ...(cachedTokens ? { input_tokens_details: { cached_tokens: cachedTokens } } : {}),
        },
      },
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
      if (!sentCreated) ensureResponseCreated(reqModel);
      finishStream();
      res.end();
    },
  };
}
