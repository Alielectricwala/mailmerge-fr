// Contact import: parse CSV/XLSX (every sheet), suggest a column mapping, read addresses out of messy
// cells, accept person-confirmed corrections, and apply an explicit duplicate policy.
// Existing data is only changed when the chosen policy says so; every row outcome is counted.
import { parse as parseCsv } from "csv-parse/sync";
import readXlsxFile, { readSheetNames } from "read-excel-file/node";
import type { Prisma } from "@prisma/client";
import prisma from "../db.js";
import { AppError } from "../middleware/error-handler.js";
import { extractEmails, likelyTypo, suggestEmailFix } from "./email-cells.js";
import { inferPersonaFromTitle, inferSegmentFromCompany, normalizeContactPersona, normalizeHotelSegment } from "./classification.js";
import {
  ALL_SHEETS,
  COALESCABLE_TARGETS,
  CUSTOM_FIELD_NAME,
  EmailSchema,
  MAX_IMPORT_ROWS,
  STANDARD_CONTACT_FIELDS,
  rowRef,
  type DuplicatePolicy,
  type ImportAnalysisDto,
  type ImportProblemRow,
  type ImportResultDto,
  type ImportRowError,
  type ImportTarget,
  type MultiEmailPolicy,
  type StandardContactField,
  toFieldName,
} from "../../shared/types.js";

export interface SheetData {
  name: string;
  headers: string[];
  rows: string[][];
  /** Original spreadsheet row number of each data row (for messages and corrections) */
  rowNumbers: number[];
}

/** The rows chosen for import; refs[i] says where rows[i] came from */
export interface ParsedSheet {
  headers: string[];
  rows: string[][];
  refs: { sheet: string; row: number }[];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

/** Header row -> unique, non-empty names; data rows keep their original spreadsheet row numbers */
function toSheet(name: string, table: string[][]): SheetData | null {
  const numbered = table.map((cells, i) => ({ cells, row: i + 1 })).filter((r) => r.cells.some((c) => c !== ""));
  if (!numbered.length) return null;
  const seen = new Map<string, number>();
  const headers = numbered[0]!.cells.map((h, i) => {
    const base = h || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base} (${n})` : base;
  });
  const rows = numbered.slice(1);
  return { name, headers, rows: rows.map((r) => r.cells), rowNumbers: rows.map((r) => r.row) };
}

export async function parseWorkbook(buffer: Buffer, fileName: string): Promise<SheetData[]> {
  const lower = fileName.toLowerCase();
  const sheets: (SheetData | null)[] = [];

  if (lower.endsWith(".xlsx")) {
    try {
      for (const name of await readSheetNames(buffer)) {
        const rows = await readXlsxFile(buffer, { sheet: name });
        sheets.push(toSheet(name, rows.map((r) => r.map(cellToString))));
      }
    } catch {
      throw AppError.badRequest("UNREADABLE_FILE", "That spreadsheet couldn't be read. Save it as .xlsx or .csv and try again.");
    }
  } else if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    try {
      const table = parseCsv(buffer, {
        bom: true,
        delimiter: [",", ";", "\t"],
        relax_column_count: true,
        relax_quotes: true,
        skip_empty_lines: false,
        trim: true,
      }) as string[][];
      sheets.push(toSheet("CSV", table));
    } catch (err) {
      throw AppError.badRequest("UNREADABLE_FILE", `That CSV couldn't be read: ${(err as Error).message}`);
    }
  } else if (lower.endsWith(".xls")) {
    throw AppError.badRequest("UNSUPPORTED_FILE", "Old Excel (.xls) files aren't supported. Save it as .xlsx or .csv.");
  } else {
    throw AppError.badRequest("UNSUPPORTED_FILE", "Upload a .csv or .xlsx file.");
  }

  const usable = sheets.filter((s): s is SheetData => s !== null && s.rows.length > 0);
  if (!usable.length) {
    throw AppError.badRequest("EMPTY_FILE", sheets.some(Boolean) ? "The file only has a header row." : "The file has no rows.");
  }
  return usable;
}

