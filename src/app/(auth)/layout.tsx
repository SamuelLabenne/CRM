import { Logo } from "@/components/app/logo";
import { CalendarCheck, Mail, Users, Workflow } from "lucide-react";

const points = [
  { icon: Users, title: "Every contact, one timeline", text: "Registrations, emails, meetings and notes in a single journey." },
  { icon: CalendarCheck, title: "Events with attendance", text: "Registration pages, waitlists, check-in and no-show follow-up." },
  { icon: Mail, title: "Emails that send themselves", text: "Templates, broadcasts, reminders and tracking built in." },
  { icon: Workflow, title: "Automations", text: "Trigger sequences from registrations, tags, outcomes and more." },
];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <Logo />
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-primary lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.25),transparent_60%)]" />
        <div className="relative flex h-full flex-col justify-center gap-8 p-12 text-primary-foreground">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">Run campaigns, events and follow-up from one place.</h2>
            <p className="mt-3 max-w-md text-primary-foreground/80">Relay is a lightweight CRM and marketing workspace for teams that grow through events, meetings and email.</p>
          </div>
          <ul className="grid max-w-md gap-5">
            {points.map((p) => (
              <li key={p.title} className="flex gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/15">
                  <p.icon className="size-4" />
                </span>
                <span>
                  <span className="block font-medium">{p.title}</span>
                  <span className="text-sm text-primary-foreground/75">{p.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
