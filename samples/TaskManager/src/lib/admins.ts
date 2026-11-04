import { z } from "zod";
import adminsFile from "../../admins.json";
import { useCurrentUser, type CurrentUser } from "@/lib/current-user";
import { createLogger } from "@/lib/logger";

/**
 * Who sees the admin tabs (Completed, Retrospective, Tags, Bulk edit), from
 * `admins.json` at the repository root. This is a UI convenience, NOT a
 * security boundary: the list ships in the browser bundle, and Azure DevOps
 * permissions (or the storage backend's) still decide what anyone can change.
 */
const adminsSchema = z.object({ admins: z.array(z.string()) });

const log = createLogger("admins");

/** Normalized admin usernames; an invalid file means nobody is an admin. */
export function parseAdmins(raw: unknown): Set<string> {
  const result = adminsSchema.safeParse(raw);
  if (!result.success) {
    log.warn("admins.json is invalid; nobody is treated as an admin.");
    return new Set();
  }
  return new Set(result.data.admins.map((name) => name.trim().toLowerCase()).filter(Boolean));
}

const ADMINS = parseAdmins(adminsFile);

/** True when the user's UPN or mail matches an entry (case-insensitive). */
export function isAdminUser(
  user: Pick<CurrentUser, "mail" | "userPrincipalName"> | null,
  admins: ReadonlySet<string> = ADMINS,
): boolean {
  if (!user || admins.size === 0) return false;
  return [user.userPrincipalName, user.mail].some(
    (name) => typeof name === "string" && admins.has(name.trim().toLowerCase()),
  );
}

/** Whether the signed-in user is listed in admins.json. False while loading. */
export function useIsAdmin(): boolean {
  return isAdminUser(useCurrentUser(true));
}
