import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lintWizard } from "../runtime/lint";

let tempDir: string;

beforeEach(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dev-wizard-lint-"));
});

afterEach(async () => {
	await fs.rm(tempDir, { recursive: true, force: true });
});

describe("lintWizard", () => {
	it("returns error when flows reference missing target", async () => {
		const configDir = path.join(tempDir, "dev-wizard-config");
		await fs.mkdir(configDir, { recursive: true });
	 await fs.writeFile(
		path.join(configDir, "index.yaml"),
		`meta: { name: Test, version: 0.0.0 }
scenarios:
  - id: sample
    label: Sample
    flow: missing_flow
flows: {}
`,
		"utf8",
	);

		const result = await lintWizard({ cwd: tempDir });

		expect(result.issues.some((issue) => issue.level === "error")).toBe(true);
	});

	it("warns about unreachable flows and prompts missing options", async () => {
		const configDir = path.join(tempDir, "dev-wizard-config");
		await fs.mkdir(configDir, { recursive: true });
		const config = `meta: { name: Test, version: 0.0.0 }
scenarios:
  - id: sample
    label: Sample
    flow: main
flows:
  main:
    id: main
    steps:
      - id: choose
        type: prompt
        mode: select
        prompt: Select something
      - id: loop
        type: iterate
        flow: shared
      - id: subgroup
        type: group
        flow: shared
  shared:
    id: shared
    steps:
      - id: done
        type: message
        text: done
  unused:
    id: unused
    steps:
      - id: noop
        type: message
        text: noop
`;
		await fs.writeFile(path.join(configDir, "index.yaml"), config, "utf8");

		const result = await lintWizard({ cwd: tempDir });
		const messages = result.issues.map((issue) => issue.message);

		expect(messages.some((message) => message.includes("not referenced"))).toBe(true);
		expect(messages.some((message) => message.includes("no options or dynamic source"))).toBe(true);
		expect(messages.some((message) => message.includes("no items or source"))).toBe(true);
	});

	it("errors when dynamic.command is used for prompts or iterate sources", async () => {
		const configPath = path.join(tempDir, "dynamic-command.yaml");
		const config = `meta: { name: Test, version: 0.0.0 }
scenarios:
  - id: sample
    label: Sample
    flow: main
flows:
  main:
    id: main
    steps:
      - id: choose
        type: prompt
        mode: select
        prompt: Pick one
        dynamic:
          type: command
          command: echo "hi"
      - id: iterate
        type: iterate
        flow: next
        source:
          from: dynamic
          dynamic:
            type: command
            command: echo "hi"
  next:
    id: next
    steps:
      - id: done
        type: message
        text: done
`;
		await fs.writeFile(configPath, config, "utf8");

		const result = await lintWizard({ cwd: tempDir, configPath });
		const messages = result.issues.map((issue) => issue.message);

		expect(
			messages.some((message) => message.includes("Prompt step \"choose\"")),
		).toBe(true);
		expect(
			messages.some((message) => message.includes("Iterate step \"iterate\"")),
		).toBe(true);
	});

	it("passes when configuration is valid", async () => {
		const configDir = path.join(tempDir, "dev-wizard-config");
		await fs.mkdir(configDir, { recursive: true });
	 await fs.writeFile(
		path.join(configDir, "index.yaml"),
		`meta: { name: Test, version: 0.0.0 }
scenarios:
  - id: sample
    label: Sample
    flow: main
flows:
  main:
    id: main
    steps:
      - id: greet
        type: message
        text: "hi"
`,
		"utf8",
	);

		const result = await lintWizard({ cwd: tempDir });

		expect(result.issues).toHaveLength(0);
		expect(result.resolution.paths.length).toBeGreaterThan(0);
	});

	it("detects missing command presets and branch targets", async () => {
		const configPath = path.join(tempDir, "custom.yaml");
		const config = `meta: { name: Test, version: 0.0.0 }
scenarios:
  - id: sample
    label: Sample
    flow: main
commandPresets:
  shell:
    shell: true
flows:
  main:
    id: main
    steps:
      - id: command-step
        type: command
        commands:
          - run: echo hi
            preset: missing
      - id: brancher
        type: branch
        branches:
          - when: "true"
            next: unknown-step
        defaultNext:
          next: later
      - id: later
        type: message
        text: end
`;
		await fs.writeFile(configPath, config, "utf8");

		const result = await lintWizard({ cwd: tempDir, configPath });
		const messages = result.issues.map((issue) => issue.message);
		expect(messages.some((message) => message.includes("unknown preset"))).toBe(true);
		expect(messages.some((message) => message.includes("Branch step \"brancher\""))).toBe(true);
		expect(messages.some((message) => message.includes("defined but never used"))).toBe(true);
	});

	it("warns when presets are overridden by defaults or commands", async () => {
		const configPath = path.join(tempDir, "overrides.yaml");
		const config = `meta: { name: Test, version: 0.0.0 }
scenarios:
  - id: sample
    label: Sample
    flow: main
commandPresets:
  shell:
    shell: true
    cwd: ./shared
flows:
  main:
    id: main
    steps:
      - id: run
        type: command
        defaults:
          preset: shell
          cwd: ./override
        commands:
          - run: echo hello
            preset: shell
            shell: false
          - run: echo stay
            preset: shell
            cwd: ./local
`;
		await fs.writeFile(configPath, config, "utf8");

		const result = await lintWizard({ cwd: tempDir, configPath });
		const messages = result.issues.map((issue) => issue.message);

		expect(messages.some((message) => message.includes("overrides preset \"shell\" field \"cwd\""))).toBe(true);
		expect(messages.some((message) => message.includes("overrides preset \"shell\" field \"shell\""))).toBe(true);
	});

	it("reports schema validation failures with file references", async () => {
		const configPath = path.join(tempDir, "invalid.yaml");
		await fs.writeFile(
			configPath,
			`scenarios: []
flows: {}
`,
			"utf8",
		);

		const result = await lintWizard({ cwd: tempDir, configPath });
		expect(result.issues).toHaveLength(1);
		const [issue] = result.issues;
		expect(issue.level).toBe("error");
		expect(issue.file).toContain("invalid.yaml");
		expect(issue.detail).toContain("path: meta");
	});

	it("warns when inline heredoc Node snippets appear in command steps", async () => {
		const configPath = path.join(tempDir, "lean.yaml");
		const config = `meta: { name: Test, version: 0.0.0 }
scenarios:
  - id: sample
    label: Sample
    flow: main
flows:
  main:
    id: main
    steps:
      - id: inline-node
        type: command
        commands:
          - run: |
              node - <<'DEV_WIZARD_NODE'
              console.log("hi");
              DEV_WIZARD_NODE
`;
		await fs.writeFile(configPath, config, "utf8");

		const result = await lintWizard({ cwd: tempDir, configPath });
		const messages = result.issues.map((issue) => issue.message);
		expect(
			messages.some((message) =>
				message.includes("embeds inline heredoc Node logic"),
			),
		).toBe(true);
	});

	it("warns when commands reference legacy sample library script paths", async () => {
		const configPath = path.join(tempDir, "legacy-script.yaml");
		const config = `meta: { name: Test, version: 0.0.0 }
scenarios:
  - id: sample
    label: Sample
    flow: main
flows:
  main:
    id: main
    steps:
      - id: legacy-script
        type: command
        commands:
          - run: pnpm exec tsx packages/dev-wizard-core/examples/library/scripts/typecheck.ts --tsconfig tsconfig.json
`;
		await fs.writeFile(configPath, config, "utf8");

		const result = await lintWizard({ cwd: tempDir, configPath });
		const messages = result.issues.map((issue) => issue.message);
		expect(
			messages.some((message) =>
				message.includes("@dev-wizard/presets/scripts"),
			),
		).toBe(true);
	});

	it("warns for hyphenated or Windows-style legacy script paths", async () => {
		const configPath = path.join(tempDir, "legacy-script-variants.yaml");
		const config = `meta: { name: Test, version: 0.0.0 }
scenarios:
  - id: sample
    label: Sample
    flow: main
flows:
  main:
    id: main
    steps:
      - id: legacy-script
        type: command
        commands:
          - run: pnpm exec tsx packages-dev-wizard-core/examples/library/scripts/previewWorkflowCommand.ts
          - run: 'pnpm exec tsx packages\\dev-wizard-core\\examples\\library\\scripts\\peerDependencies.ts'
`;
		await fs.writeFile(configPath, config, "utf8");

		const result = await lintWizard({ cwd: tempDir, configPath });
		const messages = result.issues
			.filter(
				(issue) =>
					issue.message.startsWith("Command step") &&
					issue.message.includes("@dev-wizard/presets/scripts"),
			)
			.map((issue) => issue.message);
		expect(messages).toHaveLength(2);
	});

	it("warns when loading example wrapper configs instead of presets", async () => {
		const wrapperDir = path.join(
			tempDir,
			"packages",
			"dev-wizard-core",
			"examples",
			"library",
		);
		await fs.mkdir(wrapperDir, { recursive: true });
		const configPath = path.join(wrapperDir, "release.wizard.yaml");
		const config = `meta: { name: Test, version: 0.0.0 }
scenarios:
  - id: sample
    label: Sample
    flow: main
flows:
  main:
    id: main
    steps:
      - id: greet
        type: message
        text: hi
`;
		await fs.writeFile(configPath, config, "utf8");

		const result = await lintWizard({ cwd: tempDir, configPath });
		const messages = result.issues
			.filter((issue) => issue.level === "warning")
			.map((issue) => issue.message);
		expect(
			messages.some((message) => message.includes("sample wrapper config")),
		).toBe(true);
	});

	it("errors when onError actions are missing policy routing", async () => {
		const configPath = path.join(tempDir, "onerror-policy.yaml");
		const config = `meta: { name: Test, version: 0.0.0 }
scenarios:
  - id: sample
    label: Sample
    flow: main
flows:
  main:
    id: main
    steps:
      - id: run
        type: command
        commands:
          - run: echo hi
        onError:
          actions:
            - label: Retry
              next: run
          defaultNext:
            next: exit
`;
		await fs.writeFile(configPath, config, "utf8");

		const result = await lintWizard({ cwd: tempDir, configPath });
		expect(
			result.issues.some(
				(issue) =>
					issue.level === "error" &&
					issue.message.includes(
						"defines onError.actions without an onError.policy",
					),
			),
		).toBe(true);
	});

	it("errors when answers fail prompt or policy validation", async () => {
		const configPath = path.join(tempDir, "answers-config.yaml");
		const answersPath = path.join(tempDir, "answers.json");
		const config = `meta: { name: Test, version: 0.0.0 }
scenarios:
  - id: sample
    label: Sample
    flow: main
flows:
  main:
    id: main
    steps:
      - id: choose
        type: prompt
        mode: select
        prompt: Choose
        required: true
        options:
          - label: Yes
            value: yes
      - id: name
        type: prompt
        mode: input
        prompt: Name
        required: true
      - id: run
        type: command
        commands:
          - run: echo hi
        onError:
          policy:
            key: policies.typecheck.strategy
            map:
              block: exit
              warn: continue
`;
		const answers = {
			meta: { scenarioId: "sample" },
			scenario: {
				choose: "nope",
				policies: {
					typecheck: {
						strategy: "ignore",
					},
				},
			},
		};
		await fs.writeFile(configPath, config, "utf8");
		await fs.writeFile(answersPath, JSON.stringify(answers, null, 2), "utf8");

		const result = await lintWizard({
			cwd: tempDir,
			configPath,
			answersPath,
		});
		const messages = result.issues.map((issue) => issue.message);

		expect(messages.some((message) => message.includes("Missing required answer"))).toBe(true);
		expect(messages.some((message) => message.includes("Invalid answer for prompt \"choose\""))).toBe(true);
		expect(messages.some((message) => message.includes("Policy value"))).toBe(true);
	});
});
