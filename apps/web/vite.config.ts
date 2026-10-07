import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // 0.0.0.0：本机 + 同局域网其他设备可访问（用本机局域网 IP 打开）
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        // SOP / 浏览器登录可能跑十几分钟；默认代理超时会直接 502
        timeout: 20 * 60 * 1000,
        proxyTimeout: 20 * 60 * 1000,
      },
    },
  },
});