const normalize = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** One sheet by name, or ALL_SHEETS combined by column name (columns in order of first appearance) */
export function selectSheet(sheets: SheetData[], sheet?: string): ParsedSheet {
  const chosen = !sheet ? [sheets[0]!] : sheet === ALL_SHEETS ? sheets : sheets.filter((s) => s.name === sheet);
  if (!chosen.length) throw AppError.badRequest("NO_SUCH_SHEET", `The file has no sheet called "${sheet}".`);

  const headers: string[] = [];
  const headerCanonicalMap = new Map<string, string>();

  function findSynonymTarget(sheetHeaders: string[], header: string): string | null {
    const key = normalize(header);
    for (const registered of headers) {
      const regKey = normalize(registered);
      if (regKey === key) return registered;
      // Only alias across sheets if this sheet doesn't already contain the registered header
      if (!sheetHeaders.includes(registered)) {
        for (const aliases of Object.values(ALIASES)) {
          if (aliases.includes(regKey) && aliases.includes(key)) {
            return registered;
          }
        }
      }
    }
    return null;
  }

  for (const s of chosen) {
    for (const h of s.headers) {
      if (sheet === ALL_SHEETS) {
        const canonical = findSynonymTarget(s.headers, h);
        if (canonical) {
          headerCanonicalMap.set(`${s.name}::${h}`, canonical);
        } else {
          headers.push(h);
          headerCanonicalMap.set(`${s.name}::${h}`, h);
        }
      } else {
        if (!headers.includes(h)) headers.push(h);
      }
    }
  }

  const rows: string[][] = [];
  const refs: ParsedSheet["refs"] = [];
  for (const s of chosen) {
    const index = headers.map((h) => {
      if (sheet === ALL_SHEETS) {
        return s.headers.findIndex((sh) => headerCanonicalMap.get(`${s.name}::${sh}`) === h);
      }
      return s.headers.indexOf(h);
    });
    s.rows.forEach((r, i) => {
      rows.push(index.map((j) => (j === -1 ? "" : (r[j] ?? ""))));
      refs.push({ sheet: s.name, row: s.rowNumbers[i]! });
    });
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw AppError.badRequest("TOO_MANY_ROWS", `That's ${rows.length.toLocaleString()} rows; the limit is ${MAX_IMPORT_ROWS.toLocaleString()}. Split the file.`);
  }
  return { headers, rows, refs };
}

/** Single-sheet convenience (first sheet) */
export async function parseSpreadsheet(buffer: Buffer, fileName: string): Promise<ParsedSheet> {
  return selectSheet(await parseWorkbook(buffer, fileName));
}

// ---------------------------------------------------------------------------
// Mapping suggestions
// ---------------------------------------------------------------------------

const ALIASES: Record<"email" | StandardContactField | "fullName", string[]> = {
  email: [
    "email",
    "emailaddress",
    "mail",
    "workemail",
    "businessemail",
    "emailid",
    "publicemail",
    "officialemail",
    "contactemail",
    "primaryemail",
    "guestemail",
    "bookingemail",
    "reservationemail",
    "reservationsemail",
    "frontdeskemail",
    "infoemail",
    "hotelemail",
    "directemail",
    "generalemail",
    "inboxemail",
  ],
  firstName: ["firstname", "fname", "givenname", "first", "forename"],
  lastName: ["lastname", "lname", "surname", "familyname", "last"],
  fullName: [
    "name",
    "fullname",
    "contactname",
    "contact",
    "contactperson",
    "personname",
    "decisionmaker",
    "leadname",
    "guestname",
  ],
  company: [
    "company",
    "companyname",
    "organization",
    "organisation",
    "org",
    "account",
    "accountname",
    "business",
    "businessname",
    "hotel",
    "hotelname",
    "hotelgroup",
    "hotelgroupname",
    "hotelprospectname",
    "prospectname",
    "property",
    "propertyname",
    "resort",
    "resortname",
    "establishment",
    "chain",
    "hotelchain",
  ],
  title: ["title", "jobtitle", "position", "role", "designation", "executiveposition"],
  phone: [
    "phone",
    "phonenumber",
    "mobile",
    "mobilenumber",
    "tel",
    "telephone",
    "cell",
    "cellphone",
    "contactnumber",
    "publicphone",
    "officialphone",
    "contactphone",
    "workphone",
    "businessphone",
    "hotelphone",
    "receptionphone",
    "frontdeskphone",
    "directphone",
    "phoneno",
    "mobilephone",
    "landline",
  ],
  hotelSegment: [
    "hotelsegment",
    "segment",
    "propertytype",
    "hoteltype",
    "starrating",
    "category",
    "positioning",
    "starpositioning",
    "starcategorypositioning",
    "starcategory",
    "hotelpositioning",
    "segmenttype",
  ],
  contactPersona: [
    "contactpersona",
    "persona",
    "rolecategory",
    "jobfunction",
    "department",
    "targetpersona",
  ],
};

