import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The app is served from the site root by Flask (frontend.py), straight out of frontend/dist.
// `npm run dev` proxies /api to a locally running `python app.py`.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:5000' } },
})
