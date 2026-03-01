import type { Permission, UserRole } from "../types.js";

const ALL_PERMISSIONS: Permission[] = [
  "chat:use",
  "reports:view",
  "reports:manage",
  "reports:create:feedback",
  "users:create:user",
  "users:create:staff",
  "users:create:admin",
  "users:view",
  "users:ban",
  "users:kick",
  "apikeys:create:own",
  "apikeys:create:any",
  "apikeys:view:own",
  "apikeys:view:any",
  "terminal:execute"
];

const PERMISSIONS_BY_ROLE: Record<UserRole, Permission[]> = {
  founder: [...ALL_PERMISSIONS],
  admin: [
    "chat:use",
    "reports:view",
    "reports:manage",
    "reports:create:feedback",
    "users:create:user",
    "users:create:staff",
    "users:view",
    "users:ban",
    "users:kick",
    "apikeys:create:own",
    "apikeys:view:own"
  ],
  staff: ["chat:use", "reports:view", "reports:create:feedback", "users:view", "apikeys:create:own", "apikeys:view:own"],
  user: ["chat:use", "reports:create:feedback"]
};

export const getPermissionsForRole = (role: UserRole): Permission[] => PERMISSIONS_BY_ROLE[role];

export const hasPermission = (role: UserRole, permission: Permission): boolean =>
  PERMISSIONS_BY_ROLE[role].includes(permission);

export const getRoleCapabilityMatrix = (role: UserRole) => {
  const allowed = PERMISSIONS_BY_ROLE[role];
  const denied = ALL_PERMISSIONS.filter((permission) => !allowed.includes(permission));
  return {
    role,
    allowed,
    denied
  };
};
