import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { access, lstat, readFile, readdir } from 'node:fs/promises'
import { basename, dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAgendaTransform } from './sync-agenda-workflow.mjs'

const GENERATED_JAVASCRIPT = new Map([
  ['components/feedback-widget-runtime.js', '9d8fd06a54f3fefabab3dec9aeae9e5684fca166dbec940883c354abca441d6d'],
])

export async function check(root) {
  const json = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'))
  const pkg = await json('package.json')
  const manifest = await json('.goalmatic/app.json')
  const source = await json('.goalmatic/source.json')
  const project = await json('goalmatic.config.json')
  const tsconfig = await json('tsconfig.json')

  if (pkg.packageManager !== 'yarn@1.22.22' || pkg.engines?.node !== '>=20.19.0') throw new Error('Keep the existing Yarn and Node engine contract.')
  if (pkg.devDependencies?.typescript !== '5.9.3' || pkg.devDependencies?.['vue-tsc'] !== '3.3.7' || pkg.devDependencies?.tsx !== '4.21.0') throw new Error('Keep TypeScript 5.9.3, vue-tsc 3.3.7, and tsx 4.21.0 pinned exactly.')
  if (pkg.scripts?.typecheck !== 'vue-tsc --noEmit --project tsconfig.json' || pkg.scripts?.build !== 'yarn typecheck && vite build') throw new Error('Build must gate Vite behind the strict Vue TypeScript check.')
  if (tsconfig.compilerOptions?.strict !== true || tsconfig.compilerOptions?.noUncheckedIndexedAccess !== true || tsconfig.compilerOptions?.skipLibCheck !== false || tsconfig.compilerOptions?.allowJs === true || tsconfig.vueCompilerOptions?.strictTemplates !== true) throw new Error('Keep strict, noUncheckedIndexedAccess, strictTemplates, and skipLibCheck false.')
  if (manifest.siteId !== source.siteId || manifest.siteId !== project.siteId || source.projectMode !== 'vue' || project.projectMode !== 'vue') throw new Error('Goalmatic source identity is inconsistent.')
  if (!(await readFile(resolve(root, 'index.html'), 'utf8')).includes('src="/goalmatic.dev.ts"')) throw new Error('index.html must load /goalmatic.dev.ts.')
  for (const path of ['env.d.ts', 'types.ts', 'components/feedback-widget-runtime.d.ts', 'components/feedback-widget-runtime.facade.ts', 'scripts/agenda-transform.src.ts', 'yarn.lock']) await access(resolve(root, path))
  for (const conflict of ['package-lock.json', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb']) {
    try { await access(resolve(root, conflict)) } catch { continue }
    throw new Error('Keep exactly one package-manager lockfile.')
  }

  const files = []
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.audit', '.git'].includes(entry.name)) continue
      const path = resolve(dir, entry.name)
      if ((await lstat(path)).isSymbolicLink()) throw new Error(`Source symlinks are unsupported: ${relative(root, path)}`)
      if (entry.isDirectory()) await walk(path)
      else files.push(path)
    }
  }
  await walk(root)

  let compatibilityFiles = 0
  for (const path of files) {
    const local = relative(root, path)
    const extension = extname(path)
    if (extension === '.vue') {
      const text = await readFile(path, 'utf8')
      for (const match of text.matchAll(/<script\b([^>]*)>/g)) if (!/\blang=["']ts["']/.test(match[1])) throw new Error(`Vue scripts must declare lang="ts": ${local}`)
    }
    if (extension === '.js' && !local.startsWith('tests/')) {
      const generatedHash = GENERATED_JAVASCRIPT.get(local)
      if (generatedHash) {
        const actual = createHash('sha256').update(await readFile(path)).digest('hex')
        if (actual !== generatedHash) throw new Error(`Generated JavaScript changed without regenerating its typed facade: ${local}`)
      } else {
        const typedPath = resolve(dirname(path), basename(path, '.js') + '.ts')
        try { await access(typedPath) } catch { throw new Error(`Canonical application JavaScript must be TypeScript: ${local}`) }
        const expected = `export * from './${basename(path, '.js')}.ts'\n`
        if (await readFile(path, 'utf8') !== expected) throw new Error(`Legacy test adapter must only re-export its canonical TypeScript module: ${local}`)
        compatibilityFiles += 1
      }
    }
    if ((extension === '.ts' || extension === '.vue') && /@ts-(?:ignore|expect-error|nocheck)|:\s*any\b|\bas\s+any\b|<any>|eslint-disable/.test(await readFile(path, 'utf8'))) throw new Error(`Type suppressions, explicit any, and lint suppressions are not allowed: ${local}`)
    if (extension === '.js' || extension === '.mjs') {
      const syntax = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' })
      if (syntax.status !== 0) throw new Error(syntax.stderr)
    }
  }

  const workflow = manifest.resources?.workflows?.find((item) => item.id === 'owner-daily-agenda')
  const agenda = workflow?.steps?.find((item) => item.id === 'build-agenda')?.props?.transformFunction
  if (agenda !== buildAgendaTransform()) throw new Error('Run yarn sync:agenda after changing the typed agenda transform or message defaults.')

  const command = [resolve(root, 'node_modules/vue-tsc/bin/vue-tsc.js'), '--noEmit', '--project', resolve(root, 'tsconfig.json')]
  const types = spawnSync(process.execPath, command, { cwd: root, encoding: 'utf8' })
  if (types.status !== 0) throw new Error(`Strict Vue TypeScript check failed.\n${types.stdout}${types.stderr}`)
  return {
    files: files.length,
    canonicalTypeScriptModules: files.filter((path) => extname(path) === '.ts').length,
    vueFiles: files.filter((path) => extname(path) === '.vue').length,
    handwrittenApplicationJavaScript: 0,
    compatibilityFiles,
    generatedJavaScriptExceptions: [...GENERATED_JAVASCRIPT.keys()],
    strictTemplates: true,
    workflowSourceSynchronized: true,
    remoteChanges: false,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await check(resolve('.')))
