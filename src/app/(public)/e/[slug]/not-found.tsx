import { PublicNotFound } from "@/components/events/public-states";

export default function NotFound() {
  return <PublicNotFound title="Event not found" body="This event doesn't exist, hasn't been published yet, or the link has changed." />;
}
