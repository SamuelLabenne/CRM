"use client";

import "./email-editor.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/core";
import { getMarkRange } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { Placeholder } from "@tiptap/extension-placeholder";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  MousePointerClick,
  Image as ImageIcon,
  Quote,
  Redo2,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { normalizeEditorHtml } from "@/lib/email/html";
import { cn } from "@/lib/utils";
import { EmailLink, MergeTagHighlight, safeColor } from "./editor-extensions";
import { MergeTagMenu } from "./merge-tag-menu";

/** Editor content: TipTap JSON (source of truth when present) plus the rendered HTML body. */
export type EmailEditorValue = { json: Record<string, unknown> | null; html: string };

export type EmailEditorProps = {
  /** Controlled value. When `json` is null the editor loads `html` (system templates only have HTML). */
  value: EmailEditorValue;
  onChange: (value: EmailEditorValue) => void;
  placeholder?: string;
  /** Workspace brand color, used for buttons without an explicit color. */
  brandColor?: string;
  className?: string;
  minHeight?: number;
};

const DEFAULT_BRAND = "#4f46e5";

/** Turn user input into a safe href: keeps merge tags, mailto:/tel:, anchors and absolute URLs. */
export function normalizeUrl(input: string): string {
  const v = input.trim();
  if (!v) return "";
  if (v.startsWith("{{") || v.startsWith("#") || v.startsWith("/")) return v;
  if (/^(https?:|mailto:|tel:)/i.test(v)) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return ""; // javascript:, data:, … are not allowed
  return `https://${v}`;
}

function serialize(editor: Editor) {
  return editor.isEmpty ? "" : normalizeEditorHtml(editor.getHTML());
}

type DialogKind = "link" | "image" | "button" | null;

