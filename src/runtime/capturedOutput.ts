export interface CapturedOutputSummaryOptions {
	/**
	 * Maximum number of characters to keep before truncating.
	 * Provide a large value (e.g., 2000) to effectively disable truncation for typical command output.
	 */
	hardLimit?: number;
	/**
	 * Collapse redundant whitespace (including newlines) before truncation.
	 */
	collapseWhitespace?: boolean;
	/**
	 * String returned when no output was captured.
	 */
	emptyFallback?: string;
}

/**
 * Condense captured command/stdout output for inclusion in summaries or analytics tables.
 * The default behaviour mirrors the previous summary truncation (120 characters),
 * while callers can raise the hard limit to surface whole commands when needed.
 */
export function summarizeCapturedOutput(
	raw: string,
	options: CapturedOutputSummaryOptions = {},
): string {
	const trimmed = raw.trim();
	if (!trimmed) {
		return options.emptyFallback ?? "(empty)";
	}

	const structured = formatStructuredOutput(trimmed, options);
	const collapseWhitespace = options.collapseWhitespace ?? true;
	const normalized = structured
		? structured
		: collapseWhitespace
			? trimmed.replace(/\s+/g, " ")
			: trimmed;

	const hardLimit = Math.max(1, options.hardLimit ?? 120);
	if (normalized.length <= hardLimit) {
		return normalized;
	}

	return `${normalized.slice(0, hardLimit - 1)}…`;
}

function formatStructuredOutput(
	raw: string,
	options: CapturedOutputSummaryOptions,
): string | undefined {
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			const maybePreview = (parsed as Record<string, unknown>).preview;
			const maybeRun = (parsed as Record<string, unknown>).run;
			if (typeof maybePreview === "string" || typeof maybeRun === "string") {
			const limit = Math.max(
				1,
				Math.min(80, Math.floor((options.hardLimit ?? 120) / 2)),
			);
			const parts: string[] = [];
			if (typeof maybePreview === "string") {
				parts.push(`preview: ${truncate(maybePreview, limit)}`);
			}
			if (typeof maybeRun === "string") {
				parts.push(`run: ${truncate(maybeRun, limit)}`);
			}
			return parts.join("\n");
			}
		}
	} catch {
		// ignore parse errors and fall back to string summarization
	}

	return undefined;
}

function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}
	return `${value.slice(0, Math.max(1, maxLength - 1))}…`;
}
