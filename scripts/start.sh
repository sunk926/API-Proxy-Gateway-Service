#!/bin/bash

# API 代理网关服务启动脚本
# 用途：自动化项目的构建、测试和启动流程

set -e  # 遇到错误时退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# 检查 Node.js 版本
check_node_version() {
    log_info "检查 Node.js 版本..."
    
    if ! command -v node &> /dev/null; then
        log_error "Node.js 未安装，请先安装 Node.js 18+"
        exit 1
    fi
    
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        log_error "Node.js 版本过低，当前版本: $(node -v)，需要 18+"
        exit 1
    fi
    
    log_success "Node.js 版本检查通过: $(node -v)"
}

# 检查包管理器
check_package_manager() {
    log_info "检查包管理器..."
    
    if command -v npm &> /dev/null; then
        PACKAGE_MANAGER="npm"
        log_success "使用 npm 作为包管理器"
    elif command -v yarn &> /dev/null; then
        PACKAGE_MANAGER="yarn"
        log_success "使用 yarn 作为包管理器"
    else
        log_error "未找到 npm 或 yarn 包管理器"
        exit 1
    fi
}

# 安装依赖
install_dependencies() {
    log_info "安装项目依赖..."
    
    if [ "$PACKAGE_MANAGER" = "npm" ]; then
        npm install
    else
        yarn install
    fi
    
    log_success "依赖安装完成"
}

# 检查环境变量文件
check_env_file() {
    log_info "检查环境变量配置..."
    
    if [ ! -f ".env" ]; then
        log_warning ".env 文件不存在，从 .env.example 复制..."
        if [ -f ".env.example" ]; then
            cp .env.example .env
            log_success "已创建 .env 文件"
            log_warning "请编辑 .env 文件，添加您的 Gemini API Keys"
        else
            log_error ".env.example 文件不存在"
            exit 1
        fi
    else
        log_success ".env 文件已存在"
    fi
}

# 类型检查
type_check() {
    log_info "执行 TypeScript 类型检查..."
    
    if [ "$PACKAGE_MANAGER" = "npm" ]; then
        npm run type-check
    else
        yarn type-check
    fi
    
    log_success "类型检查通过"
}

# 代码格式检查
lint_check() {
    log_info "执行代码格式检查..."
    
    if [ "$PACKAGE_MANAGER" = "npm" ]; then
        npm run lint
    else
        yarn lint
    fi
    
    log_success "代码格式检查通过"
}

# 构建项目
build_project() {
    log_info "构建项目..."
    
    if [ "$PACKAGE_MANAGER" = "npm" ]; then
        npm run build
    else
        yarn build
    fi
    
    log_success "项目构建完成"
}

# 启动服务
start_service() {
    local mode=${1:-"development"}
    
    log_info "启动服务 (模式: $mode)..."
    
    if [ "$mode" = "production" ]; then
        if [ "$PACKAGE_MANAGER" = "npm" ]; then
            npm start
        else
            yarn start
        fi
    else
        if [ "$PACKAGE_MANAGER" = "npm" ]; then
            npm run dev
        else
            yarn dev
        fi
    fi
}

# 显示帮助信息
show_help() {
    echo "API 代理网关服务启动脚本"
    echo ""
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  -h, --help          显示此帮助信息"
    echo "  -d, --dev           启动开发模式 (默认)"
    echo "  -p, --prod          启动生产模式"
    echo "  -b, --build         仅构建项目"
    echo "  -t, --test          运行测试"
    echo "  -l, --lint          运行代码检查"
    echo "  --skip-checks       跳过类型检查和代码格式检查"
    echo "  --skip-build        跳过构建步骤"
    echo ""
    echo "示例:"
    echo "  $0                  # 启动开发模式"
    echo "  $0 --prod           # 启动生产模式"
    echo "  $0 --build          # 仅构建项目"
    echo "  $0 --test           # 运行测试"
}

# 主函数
main() {
    local mode="development"
    local skip_checks=false
    local skip_build=false
    local only_build=false
    local only_test=false
    local only_lint=false
    
    # 解析命令行参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -d|--dev)
                mode="development"
                shift
                ;;
            -p|--prod)
                mode="production"
                shift
                ;;
            -b|--build)
                only_build=true
                shift
                ;;
            -t|--test)
                only_test=true
                shift
                ;;
            -l|--lint)
                only_lint=true
                shift
                ;;
            --skip-checks)
                skip_checks=true
                shift
                ;;
            --skip-build)
                skip_build=true
                shift
                ;;
            *)
                log_error "未知选项: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    log_info "开始启动 API 代理网关服务..."
    
    # 基础检查
    check_node_version
    check_package_manager
    install_dependencies
    check_env_file
    
    # 代码质量检查
    if [ "$skip_checks" = false ]; then
        type_check
        lint_check
    fi
    
    # 根据参数执行不同操作
    if [ "$only_lint" = true ]; then
        log_success "代码检查完成"
        exit 0
    elif [ "$only_test" = true ]; then
        log_info "运行测试..."
        if [ "$PACKAGE_MANAGER" = "npm" ]; then
            npm test
        else
            yarn test
        fi
        log_success "测试完成"
        exit 0
    elif [ "$only_build" = true ]; then
        build_project
        log_success "构建完成"
        exit 0
    fi
    
    # 生产模式需要构建
    if [ "$mode" = "production" ] && [ "$skip_build" = false ]; then
        build_project
    fi
    
    # 启动服务
    start_service "$mode"
}

# 捕获中断信号
trap 'log_warning "收到中断信号，正在退出..."; exit 130' INT TERM

# 执行主函数
main "$@"
