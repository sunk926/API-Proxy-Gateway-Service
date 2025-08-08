/**
 * 配置管理模块
 * 用途：管理应用程序的所有配置项，包括环境变量、默认值和配置验证
 */

import { config } from 'dotenv';
import { AppConfig, LoadBalanceStrategy, CircuitBreakerConfig } from './types';

// 加载环境变量
config();

/**
 * 获取环境变量值，支持默认值和类型转换
 * @param key - 环境变量键名
 * @param defaultValue - 默认值
 * @param transform - 类型转换函数
 * @returns 环境变量值或默认值
 */
function getEnvVar<T>(
  key: string,
  defaultValue: T,
  transform?: (value: string) => T
): T {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  
  if (transform) {
    try {
      return transform(value);
    } catch (error) {
      console.warn(`配置项 ${key} 转换失败，使用默认值:`, error);
      return defaultValue;
    }
  }
  
  return value as unknown as T;
}

/**
 * 解析布尔值环境变量
 * @param value - 字符串值
 * @returns 布尔值
 */
function parseBoolean(value: string): boolean {
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * 解析数字环境变量
 * @param value - 字符串值
 * @returns 数字值
 */
function parseNumber(value: string): number {
  const num = Number(value);
  if (isNaN(num)) {
    throw new Error(`无效的数字值: ${value}`);
  }
  return num;
}

/**
 * 解析 JSON 环境变量
 * @param value - JSON 字符串
 * @returns 解析后的对象
 */
// function parseJSON<T>(value: string): T {
//   return JSON.parse(value) as T;
// }

/**
 * 解析 CORS 源配置
 * @param value - CORS 源字符串
 * @returns CORS 源配置
 */
function parseCorsOrigin(value: string): string | string[] {
  if (value === '*') {
    return '*';
  }
  return value.split(',').map(origin => origin.trim());
}

/**
 * 默认熔断器配置
 */
const defaultCircuitBreakerConfig: CircuitBreakerConfig = {
  failureThreshold: 3,
  resetTimeout: 60000, // 1分钟
  monitoringPeriod: 300000, // 5分钟
};

/**
 * 应用配置对象
 * 包含所有应用程序运行所需的配置项
 */
export const appConfig: AppConfig = {
  // 服务器配置
  port: getEnvVar('PORT', 3000, parseNumber),
  environment: getEnvVar('NODE_ENV', 'development') as 'development' | 'production' | 'test',
  
  // 日志配置
  logLevel: getEnvVar('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',
  
  // 负载均衡配置
  loadBalanceStrategy: getEnvVar(
    'LOAD_BALANCE_STRATEGY',
    LoadBalanceStrategy.ROUND_ROBIN
  ) as LoadBalanceStrategy,
  
  // 熔断器配置
  circuitBreaker: {
    failureThreshold: getEnvVar('CIRCUIT_BREAKER_FAILURE_THRESHOLD', 
      defaultCircuitBreakerConfig.failureThreshold, parseNumber),
    resetTimeout: getEnvVar('CIRCUIT_BREAKER_RESET_TIMEOUT', 
      defaultCircuitBreakerConfig.resetTimeout, parseNumber),
    monitoringPeriod: getEnvVar('CIRCUIT_BREAKER_MONITORING_PERIOD', 
      defaultCircuitBreakerConfig.monitoringPeriod, parseNumber),
  },
  
  // CORS 配置
  cors: {
    origin: getEnvVar('CORS_ORIGIN', '*', parseCorsOrigin),
    credentials: getEnvVar('CORS_CREDENTIALS', false, parseBoolean),
  },
};

/**
 * Gemini API 配置
 */
export const geminiConfig = {
  /** Gemini API 基础 URL */
  baseUrl: getEnvVar('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com'),
  /** API 版本 */
  apiVersion: getEnvVar('GEMINI_API_VERSION', 'v1beta'),
  /** 请求超时时间（毫秒） */
  timeout: getEnvVar('GEMINI_TIMEOUT', 30000, parseNumber),
  /** 重试次数 */
  retryCount: getEnvVar('GEMINI_RETRY_COUNT', 2, parseNumber),
  /** 重试延迟（毫秒） */
  retryDelay: getEnvVar('GEMINI_RETRY_DELAY', 1000, parseNumber),
};

/**
 * 速率限制配置
 */
export const rateLimitConfig = {
  /** 是否启用速率限制 */
  enabled: getEnvVar('RATE_LIMIT_ENABLED', false, parseBoolean),
  /** 时间窗口（毫秒） */
  windowMs: getEnvVar('RATE_LIMIT_WINDOW_MS', 60000, parseNumber), // 1分钟
  /** 最大请求数 */
  maxRequests: getEnvVar('RATE_LIMIT_MAX_REQUESTS', 100, parseNumber),
  /** 限制消息 */
  message: getEnvVar('RATE_LIMIT_MESSAGE', '请求过于频繁，请稍后再试'),
};

/**
 * 安全配置
 */
export const securityConfig = {
  /** 是否启用 Helmet 安全头 */
  helmetEnabled: getEnvVar('HELMET_ENABLED', true, parseBoolean),
  /** 是否启用请求体大小限制 */
  bodyLimitEnabled: getEnvVar('BODY_LIMIT_ENABLED', true, parseBoolean),
  /** 请求体大小限制（字节） */
  bodyLimit: getEnvVar('BODY_LIMIT', '10mb'),
  /** 是否启用 API Key 验证 */
  apiKeyValidationEnabled: getEnvVar('API_KEY_VALIDATION_ENABLED', true, parseBoolean),
};

/**
 * 监控配置
 */
export const monitoringConfig = {
  /** 是否启用性能监控 */
  enabled: getEnvVar('MONITORING_ENABLED', true, parseBoolean),
  /** 统计数据保留时间（毫秒） */
  statsRetentionTime: getEnvVar('STATS_RETENTION_TIME', 3600000, parseNumber), // 1小时
  /** 健康检查端点路径 */
  healthCheckPath: getEnvVar('HEALTH_CHECK_PATH', '/health'),
  /** 统计端点路径 */
  statsPath: getEnvVar('STATS_PATH', '/stats'),
};

/**
 * 验证配置的有效性
 * @throws {Error} 当配置无效时抛出错误
 */
export function validateConfig(): void {
  const errors: string[] = [];
  
  // 验证端口号
  if (appConfig.port < 1 || appConfig.port > 65535) {
    errors.push('端口号必须在 1-65535 范围内');
  }
  
  // 验证环境
  const validEnvironments = ['development', 'production', 'test'];
  if (!validEnvironments.includes(appConfig.environment)) {
    errors.push(`环境必须是以下之一: ${validEnvironments.join(', ')}`);
  }
  
  // 验证日志级别
  const validLogLevels = ['debug', 'info', 'warn', 'error'];
  if (!validLogLevels.includes(appConfig.logLevel)) {
    errors.push(`日志级别必须是以下之一: ${validLogLevels.join(', ')}`);
  }
  
  // 验证负载均衡策略
  const validStrategies = Object.values(LoadBalanceStrategy);
  if (!validStrategies.includes(appConfig.loadBalanceStrategy)) {
    errors.push(`负载均衡策略必须是以下之一: ${validStrategies.join(', ')}`);
  }
  
  // 验证熔断器配置
  if (appConfig.circuitBreaker.failureThreshold < 1) {
    errors.push('熔断器失败阈值必须大于 0');
  }
  
  if (appConfig.circuitBreaker.resetTimeout < 1000) {
    errors.push('熔断器重置超时时间必须至少为 1000 毫秒');
  }
  
  if (appConfig.circuitBreaker.monitoringPeriod < 10000) {
    errors.push('熔断器监控周期必须至少为 10000 毫秒');
  }
  
  // 验证 Gemini 配置
  if (geminiConfig.timeout < 1000) {
    errors.push('Gemini API 超时时间必须至少为 1000 毫秒');
  }
  
  if (geminiConfig.retryCount < 0) {
    errors.push('Gemini API 重试次数不能为负数');
  }
  
  if (errors.length > 0) {
    throw new Error(`配置验证失败:\n${errors.join('\n')}`);
  }
}

/**
 * 获取当前运行环境是否为生产环境
 * @returns 是否为生产环境
 */
export function isProduction(): boolean {
  return appConfig.environment === 'production';
}

/**
 * 获取当前运行环境是否为开发环境
 * @returns 是否为开发环境
 */
export function isDevelopment(): boolean {
  return appConfig.environment === 'development';
}

/**
 * 获取当前运行环境是否为测试环境
 * @returns 是否为测试环境
 */
export function isTest(): boolean {
  return appConfig.environment === 'test';
}

// 在模块加载时验证配置
try {
  validateConfig();
} catch (error) {
  console.error('配置验证失败:', error);
  process.exit(1);
}
