/**
 * Gemini API 客户端模块
 * 用途：封装与 Google Gemini API 的交互，提供统一的接口
 */

import fetch from 'node-fetch';
import {
  GeminiGenerateContentRequest,
  GeminiGenerateContentResponse,
} from '@/utils/types';
import {
  UpstreamServiceException,
  NetworkException,
  ParseException,
  GatewayTimeoutException,
} from '@/utils/exceptions';
import { logger, maskApiKey } from '@/utils/logger';
import { geminiConfig } from '@/utils/config';

/**
 * Gemini API 客户端类
 * 负责与 Google Gemini API 进行通信
 */
export class GeminiClient {
  private baseUrl: string;
  private apiVersion: string;
  private timeout: number;
  private retryCount: number;
  private retryDelay: number;

  constructor() {
    this.baseUrl = geminiConfig.baseUrl;
    this.apiVersion = geminiConfig.apiVersion;
    this.timeout = geminiConfig.timeout;
    this.retryCount = geminiConfig.retryCount;
    this.retryDelay = geminiConfig.retryDelay;

    logger.info('Gemini API 客户端初始化', {
      baseUrl: this.baseUrl,
      apiVersion: this.apiVersion,
      timeout: this.timeout,
    });
  }

  /**
   * 生成内容（非流式）
   * @param model - 模型名称
   * @param request - 请求参数
   * @param apiKey - API Key
   * @returns Gemini API 响应
   */
  async generateContent(
    model: string,
    request: GeminiGenerateContentRequest,
    apiKey: string
  ): Promise<GeminiGenerateContentResponse> {
    const url = this.buildUrl(model, 'generateContent');
    
    logger.debug(`调用 Gemini API: ${url}`, {
      model,
      apiKey: maskApiKey(apiKey),
      contentsCount: request.contents.length,
    });

    return this.makeRequest(url, request, apiKey);
  }

  /**
   * 生成内容（流式）
   * @param model - 模型名称
   * @param request - 请求参数
   * @param apiKey - API Key
   * @returns 流式响应的 ReadableStream
   */
  async generateContentStream(
    model: string,
    request: GeminiGenerateContentRequest,
    apiKey: string
  ): Promise<ReadableStream<Uint8Array>> {
    const url = this.buildUrl(model, 'streamGenerateContent', true);
    
    logger.debug(`调用 Gemini API (流式): ${url}`, {
      model,
      apiKey: maskApiKey(apiKey),
      contentsCount: request.contents.length,
    });

    const response = await this.makeStreamRequest(url, request, apiKey);
    
    if (!response.body) {
      throw new UpstreamServiceException('Gemini API 返回空的响应体');
    }

    return response.body;
  }

  /**
   * 构建 API URL
   * @param model - 模型名称
   * @param method - API 方法
   * @param isStream - 是否为流式请求
   * @returns 完整的 API URL
   */
  private buildUrl(model: string, method: string, isStream: boolean = false): string {
    const modelPath = model.startsWith('models/') ? model : `models/${model}`;
    let url = `${this.baseUrl}/${this.apiVersion}/${modelPath}:${method}`;
    
    if (isStream) {
      url += '?alt=sse';
    }
    
    return url;
  }

