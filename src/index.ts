/**
 * 应用程序主入口文件
 * 用途：初始化 Express 服务器，配置中间件，设置路由，启动服务
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { RequestHandler } from '@/handlers/request';
import { appConfig, securityConfig, monitoringConfig } from '@/utils/config';
import { logger } from '@/utils/logger';
import { isApiException, toApiException } from '@/utils/exceptions';

/**
 * 应用程序类
 * 封装 Express 应用的初始化和配置
 */
class Application {
  private app: express.Application;
  private requestHandler: RequestHandler;
  private server?: any;

  constructor() {
    this.app = express();
    this.requestHandler = new RequestHandler();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
    
    logger.info('应用程序初始化完成');
  }

  /**
   * 设置中间件
   */
  private setupMiddleware(): void {
    // 安全中间件
    if (securityConfig.helmetEnabled) {
      this.app.use(helmet({
        contentSecurityPolicy: false, // 允许内联脚本，适用于 API 服务
        crossOriginEmbedderPolicy: false,
      }));
    }

    // CORS 中间件
    this.app.use(cors({
      origin: appConfig.cors.origin,
      credentials: appConfig.cors.credentials,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'x-goog-api-key',
        'User-Agent',
        'Accept',
      ],
    }));

    // 压缩中间件
    this.app.use(compression());

    // 请求体解析中间件
    if (securityConfig.bodyLimitEnabled) {
      this.app.use(express.json({ 
        limit: securityConfig.bodyLimit,
        strict: true,
      }));
      this.app.use(express.urlencoded({ 
        extended: true, 
        limit: securityConfig.bodyLimit,
      }));
    } else {
      this.app.use(express.json({ strict: true }));
      this.app.use(express.urlencoded({ extended: true }));
    }

    // 请求日志中间件
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();
      
