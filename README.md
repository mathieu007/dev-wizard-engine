# Dev Wizard Engine

Runtime, configuration loader, and templating utilities that power the Dev Wizard ecosystem (no terminal UI dependencies). Consumers typically depend on `@dev-wizard/engine` for programmatic automation, and pair it with `@dev-wizard/ui-terminal` when interactive prompts are needed.

## Features

- YAML/JSON5 configuration loader with import composition and validation.
- Runtime executor with branching, command orchestration, telemetry capture, and analytics outputs.
- Programmatic plan/describe/lint surfaces for CI and tooling.
- Checkpoint utilities (`createCheckpointManager`, `loadCheckpoint`, `listCheckpoints`) and `WizardExecutionError` helper for advanced resume flows.
- Overlay loader that stacks base configs, environment overlays, and local overrides while surfacing conflicts and schema-version hints.
- Plugin registry (`loadPlugins`) so custom step types can participate in both plan previews and runtime execution.

## Usage

```ts
import {
  resolveConfigPaths,
  loadConfig,
  describeWizard,
  lintWizard,
} from "@dev-wizard/engine";

const resolution = await resolveConfigPaths();
const config = await loadConfig({ configPaths: resolution.paths });
const description = await describeWizard({ configPath: resolution.paths });
const lint = await lintWizard({ configPath: resolution.paths });

console.log(description.scenarios);
console.log(lint.issues);
```

See `packages/dev-wizard-core/docs/dev-wizard.md` for end-to-end documentation and example configurations located under `packages/dev-wizard-core/examples/`.

## Publishing

The engine package is versioned and released alongside `@dev-wizard/ui-terminal` and `@dev-wizard/cli`. Use the workspace scripts:

```bash
pnpm dev-wizard:ci
pnpm dev-wizard:release:prepare <version>
pnpm dev-wizard:publish:dry-run
pnpm --filter @dev-wizard/engine publish --access public
```
