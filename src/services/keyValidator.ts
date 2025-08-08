/**
 * API Key 验证服务模块
 * 用途：提供批量 API Key 验证功能，支持并发验证和流式响应
 */

import { GeminiClient } from '@/adapters/geminiClient';
import { KeyValidationResult } from '@/utils/types';
import { ValidationException } from '@/utils/exceptions';
import { logger, maskApiKey } from '@/utils/logger';

/**
 * API Key 验证服务类
 * 提供单个和批量 API Key 验证功能
 */
export class KeyValidatorService {
  private geminiClient: GeminiClient;
  private maxConcurrentValidations: number;
  private validationTimeout: number;

  constructor() {
    this.geminiClient = new GeminiClient();
    this.maxConcurrentValidations = 10; // 最大并发验证数
    this.validationTimeout = 15000; // 验证超时时间（15秒）

    logger.info('API Key 验证服务初始化', {
      maxConcurrent: this.maxConcurrentValidations,
      timeout: this.validationTimeout,
    });
  }

  /**
   * 验证单个 API Key
   * @param apiKey - 要验证的 API Key
   * @returns 验证结果
   */
  async validateSingleKey(apiKey: string): Promise<KeyValidationResult> {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return {
        key: maskApiKey(apiKey || ''),
        status: 'BAD',
        error: 'API Key 不能为空',
        responseTime: 0,
      };
    }

    const startTime = Date.now();
    
