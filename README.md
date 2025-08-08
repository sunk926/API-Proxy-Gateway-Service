Balance Lite: 技术设计文档
1. 引言 (Introduction)
1.1. 项目目标
"Balance Lite" 项目旨在为开发者提供一个轻量级、高性能且具备高可用性的 Gemini API 代理服务。其核心目标是解决开发者在使用原生 Gemini API 时遇到的网络访问限制、单一 API Key 的请求频率与稳定性瓶颈问题。通过聚合多个 API Key，项目实现了智能负载均衡与错误的自动熔断恢复，同时内置了对 OpenAI API 格式的兼容，极大地简化了现有应用的迁移成本和开发流程。

1.2. 背景
随着大语言模型的普及，Google 的 Gemini 系列模型因其强大的性能而备受关注。然而，开发者在集成和使用过程中常面临以下挑战：

网络限制: Google Cloud 服务在部分地区存在网络访问障碍。

速率限制: 单个免费 API Key 有严格的 QPM (Queries Per Minute) 限制，容易达到瓶颈。

服务稳定性: 单个 Key 可能会因未知原因暂时失效，影响服务的整体可用性。

生态兼容性: 许多现有应用和客户端工具是围绕 OpenAI 的 API 格式构建的，直接切换到 Gemini API 需要大量的代码改造。

本项目正是为了应对这些挑战而设计的无服务器解决方案。

1.3. 范围
范围内 (In Scope)
Gemini 原生 API 代理: 完全代理对 generativelanguage.googleapis.com 的请求。

OpenAI 格式兼容: 支持将 OpenAI 格式的 /chat/completions 请求转换为 Gemini 格式，并以 OpenAI 格式返回结果。

多 Key 智能负载均衡: 支持在请求头中传入多个 API Key，并采用智能策略进行分发。

失败 Key 自动熔断与恢复: 当某个 Key 连续请求失败时，自动将其暂时隔离，并在一段时间后尝试恢复。

流式与非流式传输: 对 Gemini 和 OpenAI 两种模式均支持流式（SSE）和非流式响应。

多平台部署支持: 提供对 Vercel, Cloudflare Workers, Deno Deploy, Netlify 等主流边缘计算平台的“一键部署”支持。

API Key 验证: 提供一个独立的端点用于批量验证 API Key 的有效性。

范围外 (Out of Scope)
用户认证系统: 项目本身不设用户管理和认证。

请求日志持久化存储: 日志仅在函数执行期间输出到控制台，不进行持久化。

跨实例的状态同步: Key 的熔断状态是基于内存的，不跨地域或跨函数实例共享。

复杂的自定义路由逻辑: 只处理预设的代理和兼容性路由。

1.4. 术语表
Edge Function (边缘函数): 部署在全球分布式网络节点上的无服务器函数，能以低延迟响应用户请求。

Serverless (无服务器): 一种云计算模型，云服务商负责管理服务器基础设施，开发者只需关注代码逻辑。

Load Balancing (负载均衡): 将网络请求有效分配到多个后端服务器（或此项目中的多个 API Key）以提高系统吞吐量和可用性的技术。

Circuit Breaker (熔断器): 一种设计模式，用于在检测到连续故障时，自动阻止对可能存在问题的服务的进一步请求，防止级联失败，并在一段时间后尝试恢复。

2. 系统架构 (System Architecture)
2.1. 架构概览
Gemini Balance Lite 采用纯粹的无服务器边缘函数架构。所有逻辑均在单个函数入口内完成，无外部数据库或缓存依赖。其核心是一个事件驱动的请求处理器，它集成了路由、负载均衡和熔断器逻辑。当请求到达边缘网关时，函数被触发。它首先解析请求路径，然后将其分发给不同的处理模块。对于需要调用上游 API 的请求，智能负载均衡器会从内存中的可用 Key 池中选择一个 Key。如果调用失败，熔断器会更新该 Key 的状态。这种设计保证了极低的运维成本和高弹性。

