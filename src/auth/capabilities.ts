import type { UserRole } from "../db/types";

export type { PlatformPermission as Permission } from "../contracts/platform";
import type { PlatformPermission } from "../contracts/platform";

const LEVELS: Record<UserRole, PlatformPermission[]> = {
  user: ["horse.read", "person.read", "pedigree.read", "relationship.read"],
  owner: ["horse.read", "person.read", "pedigree.read", "relationship.read", "claim.create", "claim.read_own", "change.create", "change.read_own"],
  editor: ["horse.read", "horse.create", "horse.edit", "person.read", "pedigree.read", "relationship.read", "claim.create", "claim.read_own", "change.create", "change.read_own", "quality.read", "audit.read"],
  admin: ["horse.read", "horse.create", "horse.edit", "horse.archive", "person.read", "pedigree.read", "relationship.read", "registry.export", "claim.create", "claim.read_own", "claim.review", "change.create", "change.read_own", "change.review", "quality.read", "audit.read", "maintenance.run", "content.manage"],
  super_admin: ["horse.read", "horse.create", "horse.edit", "horse.archive", "person.read", "pedigree.read", "relationship.read", "registry.export", "claim.create", "claim.read_own", "claim.review", "change.create", "change.read_own", "change.review", "quality.read", "audit.read", "maintenance.run", "content.manage"],
};

export function capabilitiesForRole(role: UserRole): PlatformPermission[] {
  return [...LEVELS[role]];
}
