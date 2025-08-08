/**
 * OpenAI 适配器模块
 * 用途：实现 OpenAI API 格式与 Gemini API 格式之间的双向转换
 */

import { v4 as uuidv4 } from 'uuid';
import {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIMessage,
  OpenAIChoice,
  OpenAIUsage,
  GeminiGenerateContentRequest,
  GeminiGenerateContentResponse,
  GeminiContent,
  GeminiPart,
  GeminiCandidate,
} from '@/utils/types';
import { FormatConversionException } from '@/utils/exceptions';
import { logger } from '@/utils/logger';

/**
 * OpenAI 到 Gemini 适配器类
 * 负责在两种 API 格式之间进行转换
 */
export class OpenAIAdapter {
  /**
   * 将 OpenAI 请求转换为 Gemini 请求
   * @param openaiRequest - OpenAI 格式的请求
   * @returns Gemini 格式的请求
   */
  static convertRequestToGemini(
    openaiRequest: OpenAIChatCompletionRequest
  ): GeminiGenerateContentRequest {
    try {
      logger.debug('转换 OpenAI 请求到 Gemini 格式', {
        model: openaiRequest.model,
        messagesCount: openaiRequest.messages.length,
        stream: openaiRequest.stream,
      });

      const geminiRequest: GeminiGenerateContentRequest = {
        contents: this.convertMessagesToContents(openaiRequest.messages),
      };

      // 转换生成配置
      if (this.hasGenerationConfig(openaiRequest)) {
        geminiRequest.generationConfig = this.convertGenerationConfig(openaiRequest);
      }

      // 转换工具定义
      if (openaiRequest.tools && openaiRequest.tools.length > 0) {
        geminiRequest.tools = this.convertTools(openaiRequest.tools);
      }

      // 添加安全设置（使用宽松设置以兼容更多内容）
      geminiRequest.safetySettings = this.getDefaultSafetySettings();

      return geminiRequest;

    } catch (error) {
      logger.error('OpenAI 请求转换失败', error);
      throw new FormatConversionException(
        'OpenAI 请求格式转换失败',
        { originalRequest: openaiRequest, error }
      );
    }
  }

