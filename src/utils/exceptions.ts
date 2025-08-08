/**
 * 自定义异常模块
 * 用途：定义项目中使用的各种自定义异常类，提供结构化的错误处理
 */

/**
 * 基础 API 异常类
 * 所有自定义异常的基类
 */
export class ApiException extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number = 500,
    errorCode: string = 'INTERNAL_ERROR',
    details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;

    // 确保堆栈跟踪正确显示
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * 转换为 API 响应格式
   * @returns API 错误响应对象
   */
  toApiResponse(): {
    error: {
      message: string;
      type: string;
      code: string;
      details?: unknown;
    };
  } {
    return {
      error: {
        message: this.message,
        type: this.name,
        code: this.errorCode,
        details: this.details,
      },
    };
  }
}

/**
 * 验证异常类
 * 用于请求参数验证失败的情况
 */
export class ValidationException extends ApiException {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

/**
 * 认证异常类
 * 用于 API Key 认证失败的情况
 */
export class AuthenticationException extends ApiException {
  constructor(message: string = '无效的 API Key', details?: unknown) {
    super(message, 401, 'AUTHENTICATION_ERROR', details);
  }
}

/**
 * 授权异常类
 * 用于权限不足的情况
 */
export class AuthorizationException extends ApiException {
  constructor(message: string = '权限不足', details?: unknown) {
    super(message, 403, 'AUTHORIZATION_ERROR', details);
  }
}

/**
 * 资源未找到异常类
 * 用于请求的资源不存在的情况
 */
export class NotFoundException extends ApiException {
  constructor(message: string = '请求的资源未找到', details?: unknown) {
    super(message, 404, 'NOT_FOUND', details);
  }
}

/**
 * 方法不允许异常类
 * 用于 HTTP 方法不被支持的情况
 */
export class MethodNotAllowedException extends ApiException {
  constructor(message: string = 'HTTP 方法不被允许', details?: unknown) {
    super(message, 405, 'METHOD_NOT_ALLOWED', details);
  }
}

/**
 * 速率限制异常类
 * 用于请求频率超过限制的情况
 */
export class RateLimitException extends ApiException {
  constructor(message: string = '请求过于频繁，请稍后再试', details?: unknown) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED', details);
  }
}

/**
 * 上游服务异常类
 * 用于调用上游 API（如 Gemini API）失败的情况
 */
export class UpstreamServiceException extends ApiException {
  public readonly upstreamStatusCode?: number;
  public readonly upstreamResponse?: unknown;

  constructor(
    message: string,
    statusCode: number = 502,
    upstreamStatusCode?: number,
    upstreamResponse?: unknown
  ) {
    super(message, statusCode, 'UPSTREAM_SERVICE_ERROR', {
      upstreamStatusCode,
      upstreamResponse,
    });
    this.upstreamStatusCode = upstreamStatusCode ?? 0;
    this.upstreamResponse = upstreamResponse;
  }
}

/**
 * 服务不可用异常类
 * 用于所有 API Key 都不可用的情况
 */
export class ServiceUnavailableException extends ApiException {
  constructor(message: string = '服务暂时不可用，所有 API Key 都已熔断', details?: unknown) {
    super(message, 503, 'SERVICE_UNAVAILABLE', details);
  }
}

/**
 * 网关超时异常类
 * 用于请求超时的情况
 */
export class GatewayTimeoutException extends ApiException {
  constructor(message: string = '网关超时', details?: unknown) {
    super(message, 504, 'GATEWAY_TIMEOUT', details);
  }
}

/**
 * 负载均衡异常类
 * 用于负载均衡器无法选择可用 API Key 的情况
 */
export class LoadBalancerException extends ApiException {
  constructor(message: string = '负载均衡器无法选择可用的 API Key', details?: unknown) {
    super(message, 503, 'LOAD_BALANCER_ERROR', details);
  }
}

/**
 * 熔断器异常类
 * 用于熔断器阻止请求的情况
 */
