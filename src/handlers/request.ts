/**
 * 主请求处理器模块
 * 用途：统一处理所有 HTTP 请求，实现路由分发和核心业务逻辑
 */

import { Request, Response } from 'express';
import { LoadBalancer } from '@/core/loadBalancer';
import { CircuitBreakerManager } from '@/core/circuitBreaker';
import { GeminiClient } from '@/adapters/geminiClient';
import { OpenAIAdapter } from '@/adapters/openaiAdapter';
import { KeyValidatorService } from '@/services/keyValidator';
import {
  OpenAIChatCompletionRequest,
  GeminiGenerateContentRequest,
} from '@/utils/types';
import {
  ValidationException,
  AuthenticationException,
  MethodNotAllowedException,
  NotFoundException,
  isApiException,
  toApiException,
} from '@/utils/exceptions';
import { logger, maskApiKey } from '@/utils/logger';
import { appConfig } from '@/utils/config';

/**
 * 主请求处理器类
 * 协调各个组件完成请求处理
 */
export class RequestHandler {
  private loadBalancer: LoadBalancer;
  private circuitBreaker: CircuitBreakerManager;
  private geminiClient: GeminiClient;
  private keyValidator: KeyValidatorService;

  constructor() {
    this.loadBalancer = new LoadBalancer();
    this.circuitBreaker = new CircuitBreakerManager();
    this.geminiClient = new GeminiClient();
    this.keyValidator = new KeyValidatorService();

    // 启动定期任务
    this.startPeriodicTasks();

    logger.info('请求处理器初始化完成');
  }

  /**
   * 处理根路径请求
   * @param req - Express 请求对象
   * @param res - Express 响应对象
   */
  async handleRoot(req: Request, res: Response): Promise<void> {
    logger.http(req.method, req.path, 200, 0, req.get('User-Agent'));
    
    res.json({
      message: 'API 代理网关服务运行中',
      version: '1.0.0',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      endpoints: {
        chat: '/chat/completions',
        verify: '/verify',
        health: '/health',
        stats: '/stats',
      },
    });
  }

  /**
   * 处理 OpenAI Chat Completions 请求
   * @param req - Express 请求对象
   * @param res - Express 响应对象
   */
  async handleChatCompletions(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    let selectedApiKey: string | undefined;

    try {
      // 验证请求方法
      if (req.method !== 'POST') {
        throw new MethodNotAllowedException(`不支持的 HTTP 方法: ${req.method}`);
      }

      // 解析和验证请求
      const openaiRequest = this.parseOpenAIRequest(req);
      const apiKeys = this.extractApiKeys(req);

      // 添加 API Keys 到负载均衡器
      this.loadBalancer.addApiKeys(apiKeys);

      // 选择可用的 API Key
      selectedApiKey = this.loadBalancer.selectApiKey();

      // 检查熔断器状态
      this.circuitBreaker.allowRequest(selectedApiKey);

      // 转换请求格式
      const geminiRequest = OpenAIAdapter.convertRequestToGemini(openaiRequest);

      // 确定使用的模型
      const model = this.mapOpenAIModelToGemini(openaiRequest.model);

      logger.info('处理 Chat Completions 请求', {
        model,
        apiKey: maskApiKey(selectedApiKey),
        stream: openaiRequest.stream,
        messagesCount: openaiRequest.messages.length,
      });

      if (openaiRequest.stream) {
        await this.handleStreamingRequest(
          res,
          model,
          geminiRequest,
          selectedApiKey,
          openaiRequest
        );
      } else {
        await this.handleNonStreamingRequest(
          res,
          model,
          geminiRequest,
          selectedApiKey,
          openaiRequest
        );
      }

      // 记录成功
      this.recordSuccess(selectedApiKey);

      const responseTime = Date.now() - startTime;
      logger.http(req.method, req.path, 200, responseTime, req.get('User-Agent'));

    } catch (error) {
      // 记录失败
      if (selectedApiKey) {
        this.recordFailure(selectedApiKey, error);
      }

      const responseTime = Date.now() - startTime;
      await this.handleError(req, res, error, responseTime);
    }
  }

