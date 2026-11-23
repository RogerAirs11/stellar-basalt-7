/** Pure identity formatter shared by React and native ES-module frontends. */
export interface PrincipalScopeUser { id: string }
export function principalScopeKey(user: PrincipalScopeUser | null | undefined, permissions?: readonly string[] | null): string {
  if (!user) return "anonymous";
  const epoch = permissions && permissions.length > 0 ? `|p:${[...permissions].sort().join("+")}` : "";
  return `user:${user.id}${epoch}`;
}
