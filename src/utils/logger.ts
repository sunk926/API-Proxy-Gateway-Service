/**
 * 日志工具模块
 * 用途：提供统一的日志记录功能，支持不同级别的日志输出和格式化
 */

import { appConfig } from './config';

/**
 * 日志级别枚举
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * 日志级别映射
 */
const LOG_LEVEL_MAP: Record<string, LogLevel> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
};

/**
 * 日志颜色配置
 */
const LOG_COLORS = {
  debug: '\x1b[36m', // 青色
  info: '\x1b[32m',  // 绿色
  warn: '\x1b[33m',  // 黄色
  error: '\x1b[31m', // 红色
  reset: '\x1b[0m',  // 重置
};

/**
 * 日志记录器类
 * 提供结构化的日志记录功能
 */
class Logger {
  private currentLevel: LogLevel;
  private enableColors: boolean;

  constructor() {
    this.currentLevel = LOG_LEVEL_MAP[appConfig.logLevel] || LogLevel.INFO;
    this.enableColors = process.stdout.isTTY && appConfig.environment !== 'production';
  }

  /**
   * 格式化时间戳
   * @returns 格式化的时间字符串
   */
  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * 格式化日志消息
   * @param level - 日志级别
   * @param message - 日志消息
   * @param meta - 元数据
   * @returns 格式化的日志字符串
   */
  private formatMessage(level: string, message: string, meta?: unknown): string {
    const timestamp = this.formatTimestamp();
    const levelUpper = level.toUpperCase().padEnd(5);
    
    let logMessage = `[${timestamp}] ${levelUpper} ${message}`;
    
    if (meta !== undefined) {
      if (typeof meta === 'object' && meta !== null) {
        logMessage += ` ${JSON.stringify(meta, null, 2)}`;
      } else {
        logMessage += ` ${String(meta)}`;
      }
    }
    
    return logMessage;
  }

  /**
   * 添加颜色到日志消息
   * @param level - 日志级别
   * @param message - 日志消息
   * @returns 带颜色的日志消息
   */
  private colorize(level: string, message: string): string {
    if (!this.enableColors) {
      return message;
    }
    
    const color = LOG_COLORS[level as keyof typeof LOG_COLORS] || '';
    return `${color}${message}${LOG_COLORS.reset}`;
  }

  /**
   * 检查是否应该记录指定级别的日志
   * @param level - 日志级别
   * @returns 是否应该记录
   */
  private shouldLog(level: LogLevel): boolean {
    return level >= this.currentLevel;
  }

  /**
   * 记录调试级别日志
   * @param message - 日志消息
   * @param meta - 可选的元数据
   */
  debug(message: string, meta?: unknown): void {
    if (!this.shouldLog(LogLevel.DEBUG)) return;
    
    const formattedMessage = this.formatMessage('debug', message, meta);
    const coloredMessage = this.colorize('debug', formattedMessage);
    console.log(coloredMessage);
  }

  /**
   * 记录信息级别日志
   * @param message - 日志消息
   * @param meta - 可选的元数据
   */
  info(message: string, meta?: unknown): void {
    if (!this.shouldLog(LogLevel.INFO)) return;
    
    const formattedMessage = this.formatMessage('info', message, meta);
    const coloredMessage = this.colorize('info', formattedMessage);
    console.log(coloredMessage);
  }

  /**
   * 记录警告级别日志
   * @param message - 日志消息
   * @param meta - 可选的元数据
   */
  warn(message: string, meta?: unknown): void {
    if (!this.shouldLog(LogLevel.WARN)) return;
    
    const formattedMessage = this.formatMessage('warn', message, meta);
    const coloredMessage = this.colorize('warn', formattedMessage);
    console.warn(coloredMessage);
  }

  /**
   * 记录错误级别日志
   * @param message - 日志消息
   * @param meta - 可选的元数据或错误对象
   */
  error(message: string, meta?: unknown): void {
    if (!this.shouldLog(LogLevel.ERROR)) return;
    
    let errorMeta = meta;
    
    // 如果 meta 是 Error 对象，提取有用信息
    if (meta instanceof Error) {
      errorMeta = {
        name: meta.name,
        message: meta.message,
        stack: meta.stack,
      };
    }
    
    const formattedMessage = this.formatMessage('error', message, errorMeta);
    const coloredMessage = this.colorize('error', formattedMessage);
    console.error(coloredMessage);
  }

