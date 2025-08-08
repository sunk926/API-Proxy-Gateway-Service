# Cloudflare Workers 部署指南

本指南将帮助您将 API 代理网关服务部署到 Cloudflare Workers。

## 📋 前置要求

1. **Cloudflare 账户**
   - 注册 [Cloudflare 账户](https://dash.cloudflare.com/sign-up)
   - 获取 Account ID 和 Zone ID（如果有自定义域名）

2. **Wrangler CLI**
   - 安装最新版本的 Wrangler CLI
   ```bash
   npm install -g wrangler
   ```

3. **项目构建**
   - 确保项目已经构建成功
   ```bash
   npm run build
   ```

## 🚀 部署步骤

### 1. 登录 Cloudflare

```bash
wrangler login
```

这将打开浏览器窗口，请按照提示完成登录。

### 2. 配置 wrangler.toml

编辑项目根目录的 `wrangler.toml` 文件：

```toml
name = "api-proxy-gateway-service"
main = "dist/worker.js"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

# 构建配置
[build]
command = "npm run build"

# 生产环境变量
[env.production.vars]
NODE_ENV = "production"
LOG_LEVEL = "warn"
LOAD_BALANCE_STRATEGY = "round_robin"
CIRCUIT_BREAKER_FAILURE_THRESHOLD = "3"
CIRCUIT_BREAKER_RESET_TIMEOUT = "60000"
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com"
GEMINI_API_VERSION = "v1beta"
GEMINI_TIMEOUT = "30000"
CORS_ORIGIN = "*"
HELMET_ENABLED = "true"
RATE_LIMIT_ENABLED = "true"
MONITORING_ENABLED = "true"

# 开发环境变量
[env.development.vars]
NODE_ENV = "development"
LOG_LEVEL = "debug"
# ... 其他开发环境配置
```

### 3. 设置环境变量

对于敏感信息（如 API Keys），使用 Wrangler 的 secrets 功能：

```bash
# 设置 Gemini API Keys（多个 Key 用逗号分隔）
wrangler secret put GEMINI_API_KEYS

# 设置其他敏感配置（如果需要）
wrangler secret put DATABASE_URL
wrangler secret put WEBHOOK_SECRET
```

### 4. 部署到 Cloudflare Workers

```bash
# 部署到生产环境
wrangler deploy

# 或者部署到特定环境
wrangler deploy --env production
```

### 5. 验证部署

部署成功后，您将看到类似以下的输出：

```
✨ Success! Uploaded to Cloudflare Workers
🌍 Your worker is available at https://api-proxy-gateway-service.your-subdomain.workers.dev
```

测试部署的服务：

```bash
# 健康检查
curl https://api-proxy-gateway-service.your-subdomain.workers.dev/health

# 服务信息
curl https://api-proxy-gateway-service.your-subdomain.workers.dev/
```

## 🔧 高级配置

### 自定义域名

如果您有自定义域名，可以在 `wrangler.toml` 中配置：

```toml
[[routes]]
pattern = "api.yourdomain.com/*"
zone_name = "yourdomain.com"
```

然后部署：

```bash
wrangler deploy
```

### KV 存储（可选）

如果需要持久化存储，可以配置 KV 命名空间：

```bash
# 创建 KV 命名空间
wrangler kv:namespace create "CACHE"
wrangler kv:namespace create "CACHE" --preview

# 在 wrangler.toml 中添加配置
[[kv_namespaces]]
binding = "CACHE"
id = "your-kv-namespace-id"
preview_id = "your-preview-kv-namespace-id"
```

### Durable Objects（可选）

对于需要状态管理的高级功能：

```toml
[[durable_objects.bindings]]
name = "CIRCUIT_BREAKER"
class_name = "CircuitBreakerDO"
```

## 📊 监控和日志

### 查看实时日志

```bash
# 查看实时日志
wrangler tail

# 查看特定环境的日志
wrangler tail --env production

# 过滤日志
wrangler tail --format pretty
```

### 查看部署历史

```bash
# 查看部署列表
wrangler deployments list

# 查看特定部署详情
wrangler deployments view [deployment-id]
```

### 回滚部署

```bash
# 回滚到上一个版本
wrangler rollback

# 回滚到特定版本
wrangler rollback [version-id]
```

## 🔐 安全配置

### 环境变量管理

```bash
# 查看所有 secrets
wrangler secret list

# 删除 secret
wrangler secret delete SECRET_NAME

# 批量设置 secrets
echo "your-api-key-1,your-api-key-2" | wrangler secret put GEMINI_API_KEYS
```

### CORS 配置

在生产环境中，建议设置具体的 CORS 源：

```bash
wrangler secret put CORS_ORIGIN
# 输入: https://yourdomain.com,https://app.yourdomain.com
```

## 🚨 故障排除

### 常见问题

1. **构建失败**
   ```bash
   # 清理并重新构建
   npm run clean
   npm run build
   wrangler deploy
   ```

2. **环境变量未生效**
   ```bash
   # 检查 secrets 列表
   wrangler secret list
   
   # 重新设置 secret
   wrangler secret put VARIABLE_NAME
   ```

3. **部署超时**
   ```bash
   # 增加超时时间
   wrangler deploy --compatibility-date 2024-01-01
   ```

4. **域名路由问题**
   ```bash
   # 检查路由配置
   wrangler routes list
   
   # 更新路由
   wrangler route put "api.yourdomain.com/*" api-proxy-gateway-service
   ```

### 调试模式

```bash
# 本地开发模式
wrangler dev

# 指定端口
wrangler dev --port 8080

# 连接到远程资源
wrangler dev --remote
```

## 📈 性能优化

### 冷启动优化

1. **减少依赖大小**
   - 使用 tree-shaking
   - 避免大型依赖库

2. **代码分割**
   - 按需加载模块
   - 延迟初始化

3. **缓存策略**
   - 使用 KV 存储缓存配置
   - 实现智能缓存失效

### 监控指标

在 Cloudflare Dashboard 中监控：

- 请求数量和频率
- 响应时间分布
- 错误率统计
- CPU 和内存使用情况

## 🔄 CI/CD 集成

### GitHub Actions 示例

创建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy to Cloudflare Workers

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Build project
        run: npm run build
        
      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: deploy --env production
```

## 📞 支持

如果遇到部署问题：

1. 查看 [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
2. 检查 [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)
3. 在项目 GitHub 仓库提交 Issue

---

**部署成功后，您的 API 代理网关服务将在全球 Cloudflare 边缘网络上运行！** 🌍
