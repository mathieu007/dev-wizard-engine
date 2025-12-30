export interface WorkspaceProject {
    id: string;
    label: string;
    packageJsonPath: string;
}
export interface WorkspaceProjectScanOptions {
    repoRoot: string;
    includeRoot?: boolean;
    maxDepth?: number;
    ignore?: string[];
    limit?: number;
}
export declare function listWorkspaceProjects(options: WorkspaceProjectScanOptions): Promise<WorkspaceProject[]>;
