import { isAdmin, requireUser } from "@/lib/auth";
import { SettingsNav } from "@/components/settings/settings-nav";

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const user = await requireUser();
  return (
    <div className="flex flex-1 flex-col md:flex-row md:items-start">
      <SettingsNav isAdmin={isAdmin(user)} />
      <div className="flex min-h-[calc(100svh-3.5rem)] min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