    try {
      logger.debug(`开始验证 API Key: ${maskApiKey(apiKey)}`);
      
      const result = await Promise.race([
        this.geminiClient.validateApiKey(apiKey),
        this.createTimeoutPromise(),
      ]);

      const responseTime = Date.now() - startTime;

      if (result.valid) {
        logger.info(`API Key 验证成功: ${maskApiKey(apiKey)}`, {
          responseTime,
        });
        
        return {
          key: maskApiKey(apiKey),
          status: 'GOOD',
          responseTime,
        };
      } else {
        logger.warn(`API Key 验证失败: ${maskApiKey(apiKey)}`, {
          error: result.error,
          responseTime,
        });
        
        return {
          key: maskApiKey(apiKey),
          status: 'BAD',
          error: result.error || '验证失败',
          responseTime,
        };
      }

    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error(`API Key 验证出错: ${maskApiKey(apiKey)}`, {
        error: errorMessage,
        responseTime,
      });

      return {
        key: maskApiKey(apiKey),
        status: 'ERROR',
        error: errorMessage,
        responseTime,
      };
    }
  }

  /**
   * 批量验证 API Key
   * @param apiKeys - API Key 数组
   * @returns 验证结果数组
   */
  async validateMultipleKeys(apiKeys: string[]): Promise<KeyValidationResult[]> {
    if (!Array.isArray(apiKeys)) {
      throw new ValidationException('API Keys 必须是数组');
    }

    if (apiKeys.length === 0) {
      throw new ValidationException('API Keys 数组不能为空');
    }

    if (apiKeys.length > 50) {
      throw new ValidationException('一次最多只能验证 50 个 API Key');
    }

    logger.info(`开始批量验证 API Key`, {
      count: apiKeys.length,
      maxConcurrent: this.maxConcurrentValidations,
    });

    const results: KeyValidationResult[] = [];
    
    // 分批处理，控制并发数量
    for (let i = 0; i < apiKeys.length; i += this.maxConcurrentValidations) {
      const batch = apiKeys.slice(i, i + this.maxConcurrentValidations);
      
      logger.debug(`处理第 ${Math.floor(i / this.maxConcurrentValidations) + 1} 批`, {
        batchSize: batch.length,
        startIndex: i,
      });

      const batchPromises = batch.map(apiKey => this.validateSingleKey(apiKey));
      const batchResults = await Promise.all(batchPromises);
      
      results.push(...batchResults);
    }

    const summary = this.generateValidationSummary(results);
    logger.info('批量验证完成', summary);

    return results;
  }

  /**
   * 创建流式验证响应
   * @param apiKeys - API Key 数组
   * @returns ReadableStream 流式响应
   */
  createStreamValidation(apiKeys: string[]): ReadableStream<Uint8Array> {
    if (!Array.isArray(apiKeys) || apiKeys.length === 0) {
      throw new ValidationException('API Keys 数组不能为空');
    }

    if (apiKeys.length > 50) {
      throw new ValidationException('一次最多只能验证 50 个 API Key');
    }

    logger.info(`开始流式验证 API Key`, {
      count: apiKeys.length,
    });

    return new ReadableStream({
      start: async (controller) => {
        try {
          // 分批处理验证
          for (let i = 0; i < apiKeys.length; i += this.maxConcurrentValidations) {
            const batch = apiKeys.slice(i, i + this.maxConcurrentValidations);
            
            // 并发验证当前批次
            const batchPromises = batch.map(async (apiKey) => {
              const result = await this.validateSingleKey(apiKey);
              
              // 立即发送结果
              const data = `data: ${JSON.stringify(result)}\n\n`;
              controller.enqueue(new TextEncoder().encode(data));
              
              return result;
            });

            // 等待当前批次完成
            await Promise.all(batchPromises);
          }

          // 发送完成标记
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();

        } catch (error) {
          logger.error('流式验证过程中出错', error);
          
          const errorData = {
            error: error instanceof Error ? error.message : String(error),
          };
          
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(errorData)}\n\n`)
          );
          controller.close();
        }
      },
    });
  }

  /**
   * 解析 API Key 字符串
   * @param apiKeyString - 逗号分隔的 API Key 字符串
   * @returns 清理后的 API Key 数组
   */
  parseApiKeyString(apiKeyString: string): string[] {
    if (!apiKeyString || typeof apiKeyString !== 'string') {
      return [];
    }

    return apiKeyString
      .split(',')
      .map(key => key.trim())
      .filter(key => key.length > 0)
      .filter((key, index, array) => array.indexOf(key) === index); // 去重
  }

  /**
   * 验证 API Key 格式
   * @param apiKey - API Key 字符串
   * @returns 是否格式有效
   */
  validateApiKeyFormat(apiKey: string): boolean {
    if (!apiKey || typeof apiKey !== 'string') {
      return false;
    }

    // Google API Key 通常以 AIza 开头，长度约为 39 字符
    const googleApiKeyPattern = /^AIza[0-9A-Za-z_-]{35}$/;
    
    return googleApiKeyPattern.test(apiKey);
  }

  /**
   * 批量验证 API Key 格式
   * @param apiKeys - API Key 数组
   * @returns 格式验证结果
   */
  validateApiKeyFormats(apiKeys: string[]): {
    valid: string[];
    invalid: string[];
    duplicates: string[];
  } {
    const valid: string[] = [];
    const invalid: string[] = [];
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const apiKey of apiKeys) {
      if (seen.has(apiKey)) {
        duplicates.push(apiKey);
        continue;
      }
      
      seen.add(apiKey);
      
      if (this.validateApiKeyFormat(apiKey)) {
        valid.push(apiKey);
      } else {
        invalid.push(apiKey);
      }
    }

    return { valid, invalid, duplicates };
  }

  /**
   * 生成验证摘要
   * @param results - 验证结果数组
   * @returns 验证摘要
   */
  private generateValidationSummary(results: KeyValidationResult[]): {
    total: number;
    good: number;
    bad: number;
    error: number;
    averageResponseTime: number;
  } {
    const total = results.length;
    const good = results.filter(r => r.status === 'GOOD').length;
    const bad = results.filter(r => r.status === 'BAD').length;
    const error = results.filter(r => r.status === 'ERROR').length;
    
    const totalResponseTime = results.reduce((sum, r) => sum + (r.responseTime || 0), 0);
    const averageResponseTime = total > 0 ? Math.round(totalResponseTime / total) : 0;

    return {
      total,
      good,
      bad,
      error,
      averageResponseTime,
    };
  }

  /**
   * 创建超时 Promise
   * @returns 超时 Promise
   */
  private createTimeoutPromise(): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`验证超时 (${this.validationTimeout}ms)`));
      }, this.validationTimeout);
    });
  }

  /**
   * 获取验证服务统计信息
   * @returns 统计信息
   */
  getStats(): {
    maxConcurrentValidations: number;
    validationTimeout: number;
  } {
    return {
      maxConcurrentValidations: this.maxConcurrentValidations,
      validationTimeout: this.validationTimeout,
    };
  }

  /**
   * 设置最大并发验证数
   * @param maxConcurrent - 最大并发数
   */
  setMaxConcurrentValidations(maxConcurrent: number): void {
    if (maxConcurrent < 1 || maxConcurrent > 20) {
      throw new ValidationException('最大并发验证数必须在 1-20 之间');
    }
    
    this.maxConcurrentValidations = maxConcurrent;
    logger.info(`更新最大并发验证数: ${maxConcurrent}`);
  }

  /**
   * 设置验证超时时间
   * @param timeout - 超时时间（毫秒）
   */
  setValidationTimeout(timeout: number): void {
    if (timeout < 5000 || timeout > 60000) {
      throw new ValidationException('验证超时时间必须在 5000-60000 毫秒之间');
    }
    
    this.validationTimeout = timeout;
    logger.info(`更新验证超时时间: ${timeout}ms`);
  }

  /**
   * 快速检查 API Key 是否可能有效（仅格式检查）
   * @param apiKey - API Key 字符串
   * @returns 快速检查结果
   */
  quickCheck(apiKey: string): {
    formatValid: boolean;
    length: number;
    prefix: string;
  } {
    const formatValid = this.validateApiKeyFormat(apiKey);
    const length = apiKey ? apiKey.length : 0;
    const prefix = apiKey ? apiKey.substring(0, 4) : '';

    return {
      formatValid,
      length,
      prefix,
    };
  }
}
