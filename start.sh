#!/bin/bash
cd "$(dirname "$0")"
echo ""
echo "================================================"
echo "  企业产品展示与点单系统"
echo "================================================"
echo ""
echo "正在启动服务器..."
echo ""
echo "用户端将在浏览器中自动打开: http://localhost:8080"
echo "管理端入口: http://localhost:8080/admin"
echo ""

# 根据操作系统自动打开浏览器
if command -v xdg-open &>/dev/null; then
  xdg-open http://localhost:8080 &>/dev/null &
elif command -v open &>/dev/null; then
  open http://localhost:8080 &>/dev/null &
fi

python3 app.py
