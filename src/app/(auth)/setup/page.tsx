import { redirect } from "next/navigation";
import { needsSetup } from "@/lib/system";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Set up your workspace" };

export default async function SetupPage() {
  if (!(await needsSetup())) redirect("/login");
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
        <p className="text-sm text-muted-foreground">You&apos;ll be the owner. You can invite your team afterwards.</p>
      </div>
      <SetupForm requireCode={Boolean(process.env.SETUP_CODE)} />
    </div>
  );
}
