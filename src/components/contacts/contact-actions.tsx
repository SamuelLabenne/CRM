"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, CheckSquare, Mail, MoreHorizontal, Pencil, StickyNote, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { AddNoteDialog } from "@/components/contacts/add-note-dialog";
import { AddToEventDialog } from "@/components/contacts/add-to-event-dialog";
import { ContactForm, type ContactFormValues } from "@/components/contacts/contact-form";
import { SendEmailDialog, type TemplateOption } from "@/components/contacts/send-email-dialog";
import { TaskDialog } from "@/components/tasks/task-dialog";
import { deleteContactAction } from "@/app/(app)/contacts/actions";
import type { CustomFieldLite } from "@/lib/contacts/custom-values";
import type { StageDTO, TagDTO, UserDTO } from "@/lib/contacts/dto";

type Dialog = "email" | "note" | "task" | "event" | "edit" | null;

/** Header actions of the contact card: Send email, Add note, Add task, Add to event, Edit, Delete. */
export function ContactActions({
  contact,
  initialForm,
  templates,
  stages,
  users,
  customFields,
  tagSuggestions,
  currentUserId,
  timezone,
  workspace,
}: {
  contact: { id: string; name: string; email: string | null; emailStatus: string; firstName: string | null; lastName: string | null; company: string | null; jobTitle: string | null; phone: string | null };
  initialForm: Partial<ContactFormValues>;
  templates: TemplateOption[];
  stages: StageDTO[];
  users: UserDTO[];
  customFields: CustomFieldLite[];
  tagSuggestions: TagDTO[];
  currentUserId: string;
  timezone: string;
  workspace: { name: string; brandColor: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Dialog>(null);
  const close = () => setOpen(null);

  return (
    <>
      <Button size="sm" disabled={!contact.email} title={contact.email ? undefined : "This contact has no email address"} onClick={() => setOpen("email")}>
        <Mail /> Send email
      </Button>
      <Button size="sm" variant="outline" onClick={() => setOpen("note")}>
        <StickyNote /> <span className="hidden sm:inline">Add</span> note
      </Button>
      <Button size="sm" variant="outline" onClick={() => setOpen("task")}>
        <CheckSquare /> <span className="hidden sm:inline">Add</span> task
      </Button>
      <Button size="sm" variant="outline" onClick={() => setOpen("event")}>
        <CalendarPlus /> <span className="hidden sm:inline">Add to</span> event
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="outline" aria-label="More actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpen("edit")}>
            <Pencil /> Edit contact
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <ConfirmDialog
            destructive
            title={`Delete ${contact.name}?`}
            description="This permanently deletes the contact, their journey, registrations and tasks. This can't be undone."
            confirmLabel="Delete contact"
            onConfirm={async () => {
              const res = await deleteContactAction(contact.id);
              if (!res.ok) return void toast.error(res.error);
              toast.success(res.message ?? "Contact deleted");
              router.push("/contacts");
              router.refresh();
            }}
            trigger={
              <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
                <Trash2 /> Delete contact
              </DropdownMenuItem>
            }
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <SendEmailDialog open={open === "email"} onOpenChange={(o) => !o && close()} contact={contact} templates={templates} workspace={workspace} />
      <AddNoteDialog open={open === "note"} onOpenChange={(o) => !o && close()} contactId={contact.id} contactName={contact.name} />
      <AddToEventDialog open={open === "event"} onOpenChange={(o) => !o && close()} contactId={contact.id} contactName={contact.name} timezone={timezone} />
      <TaskDialog
        open={open === "task"}
        onOpenChange={(o) => !o && close()}
        lockedContact={{ id: contact.id, name: contact.name, email: contact.email }}
        users={users}
        currentUserId={currentUserId}
        timezone={timezone}
      />
      <Sheet open={open === "edit"} onOpenChange={(o) => !o && close()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl" side="right">
          <SheetHeader>
            <SheetTitle>Edit contact</SheetTitle>
            <SheetDescription>Changes are logged on the contact&apos;s journey.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            {open === "edit" && (
              <ContactForm
                contactId={contact.id}
                initial={initialForm}
                stages={stages}
                users={users}
                customFields={customFields}
                tagSuggestions={tagSuggestions}
                onDone={close}
                onCancel={close}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
