import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// index.html의 CSP는 빌드된 앱 기준이다. 개발 서버에서만 React Fast Refresh 인라인 스크립트,
// HMR 웹소켓, 브라우저에서 여는 Google 로그인 팝업을 허용한다.
const devCsp = {
  name: 'planer-dev-csp',
  apply: 'serve',
  transformIndexHtml: html => html
    .replace("script-src 'self'", "script-src 'self' 'unsafe-inline' https://apis.google.com")
    .replace("connect-src 'self'", "connect-src 'self' ws://localhost:* http://localhost:*")
    .replace("frame-src 'none'", "frame-src https://planer-f8cb7.firebaseapp.com https://accounts.google.com"),
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), devCsp],
  base: './',
})