export function EmailEditor({ value, onChange, placeholder = "Write your email…", brandColor = DEFAULT_BRAND, className, minHeight = 320 }: EmailEditorProps) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const lastHtml = useRef(value.html);
  const [dialog, setDialog] = useState<DialogKind>(null);

  const extensions = useMemo(
    () => [
      StarterKit.configure({ link: false, heading: { levels: [1, 2, 3] } }),
      EmailLink.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer", class: null },
      }),
      Image.configure({ inline: false, allowBase64: false }),
      TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right"] }),
      Placeholder.configure({ placeholder }),
      MergeTagHighlight,
    ],
    [placeholder],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: (value.json as JSONContent | null) ?? value.html,
    editorProps: { attributes: { "aria-label": "Email body", role: "textbox", "aria-multiline": "true" } },
    onUpdate: ({ editor }) => {
      const html = serialize(editor);
      lastHtml.current = html;
      onChangeRef.current({ json: editor.getJSON() as Record<string, unknown>, html });
    },
  });

  // Sync external changes (e.g. a template was picked) into the editor.
  useEffect(() => {
    if (!editor) return;
    if (value.html === lastHtml.current) return;
    lastHtml.current = value.html;
    editor.commands.setContent((value.json as JSONContent | null) ?? value.html, { emitUpdate: false });
  }, [editor, value.html, value.json]);

  const insertText = useCallback(
    (text: string) => {
      editor?.chain().focus().insertContent(text).run();
    },
    [editor],
  );

  if (!editor) {
    return (
      <div className={cn("overflow-hidden rounded-lg border bg-card", className)}>
        <div className="h-10 border-b bg-muted/40" />
        <div className="grid gap-3 p-6" style={{ minHeight }}>
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("email-editor overflow-clip rounded-lg border bg-card focus-within:ring-3 focus-within:ring-ring/30", className)}
      style={{ "--email-brand": brandColor, "--email-editor-min-height": `${minHeight}px` } as React.CSSProperties}
    >
      <Toolbar editor={editor} onInsertText={insertText} onOpenDialog={setDialog} />
      <EditorContent editor={editor} />
      <LinkDialog editor={editor} open={dialog === "link"} onClose={() => setDialog(null)} />
      <ImageDialog editor={editor} open={dialog === "image"} onClose={() => setDialog(null)} />
      <ButtonDialog editor={editor} open={dialog === "button"} onClose={() => setDialog(null)} brandColor={brandColor} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function ToolbarToggle({
  label,
  pressed,
  onPress,
  disabled,
  children,
}: {
  label: string;
  pressed?: boolean;
  onPress: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={pressed ?? false}
          onPressedChange={onPress}
          disabled={disabled}
          aria-label={label}
          onMouseDown={(e) => e.preventDefault()}
        >
          {children}
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function Sep() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />;
}

function Toolbar({
  editor,
  onInsertText,
  onOpenDialog,
}: {
  editor: Editor;
  onInsertText: (text: string) => void;
  onOpenDialog: (d: DialogKind) => void;
}) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive("heading", { level: 1 }) ? "h1" : e.isActive("heading", { level: 2 }) ? "h2" : e.isActive("heading", { level: 3 }) ? "h3" : "p",
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      left: e.isActive({ textAlign: "left" }),
      center: e.isActive({ textAlign: "center" }),
      right: e.isActive({ textAlign: "right" }),
      link: e.isActive("link") && !e.isActive("link", { button: true }),
      button: e.isActive("link", { button: true }),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const chain = () => editor.chain().focus();
  return (
    <div className="sticky top-14 z-10 flex items-center gap-0.5 overflow-x-auto border-b bg-muted/60 px-2 py-1.5 backdrop-blur" role="toolbar" aria-label="Formatting">
      <NativeSelect
        size="sm"
        aria-label="Text style"
        value={s.block}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "p") chain().setParagraph().run();
          else chain().setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 }).run();
        }}
        className="mr-1 shrink-0"
      >
        <NativeSelectOption value="p">Paragraph</NativeSelectOption>
        <NativeSelectOption value="h1">Heading 1</NativeSelectOption>
        <NativeSelectOption value="h2">Heading 2</NativeSelectOption>
        <NativeSelectOption value="h3">Heading 3</NativeSelectOption>
      </NativeSelect>
      <Sep />
      <ToolbarToggle label="Bold (⌘B)" pressed={s.bold} onPress={() => chain().toggleBold().run()}>
        <Bold />
      </ToolbarToggle>
      <ToolbarToggle label="Italic (⌘I)" pressed={s.italic} onPress={() => chain().toggleItalic().run()}>
        <Italic />
      </ToolbarToggle>
      <ToolbarToggle label="Underline (⌘U)" pressed={s.underline} onPress={() => chain().toggleUnderline().run()}>
        <UnderlineIcon />
      </ToolbarToggle>
      <ToolbarToggle label="Strikethrough" pressed={s.strike} onPress={() => chain().toggleStrike().run()}>
        <Strikethrough />
      </ToolbarToggle>
      <Sep />
      <ToolbarToggle label="Bullet list" pressed={s.bullet} onPress={() => chain().toggleBulletList().run()}>
        <List />
      </ToolbarToggle>
      <ToolbarToggle label="Numbered list" pressed={s.ordered} onPress={() => chain().toggleOrderedList().run()}>
        <ListOrdered />
      </ToolbarToggle>
      <ToolbarToggle label="Quote" pressed={s.quote} onPress={() => chain().toggleBlockquote().run()}>
        <Quote />
      </ToolbarToggle>
      <ToolbarToggle label="Divider" onPress={() => chain().setHorizontalRule().run()}>
        <Minus />
      </ToolbarToggle>
      <Sep />
      <ToolbarToggle label="Align left" pressed={s.left} onPress={() => chain().setTextAlign("left").run()}>
        <AlignLeft />
      </ToolbarToggle>
      <ToolbarToggle label="Align center" pressed={s.center} onPress={() => chain().setTextAlign("center").run()}>
        <AlignCenter />
      </ToolbarToggle>
      <ToolbarToggle label="Align right" pressed={s.right} onPress={() => chain().setTextAlign("right").run()}>
        <AlignRight />
      </ToolbarToggle>
      <Sep />
      <ToolbarToggle label="Link" pressed={s.link} onPress={() => onOpenDialog(s.button ? "button" : "link")}>
        <Link2 />
      </ToolbarToggle>
      <ToolbarToggle label="Image from URL" onPress={() => onOpenDialog("image")}>
        <ImageIcon />
      </ToolbarToggle>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={s.button ? "secondary" : "ghost"}
            size="sm"
            className="shrink-0"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onOpenDialog("button")}
          >
            <MousePointerClick /> Button
          </Button>
        </TooltipTrigger>
        <TooltipContent>{s.button ? "Edit button" : "Insert a call-to-action button"}</TooltipContent>
      </Tooltip>
      <MergeTagMenu onInsert={onInsertText} className="shrink-0" />
      <Sep />
      <ToolbarToggle label="Undo (⌘Z)" onPress={() => chain().undo().run()} disabled={!s.canUndo}>
        <Undo2 />
      </ToolbarToggle>
      <ToolbarToggle label="Redo (⇧⌘Z)" onPress={() => chain().redo().run()} disabled={!s.canRedo}>
        <Redo2 />
      </ToolbarToggle>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function selectedText(editor: Editor) {
  const { from, to, empty } = editor.state.selection;
  return empty ? "" : editor.state.doc.textBetween(from, to, " ");
}

function LinkDialog({ editor, open, onClose }: { editor: Editor; open: boolean; onClose: () => void }) {
  // Re-mount the form on every open so the fields pick up the current selection.
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">{open && <LinkForm editor={editor} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function LinkForm({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const existing = editor.isActive("link");
  const hasSelection = !editor.state.selection.empty;
  const [url, setUrl] = useState<string>(() => (existing ? String(editor.getAttributes("link").href ?? "") : ""));
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const href = normalizeUrl(url);
    if (!href) {
      setError("Enter a valid web address, email address or merge tag.");
      return;
    }
    const c = editor.chain().focus();
    if (existing) {
      c.extendMarkRange("link").setLink({ href }).run();
    } else if (hasSelection) {
      c.setLink({ href }).run();
    } else {
      c.insertContent({ type: "text", text: text.trim() || href, marks: [{ type: "link", attrs: { href } }] }).run();
    }
    onClose();
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{existing ? "Edit link" : "Add link"}</DialogTitle>
        <DialogDescription>Links to web pages, email addresses, or a merge tag such as {"{{attendee.manage_url}}"}.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="link-url">Link URL</Label>
        <Input id="link-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" autoFocus />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      {!existing && !hasSelection && (
        <div className="grid gap-2">
          <Label htmlFor="link-text">Link text</Label>
          <Input id="link-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Read more" />
        </div>
      )}
      <DialogFooter className="sm:justify-between">
        {existing ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              editor.chain().focus().extendMarkRange("link").unsetLink().run();
              onClose();
            }}
          >
            Remove link
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">{existing ? "Update" : "Add link"}</Button>
        </div>
      </DialogFooter>
    </form>
  );
}

