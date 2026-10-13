import { cookies } from "next/headers";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "@/components/app/app-sidebar";
import { CommandMenu } from "@/components/app/command-menu";
import { NotificationsBell } from "@/components/app/notifications-bell";
import { QuickCreate } from "@/components/app/quick-create";
import { JobsHeartbeat } from "@/components/app/jobs-heartbeat";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const [workspace, bell, jar] = await Promise.all([
    getSetting("workspace"),
    db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(15),
    cookies(),
  ]);
  const defaultOpen = jar.get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar
        user={{ name: user.name, email: user.email, color: user.color, role: user.role }}
        workspaceName={workspace.name}
      />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <div className="flex flex-1 items-center">
            <CommandMenu />
          </div>
          <NotificationsBell items={bell} />
          <QuickCreate />
        </header>
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </SidebarInset>
      <JobsHeartbeat />
    </SidebarProvider>
  );
}