  /**
   * 将 Gemini 响应转换为 OpenAI 响应
   * @param geminiResponse - Gemini 格式的响应
   * @param originalRequest - 原始的 OpenAI 请求
   * @returns OpenAI 格式的响应
   */
  static convertResponseToOpenAI(
    geminiResponse: GeminiGenerateContentResponse,
    originalRequest: OpenAIChatCompletionRequest
  ): OpenAIChatCompletionResponse {
    try {
      logger.debug('转换 Gemini 响应到 OpenAI 格式', {
        candidatesCount: geminiResponse.candidates?.length || 0,
        hasUsage: !!geminiResponse.usageMetadata,
      });

      const openaiResponse: OpenAIChatCompletionResponse = {
        id: `chatcmpl-${uuidv4().replace(/-/g, '')}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: this.mapGeminiModelToOpenAI(originalRequest.model),
        choices: this.convertCandidatesToChoices(geminiResponse.candidates || []),
      };

      // 转换使用统计
      if (geminiResponse.usageMetadata) {
        openaiResponse.usage = this.convertUsageMetadata(geminiResponse.usageMetadata);
      }

      // 添加系统指纹（可选）
      openaiResponse.system_fingerprint = 'fp_gemini_proxy';

      return openaiResponse;

    } catch (error) {
      logger.error('Gemini 响应转换失败', error);
      throw new FormatConversionException(
        'Gemini 响应格式转换失败',
        { originalResponse: geminiResponse, error }
      );
    }
  }

  /**
   * 将 OpenAI 消息数组转换为 Gemini 内容数组
   * @param messages - OpenAI 消息数组
   * @returns Gemini 内容数组
   */
  private static convertMessagesToContents(messages: OpenAIMessage[]): GeminiContent[] {
    const contents: GeminiContent[] = [];
    let systemInstruction: string | undefined;

    for (const message of messages) {
      if (message.role === 'system') {
        // Gemini 的系统指令需要特殊处理
        systemInstruction = message.content;
        continue;
      }

      const content: GeminiContent = {
        role: this.mapOpenAIRoleToGemini(message.role),
        parts: this.convertMessageContentToParts(message),
      };

      contents.push(content);
    }

    // 如果有系统指令，将其作为第一个用户消息的前缀
    if (systemInstruction && contents.length > 0 && contents[0]?.role === 'user') {
      const firstUserContent = contents[0];
      if (firstUserContent.parts[0]?.text) {
        firstUserContent.parts[0].text = `${systemInstruction}\n\n${firstUserContent.parts[0].text}`;
      }
    }

    return contents;
  }

  /**
   * 将 OpenAI 消息内容转换为 Gemini 部分数组
   * @param message - OpenAI 消息
   * @returns Gemini 部分数组
   */
  private static convertMessageContentToParts(message: OpenAIMessage): GeminiPart[] {
    const parts: GeminiPart[] = [];

    // 处理文本内容
    if (message.content) {
      parts.push({ text: message.content });
    }

    // 处理工具调用
    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        if (toolCall.type === 'function') {
          parts.push({
            functionCall: {
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments),
            },
          });
        }
      }
    }

    // 处理工具响应
    if (message.role === 'tool' && message.tool_call_id) {
      parts.push({
        functionResponse: {
          name: message.name || 'unknown_function',
          response: JSON.parse(message.content),
        },
      });
    }

    return parts.length > 0 ? parts : [{ text: '' }];
  }

  /**
   * 将 Gemini 候选项转换为 OpenAI 选择项
   * @param candidates - Gemini 候选项数组
   * @returns OpenAI 选择项数组
   */
  private static convertCandidatesToChoices(candidates: GeminiCandidate[]): OpenAIChoice[] {
    if (candidates.length === 0) {
      // 如果没有候选项，返回一个默认的错误响应
      return [{
        index: 0,
        message: {
          role: 'assistant',
          content: '抱歉，无法生成响应。请检查您的请求内容。',
        },
        finish_reason: 'content_filter',
      }];
    }

    return candidates.map((candidate, index) => {
      const choice: OpenAIChoice = {
        index: candidate.index ?? index,
        message: this.convertGeminiContentToOpenAIMessage(candidate.content),
        finish_reason: this.mapGeminiFinishReasonToOpenAI(candidate.finishReason),
      };

      return choice;
    });
  }

  /**
   * 将 Gemini 内容转换为 OpenAI 消息
   * @param content - Gemini 内容
   * @returns OpenAI 消息
   */
  private static convertGeminiContentToOpenAIMessage(content?: GeminiContent): OpenAIMessage {
    if (!content || !content.parts) {
      return {
        role: 'assistant',
        content: '',
      };
    }

    const message: OpenAIMessage = {
      role: 'assistant',
      content: '',
    };

    const textParts: string[] = [];
    const toolCalls: any[] = [];

    for (const part of content.parts) {
      if (part.text) {
        textParts.push(part.text);
      }

      if (part.functionCall) {
        toolCalls.push({
          id: `call_${uuidv4().replace(/-/g, '')}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args),
          },
        });
      }
    }

    message.content = textParts.join('');

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
      message.content = message.content || '';
    }

    return message;
  }

  /**
   * 转换生成配置
   * @param openaiRequest - OpenAI 请求
   * @returns Gemini 生成配置
   */
  private static convertGenerationConfig(openaiRequest: OpenAIChatCompletionRequest) {
    const config: any = {};

    if (openaiRequest.temperature !== undefined) {
      config.temperature = Math.max(0, Math.min(2, openaiRequest.temperature));
    }

    if (openaiRequest.max_tokens !== undefined) {
      config.maxOutputTokens = openaiRequest.max_tokens;
    }

    if (openaiRequest.top_p !== undefined) {
      config.topP = Math.max(0, Math.min(1, openaiRequest.top_p));
    }

    if (openaiRequest.stop) {
      config.stopSequences = Array.isArray(openaiRequest.stop) 
        ? openaiRequest.stop 
        : [openaiRequest.stop];
    }

    return config;
  }

  /**
   * 转换工具定义
   * @param tools - OpenAI 工具数组
   * @returns Gemini 工具数组
   */
  private static convertTools(tools: any[]) {
    return [{
      functionDeclarations: tools
        .filter(tool => tool.type === 'function')
        .map(tool => ({
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        })),
    }];
  }

  /**
   * 转换使用统计
   * @param usageMetadata - Gemini 使用元数据
   * @returns OpenAI 使用统计
   */
  private static convertUsageMetadata(usageMetadata: any): OpenAIUsage {
    return {
      prompt_tokens: usageMetadata.promptTokenCount || 0,
      completion_tokens: usageMetadata.candidatesTokenCount || 0,
      total_tokens: usageMetadata.totalTokenCount || 0,
    };
  }

  /**
   * 映射 OpenAI 角色到 Gemini 角色
   * @param role - OpenAI 角色
   * @returns Gemini 角色
   */
  private static mapOpenAIRoleToGemini(role: string): 'user' | 'model' | 'function' {
    switch (role) {
      case 'user':
        return 'user';
      case 'assistant':
        return 'model';
      case 'tool':
        return 'function';
      default:
        return 'user';
    }
  }

  /**
   * 映射 Gemini 完成原因到 OpenAI 完成原因
   * @param finishReason - Gemini 完成原因
   * @returns OpenAI 完成原因
   */
  private static mapGeminiFinishReasonToOpenAI(
    finishReason?: string
  ): 'stop' | 'length' | 'function_call' | 'tool_calls' | 'content_filter' | null {
    switch (finishReason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
        return 'content_filter';
      case 'OTHER':
        return 'stop';
      default:
        return null;
    }
  }

  /**
   * 映射 Gemini 模型名到 OpenAI 模型名
   * @param model - 原始模型名
   * @returns OpenAI 兼容的模型名
   */
  private static mapGeminiModelToOpenAI(model: string): string {
    // 保持原始模型名，或者映射到常见的 OpenAI 模型名
    const modelMappings: Record<string, string> = {
      'gemini-1.5-pro': 'gpt-4',
      'gemini-1.5-flash': 'gpt-3.5-turbo',
      'gemini-pro': 'gpt-3.5-turbo',
    };

    return modelMappings[model] || model;
  }

  /**
   * 检查是否有生成配置参数
   * @param request - OpenAI 请求
   * @returns 是否有生成配置
   */
  private static hasGenerationConfig(request: OpenAIChatCompletionRequest): boolean {
    return !!(
      request.temperature !== undefined ||
      request.max_tokens !== undefined ||
      request.top_p !== undefined ||
      request.stop !== undefined
    );
  }

  /**
   * 获取默认安全设置
   * @returns 默认安全设置数组
   */
  private static getDefaultSafetySettings() {
    const categories = [
      'HARM_CATEGORY_HATE_SPEECH',
      'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      'HARM_CATEGORY_DANGEROUS_CONTENT',
      'HARM_CATEGORY_HARASSMENT',
    ];

    return categories.map(category => ({
      category,
      threshold: 'BLOCK_NONE', // 使用最宽松的设置
    }));
  }

  /**
   * 生成流式响应的数据块
   * @param chunk - Gemini 流式响应块
   * @param originalRequest - 原始请求
   * @returns OpenAI 格式的流式数据块
   */
  static convertStreamChunkToOpenAI(
    chunk: any,
    originalRequest: OpenAIChatCompletionRequest
  ): string {
    try {
      const openaiChunk = {
        id: `chatcmpl-${uuidv4().replace(/-/g, '')}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: this.mapGeminiModelToOpenAI(originalRequest.model),
        choices: [{
          index: 0,
          delta: this.convertGeminiChunkToDelta(chunk),
          finish_reason: this.mapGeminiFinishReasonToOpenAI(chunk.finishReason),
        }],
      };

      return `data: ${JSON.stringify(openaiChunk)}\n\n`;

    } catch (error) {
      logger.error('流式响应块转换失败', error);
      return `data: {"error": "转换失败"}\n\n`;
    }
  }

  /**
   * 将 Gemini 流式块转换为 OpenAI delta 格式
   * @param chunk - Gemini 流式块
   * @returns OpenAI delta 对象
   */
  private static convertGeminiChunkToDelta(chunk: any): any {
    const delta: any = {};

    if (chunk.candidates && chunk.candidates[0]) {
      const candidate = chunk.candidates[0];
      
      if (candidate.content && candidate.content.parts) {
        const textParts = candidate.content.parts
          .filter((part: any) => part.text)
          .map((part: any) => part.text);
        
        if (textParts.length > 0) {
          delta.content = textParts.join('');
        }
      }
    }

    return delta;
  }

  /**
   * 生成流式响应结束标记
   * @returns 结束标记字符串
   */
  static getStreamEndMarker(): string {
    return 'data: [DONE]\n\n';
  }
}