function ImageDialog({ editor, open, onClose }: { editor: Editor; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">{open && <ImageForm editor={editor} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function ImageForm({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [src, setSrc] = useState("");
  const [alt, setAlt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const url = src.trim();
    if (!/^https?:\/\//i.test(url)) {
      setError("Enter the full image address, starting with https://");
      return;
    }
    editor.chain().focus().setImage({ src: url, alt: alt.trim() || undefined }).run();
    onClose();
  };
  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Insert image</DialogTitle>
        <DialogDescription>Paste the address of an image that is already hosted online.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="img-src">Image URL</Label>
        <Input id="img-src" value={src} onChange={(e) => setSrc(e.target.value)} placeholder="https://example.com/banner.png" autoFocus />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="img-alt">Alt text</Label>
        <Input id="img-alt" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="Describe the image (for accessibility)" />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Insert image</Button>
      </DialogFooter>
    </form>
  );
}

function ButtonDialog({ editor, open, onClose, brandColor }: { editor: Editor; open: boolean; onClose: () => void; brandColor: string }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">{open && <ButtonForm editor={editor} onClose={onClose} brandColor={brandColor} />}</DialogContent>
    </Dialog>
  );
}

const BUTTON_SWATCHES = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#111827"];

function ButtonForm({ editor, onClose, brandColor }: { editor: Editor; onClose: () => void; brandColor: string }) {
  const editing = editor.isActive("link", { button: true });
  const attrs = editing ? editor.getAttributes("link") : {};
  const [label, setLabel] = useState(() => {
    if (!editing) return selectedText(editor) || "Click here";
    const range = getMarkRange(editor.state.selection.$from, editor.state.schema.marks.link);
    return range ? editor.state.doc.textBetween(range.from, range.to, " ") : "Click here";
  });
  const [url, setUrl] = useState(() => String(attrs.href ?? ""));
  const [color, setColor] = useState<string>(() => safeColor(attrs.color) ?? "");
  const [errors, setErrors] = useState<{ label?: string; url?: string }>({});

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const href = normalizeUrl(url);
    const next: typeof errors = {};
    if (!label.trim()) next.label = "Add the button text.";
    if (!href) next.url = "Enter a valid web address or merge tag.";
    setErrors(next);
    if (next.label || next.url) return;
    const node = {
      type: "text",
      text: label.trim(),
      marks: [{ type: "link", attrs: { href, button: true, color: color || null } }],
    };
    if (editing) {
      const range = getMarkRange(editor.state.selection.$from, editor.state.schema.marks.link);
      if (range) editor.chain().focus().insertContentAt({ from: range.from, to: range.to }, node).run();
    } else {
      editor.chain().focus().insertContent({ type: "paragraph", content: [node] }).run();
    }
    onClose();
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit button" : "Insert button"}</DialogTitle>
        <DialogDescription>A call-to-action button that works in every email client.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="btn-label">Button text</Label>
        <Input id="btn-label" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        {errors.label && <p className="text-xs text-destructive">{errors.label}</p>}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="btn-url">Link URL</Label>
        <Input id="btn-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/register" />
        {errors.url && <p className="text-xs text-destructive">{errors.url}</p>}
      </div>
      <div className="grid gap-2">
        <Label>Color</Label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setColor("")}
            className={cn("flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs", !color && "ring-2 ring-ring")}
          >
            <span className="size-3.5 rounded-full" style={{ background: brandColor }} /> Brand
          </button>
          {BUTTON_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Use ${c}`}
              onClick={() => setColor(c)}
              className={cn("size-7 rounded-full border", color.toLowerCase() === c && "ring-2 ring-ring ring-offset-2 ring-offset-popover")}
              style={{ background: c }}
            />
          ))}
          <input
            type="color"
            aria-label="Custom color"
            value={safeColor(color)?.length === 7 ? color : brandColor.length === 7 ? brandColor : DEFAULT_BRAND}
            onChange={(e) => setColor(e.target.value)}
            className="size-7 cursor-pointer rounded-md border bg-transparent p-0.5"
          />
        </div>
      </div>
      <div className="rounded-lg border bg-muted/40 p-4 text-center">
        <span
          className="inline-block rounded-lg px-5 py-3 text-sm font-semibold text-white"
          style={{ background: color || brandColor }}
        >
          {label.trim() || "Button"}
        </span>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">{editing ? "Update button" : "Insert button"}</Button>
      </DialogFooter>
    </form>
  );
}
