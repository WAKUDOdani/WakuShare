import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const explorerWorkspace = process.env['WAKUSHARE_EXPLORER_WORKSPACE']
const explorerProduct = process.env['WAKUSHARE_EXPLORER_PRODUCT'] === '1'
if (explorerProduct && process.env['WAKUSHARE_PREVIEW'] === '1' && !explorerWorkspace)
  throw new Error('Product preview requires its explicit linked workspace')
if (explorerWorkspace && process.env['WAKUSHARE_PREVIEW'] !== '1')
  throw new Error('A linked Explorer workspace requires an explicit local preview build')
const preview = {
  __WAKUSHARE_PREVIEW__: JSON.stringify(process.env['WAKUSHARE_PREVIEW'] === '1'),
  __WAKUSHARE_EXPLORER_PREVIEW__: JSON.stringify(Boolean(explorerWorkspace))
}

export default defineConfig({
  main: {
    define: {
      ...preview,
      __WAKUSHARE_EXPLORER_PRODUCT__: JSON.stringify(explorerProduct),
      __WAKUSHARE_EXPLORER_WORKSPACE__: JSON.stringify(
        explorerWorkspace ? resolve(explorerWorkspace) : ''
      )
    },
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    define: preview,
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
