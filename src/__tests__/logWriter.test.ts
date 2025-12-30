import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { createStreamLogWriter } from "..";

describe("createStreamLogWriter", () => {
	it("redacts prompt answers and command output when configured", async () => {
		const stream = new PassThrough();
		const chunks: string[] = [];
		stream.setEncoding("utf8");
		stream.on("data", (chunk) => {
			chunks.push(chunk);
		});

		const writer = createStreamLogWriter(stream, {
			redactPromptValues: true,
			redactCommandOutput: true,
		});

		writer.write({
			type: "prompt.answer",
			flowId: "build",
			stepId: "prompt-1",
			value: "super-secret",
		});

		writer.write({
			type: "command.result",
			flowId: "build",
			stepId: "step-1",
			command: "echo secret",
			dryRun: false,
			success: true,
			durationMs: 42,
			stdout: "should not leak",
			stderr: "should not leak either",
		});

		await new Promise((resolve) => {
			setImmediate(resolve);
		});

		const serialized = chunks.join("");
		const events = serialized
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.map((line) => JSON.parse(line));

		expect(events).toHaveLength(2);
	expect(events[0]).toMatchObject({
		type: "prompt.answer",
		value: "[redacted]",
	});
	expect(events[1]).toMatchObject({
		type: "command.result",
	});
	expect(events[1]).not.toHaveProperty("stdout");
	expect(events[1]).not.toHaveProperty("stderr");

	await writer.close();
	expect(stream.writableEnded).toBe(false);
});
});
