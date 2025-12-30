import { readFile } from "node:fs/promises";
export async function loadReleaseEmailStatus(filePath) {
    try {
        const raw = await readFile(filePath, "utf8");
        const trimmed = raw.trim();
        if (!trimmed) {
            return undefined;
        }
        return JSON.parse(trimmed);
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return undefined;
        }
        throw error;
    }
}
//# sourceMappingURL=releaseEmailStatus.js.map