export const customFieldName = toFieldName;

export function suggestMapping(headers: string[]): Record<string, ImportTarget> {
  const used = new Set<string>();
  const mapping: Record<string, ImportTarget> = {};

  // First pass: exact alias match
  for (const header of headers) {
    const key = normalize(header);
    const match = (Object.entries(ALIASES) as [ImportTarget, string[]][]).find(
      ([target, aliases]) => !used.has(target) && aliases.includes(key)
    );
    if (match) {
      used.add(match[0]);
      mapping[header] = match[0];
    }
  }

  // Second pass: heuristic matching for critical fields if not yet claimed
  for (const header of headers) {
    if (mapping[header]) continue;
    const lower = header.toLowerCase();
    const key = normalize(header);

    // Email heuristic: if header contains "email" (e.g. "Public Email", "Sales E-mail")
    if (
      !used.has("email") &&
      (key.includes("email") || /\b(email|e-mail|mail)\b/i.test(lower)) &&
      !/mailingaddress|street/i.test(lower)
    ) {
      used.add("email");
      mapping[header] = "email";
      continue;
    }

    // Phone heuristic: if header contains "phone", "tel", "mobile"
    if (
      !used.has("phone") &&
      (key.includes("phone") || /\b(phone|tel|mobile|cell|telephone)\b/i.test(lower))
    ) {
      used.add("phone");
      mapping[header] = "phone";
      continue;
    }

    // Company / Hotel heuristic: if header contains "hotel", "resort", "property", "company"
    if (
      !used.has("company") &&
      (key.includes("hotel") || key.includes("property") || /\b(hotel|resort|property|company)\b/i.test(lower))
    ) {
      used.add("company");
      mapping[header] = "company";
      continue;
    }

    mapping[header] = `custom:${customFieldName(header)}`;
  }

  // "name" + separate first/last columns: prefer the separate ones
  if (used.has("fullName") && (used.has("firstName") || used.has("lastName"))) {
    for (const [h, t] of Object.entries(mapping)) if (t === "fullName") mapping[h] = "ignore";
  }
  return mapping;
}

export function validateMapping(mapping: Record<string, string>, headers: string[]): Record<string, ImportTarget> {
  const out: Record<string, ImportTarget> = {};
  const targets = new Set<string>();
  for (const [header, target] of Object.entries(mapping)) {
    if (!headers.includes(header)) throw AppError.badRequest("BAD_MAPPING", `The file has no column called "${header}".`);
    const valid =
      target === "ignore" ||
      target === "email" ||
      target === "fullName" ||
      (STANDARD_CONTACT_FIELDS as readonly string[]).includes(target) ||
      (target.startsWith("custom:") && CUSTOM_FIELD_NAME.test(target.slice(7)));
    if (!valid) throw AppError.badRequest("BAD_MAPPING", `"${target}" isn't a valid destination for column "${header}".`);
    if (target !== "ignore" && targets.has(target) && !COALESCABLE_TARGETS.has(target)) {
      throw AppError.badRequest("BAD_MAPPING", `Two columns are mapped to the same field (${target.replace("custom:", "")}).`);
    }
    targets.add(target);
    out[header] = target as ImportTarget;
  }
  if (!targets.has("email")) throw AppError.badRequest("BAD_MAPPING", "Choose which column holds the email address.");
  return out;
}

