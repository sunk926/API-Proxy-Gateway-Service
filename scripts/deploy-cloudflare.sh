#!/bin/bash

# Cloudflare Workers 部署脚本
# 用途：自动化 Cloudflare Workers 的部署流程

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查 Wrangler CLI
check_wrangler() {
    log_info "检查 Wrangler CLI..."
    
    if ! command -v wrangler &> /dev/null; then
        log_error "Wrangler CLI 未安装"
        log_info "请运行: npm install -g wrangler"
        exit 1
    fi
    
    log_success "Wrangler CLI 已安装: $(wrangler --version)"
}

# 检查登录状态
check_login() {
    log_info "检查 Cloudflare 登录状态..."
    
    if ! wrangler whoami &> /dev/null; then
        log_warning "未登录 Cloudflare"
        log_info "正在启动登录流程..."
        wrangler login
    else
        log_success "已登录 Cloudflare: $(wrangler whoami 2>/dev/null | head -1)"
    fi
}

# 构建项目
build_project() {
    log_info "构建项目..."
    
    # 清理旧的构建文件
    npm run clean
    
    # 安装依赖
    npm install
    
    # 构建项目
    npm run build
    
    # 检查构建结果
    if [ ! -f "dist/worker.js" ]; then
        log_error "构建失败：未找到 dist/worker.js"
        exit 1
    fi
    
    log_success "项目构建完成"
}

# 验证配置
validate_config() {
    log_info "验证配置文件..."
    
    if [ ! -f "wrangler.toml" ]; then
        log_error "未找到 wrangler.toml 配置文件"
        exit 1
    fi
    
    # 检查必要的配置项
    if ! grep -q "name.*=.*api-proxy-gateway-service" wrangler.toml; then
        log_warning "请检查 wrangler.toml 中的 name 配置"
    fi
    
    if ! grep -q "main.*=.*dist/worker.js" wrangler.toml; then
        log_warning "请检查 wrangler.toml 中的 main 配置"
    fi
    
    log_success "配置文件验证通过"
}

# 设置环境变量
setup_secrets() {
    local env=${1:-"production"}
    
    log_info "设置环境变量 (环境: $env)..."
    
    # 检查是否需要设置 API Keys
    if ! wrangler secret list | grep -q "GEMINI_API_KEYS"; then
        log_warning "未找到 GEMINI_API_KEYS，请手动设置："
        log_info "运行: wrangler secret put GEMINI_API_KEYS"
        log_info "然后输入您的 Gemini API Keys（多个用逗号分隔）"
        
        read -p "是否现在设置 GEMINI_API_KEYS? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            wrangler secret put GEMINI_API_KEYS
        fi
    else
        log_success "GEMINI_API_KEYS 已设置"
    fi
}

# 部署到 Cloudflare Workers
deploy_worker() {
    local env=${1:-"production"}
    
    log_info "部署到 Cloudflare Workers (环境: $env)..."
    
    if [ "$env" = "production" ]; then
        wrangler deploy --env production
    else
        wrangler deploy --env "$env"
    fi
    
    log_success "部署完成！"
}

# 验证部署
verify_deployment() {
    log_info "验证部署..."
    
    # 获取 Worker URL
    local worker_url=$(wrangler deployments list --json 2>/dev/null | jq -r '.[0].url' 2>/dev/null || echo "")
    
    if [ -z "$worker_url" ] || [ "$worker_url" = "null" ]; then
        log_warning "无法自动获取 Worker URL"
        log_info "请手动访问 Cloudflare Dashboard 查看部署状态"
        return
    fi
    
    log_info "Worker URL: $worker_url"
    
    # 测试健康检查端点
    log_info "测试健康检查端点..."
    
    if curl -s "$worker_url/health" | grep -q "healthy"; then
        log_success "健康检查通过"
    else
        log_warning "健康检查失败，请检查部署状态"
    fi
    
    # 显示有用的信息
    echo ""
    log_success "部署验证完成！"
    echo ""
    echo "🌍 Worker URL: $worker_url"
    echo "📊 健康检查: $worker_url/health"
    echo "📈 统计信息: $worker_url/stats"
    echo "🤖 Chat API: $worker_url/chat/completions"
    echo "🔍 Key 验证: $worker_url/verify"
    echo ""
}

# 显示帮助信息
show_help() {
    echo "Cloudflare Workers 部署脚本"
    echo ""
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  -h, --help          显示此帮助信息"
    echo "  -e, --env ENV       指定部署环境 (默认: production)"
    echo "  --skip-build        跳过构建步骤"
    echo "  --skip-secrets      跳过环境变量设置"
    echo "  --dev               启动开发模式"
    echo "  --tail              查看实时日志"
    echo ""
    echo "示例:"
    echo "  $0                  # 部署到生产环境"
    echo "  $0 -e development   # 部署到开发环境"
    echo "  $0 --dev            # 启动开发模式"
    echo "  $0 --tail           # 查看实时日志"
}

# 主函数
main() {
    local env="production"
    local skip_build=false
    local skip_secrets=false
    local dev_mode=false
    local tail_mode=false
    
    # 解析命令行参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -e|--env)
                env="$2"
                shift 2
                ;;
            --skip-build)
                skip_build=true
                shift
                ;;
            --skip-secrets)
                skip_secrets=true
                shift
                ;;
            --dev)
                dev_mode=true
                shift
                ;;
            --tail)
                tail_mode=true
                shift
                ;;
            *)
                log_error "未知选项: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    log_info "开始 Cloudflare Workers 部署流程..."
    
    # 基础检查
    check_wrangler
    check_login
    
    if [ "$tail_mode" = true ]; then
        log_info "启动日志监控..."
        wrangler tail
        exit 0
    fi
    
    if [ "$dev_mode" = true ]; then
        log_info "启动开发模式..."
        if [ "$skip_build" = false ]; then
            build_project
        fi
        wrangler dev
        exit 0
    fi
    
    # 部署流程
    validate_config
    
    if [ "$skip_build" = false ]; then
        build_project
    fi
    
    if [ "$skip_secrets" = false ]; then
        setup_secrets "$env"
    fi
    
    deploy_worker "$env"
    verify_deployment
    
    log_success "Cloudflare Workers 部署完成！"
}

# 捕获中断信号
trap 'log_warning "收到中断信号，正在退出..."; exit 130' INT TERM

# 执行主函数
main "$@"
