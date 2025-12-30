interface ResolveConfigOptions {
    explicitPaths?: string | string[] | undefined;
    cwd?: string;
    environment?: string;
    includeLocal?: boolean;
}
type ConfigSource = "explicit" | "root" | "directory" | "package-json";
export interface ConfigResolutionEntry {
    path: string;
    source: ConfigSource;
}
export interface ConfigResolution {
    paths: string[];
    entries: ConfigResolutionEntry[];
    diagnostics: string[];
    errors: string[];
}
export declare const ROOT_CONFIG_CANDIDATES: string[];
export declare const INDEX_FILENAMES: string[];
export declare function resolveConfigPaths(options?: ResolveConfigOptions): Promise<ConfigResolution>;
export {};