export class CircuitBreakerException extends ApiException {
  constructor(message: string = 'API Key 已被熔断，请稍后再试', details?: unknown) {
    super(message, 503, 'CIRCUIT_BREAKER_OPEN', details);
  }
}

/**
 * 配置异常类
 * 用于配置错误的情况
 */
export class ConfigurationException extends ApiException {
  constructor(message: string, details?: unknown) {
    super(message, 500, 'CONFIGURATION_ERROR', details);
  }
}

/**
 * 格式转换异常类
 * 用于 API 格式转换失败的情况
 */
export class FormatConversionException extends ApiException {
  constructor(message: string = 'API 格式转换失败', details?: unknown) {
    super(message, 500, 'FORMAT_CONVERSION_ERROR', details);
  }
}

/**
 * 网络异常类
 * 用于网络请求失败的情况
 */
export class NetworkException extends ApiException {
  constructor(message: string = '网络请求失败', details?: unknown) {
    super(message, 500, 'NETWORK_ERROR', details);
  }
}

/**
 * 解析异常类
 * 用于响应解析失败的情况
 */
export class ParseException extends ApiException {
  constructor(message: string = '响应解析失败', details?: unknown) {
    super(message, 500, 'PARSE_ERROR', details);
  }
}

/**
 * 检查错误是否为 API 异常
 * @param error - 错误对象
 * @returns 是否为 API 异常
 */
export function isApiException(error: unknown): error is ApiException {
  return error instanceof ApiException;
}

/**
 * 将普通错误转换为 API 异常
 * @param error - 错误对象
 * @returns API 异常
 */
export function toApiException(error: unknown): ApiException {
  if (isApiException(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new ApiException(error.message, 500, 'INTERNAL_ERROR', {
      originalError: error.name,
      stack: error.stack,
    });
  }

  return new ApiException(
    '未知错误',
    500,
    'UNKNOWN_ERROR',
    { originalError: String(error) }
  );
}

/**
 * 根据 HTTP 状态码创建相应的异常
 * @param statusCode - HTTP 状态码
 * @param message - 错误消息
 * @param details - 详细信息
 * @returns 对应的异常实例
 */
export function createExceptionFromStatusCode(
  statusCode: number,
  message: string,
  details?: unknown
): ApiException {
  switch (statusCode) {
    case 400:
      return new ValidationException(message, details);
    case 401:
      return new AuthenticationException(message, details);
    case 403:
      return new AuthorizationException(message, details);
    case 404:
      return new NotFoundException(message, details);
    case 405:
      return new MethodNotAllowedException(message, details);
    case 429:
      return new RateLimitException(message, details);
    case 502:
    case 503:
      return new ServiceUnavailableException(message, details);
    case 504:
      return new GatewayTimeoutException(message, details);
    default:
      return new ApiException(message, statusCode, 'HTTP_ERROR', details);
  }
}

/**
 * 错误处理工具函数
 */
export const ErrorUtils = {
  /**
   * 安全地获取错误消息
   * @param error - 错误对象
   * @returns 错误消息字符串
   */
  getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  },

  /**
   * 安全地获取错误堆栈
   * @param error - 错误对象
   * @returns 错误堆栈字符串或 undefined
   */
  getErrorStack(error: unknown): string | undefined {
    if (error instanceof Error) {
      return error.stack;
    }
    return undefined;
  },

  /**
   * 检查错误是否为网络相关错误
   * @param error - 错误对象
   * @returns 是否为网络错误
   */
  isNetworkError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('network') ||
        message.includes('timeout') ||
        message.includes('connection') ||
        message.includes('econnrefused') ||
        message.includes('enotfound') ||
        message.includes('etimedout')
      );
    }
    return false;
  },

  /**
   * 检查错误是否为超时错误
   * @param error - 错误对象
   * @returns 是否为超时错误
   */
  isTimeoutError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes('timeout') || message.includes('etimedout');
    }
    return false;
  },
};