// ---------------------------------------------------------------------------
// Row -> contact values
// ---------------------------------------------------------------------------

export interface ContactValues {
  email: string;
  standard: Partial<Record<StandardContactField, string>>;
  custom: Record<string, string>;
}

export interface RowValues {
  /** Raw content of the email column */
  rawEmail: string;
  /** Every valid address found in it (lower-case, de-duplicated) */
  emails: string[];
  /** Text other than addresses was removed from the cell */
  hadExtraText: boolean;
  standard: Partial<Record<StandardContactField, string>>;
  custom: Record<string, string>;
}

export function rowToValues(row: string[], headers: string[], mapping: Record<string, ImportTarget>): RowValues {
  const values: RowValues = { rawEmail: "", emails: [], hadExtraText: false, standard: {}, custom: {} };
  headers.forEach((header, i) => {
    const target = mapping[header];
    const cell = (row[i] ?? "").trim();
    if (!target || target === "ignore" || !cell) return;
    if (target === "email") {
      values.rawEmail = values.rawEmail ? `${values.rawEmail}, ${cell}` : cell;
    } else if (target === "fullName") {
      if (!values.standard.firstName) {
        const [first, ...rest] = cell.split(/\s+/);
        values.standard.firstName = first;
        if (rest.length && !values.standard.lastName) values.standard.lastName = rest.join(" ");
      }
    } else if (target.startsWith("custom:")) {
      const key = target.slice(7);
      values.custom[key] = values.custom[key] || cell.slice(0, 2000);
    } else {
      const stdKey = target as StandardContactField;
      if (!values.standard[stdKey]) {
        values.standard[stdKey] = cell.slice(0, 200);
      }
    }
  });
  const found = extractEmails(values.rawEmail);
  values.emails = found.emails;
  values.hadExtraText = found.hadExtraText;
  return values;
}

// ---------------------------------------------------------------------------
// Analysis: what will be imported, what was cleaned, what needs a person
// ---------------------------------------------------------------------------

const MAX_PROBLEMS = 500;

export interface ImportPlan {
  records: Map<string, ContactValues>;
  analysis: ImportAnalysisDto;
  /** Rows left out, for the import report */
  errors: ImportRowError[];
}

export function planImport(sheet: ParsedSheet, mapping: Record<string, ImportTarget>, multiEmail: MultiEmailPolicy, fixes: Record<string, string>): ImportPlan {
  const records = new Map<string, ContactValues>();
  const problems: ImportProblemRow[] = [];
  const typos: ImportProblemRow[] = [];
  const errors: ImportRowError[] = [];
  const stats = { multiEmailRows: 0, cleanedRows: 0, fixedRows: 0, skippedRows: 0, duplicatesInFile: 0, problemCount: 0, typoCount: 0 };

  sheet.rows.forEach((row, i) => {
    const { sheet: sheetName, row: rowNumber } = sheet.refs[i]!;
    const ref = rowRef(sheetName, rowNumber);
    const at = sheetName === "CSV" ? { row: rowNumber } : { sheet: sheetName, row: rowNumber };
    const values = rowToValues(row, sheet.headers, mapping);
    const context = [values.standard.firstName, values.standard.lastName, values.standard.company].filter(Boolean).join(" · ");
    let emails = values.emails;

    const fix = fixes[ref];
    if (fix !== undefined) {
      if (fix === "") {
        stats.skippedRows++;
        errors.push({ ...at, message: "Skipped during review" });
        return;
      }
      const parsed = EmailSchema.safeParse(fix);
      if (parsed.success) {
        emails = [parsed.data];
        stats.fixedRows++;
      }
    }

    if (!emails.length) {
      stats.problemCount++;
      const message = fix ? `"${fix}" isn't a valid email address` : values.rawEmail ? "No valid email address in this cell" : "Email is empty";
      errors.push({ ...at, message: values.rawEmail ? `${message}: "${values.rawEmail.slice(0, 80)}"` : message });
      if (problems.length < MAX_PROBLEMS) {
        problems.push({
          kind: "invalid",
          ref,
          sheet: sheetName,
          row: rowNumber,
          raw: values.rawEmail,
          suggestion: fix ? null : suggestEmailFix(values.rawEmail),
          context,
          message,
        });
      }
      return;
    }

    if (fix === undefined) {
      if (emails.length > 1) stats.multiEmailRows++;
      if (values.hadExtraText) stats.cleanedRows++;
      // Only single-address cells: a correction replaces the whole cell
      const typo = emails.length === 1 ? likelyTypo(emails[0]!) : null;
      if (typo) {
        stats.typoCount++;
        if (typos.length < MAX_PROBLEMS) {
          typos.push({ kind: "typo", ref, sheet: sheetName, row: rowNumber, raw: values.rawEmail, suggestion: typo, found: emails[0], context, message: `Possible typo in ${emails[0]}` });
        }
      }
    }
    for (const email of multiEmail === "first" ? emails.slice(0, 1) : emails) {
      if (records.has(email)) {
        stats.duplicatesInFile++;
        continue;
      }
      records.set(email, { email, standard: values.standard, custom: values.custom });
    }
  });

  return {
    records,
    errors,
    analysis: { totalRows: sheet.rows.length, contacts: records.size, problems: [...problems, ...typos].slice(0, MAX_PROBLEMS), ...stats },
  };
}

