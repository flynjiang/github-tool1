@echo off
chcp 65001 >nul 2>&1
title Git + LFS Web Helper

echo ========================================
echo   Git + LFS Web Helper
echo   启动中...
echo ========================================
echo.

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: 显示 Node 版本
for /f "tokens=*" %%i in ('node -v') do echo [信息] Node.js 版本: %%i

:: 进入脚本所在目录
cd /d "%~dp0"

:: 检查 .env 是否存在，不存在则从示例复制
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo [信息] 已创建 .env 配置文件（默认直连模式）
        echo [信息] 如需代理请编辑 .env 文件
        echo.
    )
)

:: 检查 node_modules 是否存在
if not exist "node_modules\" (
    echo.
    echo [信息] 首次运行，正在安装依赖...
    echo [信息] 这可能需要 1-2 分钟，请耐心等待...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo [错误] 依赖安装失败，请检查网络连接
        pause
        exit /b 1
    )
    echo.
    echo [信息] 依赖安装完成！
)

echo.
echo [信息] 正在启动开发服务器...
echo [信息] 启动后会自动打开浏览器
echo [信息] 关闭此窗口即可停止服务
echo.
echo ========================================
echo   访问地址: http://localhost:5173
echo ========================================
echo.

:: 延迟 2 秒后打开浏览器
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:5173"

:: 启动 Vite 开发服务器
call npx vite --host
