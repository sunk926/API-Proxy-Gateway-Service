# API 代理网关服务

一个轻量级、高性能的 API 代理网关服务，专为 AI 模型 API 设计，支持多个 API Key 的智能负载均衡和熔断机制。

## ✨ 核心特性

- 🔄 **智能负载均衡** - 支持轮询、随机、最少连接等多种策略
- 🛡️ **熔断器保护** - 自动检测故障 API Key 并进行熔断恢复
- 🔌 **OpenAI 兼容** - 完全兼容 OpenAI Chat Completions API 格式
- 🚀 **流式支持** - 支持 Server-Sent Events (SSE) 流式响应
- 📊 **实时监控** - 提供详细的统计信息和健康检查
- 🔐 **安全可靠** - 内置 CORS、速率限制、请求验证等安全机制
- ☁️ **云原生** - 支持 Vercel、Cloudflare Workers、Docker 等多种部署方式

## 🏗️ 架构设计

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   客户端请求     │───▶│   负载均衡器      │───▶│   Gemini API    │
│ (OpenAI 格式)   │    │                  │    │                 │
└─────────────────┘    │  ┌─────────────┐  │    └─────────────────┘
                       │  │  熔断器     │  │
                       │  └─────────────┘  │    ┌─────────────────┐
                       │                  │───▶│   Gemini API    │
                       │  ┌─────────────┐  │    │                 │
                       │  │ 格式转换器   │  │    └─────────────────┘
                       │  └─────────────┘  │
                       └──────────────────┘    ┌─────────────────┐
                                              │   Gemini API    │
                                              │                 │
                                              └─────────────────┘
```

## 🚀 快速开始

### 环境要求

- Node.js 18+
- npm 或 yarn
- TypeScript 5.0+

### 本地开发

1. **克隆项目**
```bash
git clone https://github.com/your-username/api-proxy-gateway-service.git
cd api-proxy-gateway-service
```

2. **安装依赖**
```bash
npm install
```

3. **配置环境变量**
```bash
cp .env.example .env
# 编辑 .env 文件，添加您的 Gemini API Keys
```

4. **启动开发服务器**
```bash
npm run dev
```

服务将在 `http://localhost:3000` 启动。

### Docker 部署

1. **构建镜像**
```bash
docker build -t api-proxy-gateway .
```

2. **运行容器**
```bash
docker run -p 3000:3000 \
  -e GEMINI_API_KEYS="your-api-key-1,your-api-key-2" \
  api-proxy-gateway
```

### Docker Compose 部署

```bash
docker-compose up -d
```

## 📖 API 文档

### Chat Completions

与 OpenAI Chat Completions API 完全兼容：

```bash
curl -X POST http://localhost:3000/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-gemini-api-key" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "Hello, world!"}
    ],
    "stream": false
  }'
```

### API Key 验证

批量验证 API Key 的有效性：

```bash
curl -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer key1,key2,key3"
```

### 健康检查

```bash
curl http://localhost:3000/health
```

### 统计信息

```bash
curl http://localhost:3000/stats
```

## ⚙️ 配置说明

### 环境变量

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `NODE_ENV` | 运行环境 | `development` |
| `LOG_LEVEL` | 日志级别 | `info` |
| `LOAD_BALANCE_STRATEGY` | 负载均衡策略 | `round_robin` |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` | 熔断器失败阈值 | `3` |
| `CIRCUIT_BREAKER_RESET_TIMEOUT` | 熔断器重置时间(ms) | `60000` |
| `GEMINI_BASE_URL` | Gemini API 基础 URL | `https://generativelanguage.googleapis.com` |
| `CORS_ORIGIN` | CORS 允许的源 | `*` |

### 负载均衡策略

- `round_robin` - 轮询策略（默认）
- `random` - 随机策略
- `least_connections` - 最少连接策略

## 🌐 部署指南

### Vercel 部署

1. **安装 Vercel CLI**
```bash
npm i -g vercel
```

2. **部署到 Vercel**
```bash
vercel --prod
```

3. **设置环境变量**
在 Vercel 控制台中设置必要的环境变量。

### Cloudflare Workers 部署

1. **安装 Wrangler CLI**
```bash
npm i -g wrangler
```

2. **配置 wrangler.toml**
编辑 `wrangler.toml` 文件，设置您的账户信息。

3. **部署到 Cloudflare Workers**
```bash
wrangler publish
```

### AWS Lambda 部署

使用 Serverless Framework 或 AWS SAM 进行部署。

## 📊 监控和日志

### 内置监控端点

- `/health` - 健康检查
- `/stats` - 统计信息
- `/` - 服务信息

### 日志级别

- `debug` - 调试信息
- `info` - 一般信息
- `warn` - 警告信息
- `error` - 错误信息

### 统计指标

- 总请求数
- 成功/失败请求数
- 平均响应时间
- API Key 状态
- 熔断器状态

## 🔧 开发指南

### 项目结构

```
src/
├── adapters/          # 适配器层
│   ├── geminiClient.ts    # Gemini API 客户端
│   └── openaiAdapter.ts   # OpenAI 格式适配器
├── core/              # 核心功能
│   ├── circuitBreaker.ts  # 熔断器
│   └── loadBalancer.ts    # 负载均衡器
├── handlers/          # 请求处理器
│   └── request.ts         # 主请求处理器
├── services/          # 业务服务
│   └── keyValidator.ts    # Key 验证服务
├── utils/             # 工具函数
│   ├── config.ts          # 配置管理
│   ├── exceptions.ts      # 异常处理
│   ├── logger.ts          # 日志工具
│   └── types.ts           # 类型定义
├── index.ts           # 主入口文件
└── worker.ts          # Cloudflare Workers 入口
```

### 代码规范

- 使用 TypeScript 进行类型安全开发
- 遵循 ESLint 和 Prettier 代码规范
- 所有函数必须包含完整的 JSDoc 注释
- 使用中文注释和文档

### 测试

```bash
# 运行测试
npm test

# 运行测试覆盖率
npm run test:coverage

# 运行类型检查
npm run type-check
```

## 🤝 贡献指南

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢

- [Google Gemini API](https://ai.google.dev/) - 强大的 AI 模型服务
- [OpenAI API](https://openai.com/api/) - API 格式标准参考
- [Express.js](https://expressjs.com/) - Web 框架
- [TypeScript](https://www.typescriptlang.org/) - 类型安全的 JavaScript

## 📞 支持

如果您遇到任何问题或有任何建议，请：

1. 查看 [FAQ](docs/FAQ.md)
2. 搜索现有的 [Issues](https://github.com/your-username/api-proxy-gateway-service/issues)
3. 创建新的 Issue

---

**⭐ 如果这个项目对您有帮助，请给它一个星标！**