/** Fields to write for an existing contact under a policy; empty object = nothing changes */
export function mergeForPolicy(
  existing: {
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    title: string | null;
    phone: string | null;
    hotelSegment?: string | null;
    contactPersona?: string | null;
    customFields: Record<string, string>;
  },
  incoming: ContactValues,
  policy: DuplicatePolicy
): { standard: Partial<Record<StandardContactField, string>>; customFields?: Record<string, string> } {
  if (policy === "skip") return { standard: {} };
  const standard: Partial<Record<StandardContactField, string>> = {};
  for (const [field, value] of Object.entries(incoming.standard) as [StandardContactField, string][]) {
    const current = existing[field];
    if (policy === "fill_empty" ? !current : current !== value) standard[field] = value;
  }
  let changedCustom = false;
  const customFields = { ...existing.customFields };
  for (const [key, value] of Object.entries(incoming.custom)) {
    const current = customFields[key];
    if (policy === "fill_empty" ? !current : current !== value) {
      customFields[key] = value;
      changedCustom = true;
    }
  }
  return changedCustom ? { standard, customFields } : { standard };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const MAX_REPORTED_ERRORS = 200;

export async function runImport(args: {
  sheet: ParsedSheet;
  fileName: string;
  mapping: Record<string, ImportTarget>;
  policy: DuplicatePolicy;
  multiEmail?: MultiEmailPolicy;
  fixes?: Record<string, string>;
  listId?: string;
  newListName?: string;
  userId?: string;
}): Promise<ImportResultDto> {
  const { sheet, policy } = args;
  const plan = planImport(sheet, args.mapping, args.multiEmail ?? "each", args.fixes ?? {});
  const { records } = plan;
  const errors = plan.errors.slice(0, MAX_REPORTED_ERRORS);
  const skipped = plan.analysis.problemCount + plan.analysis.skippedRows;

  const emails = [...records.keys()];
  const existing = new Map<
    string,
    {
      id: string;
      firstName: string | null;
      lastName: string | null;
      company: string | null;
      title: string | null;
      phone: string | null;
      hotelSegment?: string | null;
      contactPersona?: string | null;
      customFields: Prisma.JsonValue;
    }
  >();
  for (let i = 0; i < emails.length; i += 1000) {
    const batch = await prisma.contact.findMany({ where: { email: { in: emails.slice(i, i + 1000) } } });
    for (const c of batch) existing.set(c.email.toLowerCase(), c);
  }
  const suppressedInFile = emails.length
    ? await prisma.suppressionEntry.count({ where: { email: { in: emails } } })
    : 0;

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let addedToList = 0;
  let list: { id: string; name: string } | null = null;

  const result = await prisma.$transaction(
    async (tx) => {
      if (args.listId) {
        list = await tx.contactList.findUnique({ where: { id: args.listId }, select: { id: true, name: true } });
        if (!list) throw AppError.notFound("LIST_NOT_FOUND", "That list no longer exists.");
      } else if (args.newListName) {
        const clash = await tx.contactList.findUnique({ where: { name: args.newListName } });
        if (clash) throw AppError.conflict("DUPLICATE", `A list called "${args.newListName}" already exists. Pick it instead, or use another name.`);
        list = await tx.contactList.create({ data: { name: args.newListName }, select: { id: true, name: true } });
      }

      const toCreate: Prisma.ContactCreateManyInput[] = [];
      for (const record of records.values()) {
        const current = existing.get(record.email);
        if (!current) {
          const segInferred = !record.standard.hotelSegment && record.standard.company ? inferSegmentFromCompany(record.standard.company, record.custom) : null;
          const perInferred = !record.standard.contactPersona && record.standard.title ? inferPersonaFromTitle(record.standard.title) : null;

          const hotelSegment = record.standard.hotelSegment ?? (segInferred && segInferred.value !== "UNKNOWN" ? segInferred.value : null);
          const hotelSegmentStatus = record.standard.hotelSegment ? "MANUAL" : (hotelSegment ? "GUESSED" : null);
          const hotelSegmentConfidence = record.standard.hotelSegment ? 1.0 : (segInferred && segInferred.value !== "UNKNOWN" ? segInferred.confidence : null);

          const contactPersona = record.standard.contactPersona ?? (perInferred && perInferred.value !== "UNKNOWN" ? perInferred.value : null);
          const contactPersonaStatus = record.standard.contactPersona ? "MANUAL" : (contactPersona ? "GUESSED" : null);
          const contactPersonaConfidence = record.standard.contactPersona ? 1.0 : (perInferred && perInferred.value !== "UNKNOWN" ? perInferred.confidence : null);

          toCreate.push({
            email: record.email,
            ...record.standard,
            hotelSegment,
            hotelSegmentStatus,
            hotelSegmentConfidence,
            contactPersona,
            contactPersonaStatus,
            contactPersonaConfidence,
            customFields: record.custom,
            source: "csv-import",
          });
          continue;
        }
        const merged = mergeForPolicy(
          {
            ...current,
            customFields: Object.fromEntries(
              Object.entries((current.customFields as Record<string, unknown>) ?? {}).map(([k, v]) => [k, String(v)])
            ),
          },
          record,
          policy
        );
        if (Object.keys(merged.standard).length === 0 && !merged.customFields) {
          unchanged++;
          continue;
        }
        await tx.contact.update({
          where: { id: current.id },
          data: { ...merged.standard, ...(merged.customFields ? { customFields: merged.customFields } : {}) },
        });
        updated++;
      }
      for (let i = 0; i < toCreate.length; i += 1000) {
        created += (await tx.contact.createMany({ data: toCreate.slice(i, i + 1000), skipDuplicates: true })).count;
      }

      if (list && emails.length) {
        const ids: string[] = [];
        for (let i = 0; i < emails.length; i += 1000) {
          const rows = await tx.contact.findMany({ where: { email: { in: emails.slice(i, i + 1000) } }, select: { id: true } });
          ids.push(...rows.map((r) => r.id));
        }
        for (let i = 0; i < ids.length; i += 1000) {
          addedToList += (
            await tx.listMembership.createMany({
              data: ids.slice(i, i + 1000).map((contactId) => ({ contactId, contactListId: list!.id })),
              skipDuplicates: true,
            })
          ).count;
        }
      }

      return tx.importBatch.create({
        data: {
          fileName: args.fileName.slice(0, 200),
          contactListId: list?.id,
          createdById: args.userId,
          duplicatePolicy: policy,
          totalRows: sheet.rows.length,
          created,
          updated,
          unchanged,
          skipped,
          errors,
        },
      });
    },
    { timeout: 120_000, maxWait: 10_000 }
  );

  return {
    id: result.id,
    fileName: result.fileName,
    totalRows: sheet.rows.length,
    created,
    updated,
    unchanged,
    skipped,
    addedToList,
    list,
    errors,
    suppressedInFile,
  };
}
