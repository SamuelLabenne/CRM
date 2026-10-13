import Link from "next/link";
import { CalendarClock, Plus } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { BookingPageCard } from "@/components/scheduling/booking-page-card";
import { requireUser } from "@/lib/auth";
import { listPagesWithStats } from "@/lib/scheduling/pages";

export const metadata = { title: "Booking pages" };

export default async function SchedulingPage() {
  await requireUser();
  const pages = await listPagesWithStats();
  return (
    <>
      <PageHeader
        title="Booking pages"
        description="Qualified 1:1 booking links – capture leads, screen them with questions and let the good ones pick a time."
        actions={
          <Button asChild>
            <Link href="/scheduling/new">
              <Plus /> New booking page
            </Link>
          </Button>
        }
      />
      <PageBody>
        {pages.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No booking pages yet"
            description="Create a booking page to let leads book a call with you. Add qualifying questions, share the link or embed it on your site."
            action={
              <Button asChild>
                <Link href="/scheduling/new">
                  <Plus /> Create your first booking page
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {pages.map((p) => (
              <BookingPageCard
                key={p.id}
                page={{
                  id: p.id,
                  slug: p.slug,
                  title: p.title,
                  color: p.color,
                  durationMinutes: p.durationMinutes,
                  locationType: p.locationType,
                  isActive: p.isActive,
                  hosts: p.hostUsers,
                  bookings30: p.bookings30,
                  views30: p.views30,
                  questionCount: p.questions.length,
                }}
              />
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
