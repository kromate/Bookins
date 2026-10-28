// Transpiles scripts/agenda-transform.src.ts, injects message defaults and country tables from
// messaging.ts, and writes the result into the `owner-daily-agenda` workflow of .goalmatic/app.json.
//   node --import tsx scripts/sync-agenda-workflow.mjs          # update the manifest
//   import { buildAgendaTransform } from './scripts/sync-agenda-workflow.mjs'   # used by tests
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { COUNTRY_CODES, DEFAULT_TEMPLATES, TIMEZONE_COUNTRIES } from '../messaging.ts'

const root = new URL('../', import.meta.url)

// The platform rewrites text between angle brackets and token-like braces in step props, so string
// literals carry braces as unicode escapes and the source never contains two opening braces in a row.
const literal = (text) => JSON.stringify(text).replaceAll('{', '\\u007b').replaceAll('}', '\\u007d')

export function buildAgendaTransform() {
  const typedSource = readFileSync(new URL('scripts/agenda-transform.src.ts', root), 'utf8')
  const source = ts.transpileModule(typedSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      removeComments: false,
    },
    fileName: 'agenda-transform.src.ts',
    reportDiagnostics: true,
  }).outputText
  const defaults = `{ subject: ${literal(DEFAULT_TEMPLATES.reminder24.subject)}, body: ${literal(DEFAULT_TEMPLATES.reminder24.body)} }`
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
    .replace('__DEFAULTS__', () => defaults)
    .replace('__COUNTRY_CODES__', () => JSON.stringify(COUNTRY_CODES))
    .replace('__TZ_COUNTRIES__', () => JSON.stringify(TIMEZONE_COUNTRIES))
    .trim()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = new URL('.goalmatic/app.json', root)
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  const workflow = manifest.resources.workflows.find((item) => item.id === 'owner-daily-agenda')
  const step = workflow.steps.find((item) => item.id === 'build-agenda')
  step.props.transformFunction = buildAgendaTransform()
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log('Updated build-agenda transformFunction')
}