  /**
   * 发起 HTTP 请求
   * @param url - 请求 URL
   * @param body - 请求体
   * @param apiKey - API Key
   * @returns 解析后的响应
   */
  private async makeRequest(
    url: string,
    body: unknown,
    apiKey: string
  ): Promise<GeminiGenerateContentResponse> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retryCount; attempt++) {
      try {
        const response = await this.fetchWithTimeout(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          await this.handleErrorResponse(response, apiKey);
        }

        const responseText = await response.text();
        
        try {
          return JSON.parse(responseText) as GeminiGenerateContentResponse;
        } catch (parseError) {
          throw new ParseException('解析 Gemini API 响应失败', {
            responseText: responseText.substring(0, 500),
            parseError: parseError instanceof Error ? parseError.message : String(parseError),
          });
        }

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < this.retryCount && this.shouldRetry(error)) {
          logger.warn(`Gemini API 请求失败，第 ${attempt + 1} 次重试`, {
            apiKey: maskApiKey(apiKey),
            error: lastError.message,
            nextRetryIn: this.retryDelay,
          });
          
          await this.delay(this.retryDelay * (attempt + 1));
          continue;
        }
        
        break;
      }
    }

    // 所有重试都失败了
    throw this.wrapError(lastError!, apiKey);
  }

  /**
   * 发起流式 HTTP 请求
   * @param url - 请求 URL
   * @param body - 请求体
   * @param apiKey - API Key
   * @returns 流式响应
   */
  private async makeStreamRequest(
    url: string,
    body: unknown,
    apiKey: string
  ): Promise<Response> {
    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        await this.handleErrorResponse(response, apiKey);
      }

      return response;

    } catch (error) {
      throw this.wrapError(error, apiKey);
    }
  }

  /**
   * 带超时的 fetch 请求
   * @param url - 请求 URL
   * @param options - 请求选项
   * @returns fetch 响应
   */
  private async fetchWithTimeout(
    url: string,
    options: any
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      return response as unknown as Response;
      
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GatewayTimeoutException(`Gemini API 请求超时 (${this.timeout}ms)`);
      }
      
      throw error;
    }
  }

  /**
   * 处理错误响应
   * @param response - HTTP 响应
   * @param apiKey - API Key
   */
  private async handleErrorResponse(response: Response, _apiKey: string): Promise<never> {
    let errorBody: unknown;
    
    try {
      const responseText = await response.text();
      errorBody = JSON.parse(responseText);
    } catch {
      errorBody = { message: '无法解析错误响应' };
    }

    logger.error(`Gemini API 错误响应`, {
      status: response.status,
      statusText: response.statusText,
      apiKey: maskApiKey(_apiKey),
      errorBody,
    });

    throw new UpstreamServiceException(
      `Gemini API 请求失败: ${response.status} ${response.statusText}`,
      response.status,
      response.status,
      errorBody
    );
  }

  /**
   * 包装错误为适当的异常类型
   * @param error - 原始错误
   * @param apiKey - API Key
   * @returns 包装后的异常
   */
  private wrapError(error: unknown, _apiKey: string): Error {
    if (error instanceof UpstreamServiceException ||
        error instanceof GatewayTimeoutException ||
        error instanceof ParseException) {
      return error;
    }

    if (error instanceof Error) {
      if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
        return new GatewayTimeoutException(`Gemini API 请求超时: ${error.message}`);
      }
      
      if (error.message.includes('network') || 
          error.message.includes('ECONNREFUSED') ||
          error.message.includes('ENOTFOUND')) {
        return new NetworkException(`Gemini API 网络错误: ${error.message}`);
      }
    }

    return new UpstreamServiceException(
      `Gemini API 未知错误: ${error instanceof Error ? error.message : String(error)}`,
      502,
      undefined,
      { originalError: error }
    );
  }

  /**
   * 判断是否应该重试
   * @param error - 错误对象
   * @returns 是否应该重试
   */
  private shouldRetry(error: unknown): boolean {
    if (error instanceof UpstreamServiceException) {
      // 对于某些 HTTP 状态码不进行重试
      const noRetryStatuses = [400, 401, 403, 404];
      return !noRetryStatuses.includes(error.statusCode);
    }

    if (error instanceof GatewayTimeoutException ||
        error instanceof NetworkException) {
      return true;
    }

    return false;
  }

  /**
   * 延迟函数
   * @param ms - 延迟毫秒数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 验证 API Key 是否有效
   * @param apiKey - 要验证的 API Key
   * @returns 验证结果
   */
  async validateApiKey(apiKey: string): Promise<{
    valid: boolean;
    error?: string;
    responseTime: number;
  }> {
    const startTime = Date.now();
    
    try {
      const testRequest: GeminiGenerateContentRequest = {
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Hello' }],
          },
        ],
      };

      await this.generateContent('gemini-1.5-flash', testRequest, apiKey);
      
      return {
        valid: true,
        responseTime: Date.now() - startTime,
      };

    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
        responseTime: Date.now() - startTime,
      };
    }
  }

  /**
   * 获取可用的模型列表
   * @param apiKey - API Key
   * @returns 模型列表
   */
  async listModels(apiKey: string): Promise<any> {
    const url = `${this.baseUrl}/${this.apiVersion}/models`;
    
    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          'x-goog-api-key': apiKey,
        },
      });

      if (!response.ok) {
        await this.handleErrorResponse(response, apiKey);
      }

      const responseText = await response.text();
      return JSON.parse(responseText);

    } catch (error) {
      throw this.wrapError(error, apiKey);
    }
  }
}
