import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: process.env.BASE || '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'برنامج المتجر',
        short_name: 'المتجر',
        lang: 'ar',
        dir: 'rtl',
        display: 'standalone',
        background_color: '#f6f7f9',
        theme_color: '#14315c',
        icons: []
      }
    })
  ]
})
