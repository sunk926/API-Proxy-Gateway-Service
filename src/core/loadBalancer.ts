/**
 * 负载均衡器模块
 * 用途：实现多个 API Key 的智能负载均衡，支持轮询、随机等策略
 */

import { ApiKeyInfo, ApiKeyStatus, LoadBalanceStrategy } from '@/utils/types';
import { LoadBalancerException } from '@/utils/exceptions';
import { logger, maskApiKey } from '@/utils/logger';
import { appConfig } from '@/utils/config';

/**
 * 负载均衡器类
 * 管理多个 API Key 的分发和状态跟踪
 */
export class LoadBalancer {
  private apiKeys: Map<string, ApiKeyInfo> = new Map();
  private roundRobinIndex: number = 0;
  private strategy: LoadBalanceStrategy;

  constructor(strategy: LoadBalanceStrategy = appConfig.loadBalanceStrategy) {
    this.strategy = strategy;
    logger.info(`负载均衡器初始化，策略: ${strategy}`);
  }

  /**
   * 添加 API Key 到负载均衡器
   * @param apiKey - API Key 字符串
   */
  addApiKey(apiKey: string): void {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new LoadBalancerException('无效的 API Key');
    }

    if (this.apiKeys.has(apiKey)) {
      logger.warn(`API Key 已存在: ${maskApiKey(apiKey)}`);
      return;
    }

    const keyInfo: ApiKeyInfo = {
      key: apiKey,
      status: ApiKeyStatus.AVAILABLE,
      failureCount: 0,
      requestCount: 0,
      successCount: 0,
    };

