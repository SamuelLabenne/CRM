"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { importChunkAction } from "@/app/(app)/contacts/import/actions";
import { guessMapping, IMPORT_FIELDS, isBlankRow, mapCsvRow, type ImportField, type ImportRowInput } from "@/lib/contacts/csv-mapping";
import type { CustomFieldLite } from "@/lib/contacts/custom-values";
type ImportMode = "update" | "fill" | "skip";
import { cn } from "@/lib/utils";

const CHUNK = 200;
const MAX_ROWS = 20_000;

type Parsed = { fileName: string; headers: string[]; rows: string[][] };
type Summary = { created: number; updated: number; skipped: number; errors: { line: number; message: string }[] };

export function ImportWizard({ customFields, stages }: { customFields: CustomFieldLite[]; stages: { key: string; label: string }[] }) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<ImportField[]>([]);
  const [mode, setMode] = useState<ImportMode>("fill");
  const [tagName, setTagName] = useState(() => `Imported ${new Date().toISOString().slice(0, 10)}`);
  const [progress, setProgress] = useState<number | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function readFile(file: File) {
    if (!/\.(csv|txt|tsv)$/i.test(file.name) && file.type && !file.type.includes("csv") && !file.type.includes("text")) {
      toast.error("Please choose a .csv file");
      return;
    }
    Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy",
      complete: (res) => {
        const [headerRow, ...rest] = res.data;
        if (!headerRow?.length || !rest.length) {
          toast.error("That file looks empty – it needs a header row and at least one contact.");
          return;
        }
        if (rest.length > MAX_ROWS) {
          toast.error(`That file has ${rest.length.toLocaleString()} rows; import at most ${MAX_ROWS.toLocaleString()} at a time.`);
          return;
        }
        const headers = headerRow.map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`);
        setParsed({ fileName: file.name, headers, rows: rest.map((r) => headers.map((_, i) => String(r[i] ?? ""))) });
        setMapping(guessMapping(headers, customFields));
        setSummary(null);
      },
      error: (err) => toast.error(`Couldn't read the file: ${err.message}`),
    });
  }

  const ctx = useMemo(() => ({ customFields, stages }), [customFields, stages]);
  const mapped = useMemo(() => {
    if (!parsed) return { rows: [] as ImportRowInput[], errors: [] as { line: number; message: string }[], warnings: 0 };
    const rows: ImportRowInput[] = [];
    const errors: { line: number; message: string }[] = [];
    let warnings = 0;
    parsed.rows.forEach((cells, i) => {
      if (isBlankRow(cells)) return;
      const r = mapCsvRow(cells, mapping, ctx, i + 2);
      warnings += r.warnings.length;
      if (r.input) rows.push(r.input);
      else errors.push({ line: i + 2, message: r.error ?? "Row skipped" });
    });
    return { rows, errors, warnings };
  }, [parsed, mapping, ctx]);

  const hasIdentity = mapping.some((m) => m === "email" || m === "phone" || m === "full_name" || m === "first_name" || m === "last_name");

  async function runImport() {
    if (!mapped.rows.length) return;
    setProgress(0);
    const total: Summary = { created: 0, updated: 0, skipped: 0, errors: [...mapped.errors] };
    for (let i = 0; i < mapped.rows.length; i += CHUNK) {
      const res = await importChunkAction({ rows: mapped.rows.slice(i, i + CHUNK), mode, tagName: tagName.trim() || null });
      if (!res.ok) {
        toast.error(res.error);
        total.errors.push({ line: mapped.rows[i].line, message: `Chunk failed: ${res.error}` });
      } else if (res.data) {
        total.created += res.data.created;
        total.updated += res.data.updated;
        total.skipped += res.data.skipped;
        total.errors.push(...res.data.errors);
      }
      setProgress(Math.min(100, Math.round(((i + CHUNK) / mapped.rows.length) * 100)));
    }
    setSummary(total);
    setProgress(null);
    toast.success(`Import finished: ${total.created} created, ${total.updated} updated`);
  }

  if (summary) {
    return (
      <Card className="gap-5 p-6">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="size-8 text-emerald-600" />
          <div>
            <h2 className="text-lg font-semibold">Import complete</h2>
            <p className="text-sm text-muted-foreground">{parsed?.fileName}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Created", summary.created],
            ["Updated", summary.updated],
            ["Skipped", summary.skipped],
            ["Errors", summary.errors.length],
          ].map(([label, n]) => (
            <div key={label} className="rounded-lg bg-muted/60 p-3 text-center">
              <div className="text-2xl font-semibold tabular-nums">{n}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
        {summary.errors.length > 0 && (
          <div className="max-h-56 overflow-auto rounded-lg border p-3 text-sm">
            {summary.errors.slice(0, 200).map((e, i) => (
              <div key={i} className="flex gap-2">
                <span className="w-16 shrink-0 text-muted-foreground">Line {e.line}</span>
                <span>{e.message}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/contacts">View contacts</Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setParsed(null);
              setSummary(null);
            }}
          >
            Import another file
          </Button>
        </div>
      </Card>
    );
  }

  if (!parsed) {
    return (
      <div className="grid gap-4">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) readFile(f);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-card p-12 text-center transition-colors",
            dragging ? "border-primary bg-accent" : "hover:border-primary/50",
          )}
        >
          <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <Upload className="size-6" />
          </span>
          <span className="font-medium">Drop a CSV file here, or click to choose</span>
          <span className="max-w-md text-sm text-muted-foreground">
            The first row must contain column names (e.g. First name, Last name, Email, Company, Tags). Up to {MAX_ROWS.toLocaleString()} rows per file.
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv,.tsv,.txt"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) readFile(f);
              e.target.value = "";
            }}
          />
        </label>
        <p className="text-sm text-muted-foreground">
          Tip: tags can be a comma-separated list in one column; stage values are matched to your pipeline stages by name.
        </p>
      </div>
    );
  }

  const fieldOptions = [
    ...IMPORT_FIELDS.map((f) => ({ value: f.key as string, label: f.label })),
    ...customFields.map((c) => ({ value: `custom:${c.key}`, label: `${c.label} (custom)` })),
  ];

  return (
    <div className="grid gap-6">
      <Card className="gap-0 p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="size-5 text-emerald-600" />
            <span className="font-medium">{parsed.fileName}</span>
            <span className="text-sm text-muted-foreground">· {parsed.rows.length.toLocaleString()} rows</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setParsed(null)} disabled={progress != null}>
            <ArrowLeft /> Choose another file
          </Button>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Column in your file</TableHead>
                <TableHead>Example values</TableHead>
                <TableHead className="pr-5">Import as</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parsed.headers.map((h, i) => (
                <TableRow key={i}>
                  <TableCell className="pl-5 font-medium">{h}</TableCell>
                  <TableCell className="max-w-72 truncate text-sm text-muted-foreground">
                    {parsed.rows
                      .slice(0, 3)
                      .map((r) => r[i])
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </TableCell>
                  <TableCell className="pr-5">
                    <NativeSelect
                      className="w-56"
                      value={mapping[i]}
                      onChange={(e) => setMapping((m) => m.map((v, idx) => (idx === i ? (e.target.value as ImportField) : v)))}
                    >
                      {fieldOptions.map((o) => (
                        <NativeSelectOption key={o.value} value={o.value}>
                          {o.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="grid gap-5 p-5 md:grid-cols-2">
        <div className="grid gap-3">
          <Label>When a contact already exists (same email or phone)</Label>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as ImportMode)} className="grid gap-2">
            {[
              ["fill", "Fill in blanks only", "Keep existing values, add missing ones (recommended)"],
              ["update", "Overwrite", "Replace existing values with the values from the file"],
              ["skip", "Skip", "Leave existing contacts untouched"],
            ].map(([v, title, desc]) => (
              <label key={v} className="flex items-start gap-3 rounded-lg border p-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-accent/50">
                <RadioGroupItem value={v} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">{title}</span>
                  <span className="text-xs text-muted-foreground">{desc}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </div>
        <div className="grid content-start gap-3">
          <Label htmlFor="import-tag">Tag every imported contact</Label>
          <Input id="import-tag" value={tagName} onChange={(e) => setTagName(e.target.value)} placeholder="e.g. Trade show 2026" maxLength={60} />
          <p className="text-xs text-muted-foreground">Makes it easy to find, email or undo this import later. Leave empty for no tag.</p>
          <div className="mt-2 grid gap-1 rounded-lg bg-muted/50 p-3 text-sm">
            <span>
              <strong className="tabular-nums">{mapped.rows.length.toLocaleString()}</strong> rows ready to import
            </span>
            {mapped.errors.length > 0 && (
              <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-3.5" /> {mapped.errors.length} rows will be skipped (e.g. line {mapped.errors[0].line}: {mapped.errors[0].message})
              </span>
            )}
            {mapped.warnings > 0 && <span className="text-muted-foreground">{mapped.warnings} values will be ignored (invalid email/date/number…)</span>}
          </div>
        </div>
      </Card>

      {progress != null && (
        <div className="grid gap-2">
          <Progress value={progress} />
          <p className="text-sm text-muted-foreground">Importing… {progress}%</p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {!hasIdentity && <span className="text-sm text-destructive">Map at least an email, phone or name column.</span>}
        <Button size="lg" onClick={runImport} disabled={!hasIdentity || !mapped.rows.length || progress != null}>
          <Upload /> Import {mapped.rows.length.toLocaleString()} contacts
        </Button>
      </div>
    </div>
  );
}
