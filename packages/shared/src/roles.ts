/** Papéis dentro de um workspace (docs/data-model.md). */
export const WORKSPACE_ROLES = ['owner', 'admin', 'member'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** Papéis dentro de uma organization. */
export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Papel global da plataforma. `admin` acessa o painel administrativo (Fase 6). */
export const PLATFORM_ROLES = ['user', 'admin'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

const RANK: Record<WorkspaceRole, number> = { member: 1, admin: 2, owner: 3 };

/** `true` se `actual` tem pelo menos o nível de `required`. */
export function roleAtLeast(actual: WorkspaceRole, required: WorkspaceRole): boolean {
  return RANK[actual] >= RANK[required];
}

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === 'string' && (WORKSPACE_ROLES as readonly string[]).includes(value);
}
