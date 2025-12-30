import { readFile } from "node:fs/promises";

export async function loadReleaseEmailStatus(filePath: string): Promise<unknown> {
	try {
		const raw = await readFile(filePath, "utf8");
		const trimmed = raw.trim();
		if (!trimmed) {
			return undefined;
		}
		return JSON.parse(trimmed) as unknown;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}
