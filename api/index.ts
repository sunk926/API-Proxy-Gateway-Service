/**
 * Vercel API 路由入口文件
 * 用途：为 Vercel 无服务器函数提供统一的入口点
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { Application } from '../src/index';
import { logger } from '../src/utils/logger';

// 全局应用实例（在无服务器环境中复用）
let app: Application | null = null;

/**
 * 获取或创建应用实例
 * @returns Application 实例
 */
function getApp(): Application {
  if (!app) {
    app = new Application();
    logger.info('Vercel 环境下创建应用实例');
  }
  return app;
}

/**
 * Vercel 无服务器函数处理器
 * @param req - Vercel 请求对象
 * @param res - Vercel 响应对象
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  try {
    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, x-goog-api-key, User-Agent, Accept'
    );

    // 处理 OPTIONS 预检请求
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    // 获取应用实例
    const application = getApp();
    const expressApp = application.getApp();

    // 将 Vercel 请求转换为 Express 请求格式
    const expressReq = req as any;
    const expressRes = res as any;

    // 设置必要的 Express 属性
    expressReq.originalUrl = req.url;
    expressReq.path = req.url?.split('?')[0] || '/';
    expressReq.query = req.query || {};
    expressReq.params = {};
    expressReq.get = (header: string) => req.headers[header.toLowerCase()];

    // 处理请求
    expressApp(expressReq, expressRes);

  } catch (error) {
    logger.error('Vercel 函数处理失败', error);
    
    if (!res.headersSent) {
      res.status(500).json({
        error: {
          message: '服务器内部错误',
          type: 'InternalServerError',
          code: 'INTERNAL_ERROR',
        },
      });
    }
  }
}
