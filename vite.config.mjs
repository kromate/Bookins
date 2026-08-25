import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

function goalmaticSeo() {
  return {
    name: 'goalmatic-source-seo',
    transformIndexHtml(html) {
      try {
        const seo = JSON.parse(readFileSync(new URL('./goalmatic.seo.json', import.meta.url), 'utf8'))
        const page = seo.pages?.['/'] || {}
        const escape = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
        const title = escape(page.title || seo.title)
        const description = escape(page.description || seo.description)
        const image = escape(page.image || seo.image)
        const favicon = escape(seo.favicon)
        const upsert = (pattern, tag) => { if (!tag) return; html = pattern.test(html) ? html.replace(pattern, tag) : html.replace('</head>', tag + '\n</head>') }
        if (title) html = /<title>[\s\S]*?<\/title>/i.test(html) ? html.replace(/<title>[\s\S]*?<\/title>/i, '<title>' + title + '</title>') : html.replace('</head>', '<title>' + title + '</title>\n</head>')
        upsert(/<meta\b[^>]*name=["']description["'][^>]*>/i, description && '<meta name="description" content="' + description + '">')
        upsert(/<meta\b[^>]*property=["']og:image["'][^>]*>/i, image && '<meta property="og:image" content="' + image + '">')
        upsert(/<link\b[^>]*rel=["']icon["'][^>]*>/i, favicon && '<link rel="icon" href="' + favicon + '">')
        return html
      } catch { return html }
    },
  }
}

export default defineConfig({ plugins: [vue(), tailwindcss(), goalmaticSeo()] })
