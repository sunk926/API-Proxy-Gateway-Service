/**
 * 核心类型定义文件
 * 用途：定义项目中使用的所有 TypeScript 类型和接口
 */

// ==================== API 相关类型 ====================

/**
 * API Key 状态枚举
 */
export enum ApiKeyStatus {
  AVAILABLE = 'available',
  CIRCUIT_BROKEN = 'circuit_broken',
  INVALID = 'invalid',
}

/**
 * API Key 信息接口
 */
export interface ApiKeyInfo {
  /** API Key 字符串 */
  key: string;
  /** 当前状态 */
  status: ApiKeyStatus;
  /** 失败次数计数 */
  failureCount: number;
  /** 最后失败时间 */
  lastFailureTime?: Date;
  /** 熔断恢复时间 */
  circuitBreakerResetTime?: Date;
  /** 请求计数统计 */
  requestCount: number;
  /** 成功请求计数 */
  successCount: number;
}

/**
 * 负载均衡策略枚举
 */
export enum LoadBalanceStrategy {
  ROUND_ROBIN = 'round_robin',
  RANDOM = 'random',
  LEAST_CONNECTIONS = 'least_connections',
}

// ==================== OpenAI API 类型 ====================

/**
 * OpenAI 消息角色
 */
export type OpenAIRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * OpenAI 消息接口
 */
export interface OpenAIMessage {
  role: OpenAIRole;
  content: string;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

/**
 * OpenAI 工具调用接口
 */
export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * OpenAI Chat Completions 请求接口
 */
export interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  stream?: boolean;
  tools?: OpenAITool[];
  tool_choice?: string | object;
  user?: string;
}

/**
 * OpenAI 工具定义接口
 */
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: object;
  };
}

/**
 * OpenAI Chat Completions 响应接口
 */
export interface OpenAIChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
  system_fingerprint?: string;
}

/**
 * OpenAI 选择项接口
 */
export interface OpenAIChoice {
  index: number;
  message: OpenAIMessage;
  finish_reason: 'stop' | 'length' | 'function_call' | 'tool_calls' | 'content_filter' | null;
  logprobs?: object | null;
}

/**
 * OpenAI 使用统计接口
 */
export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ==================== Gemini API 类型 ====================

/**
 * Gemini 内容部分接口
 */
export interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

/**
 * Gemini 内容接口
 */
export interface GeminiContent {
  role: 'user' | 'model' | 'function';
  parts: GeminiPart[];
}

/**
 * Gemini 生成配置接口
 */
export interface GeminiGenerationConfig {
  temperature?: number;
  topK?: number;
  topP?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  candidateCount?: number;
}

/**
 * Gemini 请求接口
 */
export interface GeminiGenerateContentRequest {
  contents: GeminiContent[];
  generationConfig?: GeminiGenerationConfig;
  safetySettings?: GeminiSafetySetting[];
  tools?: GeminiTool[];
}

/**
 * Gemini 安全设置接口
 */
export interface GeminiSafetySetting {
  category: string;
  threshold: string;
}

/**
 * Gemini 工具接口
 */
export interface GeminiTool {
  functionDeclarations?: GeminiFunctionDeclaration[];
}

/**
 * Gemini 函数声明接口
 */
export interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: object;
}

/**
 * Gemini 响应接口
 */
export interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: GeminiPromptFeedback;
  usageMetadata?: GeminiUsageMetadata;
}

/**
 * Gemini 候选项接口
 */
export interface GeminiCandidate {
  content?: GeminiContent;
  finishReason?: string;
  index?: number;
  safetyRatings?: GeminiSafetyRating[];
}

/**
 * Gemini 提示反馈接口
 */
export interface GeminiPromptFeedback {
  blockReason?: string;
  safetyRatings?: GeminiSafetyRating[];
}

/**
 * Gemini 安全评级接口
 */
export interface GeminiSafetyRating {
  category: string;
  probability: string;
  blocked?: boolean;
}

/**
 * Gemini 使用元数据接口
 */
export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

// ==================== 配置类型 ====================

/**
 * 应用配置接口
 */
export interface AppConfig {
  /** 服务端口 */
  port: number;
  /** 环境模式 */
  environment: 'development' | 'production' | 'test';
  /** 日志级别 */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** 负载均衡策略 */
  loadBalanceStrategy: LoadBalanceStrategy;
  /** 熔断器配置 */
  circuitBreaker: CircuitBreakerConfig;
  /** CORS 配置 */
  cors: {
    origin: string | string[];
    credentials: boolean;
  };
}

/**
 * 熔断器配置接口
 */
export interface CircuitBreakerConfig {
  /** 失败阈值 */
  failureThreshold: number;
  /** 重置超时时间（毫秒） */
  resetTimeout: number;
  /** 监控窗口时间（毫秒） */
  monitoringPeriod: number;
}

// ==================== HTTP 相关类型 ====================

/**
 * API 错误响应接口
 */
export interface ApiErrorResponse {
  error: {
    message: string;
    type: string;
    code?: string;
    details?: unknown;
  };
}

/**
 * Key 验证结果接口
 */
export interface KeyValidationResult {
  key: string;
  status: 'GOOD' | 'BAD' | 'ERROR';
  error?: string;
  responseTime?: number;
}

/**
 * 服务统计信息接口
 */
export interface ServiceStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  activeApiKeys: number;
  circuitBrokenKeys: number;
}
