/**
 * 熔断器模块
 * 用途：实现熔断器模式，防止级联失败，提供自动恢复机制
 */

import { CircuitBreakerConfig } from '@/utils/types';
import { CircuitBreakerException } from '@/utils/exceptions';
import { logger, maskApiKey } from '@/utils/logger';
import { appConfig } from '@/utils/config';

/**
 * 熔断器状态枚举
 */
export enum CircuitBreakerState {
  CLOSED = 'closed',     // 关闭状态，正常工作
  OPEN = 'open',         // 开启状态，阻止请求
  HALF_OPEN = 'half_open', // 半开状态，允许少量请求测试
}

/**
 * 熔断器统计信息接口
 */
interface CircuitBreakerStats {
  requestCount: number;
  successCount: number;
  failureCount: number;
  lastRequestTime?: Date;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
}

/**
 * 熔断器实例接口
 */
interface CircuitBreakerInstance {
  state: CircuitBreakerState;
  stats: CircuitBreakerStats;
  stateChangeTime: Date;
  nextAttemptTime?: Date;
  halfOpenSuccessCount: number;
  halfOpenFailureCount: number;
}

/**
 * 熔断器管理器类
 * 为每个 API Key 维护独立的熔断器实例
 */
export class CircuitBreakerManager {
  private circuitBreakers: Map<string, CircuitBreakerInstance> = new Map();
  private config: CircuitBreakerConfig;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: CircuitBreakerConfig = appConfig.circuitBreaker) {
    this.config = config;
    this.startCleanupTimer();
    logger.info('熔断器管理器初始化', { config });
  }

  /**
   * 获取或创建指定 API Key 的熔断器实例
   * @param apiKey - API Key 字符串
   * @returns 熔断器实例
   */
  private getOrCreateCircuitBreaker(apiKey: string): CircuitBreakerInstance {
    let circuitBreaker = this.circuitBreakers.get(apiKey);
    
    if (!circuitBreaker) {
      circuitBreaker = {
        state: CircuitBreakerState.CLOSED,
        stats: {
          requestCount: 0,
          successCount: 0,
          failureCount: 0,
        },
        stateChangeTime: new Date(),
        halfOpenSuccessCount: 0,
        halfOpenFailureCount: 0,
      };
      
      this.circuitBreakers.set(apiKey, circuitBreaker);
      logger.debug(`为 API Key 创建熔断器: ${maskApiKey(apiKey)}`);
    }
    
    return circuitBreaker;
  }

  /**
   * 检查是否允许请求通过
   * @param apiKey - API Key 字符串
   * @returns 是否允许请求
   * @throws {CircuitBreakerException} 当熔断器阻止请求时
   */
  allowRequest(apiKey: string): boolean {
    const circuitBreaker = this.getOrCreateCircuitBreaker(apiKey);
    const now = new Date();

    // 更新统计信息
    circuitBreaker.stats.requestCount++;
    circuitBreaker.stats.lastRequestTime = now;

    switch (circuitBreaker.state) {
      case CircuitBreakerState.CLOSED:
        // 关闭状态，允许所有请求
        return true;

      case CircuitBreakerState.OPEN:
        // 检查是否到了尝试恢复的时间
        if (circuitBreaker.nextAttemptTime && now >= circuitBreaker.nextAttemptTime) {
          this.transitionToHalfOpen(apiKey, circuitBreaker);
          return true;
        }
        
        // 仍在熔断期间，拒绝请求
        throw new CircuitBreakerException(
          `API Key ${maskApiKey(apiKey)} 已被熔断`,
          {
            state: circuitBreaker.state,
            nextAttemptTime: circuitBreaker.nextAttemptTime,
            failureCount: circuitBreaker.stats.failureCount,
          }
        );

      case CircuitBreakerState.HALF_OPEN:
        // 半开状态，允许少量请求进行测试
        return true;

      default:
        return true;
    }
  }

  /**
   * 记录请求成功
   * @param apiKey - API Key 字符串
   */
  recordSuccess(apiKey: string): void {
    const circuitBreaker = this.circuitBreakers.get(apiKey);
    if (!circuitBreaker) {
      return;
    }

    const now = new Date();
    circuitBreaker.stats.successCount++;
    circuitBreaker.stats.lastSuccessTime = now;

    switch (circuitBreaker.state) {
      case CircuitBreakerState.HALF_OPEN:
        circuitBreaker.halfOpenSuccessCount++;
        
        // 如果半开状态下连续成功次数达到阈值，转为关闭状态
        if (circuitBreaker.halfOpenSuccessCount >= 3) {
          this.transitionToClosed(apiKey, circuitBreaker);
        }
        break;

      case CircuitBreakerState.CLOSED:
        // 在关闭状态下，成功请求有助于重置失败计数
        this.resetFailureCount(circuitBreaker);
        break;
    }

    logger.debug(`熔断器记录成功: ${maskApiKey(apiKey)}`, {
      state: circuitBreaker.state,
      successCount: circuitBreaker.stats.successCount,
      halfOpenSuccessCount: circuitBreaker.halfOpenSuccessCount,
    });
  }

  /**
   * 记录请求失败
   * @param apiKey - API Key 字符串
   * @param error - 错误信息
   */
  recordFailure(apiKey: string, error?: unknown): void {
    const circuitBreaker = this.getOrCreateCircuitBreaker(apiKey);
    const now = new Date();

    circuitBreaker.stats.failureCount++;
    circuitBreaker.stats.lastFailureTime = now;

    switch (circuitBreaker.state) {
      case CircuitBreakerState.CLOSED:
        // 检查是否达到失败阈值
        if (this.shouldTripCircuitBreaker(circuitBreaker)) {
          this.transitionToOpen(apiKey, circuitBreaker);
        }
        break;

      case CircuitBreakerState.HALF_OPEN:
        circuitBreaker.halfOpenFailureCount++;
        // 半开状态下任何失败都会立即转为开启状态
        this.transitionToOpen(apiKey, circuitBreaker);
        break;
    }

    logger.debug(`熔断器记录失败: ${maskApiKey(apiKey)}`, {
      state: circuitBreaker.state,
      failureCount: circuitBreaker.stats.failureCount,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  /**
   * 检查是否应该触发熔断器
   * @param circuitBreaker - 熔断器实例
   * @returns 是否应该触发熔断器
   */
  private shouldTripCircuitBreaker(circuitBreaker: CircuitBreakerInstance): boolean {
    const { stats } = circuitBreaker;
    // 简化实现：如果连续失败次数达到阈值就触发
    return stats.failureCount >= this.config.failureThreshold;
  }

  /**
   * 转换到开启状态（熔断）
   * @param apiKey - API Key 字符串
   * @param circuitBreaker - 熔断器实例
   */
  private transitionToOpen(apiKey: string, circuitBreaker: CircuitBreakerInstance): void {
    circuitBreaker.state = CircuitBreakerState.OPEN;
    circuitBreaker.stateChangeTime = new Date();
    circuitBreaker.nextAttemptTime = new Date(Date.now() + this.config.resetTimeout);
    circuitBreaker.halfOpenSuccessCount = 0;
    circuitBreaker.halfOpenFailureCount = 0;

    logger.circuitBreaker('开启', maskApiKey(apiKey), {
      failureCount: circuitBreaker.stats.failureCount,
      nextAttemptTime: circuitBreaker.nextAttemptTime,
    });
  }

  /**
   * 转换到半开状态
   * @param apiKey - API Key 字符串
   * @param circuitBreaker - 熔断器实例
   */
  private transitionToHalfOpen(apiKey: string, circuitBreaker: CircuitBreakerInstance): void {
    circuitBreaker.state = CircuitBreakerState.HALF_OPEN;
    circuitBreaker.stateChangeTime = new Date();
    circuitBreaker.halfOpenSuccessCount = 0;
    circuitBreaker.halfOpenFailureCount = 0;
    delete circuitBreaker.nextAttemptTime;

    logger.circuitBreaker('半开', maskApiKey(apiKey), {
      previousFailureCount: circuitBreaker.stats.failureCount,
    });
  }

  /**
   * 转换到关闭状态（正常）
   * @param apiKey - API Key 字符串
   * @param circuitBreaker - 熔断器实例
   */
  private transitionToClosed(apiKey: string, circuitBreaker: CircuitBreakerInstance): void {
    circuitBreaker.state = CircuitBreakerState.CLOSED;
    circuitBreaker.stateChangeTime = new Date();
    circuitBreaker.halfOpenSuccessCount = 0;
    circuitBreaker.halfOpenFailureCount = 0;
    this.resetFailureCount(circuitBreaker);

    logger.circuitBreaker('关闭', maskApiKey(apiKey), {
      recoveredAt: circuitBreaker.stateChangeTime,
    });
  }

  /**
   * 重置失败计数
   * @param circuitBreaker - 熔断器实例
   */
  private resetFailureCount(circuitBreaker: CircuitBreakerInstance): void {
    circuitBreaker.stats.failureCount = 0;
    delete circuitBreaker.stats.lastFailureTime;
  }

  /**
   * 获取指定 API Key 的熔断器状态
   * @param apiKey - API Key 字符串
   * @returns 熔断器状态
   */
  getState(apiKey: string): CircuitBreakerState {
    const circuitBreaker = this.circuitBreakers.get(apiKey);
    return circuitBreaker ? circuitBreaker.state : CircuitBreakerState.CLOSED;
  }

  /**
   * 获取指定 API Key 的统计信息
   * @param apiKey - API Key 字符串
   * @returns 统计信息
   */
  getStats(apiKey: string): CircuitBreakerStats | undefined {
    const circuitBreaker = this.circuitBreakers.get(apiKey);
    return circuitBreaker ? { ...circuitBreaker.stats } : undefined;
  }

  /**
   * 获取所有熔断器的统计信息
   * @returns 所有熔断器的统计信息
   */
  getAllStats(): Record<string, {
    state: CircuitBreakerState;
    stats: CircuitBreakerStats;
    stateChangeTime: Date;
    nextAttemptTime?: Date;
  }> {
    const result: Record<string, any> = {};
    
    for (const [apiKey, circuitBreaker] of this.circuitBreakers.entries()) {
      result[maskApiKey(apiKey)] = {
        state: circuitBreaker.state,
        stats: { ...circuitBreaker.stats },
        stateChangeTime: circuitBreaker.stateChangeTime,
        nextAttemptTime: circuitBreaker.nextAttemptTime,
      };
    }
    
    return result;
  }

  /**
   * 手动重置指定 API Key 的熔断器
   * @param apiKey - API Key 字符串
   */
  reset(apiKey: string): void {
    const circuitBreaker = this.circuitBreakers.get(apiKey);
    if (circuitBreaker) {
      this.transitionToClosed(apiKey, circuitBreaker);
      logger.info(`手动重置熔断器: ${maskApiKey(apiKey)}`);
    }
  }

  /**
   * 重置所有熔断器
   */
  resetAll(): void {
    for (const [apiKey] of this.circuitBreakers.entries()) {
      this.reset(apiKey);
    }
    logger.info('重置所有熔断器');
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    // 每5分钟清理一次过期的熔断器实例
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  /**
   * 清理过期的熔断器实例
   */
  private cleanup(): void {
    const now = new Date();
    const expireTime = 24 * 60 * 60 * 1000; // 24小时
    let cleanedCount = 0;

    for (const [apiKey, circuitBreaker] of this.circuitBreakers.entries()) {
      const lastActivity = circuitBreaker.stats.lastRequestTime || circuitBreaker.stateChangeTime;
      
      if (now.getTime() - lastActivity.getTime() > expireTime) {
        this.circuitBreakers.delete(apiKey);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`清理 ${cleanedCount} 个过期的熔断器实例`);
    }
  }

  /**
   * 销毁熔断器管理器
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      delete this.cleanupInterval;
    }
    
    this.circuitBreakers.clear();
    logger.info('熔断器管理器已销毁');
  }
}