  /**
   * 记录 HTTP 请求日志
   * @param method - HTTP 方法
   * @param url - 请求 URL
   * @param statusCode - 响应状态码
   * @param responseTime - 响应时间（毫秒）
   * @param userAgent - 用户代理
   */
  http(
    method: string,
    url: string,
    statusCode: number,
    responseTime: number,
    userAgent?: string
  ): void {
    const message = `${method} ${url} ${statusCode} ${responseTime}ms`;
    const meta = userAgent ? { userAgent } : undefined;
    
    if (statusCode >= 400) {
      this.warn(message, meta);
    } else {
      this.info(message, meta);
    }
  }

  /**
   * 记录 API Key 相关日志
   * @param action - 操作类型
   * @param keyPreview - API Key 预览（脱敏）
   * @param details - 详细信息
   */
  apiKey(action: string, keyPreview: string, details?: unknown): void {
    const message = `API Key ${action}: ${keyPreview}`;
    this.info(message, details);
  }

  /**
   * 记录负载均衡日志
   * @param strategy - 负载均衡策略
   * @param selectedKey - 选中的 API Key 预览
   * @param availableCount - 可用 Key 数量
   */
  loadBalance(strategy: string, selectedKey: string, availableCount: number): void {
    const message = `负载均衡 [${strategy}] 选择 Key: ${selectedKey}`;
    this.debug(message, { availableCount });
  }

  /**
   * 记录熔断器日志
   * @param action - 熔断器动作
   * @param keyPreview - API Key 预览
   * @param details - 详细信息
   */
  circuitBreaker(action: string, keyPreview: string, details?: unknown): void {
    const message = `熔断器 ${action}: ${keyPreview}`;
    this.warn(message, details);
  }

  /**
   * 记录性能指标日志
   * @param metric - 指标名称
   * @param value - 指标值
   * @param unit - 单位
   */
  metric(metric: string, value: number, unit: string): void {
    const message = `性能指标 ${metric}: ${value}${unit}`;
    this.debug(message);
  }

  /**
   * 设置日志级别
   * @param level - 新的日志级别
   */
  setLevel(level: string): void {
    const newLevel = LOG_LEVEL_MAP[level.toLowerCase()];
    if (newLevel !== undefined) {
      this.currentLevel = newLevel;
      this.info(`日志级别已设置为: ${level.toUpperCase()}`);
    } else {
      this.warn(`无效的日志级别: ${level}`);
    }
  }

  /**
   * 获取当前日志级别
   * @returns 当前日志级别字符串
   */
  getLevel(): string {
    const levelEntries = Object.entries(LOG_LEVEL_MAP);
    const currentEntry = levelEntries.find(([, value]) => value === this.currentLevel);
    return currentEntry ? currentEntry[0] : 'info';
  }
}

/**
 * 全局日志记录器实例
 */
export const logger = new Logger();

/**
 * 创建带有上下文的日志记录器
 * @param context - 上下文标识
 * @returns 带上下文的日志记录器
 */
export function createContextLogger(context: string) {
  return {
    debug: (message: string, meta?: unknown) => 
      logger.debug(`[${context}] ${message}`, meta),
    info: (message: string, meta?: unknown) => 
      logger.info(`[${context}] ${message}`, meta),
    warn: (message: string, meta?: unknown) => 
      logger.warn(`[${context}] ${message}`, meta),
    error: (message: string, meta?: unknown) => 
      logger.error(`[${context}] ${message}`, meta),
  };
}

/**
 * 脱敏 API Key，只显示前后几位字符
 * @param apiKey - 完整的 API Key
 * @param prefixLength - 前缀长度，默认为 7
 * @param suffixLength - 后缀长度，默认为 7
 * @returns 脱敏后的 API Key
 */
export function maskApiKey(
  apiKey: string, 
  prefixLength: number = 7, 
  suffixLength: number = 7
): string {
  if (apiKey.length <= prefixLength + suffixLength) {
    return '*'.repeat(apiKey.length);
  }
  
  const prefix = apiKey.substring(0, prefixLength);
  const suffix = apiKey.substring(apiKey.length - suffixLength);
  return `${prefix}......${suffix}`;
}
