import fs from "node:fs/promises";
import path from "node:path";
export async function writeManifest(filePath, manifest) {
    const resolved = path.resolve(filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    const payload = JSON.stringify(manifest, null, 2);
    await fs.writeFile(resolved, `${payload}\n`, "utf8");
}
export async function readManifest(filePath) {
    const resolved = path.resolve(filePath);
    const raw = await fs.readFile(resolved, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed.schemaVersion !== 1) {
        throw new Error(`Unsupported manifest schema version ${String(parsed.schemaVersion)} (expected 1).`);
    }
    return {
        ...parsed,
        filePath: resolved,
    };
}
//# sourceMappingURL=manifest.js.map