    this.apiKeys.set(apiKey, keyInfo);
    logger.info(`添加 API Key: ${maskApiKey(apiKey)}`);
  }

  /**
   * 批量添加 API Key
   * @param apiKeys - API Key 数组
   */
  addApiKeys(apiKeys: string[]): void {
    if (!Array.isArray(apiKeys)) {
      throw new LoadBalancerException('API Keys 必须是数组');
    }

    apiKeys.forEach(key => {
      try {
        this.addApiKey(key);
      } catch (error) {
        logger.error(`添加 API Key 失败: ${maskApiKey(key)}`, error);
      }
    });

    logger.info(`批量添加 API Key 完成，总数: ${this.apiKeys.size}`);
  }

  /**
   * 移除 API Key
   * @param apiKey - 要移除的 API Key
   */
  removeApiKey(apiKey: string): void {
    if (this.apiKeys.delete(apiKey)) {
      logger.info(`移除 API Key: ${maskApiKey(apiKey)}`);
    } else {
      logger.warn(`尝试移除不存在的 API Key: ${maskApiKey(apiKey)}`);
    }
  }

  /**
   * 获取可用的 API Key 列表
   * @returns 可用的 API Key 信息数组
   */
  getAvailableKeys(): ApiKeyInfo[] {
    return Array.from(this.apiKeys.values()).filter(
      keyInfo => keyInfo.status === ApiKeyStatus.AVAILABLE
    );
  }

  /**
   * 获取被熔断的 API Key 列表
   * @returns 被熔断的 API Key 信息数组
   */
  getCircuitBrokenKeys(): ApiKeyInfo[] {
    return Array.from(this.apiKeys.values()).filter(
      keyInfo => keyInfo.status === ApiKeyStatus.CIRCUIT_BROKEN
    );
  }

  /**
   * 选择一个可用的 API Key
   * @returns 选中的 API Key 字符串
   * @throws {LoadBalancerException} 当没有可用的 API Key 时
   */
  selectApiKey(): string {
    const availableKeys = this.getAvailableKeys();

    if (availableKeys.length === 0) {
      throw new LoadBalancerException('没有可用的 API Key', {
        totalKeys: this.apiKeys.size,
        circuitBrokenKeys: this.getCircuitBrokenKeys().length,
      });
    }

    let selectedKey: string;

    switch (this.strategy) {
      case LoadBalanceStrategy.ROUND_ROBIN:
        selectedKey = this.selectRoundRobin(availableKeys);
        break;
      case LoadBalanceStrategy.RANDOM:
        selectedKey = this.selectRandom(availableKeys);
        break;
      case LoadBalanceStrategy.LEAST_CONNECTIONS:
        selectedKey = this.selectLeastConnections(availableKeys);
        break;
      default:
        selectedKey = this.selectRoundRobin(availableKeys);
    }

    // 更新请求计数
    const keyInfo = this.apiKeys.get(selectedKey);
    if (keyInfo) {
      keyInfo.requestCount++;
    }

    logger.loadBalance(this.strategy, maskApiKey(selectedKey), availableKeys.length);
    return selectedKey;
  }

  /**
   * 轮询策略选择 API Key
   * @param availableKeys - 可用的 API Key 列表
   * @returns 选中的 API Key
   */
  private selectRoundRobin(availableKeys: ApiKeyInfo[]): string {
    const selectedKey = availableKeys[this.roundRobinIndex % availableKeys.length];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % availableKeys.length;
    return selectedKey!.key;
  }

  /**
   * 随机策略选择 API Key
   * @param availableKeys - 可用的 API Key 列表
   * @returns 选中的 API Key
   */
  private selectRandom(availableKeys: ApiKeyInfo[]): string {
    const randomIndex = Math.floor(Math.random() * availableKeys.length);
    return availableKeys[randomIndex]!.key;
  }

  /**
   * 最少连接策略选择 API Key
   * @param availableKeys - 可用的 API Key 列表
   * @returns 选中的 API Key
   */
  private selectLeastConnections(availableKeys: ApiKeyInfo[]): string {
    let selectedKey = availableKeys[0]!;
    let minRequests = selectedKey.requestCount;

    for (const keyInfo of availableKeys) {
      if (keyInfo.requestCount < minRequests) {
        minRequests = keyInfo.requestCount;
        selectedKey = keyInfo;
      }
    }

    return selectedKey.key;
  }

  /**
   * 记录 API Key 请求成功
   * @param apiKey - API Key 字符串
   */
  recordSuccess(apiKey: string): void {
    const keyInfo = this.apiKeys.get(apiKey);
    if (!keyInfo) {
      logger.warn(`尝试记录不存在的 API Key 成功: ${maskApiKey(apiKey)}`);
      return;
    }

    keyInfo.successCount++;
    keyInfo.failureCount = 0; // 重置失败计数
    
    // 如果之前被熔断，现在恢复
    if (keyInfo.status === ApiKeyStatus.CIRCUIT_BROKEN) {
      keyInfo.status = ApiKeyStatus.AVAILABLE;
      delete keyInfo.circuitBreakerResetTime;
      logger.info(`API Key 恢复可用: ${maskApiKey(apiKey)}`);
    }

    logger.debug(`记录 API Key 成功: ${maskApiKey(apiKey)}`, {
      successCount: keyInfo.successCount,
      requestCount: keyInfo.requestCount,
    });
  }

  /**
   * 记录 API Key 请求失败
   * @param apiKey - API Key 字符串
   * @param error - 错误信息
   */
  recordFailure(apiKey: string, error?: unknown): void {
    const keyInfo = this.apiKeys.get(apiKey);
    if (!keyInfo) {
      logger.warn(`尝试记录不存在的 API Key 失败: ${maskApiKey(apiKey)}`);
      return;
    }

    keyInfo.failureCount++;
    keyInfo.lastFailureTime = new Date();

    logger.debug(`记录 API Key 失败: ${maskApiKey(apiKey)}`, {
      failureCount: keyInfo.failureCount,
      error: error instanceof Error ? error.message : String(error),
    });

    // 检查是否需要熔断
    if (keyInfo.failureCount >= appConfig.circuitBreaker.failureThreshold) {
      this.circuitBreakApiKey(apiKey);
    }
  }

  /**
   * 熔断指定的 API Key
   * @param apiKey - 要熔断的 API Key
   */
  private circuitBreakApiKey(apiKey: string): void {
    const keyInfo = this.apiKeys.get(apiKey);
    if (!keyInfo) {
      return;
    }

    keyInfo.status = ApiKeyStatus.CIRCUIT_BROKEN;
    keyInfo.circuitBreakerResetTime = new Date(
      Date.now() + appConfig.circuitBreaker.resetTimeout
    );

    logger.circuitBreaker('熔断', maskApiKey(apiKey), {
      failureCount: keyInfo.failureCount,
      resetTime: keyInfo.circuitBreakerResetTime,
    });
  }

  /**
   * 检查并恢复已过期的熔断 API Key
   */
  checkAndRecoverCircuitBrokenKeys(): void {
    const now = new Date();
    let recoveredCount = 0;

    for (const [apiKey, keyInfo] of this.apiKeys.entries()) {
      if (
        keyInfo.status === ApiKeyStatus.CIRCUIT_BROKEN &&
        keyInfo.circuitBreakerResetTime &&
        now >= keyInfo.circuitBreakerResetTime
      ) {
        keyInfo.status = ApiKeyStatus.AVAILABLE;
        keyInfo.failureCount = 0;
        delete keyInfo.circuitBreakerResetTime;
        delete keyInfo.lastFailureTime;
        
        recoveredCount++;
        logger.circuitBreaker('恢复', maskApiKey(apiKey));
      }
    }

    if (recoveredCount > 0) {
      logger.info(`恢复 ${recoveredCount} 个熔断的 API Key`);
    }
  }

  /**
   * 获取负载均衡器统计信息
   * @returns 统计信息对象
   */
  getStats(): {
    totalKeys: number;
    availableKeys: number;
    circuitBrokenKeys: number;
    invalidKeys: number;
    totalRequests: number;
    totalSuccesses: number;
    totalFailures: number;
    strategy: LoadBalanceStrategy;
  } {
    const keys = Array.from(this.apiKeys.values());
    
    return {
      totalKeys: keys.length,
      availableKeys: keys.filter(k => k.status === ApiKeyStatus.AVAILABLE).length,
      circuitBrokenKeys: keys.filter(k => k.status === ApiKeyStatus.CIRCUIT_BROKEN).length,
      invalidKeys: keys.filter(k => k.status === ApiKeyStatus.INVALID).length,
      totalRequests: keys.reduce((sum, k) => sum + k.requestCount, 0),
      totalSuccesses: keys.reduce((sum, k) => sum + k.successCount, 0),
      totalFailures: keys.reduce((sum, k) => sum + k.failureCount, 0),
      strategy: this.strategy,
    };
  }

  /**
   * 设置负载均衡策略
   * @param strategy - 新的负载均衡策略
   */
  setStrategy(strategy: LoadBalanceStrategy): void {
    this.strategy = strategy;
    this.roundRobinIndex = 0; // 重置轮询索引
    logger.info(`负载均衡策略已更改为: ${strategy}`);
  }

  /**
   * 清空所有 API Key
   */
  clear(): void {
    const count = this.apiKeys.size;
    this.apiKeys.clear();
    this.roundRobinIndex = 0;
    logger.info(`清空所有 API Key，共 ${count} 个`);
  }

  /**
   * 获取指定 API Key 的信息
   * @param apiKey - API Key 字符串
   * @returns API Key 信息或 undefined
   */
  getKeyInfo(apiKey: string): ApiKeyInfo | undefined {
    return this.apiKeys.get(apiKey);
  }

  /**
   * 检查是否有可用的 API Key
   * @returns 是否有可用的 API Key
   */
  hasAvailableKeys(): boolean {
    return this.getAvailableKeys().length > 0;
  }
}
