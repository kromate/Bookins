# Bookins TypeScript migration

Bookins uses TypeScript 5.9.3 and vue-tsc 3.3.7 as its checked source contract. `tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`, and Vue `strictTemplates`, keeps `skipLibCheck` false, and does not enable `allowJs`. Production builds run the strict check before Vite.

All application and domain implementations are canonical `.ts` modules or Vue SFCs with `lang="ts"`. The adjacent `.js` files are exact one-line reexports retained only because the existing Node tests import those paths. `components/feedback-widget-runtime.js` is generated vendor output whose pre-migration SHA-256 is pinned by `yarn check:source`; its handwritten facade and declaration are TypeScript. The remaining `.mjs` files are build and workflow tooling.

The daily agenda is authored as `scripts/agenda-transform.src.ts`. `yarn sync:agenda` transpiles it, injects the shared message defaults and country tables, and writes standalone JavaScript into the App manifest. `yarn check:source` verifies that the manifest bytes match the typed source generator and that the emitted workflow code still obeys the platform's rewriting restrictions.

The source exporter includes the TypeScript entrypoint, declarations, domain modules, Vue components, configuration, manifest, Yarn lockfile, and workflow source. `.ts` and `.d.ts` files retain the existing generic `javascript` source type; Vue SFCs retain `vue`. Export writes only local ignored `.audit/source-candidate.json` and `.audit/source-receipt.json` files and performs no upload, source sync, release, or publication.

The pinned supporting packages close concrete declaration gaps without weakening the compiler:

- `tsx` 4.21.0 loads the canonical TypeScript modules through the unchanged JavaScript test imports on the existing Node `>=20.19.0` engine contract.
- `@types/qrcode` 1.5.6 and `@types/web-bluetooth` 0.0.22 provide the libraries' missing ambient declarations.
- `vue-component-type-helpers` 3.3.12 satisfies vue-tsc's component helper contract.
- `@tanstack/virtual-core` and `@tanstack/vue-virtual` 3.10.1 are pinned to a release whose generic `VirtualItem` declarations are compatible with Radix Vue 1.9.17.

## Local evidence

The pre-migration existing test suite had 122 tests: 120 passed and two failed. The failures were already present: the workflow test expects package and manifest version 0.6.0 while the current files are 0.8.0 and 0.9.0, and the old agenda fixture expects one same-day booking where the current transform reports zero. The test files remain byte-for-byte unchanged. After migration, the suite retains that same 120-pass, two-failure baseline.

On 2026-10-26 with Node 24.14.1 and Yarn 1.22.22:

- `yarn typecheck` passed with all application modules, Vue templates, and the typed agenda source included.
- `yarn check:source` passed with 33 canonical TypeScript modules, 37 Vue SFCs, 27 exact compatibility reexports, one hash-pinned generated JavaScript file, and a synchronized workflow transform.
- `yarn build` passed after the strict typecheck and transformed 227 modules.
- `yarn export:source` passed locally with 102 text descriptors, including 33 `.ts`/`.d.ts` files and 37 Vue SFCs; all 33 TypeScript descriptors use `type: "javascript"`.
- The exported candidate was reconstructed in an isolated ignored directory and its strict typecheck and 227-module production build both passed against the frozen install.
- `yarn test` reproduced the unchanged 120-pass, two-failure baseline described above under UTC, America/New_York, and Pacific/Auckland.

No Node 20.19 binary was available locally, so execution on the minimum declared engine remains unverified in this checkout. The `--import` loader flag used by the test script is supported by the declared baseline, while the executed evidence above is from Node 24.14.1.

The generated feedback widget bytes and every existing test file match the pre-migration checkpoint. The agenda source is tested by evaluating the generated manifest transform and comparing its reminder links with the canonical messaging implementation. Connected Calendar operations, workflow delivery, guest grants, and other hosted-provider behavior still require the existing real-account release checks; no server, browser, provider, remote source, or deployment action was part of this migration.
