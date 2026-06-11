@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ================================================
echo   企业产品展示与点单系统
echo ================================================
echo.

REM 检查并清理已占用 8080 端口的旧进程
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING" 2^>nul') do (
    echo [清理] 正在结束旧进程 PID=%%a ...
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

echo 正在启动服务器...
echo.
echo 用户端将在浏览器中自动打开: http://localhost:8080
echo 管理端入口: http://localhost:8080/admin
echo.

start http://localhost:8080
python app.py
pause
