import { requireUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { calendarFeedUrl, ensureCalendarToken } from "@/lib/team";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { ProfileForm } from "./profile-form";
import { PasswordForm } from "./password-form";
import { AvailabilityEditor } from "./availability-editor";
import { CalendarFeedCard } from "./calendar-feed-card";

export const metadata = { title: "Profile & availability" };

export default async function ProfilePage() {
  const user = await requireUser();
  const [workspace, token] = await Promise.all([getSetting("workspace"), ensureCalendarToken(user.id)]);
  return (
    <>
      <PageHeader title="Profile & availability" description="Your account, the hours people can book you, and your personal calendar feed." />
      <PageBody className="w-full max-w-4xl">
        <ProfileForm
          initial={{ name: user.name, email: user.email, title: user.title ?? "", timezone: user.timezone ?? "", color: user.color }}
          role={user.role}
          workspaceTimezone={workspace.timezone}
        />
        <AvailabilityEditor
          initialAvailability={user.availability}
          initialOverrides={user.dateOverrides}
          weekStartsOn={workspace.weekStartsOn}
          timezone={user.timezone || workspace.timezone}
        />
        <CalendarFeedCard initialUrl={calendarFeedUrl(token)} />
        <PasswordForm />
      </PageBody>
    </>
  );
}
