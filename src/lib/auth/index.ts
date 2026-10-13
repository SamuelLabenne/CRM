import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@/lib/db/schema";
import { readSessionUser } from "./session";

/** Current user (memoized per request). */
export const getCurrentUser = cache(async (): Promise<User | null> => readSessionUser());

/** Use at the top of every protected page, layout, server action and route handler. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export function isAdmin(user: Pick<User, "role">) {
  return user.role === "owner" || user.role === "admin";
}

/** Owner/admin only (settings, team management…). */
export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (!isAdmin(user)) redirect("/dashboard?error=forbidden");
  return user;
}

/** For server actions that return a result object instead of redirecting. */
export class AuthError extends Error {}
