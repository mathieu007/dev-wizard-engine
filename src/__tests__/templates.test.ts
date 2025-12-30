import { describe, expect, it } from "vitest";
import { renderTemplate } from "../runtime/templates";

const baseContext = {
	state: {},
	env: process.env,
	repoRoot: process.cwd(),
};

function evaluateTemplate(template: string): unknown {
	return Function(`${template}\nreturn input;`)();
}

describe("templates helpers", () => {
	it("renders jsonString helper into a JS-friendly single-quoted literal", () => {
		const template =
			"const input = JSON.parse('{{ jsonString state.values }}');";
		const context = {
			...baseContext,
			state: {
				values: ["dir/it's", "dir\\sub", "dir`tick"],
			},
		};

		const rendered = renderTemplate(template, context);
		const expectedLiteral = JSON.stringify(context.state.values)
			.replace(/\\/g, "\\\\")
			.replace(/"/g, '\\"')
			.replace(/'/g, "\\'")
			.replace(/`/g, "\\`");
		expect(rendered).toBe(
			`const input = JSON.parse('${expectedLiteral}');`,
		);
		expect(evaluateTemplate(rendered)).toEqual(context.state.values);
	});

	it("escapes quotes, backslashes, and backticks via jsonString", () => {
		const template =
			"const input = JSON.parse('{{ jsonString state.values }}');";
		const context = {
			...baseContext,
			state: {
				values: ["dir/it's", "dir\\sub", "dir`tick"],
			},
		};

		const rendered = renderTemplate(template, context);
		expect(rendered).toContain("dir\\\\\\\\sub");
		expect(rendered).toContain("dir\\`tick");
		expect(rendered).toContain("dir/it\\'s");
		expect(evaluateTemplate(rendered)).toEqual(context.state.values);
	});

	it("renders jsonLiteral into inline JavaScript", () => {
		const template =
			"const selected = {{ jsonLiteral state.values }};";
		const context = {
			...baseContext,
			state: {
				values: ["alpha", "beta"],
			},
		};

		const rendered = renderTemplate(template, context);
		expect(rendered).toBe('const selected = ["alpha","beta"];');
	});

	it("renders jsonLiteral fallback to null when value is undefined", () => {
		const template =
			"const result = {{ jsonLiteral state.missing }};";
		const rendered = renderTemplate(template, baseContext);
		expect(rendered).toBe("const result = null;");
	});

	it("supports includes helper for arrays and strings", () => {
		const template =
			"const input = {{ jsonLiteral (includes state.values \"beta\") }};";
		const context = {
			...baseContext,
			state: {
				values: ["alpha", "beta"],
			},
		};

		const rendered = renderTemplate(template, context);
		expect(rendered).toBe("const input = true;");
	});
});