  /**
   * 处理 API Key 验证请求
   * @param req - Express 请求对象
   * @param res - Express 响应对象
   */
  async handleKeyVerification(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();

    try {
      // 验证请求方法
      if (req.method !== 'POST') {
        throw new MethodNotAllowedException(`不支持的 HTTP 方法: ${req.method}`);
      }

      const apiKeys = this.extractApiKeys(req);

      logger.info('处理 API Key 验证请求', {
        keyCount: apiKeys.length,
      });

      // 设置 SSE 响应头
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');

      // 创建流式验证
      const stream = this.keyValidator.createStreamValidation(apiKeys);
      const reader = stream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            break;
          }
          
          res.write(value);
        }
      } finally {
        reader.releaseLock();
      }

      res.end();

      const responseTime = Date.now() - startTime;
      logger.http(req.method, req.path, 200, responseTime, req.get('User-Agent'));

    } catch (error) {
      const responseTime = Date.now() - startTime;
      await this.handleError(req, res, error, responseTime);
    }
  }

  /**
   * 处理健康检查请求
   * @param req - Express 请求对象
   * @param res - Express 响应对象
   */
  async handleHealthCheck(req: Request, res: Response): Promise<void> {
    const stats = this.loadBalancer.getStats();
    
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      loadBalancer: {
        totalKeys: stats.totalKeys,
        availableKeys: stats.availableKeys,
        circuitBrokenKeys: stats.circuitBrokenKeys,
        strategy: stats.strategy,
      },
      environment: appConfig.environment,
    };

    logger.http(req.method, req.path, 200, 0, req.get('User-Agent'));
    res.json(health);
  }

  /**
   * 处理统计信息请求
   * @param req - Express 请求对象
   * @param res - Express 响应对象
   */
  async handleStats(req: Request, res: Response): Promise<void> {
    const loadBalancerStats = this.loadBalancer.getStats();
    const circuitBreakerStats = this.circuitBreaker.getAllStats();
    const keyValidatorStats = this.keyValidator.getStats();

    const stats = {
      timestamp: new Date().toISOString(),
      loadBalancer: loadBalancerStats,
      circuitBreaker: circuitBreakerStats,
      keyValidator: keyValidatorStats,
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version,
        platform: process.platform,
      },
    };

    logger.http(req.method, req.path, 200, 0, req.get('User-Agent'));
    res.json(stats);
  }

  /**
   * 处理 404 错误
   * @param req - Express 请求对象
   * @param res - Express 响应对象
   */
  async handleNotFound(req: Request, res: Response): Promise<void> {
    const error = new NotFoundException(`路径未找到: ${req.path}`);
    await this.handleError(req, res, error, 0);
  }

  /**
   * 解析 OpenAI 请求
   * @param req - Express 请求对象
   * @returns OpenAI 请求对象
   */
  private parseOpenAIRequest(req: Request): OpenAIChatCompletionRequest {
    const body = req.body;

    if (!body || typeof body !== 'object') {
      throw new ValidationException('请求体不能为空');
    }

    if (!body.messages || !Array.isArray(body.messages)) {
      throw new ValidationException('messages 字段是必需的且必须是数组');
    }

    if (body.messages.length === 0) {
      throw new ValidationException('messages 数组不能为空');
    }

    return body as OpenAIChatCompletionRequest;
  }

  /**
   * 提取 API Keys
   * @param req - Express 请求对象
   * @returns API Key 数组
   */
  private extractApiKeys(req: Request): string[] {
    // 从 Authorization header 提取
    const authHeader = req.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const keyString = authHeader.substring(7);
      const keys = this.keyValidator.parseApiKeyString(keyString);
      if (keys.length > 0) {
        return keys;
      }
    }

    // 从 x-goog-api-key header 提取
    const googleHeader = req.get('x-goog-api-key');
    if (googleHeader) {
      const keys = this.keyValidator.parseApiKeyString(googleHeader);
      if (keys.length > 0) {
        return keys;
      }
    }

    throw new AuthenticationException('未提供有效的 API Key');
  }

  /**
   * 处理非流式请求
   */
  private async handleNonStreamingRequest(
    res: Response,
    model: string,
    geminiRequest: GeminiGenerateContentRequest,
    apiKey: string,
    originalRequest: OpenAIChatCompletionRequest
  ): Promise<void> {
    const geminiResponse = await this.geminiClient.generateContent(
      model,
      geminiRequest,
      apiKey
    );

    const openaiResponse = OpenAIAdapter.convertResponseToOpenAI(
      geminiResponse,
      originalRequest
    );

    res.json(openaiResponse);
  }

  /**
   * 处理流式请求
   */
  private async handleStreamingRequest(
    res: Response,
    model: string,
    geminiRequest: GeminiGenerateContentRequest,
    apiKey: string,
    originalRequest: OpenAIChatCompletionRequest
  ): Promise<void> {
    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const stream = await this.geminiClient.generateContentStream(
      model,
      geminiRequest,
      apiKey
    );

    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          res.write(OpenAIAdapter.getStreamEndMarker());
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));
              const openaiChunk = OpenAIAdapter.convertStreamChunkToOpenAI(
                data,
                originalRequest
              );
              res.write(openaiChunk);
            } catch (parseError) {
              logger.warn('解析流式响应块失败', parseError);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    res.end();
  }

  /**
   * 映射 OpenAI 模型到 Gemini 模型
   * @param model - OpenAI 模型名
   * @returns Gemini 模型名
   */
  private mapOpenAIModelToGemini(model: string): string {
    const modelMappings: Record<string, string> = {
      'gpt-4': 'gemini-1.5-pro',
      'gpt-4-turbo': 'gemini-1.5-pro',
      'gpt-3.5-turbo': 'gemini-1.5-flash',
      'gpt-3.5-turbo-16k': 'gemini-1.5-flash',
    };

    return modelMappings[model] || 'gemini-1.5-flash';
  }

  /**
   * 记录成功请求
   * @param apiKey - API Key
   */
  private recordSuccess(apiKey: string): void {
    this.loadBalancer.recordSuccess(apiKey);
    this.circuitBreaker.recordSuccess(apiKey);
  }

  /**
   * 记录失败请求
   * @param apiKey - API Key
   * @param error - 错误信息
   */
  private recordFailure(apiKey: string, error: unknown): void {
    this.loadBalancer.recordFailure(apiKey, error);
    this.circuitBreaker.recordFailure(apiKey, error);
  }

  /**
   * 处理错误
   * @param req - Express 请求对象
   * @param res - Express 响应对象
   * @param error - 错误对象
   * @param responseTime - 响应时间
   */
  private async handleError(
    req: Request,
    res: Response,
    error: unknown,
    responseTime: number
  ): Promise<void> {
    const apiException = isApiException(error) ? error : toApiException(error);
    
    logger.error('请求处理失败', {
      path: req.path,
      method: req.method,
      error: apiException.message,
      statusCode: apiException.statusCode,
      responseTime,
    });

    logger.http(
      req.method,
      req.path,
      apiException.statusCode,
      responseTime,
      req.get('User-Agent')
    );

    if (!res.headersSent) {
      res.status(apiException.statusCode).json(apiException.toApiResponse());
    }
  }

  /**
   * 启动定期任务
   */
  private startPeriodicTasks(): void {
    // 每分钟检查并恢复熔断的 API Key
    setInterval(() => {
      this.loadBalancer.checkAndRecoverCircuitBrokenKeys();
    }, 60000);

    logger.info('定期任务已启动');
  }

  /**
   * 获取负载均衡器实例
   * @returns 负载均衡器实例
   */
  getLoadBalancer(): LoadBalancer {
    return this.loadBalancer;
  }

  /**
   * 获取熔断器管理器实例
   * @returns 熔断器管理器实例
   */
  getCircuitBreaker(): CircuitBreakerManager {
    return this.circuitBreaker;
  }

  /**
   * 销毁请求处理器
   */
  destroy(): void {
    this.circuitBreaker.destroy();
    logger.info('请求处理器已销毁');
  }
}
