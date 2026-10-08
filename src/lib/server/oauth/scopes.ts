import { hasPermission, type ResourceName } from "../permissions.js";
import { OAUTH_SCOPES, type OAuthScope } from "./config.js";

export function canMcpRead(
  locals: App.Locals,
  resource: ResourceName,
): boolean {
  // This check must precede hasPermission's superuser shortcut.
  if (
    locals.oauth &&
    !locals.oauth.scopes.includes(`${resource}:read` as OAuthScope)
  )
    return false;
  return hasPermission(locals, resource, "view");
}

export function allowedScopes(locals: App.Locals): OAuthScope[] {
  return OAUTH_SCOPES.filter((scope) =>
    canMcpRead(locals, scope.split(":")[0] as ResourceName),
  );
}
