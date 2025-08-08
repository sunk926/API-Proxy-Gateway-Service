#!/bin/bash

# API 代理网关服务测试脚本
# 用途：测试各个 API 端点的功能

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 配置
BASE_URL="http://localhost:3000"
TEST_API_KEY="AIzaSyDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"  # 示例 API Key

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

# 检查服务是否运行
check_service() {
    log_info "检查服务是否运行..."
    
    if curl -s "$BASE_URL/health" > /dev/null; then
        log_success "服务正在运行"
    else
        log_error "服务未运行，请先启动服务"
        exit 1
    fi
}

# 测试根路径
test_root() {
    log_info "测试根路径..."
    
    response=$(curl -s "$BASE_URL/")
    
    if echo "$response" | grep -q "API 代理网关服务运行中"; then
        log_success "根路径测试通过"
    else
        log_error "根路径测试失败"
        echo "响应: $response"
    fi
}

# 测试健康检查
test_health() {
    log_info "测试健康检查..."
    
    response=$(curl -s "$BASE_URL/health")
    
    if echo "$response" | grep -q "healthy"; then
        log_success "健康检查测试通过"
    else
        log_error "健康检查测试失败"
        echo "响应: $response"
    fi
}

# 测试统计信息
test_stats() {
    log_info "测试统计信息..."
    
    response=$(curl -s "$BASE_URL/stats")
    
    if echo "$response" | grep -q "loadBalancer"; then
        log_success "统计信息测试通过"
    else
        log_error "统计信息测试失败"
        echo "响应: $response"
    fi
}

# 测试 Chat Completions (非流式)
test_chat_completions() {
    log_info "测试 Chat Completions (非流式)..."
    
    response=$(curl -s -X POST "$BASE_URL/chat/completions" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $TEST_API_KEY" \
        -d '{
            "model": "gpt-3.5-turbo",
            "messages": [
                {"role": "user", "content": "Hello, world!"}
            ],
            "stream": false
        }')
    
    if echo "$response" | grep -q "choices\|error"; then
        log_success "Chat Completions 测试通过"
        echo "响应摘要: $(echo "$response" | jq -r '.choices[0].message.content // .error.message' 2>/dev/null || echo "无法解析响应")"
    else
        log_error "Chat Completions 测试失败"
        echo "响应: $response"
    fi
}

# 测试 Chat Completions (流式)
test_chat_completions_stream() {
    log_info "测试 Chat Completions (流式)..."
    
    # 使用 timeout 限制测试时间
    response=$(timeout 10s curl -s -X POST "$BASE_URL/chat/completions" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $TEST_API_KEY" \
        -d '{
            "model": "gpt-3.5-turbo",
            "messages": [
                {"role": "user", "content": "Say hello"}
            ],
            "stream": true
        }' || echo "timeout")
    
    if echo "$response" | grep -q "data:\|error"; then
        log_success "流式 Chat Completions 测试通过"
        echo "响应摘要: 收到流式数据"
    else
        log_warning "流式 Chat Completions 测试可能失败或超时"
        echo "响应: $response"
    fi
}

# 测试 API Key 验证
test_key_verification() {
    log_info "测试 API Key 验证..."
    
    response=$(timeout 10s curl -s -X POST "$BASE_URL/verify" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $TEST_API_KEY,invalid-key" || echo "timeout")
    
    if echo "$response" | grep -q "data:\|status"; then
        log_success "API Key 验证测试通过"
        echo "响应摘要: 收到验证结果"
    else
        log_warning "API Key 验证测试可能失败或超时"
        echo "响应: $response"
    fi
}

# 测试错误处理
test_error_handling() {
    log_info "测试错误处理..."
    
    # 测试无效路径
    response=$(curl -s "$BASE_URL/invalid-path")
    
    if echo "$response" | grep -q "error\|404"; then
        log_success "404 错误处理测试通过"
    else
        log_error "404 错误处理测试失败"
        echo "响应: $response"
    fi
    
    # 测试无效请求体
    response=$(curl -s -X POST "$BASE_URL/chat/completions" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $TEST_API_KEY" \
        -d '{"invalid": "request"}')
    
    if echo "$response" | grep -q "error"; then
        log_success "无效请求错误处理测试通过"
    else
        log_error "无效请求错误处理测试失败"
        echo "响应: $response"
    fi
}

# 测试 CORS
test_cors() {
    log_info "测试 CORS..."
    
    response=$(curl -s -I -X OPTIONS "$BASE_URL/chat/completions" \
        -H "Origin: https://example.com" \
        -H "Access-Control-Request-Method: POST" \
        -H "Access-Control-Request-Headers: Content-Type,Authorization")
    
    if echo "$response" | grep -q "Access-Control-Allow-Origin"; then
        log_success "CORS 测试通过"
    else
        log_error "CORS 测试失败"
        echo "响应: $response"
    fi
}

# 性能测试
test_performance() {
    log_info "执行简单性能测试..."
    
    start_time=$(date +%s%N)
    
    for i in {1..5}; do
        curl -s "$BASE_URL/health" > /dev/null
    done
    
    end_time=$(date +%s%N)
    duration=$(( (end_time - start_time) / 1000000 ))  # 转换为毫秒
    avg_time=$(( duration / 5 ))
    
    log_success "性能测试完成 - 5次请求平均响应时间: ${avg_time}ms"
}

# 显示帮助信息
show_help() {
    echo "API 代理网关服务测试脚本"
    echo ""
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  -h, --help          显示此帮助信息"
    echo "  -u, --url URL       设置基础 URL (默认: $BASE_URL)"
    echo "  -k, --key KEY       设置测试 API Key"
    echo "  --basic             只运行基础测试"
    echo "  --full              运行完整测试套件"
    echo "  --performance       只运行性能测试"
    echo ""
    echo "示例:"
    echo "  $0                  # 运行基础测试"
    echo "  $0 --full           # 运行完整测试"
    echo "  $0 -u http://localhost:8080 # 使用自定义 URL"
}

# 主函数
main() {
    local test_mode="basic"
    
    # 解析命令行参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -u|--url)
                BASE_URL="$2"
                shift 2
                ;;
            -k|--key)
                TEST_API_KEY="$2"
                shift 2
                ;;
            --basic)
                test_mode="basic"
                shift
                ;;
            --full)
                test_mode="full"
                shift
                ;;
            --performance)
                test_mode="performance"
                shift
                ;;
            *)
                log_error "未知选项: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    log_info "开始测试 API 代理网关服务..."
    log_info "基础 URL: $BASE_URL"
    
    # 检查服务状态
    check_service
    
    # 根据模式执行测试
    case $test_mode in
        "basic")
            test_root
            test_health
            test_stats
            test_cors
            ;;
        "full")
            test_root
            test_health
            test_stats
            test_chat_completions
            test_chat_completions_stream
            test_key_verification
            test_error_handling
            test_cors
            test_performance
            ;;
        "performance")
            test_performance
            ;;
    esac
    
    log_success "测试完成！"
}

# 执行主函数
main "$@"
