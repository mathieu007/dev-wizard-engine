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
export declare function summarizeCapturedOutput(raw: string, options?: CapturedOutputSummaryOptions): string;
