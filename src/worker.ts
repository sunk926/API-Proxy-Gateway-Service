/**
 * Cloudflare Workers 入口文件
 * 用途：为 Cloudflare Workers 环境提供适配的请求处理
 */

import { RequestHandler } from '@/handlers/request';
import { logger } from '@/utils/logger';
import { isApiException, toApiException } from '@/utils/exceptions';

/**
 * Cloudflare Workers 环境接口
 */
interface Env {
  // 环境变量
  NODE_ENV?: string;
  LOG_LEVEL?: string;
  LOAD_BALANCE_STRATEGY?: string;
  CIRCUIT_BREAKER_FAILURE_THRESHOLD?: string;
  CIRCUIT_BREAKER_RESET_TIMEOUT?: string;
  GEMINI_BASE_URL?: string;
  GEMINI_API_VERSION?: string;
  GEMINI_TIMEOUT?: string;
  CORS_ORIGIN?: string;

  // KV 存储（可选）
  // CACHE?: KVNamespace;

  // Durable Objects（可选）
  // CIRCUIT_BREAKER?: DurableObjectNamespace;
}

/**
 * 全局请求处理器实例
 */
let requestHandler: RequestHandler | null = null;

/**
 * 获取或创建请求处理器实例
 * @param env - Cloudflare Workers 环境变量
 * @returns RequestHandler 实例
 */
function getRequestHandler(env: Env): RequestHandler {
  if (!requestHandler) {
    // 设置环境变量
    const envVars = env as Record<string, string | undefined>;
    if (envVars.NODE_ENV) process.env.NODE_ENV = envVars.NODE_ENV;
    if (envVars.LOG_LEVEL) process.env.LOG_LEVEL = envVars.LOG_LEVEL;
    if (envVars.LOAD_BALANCE_STRATEGY) process.env.LOAD_BALANCE_STRATEGY = envVars.LOAD_BALANCE_STRATEGY;
    if (envVars.CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD = envVars.CIRCUIT_BREAKER_FAILURE_THRESHOLD;
    }
    if (envVars.CIRCUIT_BREAKER_RESET_TIMEOUT) {
      process.env.CIRCUIT_BREAKER_RESET_TIMEOUT = envVars.CIRCUIT_BREAKER_RESET_TIMEOUT;
    }
    if (envVars.GEMINI_BASE_URL) process.env.GEMINI_BASE_URL = envVars.GEMINI_BASE_URL;
    if (envVars.GEMINI_API_VERSION) process.env.GEMINI_API_VERSION = envVars.GEMINI_API_VERSION;
    if (envVars.GEMINI_TIMEOUT) process.env.GEMINI_TIMEOUT = envVars.GEMINI_TIMEOUT;
    if (envVars.CORS_ORIGIN) process.env.CORS_ORIGIN = envVars.CORS_ORIGIN;

    requestHandler = new RequestHandler();
    logger.info('Cloudflare Workers 环境下创建请求处理器实例');
  }
  
  return requestHandler;
}

/**
 * 将 Cloudflare Workers Request 转换为 Express 兼容的请求对象
 * @param request - Cloudflare Workers Request
 * @returns Express 兼容的请求对象
 */
async function convertRequest(request: Request): Promise<any> {
  const url = new URL(request.url);
  const body = request.method !== 'GET' && request.method !== 'HEAD' 
    ? await request.json().catch(() => ({}))
    : {};

  return {
    method: request.method,
    url: url.pathname + url.search,
    originalUrl: url.pathname + url.search,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    params: {},
    headers: Object.fromEntries(request.headers),
    body,
    get: (header: string) => request.headers.get(header),
  };
}

/**
 * 创建 Express 兼容的响应对象
 * @returns Express 兼容的响应对象
 */
function createResponse(): any {
  let statusCode = 200;
  const headers = new Headers();
  let responseBody: any = null;
  let headersSent = false;

  return {
    status: (code: number) => {
      statusCode = code;
      return {
        json: (data: any) => {
          responseBody = data;
          headers.set('Content-Type', 'application/json');
          headersSent = true;
          return Promise.resolve();
        },
        end: () => {
          headersSent = true;
          return Promise.resolve();
        },
      };
    },
    json: (data: any) => {
      responseBody = data;
      headers.set('Content-Type', 'application/json');
      headersSent = true;
      return Promise.resolve();
    },
    setHeader: (name: string, value: string) => {
      headers.set(name, value);
    },
    write: (chunk: any) => {
      // 流式写入的简化实现
      if (!responseBody) responseBody = '';
      responseBody += chunk;
    },
    end: () => {
      headersSent = true;
      return Promise.resolve();
    },
    get headersSent() {
      return headersSent;
    },
    getStatusCode: () => statusCode,
    getHeaders: () => headers,
    getBody: () => responseBody,
  };
}

/**
 * 主要的 fetch 事件处理器
 * @param request - Cloudflare Workers Request
 * @param env - 环境变量
 * @param ctx - 执行上下文
 * @returns Response
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: any
  ): Promise<Response> {
    try {
      // 设置 CORS 头
      const envVars = env as Record<string, string | undefined>;
      const corsHeaders = {
        'Access-Control-Allow-Origin': envVars.CORS_ORIGIN || '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-goog-api-key, User-Agent, Accept',
        'Access-Control-Max-Age': '86400',
      };

      // 处理 OPTIONS 预检请求
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 200,
          headers: corsHeaders,
        });
      }

      // 获取请求处理器
      const handler = getRequestHandler(env);

      // 转换请求格式
      const req = await convertRequest(request);
      const res = createResponse();

      // 路由处理
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === '/') {
        await handler.handleRoot(req, res);
      } else if (path === '/health') {
        await handler.handleHealthCheck(req, res);
      } else if (path === '/stats') {
        await handler.handleStats(req, res);
      } else if (path === '/chat/completions' || path === '/v1/chat/completions') {
        await handler.handleChatCompletions(req, res);
      } else if (path === '/verify') {
        await handler.handleKeyVerification(req, res);
      } else {
        await handler.handleNotFound(req, res);
      }

      // 构建响应
      const responseHeaders = new Headers(corsHeaders);
      const resHeaders = res.getHeaders();
      
      for (const [key, value] of resHeaders) {
        responseHeaders.set(key, value);
      }

      const responseBody = res.getBody();
      const body = typeof responseBody === 'object' 
        ? JSON.stringify(responseBody) 
        : responseBody;

      return new Response(body, {
        status: res.getStatusCode(),
        headers: responseHeaders,
      });

    } catch (error) {
      logger.error('Cloudflare Workers 请求处理失败', error);

      const apiException = isApiException(error) ? error : toApiException(error);
      
      return new Response(
        JSON.stringify(apiException.toApiResponse()),
        {
          status: apiException.statusCode,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': (env as Record<string, string | undefined>).CORS_ORIGIN || '*',
          },
        }
      );
    }
  },

  /**
   * 定时任务处理器（可选）
   * @param _event - 定时事件
   * @param env - 环境变量
   * @param _ctx - 执行上下文
   */
  async scheduled(
    _event: any,
    env: Env,
    _ctx: any
  ): Promise<void> {
    try {
      logger.info('执行定时清理任务');
      
      // 这里可以执行定期清理任务
      // 例如：清理过期的熔断器状态、统计数据等
      
      const handler = getRequestHandler(env);
      const loadBalancer = handler.getLoadBalancer();
      
      // 检查并恢复熔断的 API Key
      loadBalancer.checkAndRecoverCircuitBrokenKeys();
      
      logger.info('定时清理任务完成');
      
    } catch (error) {
      logger.error('定时任务执行失败', error);
    }
  },
};
