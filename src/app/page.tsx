import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { needsSetup } from "@/lib/system";

export default async function Home() {
  if (await needsSetup()) redirect("/setup");
  redirect((await getCurrentUser()) ? "/dashboard" : "/login");
}

// Depends on the database and the session on every request.
export const dynamic = "force-dynamic";