      res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        logger.http(
          req.method,
          req.originalUrl,
          res.statusCode,
          responseTime,
          req.get('User-Agent')
        );
      });
      
      next();
    });

    logger.info('中间件配置完成');
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    // 根路径
    this.app.get('/', (req, res) => {
      this.requestHandler.handleRoot(req, res);
    });

    // 健康检查端点
    this.app.get(monitoringConfig.healthCheckPath, (req, res) => {
      this.requestHandler.handleHealthCheck(req, res);
    });

    // 统计信息端点
    this.app.get(monitoringConfig.statsPath, (req, res) => {
      this.requestHandler.handleStats(req, res);
    });

    // OpenAI Chat Completions 兼容端点
    this.app.post('/chat/completions', (req, res) => {
      this.requestHandler.handleChatCompletions(req, res);
    });

    this.app.post('/v1/chat/completions', (req, res) => {
      this.requestHandler.handleChatCompletions(req, res);
    });

    // API Key 验证端点
    this.app.post('/verify', (req, res) => {
      this.requestHandler.handleKeyVerification(req, res);
    });

    // Gemini 原生 API 代理端点
    this.app.all('/v1beta/*', (req, res) => {
      this.handleGeminiProxy(req, res);
    });

    this.app.all('/v1/*', (req, res) => {
      this.handleGeminiProxy(req, res);
    });

    // OPTIONS 预检请求处理
    this.app.options('*', (_req, res) => {
      res.status(200).end();
    });

    // 404 处理
    this.app.use('*', (req, res) => {
      this.requestHandler.handleNotFound(req, res);
    });

    logger.info('路由配置完成');
  }

  /**
   * 处理 Gemini 原生 API 代理
   * @param _req - Express 请求对象
   * @param res - Express 响应对象
   */
  private async handleGeminiProxy(_req: Request, res: Response): Promise<void> {
    try {
      // 这里可以实现 Gemini 原生 API 的直接代理
      // 暂时返回未实现的响应
      res.status(501).json({
        error: {
          message: 'Gemini 原生 API 代理功能暂未实现',
          type: 'NotImplementedError',
          code: 'NOT_IMPLEMENTED',
        },
      });
    } catch (error) {
      const apiException = isApiException(error) ? error : toApiException(error);
      res.status(apiException.statusCode).json(apiException.toApiResponse());
    }
  }

  /**
   * 设置错误处理
   */
  private setupErrorHandling(): void {
    // 全局错误处理中间件
    this.app.use((
      error: Error,
      req: Request,
      res: Response,
      _next: NextFunction
    ) => {
      const apiException = isApiException(error) ? error : toApiException(error);
      
      logger.error('未捕获的错误', {
        path: req.path,
        method: req.method,
        error: apiException.message,
        stack: apiException.stack,
      });

      if (!res.headersSent) {
        res.status(apiException.statusCode).json(apiException.toApiResponse());
      }
    });

    // 处理未捕获的 Promise 拒绝
    process.on('unhandledRejection', (reason, _promise) => {
      logger.error('未处理的 Promise 拒绝', {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    });

    // 处理未捕获的异常
    process.on('uncaughtException', (error) => {
      logger.error('未捕获的异常', {
        error: error.message,
        stack: error.stack,
      });
      
      // 优雅关闭
      this.gracefulShutdown('uncaughtException');
    });

    // 处理进程信号
    process.on('SIGTERM', () => {
      logger.info('收到 SIGTERM 信号');
      this.gracefulShutdown('SIGTERM');
    });

    process.on('SIGINT', () => {
      logger.info('收到 SIGINT 信号');
      this.gracefulShutdown('SIGINT');
    });

    logger.info('错误处理配置完成');
  }

  /**
   * 启动服务器
   * @returns Promise<void>
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(appConfig.port, () => {
          logger.info(`服务器启动成功`, {
            port: appConfig.port,
            environment: appConfig.environment,
            nodeVersion: process.version,
            platform: process.platform,
          });
          
          // 输出可用的端点信息
          this.logEndpoints();
          
          resolve();
        });

        this.server.on('error', (error: Error) => {
          logger.error('服务器启动失败', error);
          reject(error);
        });

      } catch (error) {
        logger.error('服务器初始化失败', error);
        reject(error);
      }
    });
  }

  /**
   * 停止服务器
   * @returns Promise<void>
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('服务器已停止');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 优雅关闭
   * @param signal - 关闭信号
   */
  private async gracefulShutdown(signal: string): Promise<void> {
    logger.info(`开始优雅关闭 (${signal})`);
    
    try {
      // 停止接受新请求
      await this.stop();
      
      // 清理资源
      this.requestHandler.destroy();
      
      logger.info('优雅关闭完成');
      process.exit(0);
      
    } catch (error) {
      logger.error('优雅关闭失败', error);
      process.exit(1);
    }
  }

  /**
   * 输出端点信息
   */
  private logEndpoints(): void {
    const baseUrl = `http://localhost:${appConfig.port}`;
    
    logger.info('可用端点:', {
      root: `${baseUrl}/`,
      health: `${baseUrl}${monitoringConfig.healthCheckPath}`,
      stats: `${baseUrl}${monitoringConfig.statsPath}`,
      chatCompletions: `${baseUrl}/chat/completions`,
      verify: `${baseUrl}/verify`,
    });
  }

  /**
   * 获取 Express 应用实例
   * @returns Express 应用实例
   */
  getApp(): express.Application {
    return this.app;
  }

  /**
   * 获取请求处理器实例
   * @returns 请求处理器实例
   */
  getRequestHandler(): RequestHandler {
    return this.requestHandler;
  }
}

/**
 * 主函数
 * 应用程序入口点
 */
async function main(): Promise<void> {
  try {
    logger.info('启动 API 代理网关服务', {
      version: '1.0.0',
      nodeVersion: process.version,
      platform: process.platform,
      environment: appConfig.environment,
    });

    const app = new Application();
    await app.start();

  } catch (error) {
    logger.error('应用程序启动失败', error);
    process.exit(1);
  }
}

// 如果直接运行此文件，则启动应用程序
if (require.main === module) {
  main().catch((error) => {
    console.error('启动失败:', error);
    process.exit(1);
  });
}

export { Application };
export default main;
