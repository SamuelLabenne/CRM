"use client";

import Link from "next/link";
import { CalendarClock, Mail, Megaphone, Plus, Send, Ticket, UserPlus, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function QuickCreate() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <Plus /> Create
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem asChild>
          <Link href="/contacts/new"><UserPlus /> Contact</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/events/new"><Ticket /> Event</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/campaigns/new"><Megaphone /> Campaign</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/emails/broadcasts/new"><Send /> Broadcast email</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/emails/templates/new"><Mail /> Email template</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/automations/new"><Workflow /> Automation</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/scheduling/new"><CalendarClock /> Booking page</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
