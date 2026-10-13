import { PublicNotFound } from "@/components/events/public-states";

export default function NotFound() {
  return <PublicNotFound embed title="Event not found" body="This event isn't available." />;
}