2.2. 架构图
graph TD
    subgraph "客户端"
        A[用户 / AI 应用]
    end

    subgraph "边缘计算平台 (Vercel / Cloudflare / ...)"
        B[边缘网关]
        C{核心路由与负载均衡器<br>(handle_request.js)}
        D[OpenAI 适配器<br>(openai.mjs)]
        E[Key 验证服务<br>(verify_keys.js)]
        F[(内存状态<br>可用Keys/熔断Keys)]
    end

    subgraph "上游服务"
        G[Google Gemini API]
    end

    A -- HTTPS请求 --> B
    B -- 触发函数 --> C
    C -- 路径: /verify --> E
    C -- 路径: */chat/completions --> D
    C -- 路径: /v1beta/* --> G
    C -- 读/写 --> F
    D -- 转换后请求 --> C
    E -- 验证请求 --> G

2.3. 数据流图 (OpenAI 聊天请求)
sequenceDiagram
    participant Client as 客户端
    participant Edge_Gateway as 边缘网关
    participant Handler as 核心处理器
    participant OpenAI_Adapter as OpenAI适配器
    participant Gemini_API as Gemini API

    Client->>Edge_Gateway: POST /chat/completions (含多个Key)
    Edge_Gateway->>Handler: 触发函数
    Handler->>OpenAI_Adapter: 传入请求
    OpenAI_Adapter->>Handler: 返回转换后的Gemini格式请求
    
    Handler->>Handler: 1. 从可用Key池选择一个Key (e.g., Key_A)
    Handler->>Gemini_API: 2. 使用 Key_A 发起 generateContent 请求

    alt 请求成功
        Gemini_API-->>Handler: 返回成功响应 (200 OK)
        Handler->>OpenAI_Adapter: 传入Gemini响应
        OpenAI_Adapter->>Handler: 返回转换后的OpenAI格式响应
        Handler-->>Client: 返回最终响应
    else 请求失败 (e.g., 429/500)
        Gemini_API-->>Handler: 返回错误响应
        Handler->>Handler: 3. 记录 Key_A 失败次数
        Note right of Handler: 如果失败次数达到阈值...<br/>将 Key_A 从可用池移入熔断池<br/>并设置冷却计时器。
        Handler->>Handler: 4. 尝试选择下一个可用 Key (e.g., Key_B)
        Handler->>Gemini_API: 5. 使用 Key_B 重试请求
        Gemini_API-->>Handler: 返回成功响应
        Handler-->>Client: (同成功路径)
    end

3. 核心模块设计 (Module Design)
3.1. 入口与智能负载均衡模块 (handle_request.js)
职责: 作为所有请求的统一入口，负责解析请求、分发任务，并对需要访问上游 API 的请求执行智能的 Key 选择策略。

智能负载均衡策略:

"轮询 + 错误避免": 模块在内存中维护一个所有可用 API Keys 的列表。每次请求时，它会按顺序（轮询）从这个列表中取出一个 Key。这种方式确保了请求能均匀地分布在所有健康的 Key 上。

错误自动禁用（熔断器模式）:

状态管理: 模块在内存中额外维护一个“熔断中”的 Key 列表，其中每个 Key 都关联一个解禁时间戳。

触发条件: 当使用某个 Key 对 Gemini API 的请求返回严重错误（如 429 Too Many Requests, 500 Internal Server Error）时，该 Key 的失败计数器会增加。为了简化，当前实现为单次失败即触发。

熔断逻辑: 一旦触发，该 Key 会立即从“可用”列表移动到“熔断中”列表，并为其设置一个当前时间 + 冷却时间（例如 5 分钟）的解禁时间戳。

恢复机制: 在选择 Key 时，负载均衡器会忽略“熔断中”列表里的所有 Key。在每次新请求开始时，系统会检查“熔断中”列表，将所有已经超过解禁时间戳的 Key 移回到“可用”列表的末尾，让它们有机会被重新使用。

3.2. OpenAI 兼容适配器 (openai.mjs)
职责: 充当 OpenAI 和 Gemini API 之间的翻译层，使得用户可以使用标准的 OpenAI 客户端与 Gemini 模型进行交互。

请求转换:

将 OpenAI 的 messages 数组转换为 Gemini 的 contents 数组，并正确映射 role (user -> user, assistant -> model)。

将 OpenAI 的 model, temperature, max_tokens, stream 等参数映射到 Gemini 的 generationConfig 中对应的字段。

响应转换:

将 Gemini 的 generateContentResponse 转换回 OpenAI 的 chat.completion 对象。

精确映射 finishReason (STOP -> stop, MAX_TOKENS -> length, SAFETY -> content_filter)。

在流式响应中，将 Gemini 的 SSE 事件块逐个转换为 OpenAI 的 chat.completion.chunk 格式，并确保 [DONE] 信号被正确发送。

3.3. API Key 验证模块 (verify_keys.js)
职责: 提供一个快速、并发的方式来检查用户提供的一组 API Key 是否有效。

实现机制:

接收到请求后，模块会并发地为请求头 x-goog-api-key 中提供的每一个 Key 发起一个简单的 generateContent 测试请求。

它利用 ReadableStream 和 text/event-stream 格式，每当一个 Key 的验证完成时，就立即将结果（包含 Key 的部分信息、状态和错误消息）作为一个 SSE 事件推送给客户端，实现了非阻塞的流式响应。

4. API 接口设计 (API Design)
4.1. Gemini 代理端点
Endpoint: /{v1beta|v1}/models/{model}:{method}

Method: POST

Headers:

Content-Type: application/json

x-goog-api-key: <key1>,<key2>,...

描述: 完全代理对 Google Gemini API 的请求。请求和响应体与官方 API 规范一致。负载均衡和熔断机制在此端点上生效。

4.2. OpenAI 兼容端点
Endpoint: /chat/completions (或 /v1/chat/completions)

Method: POST

Headers:

Content-Type: application/json

Authorization: Bearer <key1>,<key2>,...

描述: 模拟 OpenAI 的聊天完成接口。

请求示例:

{
    "model": "gpt-3.5-turbo",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": false
}

响应示例:

{
    "id": "chatcmpl-...",
    "object": "chat.completion",
    "created": 1677652288,
    "model": "gemini-1.5-flash",
    "choices": [{
        "index": 0,
        "message": {
            "role": "assistant",
            "content": "你好！有什么可以帮助你的吗？"
        },
        "finish_reason": "stop"
    }],
    "usage": {
        "prompt_tokens": 9,
        "completion_tokens": 12,
        "total_tokens": 21
    }
}

4.3. API Key 验证端点
Endpoint: /verify

Method: POST

Headers:

x-goog-api-key: <valid_key>,<invalid_key>

描述: 以 SSE (Server-Sent Events) 形式流式返回 Key 的验证结果。

响应流示例:

data: {"key":"AIzaSy...OfGC3A","status":"GOOD"}

data: {"key":"AIzaSy...Invalid","status":"BAD","error":"API key not valid. Please pass a valid API key."}

5. 部署与配置 (Deployment & Configuration)
5.1. Vercel 部署
配置文件: vercel.json, api/vercel_index.js

关键配置: vercel.json 中的 "routes": [{ "src": "/(.*)", "dest": "/api/vercel_index.js" }] 将所有请求重写到边缘函数。api/vercel_index.js 中设置 runtime: 'edge' 以确保在 Vercel 的全球边缘网络上运行。

5.2. Cloudflare Worker 部署
配置文件: wrangler.toml

关键配置: main = "src/index.js" 指定了入口文件。compatibility_flags = ["nodejs_compat"] 开启了对 Node.js 部分核心模块的兼容性支持。

5.3. Deno Deploy 部署
入口文件: src/deno_index.ts

描述: 该文件使用 Deno.serve API 启动一个原生 HTTP 服务器，将所有传入的请求传递给核心处理逻辑 handleRequest。

5.4. Netlify Edge Function 部署
配置文件: netlify.toml, netlify/functions/api.js

描述: netlify.toml 中的 [[redirects]] 规则，特别是 from = "/*" 和 to = "/.netlify/functions/api", 将站点的所有流量捕获并代理到名为 api 的边缘函数。

6. 错误处理与安全性 (Error Handling & Security)
6.1. 错误处理
上游错误: 所有来自 Gemini API 的 4xx 或 5xx 响应都会被捕获。这些错误不仅会触发熔断机制，其响应体也会被尽可能透明地返回给客户端，以便调试。

无可用 Key 错误: 如果所有用户提供的 API Key 都因失败而被移入熔断列表，系统将向客户端返回 503 Service Unavailable 状态码，并附带一条明确的错误消息，如 "All API keys are currently unavailable."。

6.2. 安全性考量
API Key 安全: API Key 仅在请求的生命周期内存在于内存中，通过 HTTPS 安全传输，项目本身不会在任何地方持久化存储这些凭证。

CORS: openai.mjs 模块正确处理 OPTIONS 预检请求，并在所有响应中添加 Access-Control-Allow-Origin: * 头，以确保浏览器环境下的跨域调用能够成功。

状态管理: 必须明确，Key 的熔断状态是基于内存且限于单个函数实例的。这意味着在 Serverless 环境下，一个位于东京的函数实例无法知道一个位于法兰克福的实例中的 Key 状态。这种设计简化了架构，但也意味着熔断不是全局性的。

7. 未来展望 (Future Work)
分布式状态管理: 引入 Cloudflare KV 或 Vercel KV 等分布式键值存储，用于同步 API Key 的熔断状态。这将使得熔断决策可以在全球所有边缘节点之间共享，实现更快速、更高效的全局故障转移。

高级负载均衡策略: 开发更复杂的负载均衡算法，例如：

基于延迟: 定期检测每个 Key 到 Gemini API 的网络延迟，优先选择延迟最低的 Key。

基于令牌使用量: 如果可能，追踪每个 Key 的令牌消耗，优先选择消耗较少的 Key 以避免超出配额。

可配置的熔断参数: 允许用户通过特定的请求头（如 X-Circuit-Breaker-Cooldown: 300）或环境变量来动态配置熔断策略的参数，如失败阈值、冷却时间等，以适应不同的使用场景。
