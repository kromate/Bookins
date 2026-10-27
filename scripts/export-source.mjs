import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { check } from './check.mjs'

export async function exportSource(root) {
  await check(root)
  const roots = [
    '.env.example', '.goalmatic/app.json', '.goalmatic/source.json', '.goalmatic/tailwind.css',
    '.goalmaticignore', 'App.vue', 'README.md', 'booking-appearance.ts', 'booking.ts',
    'campaigns.ts', 'components', 'css', 'csv.ts', 'demo', 'docs/ARCHITECTURE.md',
    'docs/TYPESCRIPT-MIGRATION.md', 'env.d.ts', 'error-message.ts', 'feedback.config.json',
    'format-date.ts', 'goalmatic.config.json', 'goalmatic.dev.ts', 'goalmatic.json',
    'goalmatic.seo.json', 'goalmatic/store-listing.json', 'guest-page.ts', 'i18n', 'index.html',
    'messaging.ts', 'package.json', 'pages', 'records.ts', 'runtime.ts', 'scheduling.ts',
    'scripts', 'service-meta.ts', 'services.ts', 'setup.ts', 'team-ui.ts', 'team.ts',
    'time-display.ts', 'tsconfig.json', 'types.ts', 'vite.config.mjs', 'weekly-hours.ts', 'yarn.lock',
  ]
  const files = []
  async function add(path) {
    let stat
    try { stat = await lstat(path) } catch (error) { if (error?.code === 'ENOENT') return; throw error }
    if (stat.isSymbolicLink()) throw new Error(`Refusing a source symlink: ${path}`)
    if (stat.isDirectory()) {
      for (const entry of (await readdir(path)).sort()) await add(resolve(path, entry))
      return
    }
    const local = relative(root, path)
    if (!/\.(vue|css|m?js|ts|json|html|svg|txt|lock|md)$/.test(local) && !['.env.example', '.goalmaticignore'].includes(local)) throw new Error(`Unsupported source file: ${local}`)
    const bytes = await readFile(path)
    if (bytes.includes(0) || bytes.length > 1024 * 1024) throw new Error(`Binary or oversized source: ${local}`)
    const content = bytes.toString('utf8')
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:sk_live_|sk_test_)[a-zA-Z0-9]{12,}/.test(content)) throw new Error(`Potential secret in ${local}`)
    const extension = extname(local)
    const type = extension === '.vue' ? 'vue' : extension === '.css' ? 'css' : ['.ts', '.mjs', '.js'].includes(extension) ? 'javascript' : extension === '.html' ? 'html' : 'text'
    files.push({ path: local, type, content })
  }
  for (const path of roots) await add(resolve(root, path))
  files.sort((left, right) => left.path.localeCompare(right.path))
  const payload = `${JSON.stringify(files, null, 2)}\n`
  if (Buffer.byteLength(payload) > 20 * 1024 * 1024) throw new Error('Source export exceeds 20 MiB.')
  const audit = resolve(root, '.audit')
  await mkdir(audit, { recursive: true })
  await writeFile(resolve(audit, 'source-candidate.json'), payload)
  const receipt = {
    files: files.length,
    sha256: createHash('sha256').update(payload).digest('hex'),
    typescriptFiles: files.filter((file) => file.path.endsWith('.ts')).length,
    javascriptTypedFiles: files.filter((file) => file.path.endsWith('.ts') && file.type === 'javascript').length,
    vueFiles: files.filter((file) => file.type === 'vue').length,
    siteId: (await JSON.parse(await readFile(resolve(root, '.goalmatic/app.json'), 'utf8'))).siteId,
    remoteChanges: false,
  }
  await writeFile(resolve(audit, 'source-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
  return receipt
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await exportSource(resolve('.')))
