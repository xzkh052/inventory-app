#!/bin/bash
# ============================================================
# 库存管理 — Mac 一键启动脚本
# 双击本文件即可启动本地服务并打开浏览器
#
# 端口固定为 8001，保证数据来源始终一致。
# 启动前会先结束占用 8001 的旧进程，避免端口漂移导致数据"消失"。
# ============================================================

cd "$(dirname "$0")" || exit 1

PORT=8001

# 先结束占用该端口的旧进程（避免端口漂移）
OLD_PID=$(lsof -ti :$PORT 2>/dev/null)
if [ -n "$OLD_PID" ]; then
  echo "检测到端口 $PORT 已被占用，正在结束旧进程..."
  kill $OLD_PID 2>/dev/null
  sleep 1
  # 若仍未结束，强制结束
  OLD_PID=$(lsof -ti :$PORT 2>/dev/null)
  if [ -n "$OLD_PID" ]; then
    kill -9 $OLD_PID 2>/dev/null
    sleep 1
  fi
fi

# 获取本机局域网 IP（供 iPhone 使用）
IP=$(ipconfig getifaddr en0 2>/dev/null)
if [ -z "$IP" ]; then
  IP=$(ipconfig getifaddr en1 2>/dev/null)
fi

echo ""
echo "============================================"
echo "  库存管理 已启动"
echo "============================================"
echo ""
echo "  Mac 本机访问（请始终使用这个地址）："
echo "    http://localhost:$PORT"
echo ""
if [ -n "$IP" ]; then
  echo "  iPhone 访问（需同一 WiFi）："
  echo "    http://$IP:$PORT"
  echo ""
  echo "  iPhone 首次使用：Safari 打开上面地址"
  echo "  → 分享 → 添加到主屏幕"
  echo ""
fi
echo "  关闭本窗口即停止服务。"
echo "============================================"
echo ""

# 延迟 1 秒后打开浏览器
( sleep 1 && open "http://localhost:$PORT" ) &

# 启动本地服务
python3 -m http.server $PORT
