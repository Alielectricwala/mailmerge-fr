import { describe, it, expect } from "vitest";
import writeXlsxFile from "write-excel-file/node";
import {
  customFieldName,
  mergeForPolicy,
  parseSpreadsheet,
  parseWorkbook,
  planImport,
  rowToValues,
  selectSheet,
  suggestMapping,
  validateMapping,
  type ParsedSheet,
} from "./contact-import.js";
import { ALL_SHEETS } from "../../shared/types.js";

describe("parseSpreadsheet (CSV)", () => {
  it("handles BOM, quotes, semicolons and trailing empty rows", async () => {
    const csv = "﻿Email;First Name;Notes\na@x.com;Ana;\"likes; semicolons\"\n;;\n";
    const sheet = await parseSpreadsheet(Buffer.from(csv), "contacts.csv");
    expect(sheet.headers).toEqual(["Email", "First Name", "Notes"]);
    expect(sheet.rows).toEqual([["a@x.com", "Ana", "likes; semicolons"]]);
  });

  it("de-duplicates header names", async () => {
    const sheet = await parseSpreadsheet(Buffer.from("Email,Tag,Tag\na@x.com,1,2"), "f.csv");
    expect(sheet.headers).toEqual(["Email", "Tag", "Tag (2)"]);
  });

  it("rejects unsupported and empty files with a clear message", async () => {
    await expect(parseSpreadsheet(Buffer.from("x"), "f.pdf")).rejects.toThrow(/\.csv or \.xlsx/);
    await expect(parseSpreadsheet(Buffer.from("Email\n"), "f.csv")).rejects.toThrow(/only has a header/);
  });
});

describe("suggestMapping", () => {
  it("recognizes common headers and keeps the rest as custom fields", () => {
    expect(suggestMapping(["E-mail Address", "First name", "Surname", "Organisation", "Room Count"])).toEqual({
      "E-mail Address": "email",
      "First name": "firstName",
      Surname: "lastName",
      Organisation: "company",
      "Room Count": "custom:roomCount",
    });
  });

  it("prefers separate first/last columns over a combined name", () => {
    expect(suggestMapping(["Name", "First Name", "Email"]).Name).toBe("ignore");
  });

  it("correctly identifies hotel prospect columns including Public Email and Public Phone", () => {
    const headers = [
      "Hotel Name",
      "Star Category / Positioning",
      "Public Phone",
      "Public Email",
      "Website / Verification Link",
      "Why It May Fit Focus Realm",
    ];
    const mapping = suggestMapping(headers);
    expect(mapping["Public Email"]).toBe("email");
    expect(mapping["Public Phone"]).toBe("phone");
    expect(mapping["Hotel Name"]).toBe("company");
    expect(mapping["Star Category / Positioning"]).toBe("hotelSegment");
    expect(mapping["Website / Verification Link"]).toBe("custom:websiteVerificationLink");
  });
});

describe("validateMapping", () => {
  it("requires an email column and rejects duplicates for non-coalescable targets", () => {
    expect(() => validateMapping({ A: "firstName" }, ["A"])).toThrow(/email/);
    expect(() => validateMapping({ A: "email", B: "email" }, ["A", "B"])).toThrow(/same field/);
    expect(() => validateMapping({ A: "email", B: "custom:bad name" }, ["A", "B"])).toThrow(/valid destination/);
    expect(() => validateMapping({ A: "email", B: "custom:notes", C: "custom:notes" }, ["A", "B", "C"])).toThrow(/same field/);
  });

  it("permits coalescable fields like Company to receive multiple columns without error", () => {
    const valid = validateMapping(
      { "Hotel Name": "company", "Hotel / Group Name": "company", Email: "email" },
      ["Hotel Name", "Hotel / Group Name", "Email"]
    );
    expect(valid["Hotel Name"]).toBe("company");
    expect(valid["Hotel / Group Name"]).toBe("company");
  });
});

describe("parseWorkbook (multi-sheet .xlsx)", () => {
  async function workbook() {
    return writeXlsxFile([
      { sheet: "Goa", data: [["Email", "Hotel"], ["a@goa.in", "Sea View"], [null, null], ["b@goa.in", "Palms"]] },
      { sheet: "Empty", data: [["Email"]] },
      { sheet: "Pune", data: [["Hotel", "Email", "City"], ["Orchid", "c@pune.in", "Pune"]] },
    ]).toBuffer();
  }

  it("reads every sheet with data, keeping original row numbers", async () => {
    const sheets = await parseWorkbook(await workbook(), "hotels.xlsx");
    expect(sheets.map((s) => s.name)).toEqual(["Goa", "Pune"]);
    expect(sheets[0]).toMatchObject({ headers: ["Email", "Hotel"], rows: [["a@goa.in", "Sea View"], ["b@goa.in", "Palms"]], rowNumbers: [2, 4] });
  });

  it("selects one sheet, or combines all of them by column name", async () => {
    const sheets = await parseWorkbook(await workbook(), "hotels.xlsx");
    expect(selectSheet(sheets).rows).toHaveLength(2);
    expect(selectSheet(sheets, "Pune").rows).toEqual([["Orchid", "c@pune.in", "Pune"]]);
    const all = selectSheet(sheets, ALL_SHEETS);
    expect(all.headers).toEqual(["Email", "Hotel", "City"]);
    expect(all.rows).toEqual([
      ["a@goa.in", "Sea View", ""],
      ["b@goa.in", "Palms", ""],
      ["c@pune.in", "Orchid", "Pune"],
    ]);
    expect(all.refs).toEqual([
      { sheet: "Goa", row: 2 },
      { sheet: "Goa", row: 4 },
      { sheet: "Pune", row: 2 },
    ]);
    expect(() => selectSheet(sheets, "Delhi")).toThrow(/no sheet called "Delhi"/);
  });

  it("unifies synonymous headers like Hotel Name and Hotel / Group Name across sheets", async () => {
    const multiSheetBuffer = await writeXlsxFile([
      { sheet: "North", data: [["Hotel Name", "Public Email"], ["Taj Mahal", "taj@hotel.test"]] },
      { sheet: "South", data: [["Hotel / Group Name", "Public Email"], ["Oberoi Group", "oberoi@hotel.test"]] },
    ]).toBuffer();

    const sheets = await parseWorkbook(multiSheetBuffer, "growing_hotels.xlsx");
    const combined = selectSheet(sheets, ALL_SHEETS);

    // Both sheets should align to the canonical "Hotel Name" column without creating a duplicate column
    expect(combined.headers).toEqual(["Hotel Name", "Public Email"]);
    expect(combined.rows).toEqual([
      ["Taj Mahal", "taj@hotel.test"],
      ["Oberoi Group", "oberoi@hotel.test"],
    ]);
  });
});

describe("rowToValues", () => {
  const headers = ["Email", "Name", "City"];
  const mapping = { Email: "email", Name: "fullName", City: "custom:city" } as const;

  it("normalises email, splits full name and keeps custom fields", () => {
    expect(rowToValues([" Ana@X.com ", "Ana Maria Li", "Pune"], headers, mapping)).toEqual({
      rawEmail: "Ana@X.com",
      emails: ["ana@x.com"],
      hadExtraText: false,
      standard: { firstName: "Ana", lastName: "Maria Li" },
      custom: { city: "Pune" },
    });
  });

  it("finds every address in a cell and reports when nothing usable is there", () => {
    expect(rowToValues(["a@x.com; b@y.com", "Ana", ""], headers, mapping).emails).toEqual(["a@x.com", "b@y.com"]);
    expect(rowToValues(["", "Ana", ""], headers, mapping)).toMatchObject({ rawEmail: "", emails: [] });
    expect(rowToValues(["nope", "Ana", ""], headers, mapping)).toMatchObject({ rawEmail: "nope", emails: [] });
  });

  it("coalesces values when multiple columns map to the same target like company", () => {
    const coalesceHeaders = ["Email", "Hotel Name", "Hotel / Group Name"];
    const coalesceMapping = { Email: "email", "Hotel Name": "company", "Hotel / Group Name": "company" } as const;

    // Row 1: Hotel Name populated, Group Name empty
    const r1 = rowToValues(["a@hotel.com", "Grand Palace", ""], coalesceHeaders, coalesceMapping);
    expect(r1.standard.company).toBe("Grand Palace");

    // Row 2: Hotel Name empty, Group Name populated
    const r2 = rowToValues(["b@hotel.com", "", "Oberoi Group"], coalesceHeaders, coalesceMapping);
    expect(r2.standard.company).toBe("Oberoi Group");
  });
});

describe("planImport", () => {
  const sheet = (rows: string[][]): ParsedSheet => ({
    headers: ["Email", "Company"],
    rows,
    refs: rows.map((_, i) => ({ sheet: "CSV", row: i + 2 })),
  });
  const mapping = { Email: "email", Company: "company" } as const;
  const rows = [
    ["a@x.com, b@x.com", "Acme"],
    ["Front desk: c@x.com", "Bay"],
    ["john at gmail dot com", "Gull"],
    ["N/A", "Nope"],
    ["A@X.COM", "Dupe"],
  ];

  it("splits multi-address cells, cleans junk, and lists rows that need a person", () => {
    const { analysis, records } = planImport(sheet(rows), mapping, "each", {});
    expect([...records.keys()]).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
    expect(analysis).toMatchObject({ totalRows: 5, contacts: 3, multiEmailRows: 1, cleanedRows: 1, duplicatesInFile: 1, problemCount: 2, fixedRows: 0 });
    expect(analysis.problems).toEqual([
      { kind: "invalid", ref: "CSV!4", sheet: "CSV", row: 4, raw: "john at gmail dot com", suggestion: "john@gmail.com", context: "Gull", message: "No valid email address in this cell" },
      { kind: "invalid", ref: "CSV!5", sheet: "CSV", row: 5, raw: "N/A", suggestion: null, context: "Nope", message: "No valid email address in this cell" },
    ]);
  });

  it("flags likely provider typos without blocking them", () => {
    const plan = planImport(sheet([["lotus@gmial.com", "Lotus"]]), mapping, "each", {});
    expect(plan.records.has("lotus@gmial.com")).toBe(true);
    expect(plan.analysis).toMatchObject({ typoCount: 1, problemCount: 0 });
    expect(plan.analysis.problems[0]).toMatchObject({ kind: "typo", ref: "CSV!2", suggestion: "lotus@gmail.com" });

    const corrected = planImport(sheet([["lotus@gmial.com", "Lotus"]]), mapping, "each", { "CSV!2": "lotus@gmail.com" });
    expect([...corrected.records.keys()]).toEqual(["lotus@gmail.com"]);
    expect(corrected.analysis).toMatchObject({ typoCount: 0, fixedRows: 1, problems: [] });
  });

  it("keeps only the first address when asked", () => {
    expect([...planImport(sheet(rows), mapping, "first", {}).records.keys()]).toEqual(["a@x.com", "c@x.com"]);
  });

  it("applies corrections, honours skips, and keeps invalid corrections as problems", () => {
    const plan = planImport(sheet(rows), mapping, "each", { "CSV!4": "john@gmail.com", "CSV!5": "", "CSV!3": "still wrong" });
    expect(plan.records.get("john@gmail.com")).toEqual({ email: "john@gmail.com", standard: { company: "Gull" }, custom: {} });
    expect(plan.records.has("c@x.com")).toBe(true); // an invalid correction never discards the address already found
    expect(plan.analysis).toMatchObject({ fixedRows: 1, skippedRows: 1, problemCount: 0, contacts: 4 });
    expect(plan.errors).toEqual([{ row: 5, message: "Skipped during review" }]);

    const retry = planImport(sheet(rows), mapping, "each", { "CSV!5": "nope@" });
    expect(retry.analysis.problems.find((p) => p.ref === "CSV!5")).toMatchObject({ message: '"nope@" isn\'t a valid email address', suggestion: null });
  });
});

describe("mergeForPolicy", () => {
  const existing = { firstName: "Ana", lastName: null, company: "Old Co", title: null, phone: null, customFields: { city: "Pune" } };
  const incoming = { email: "a@x.com", standard: { firstName: "Anna", lastName: "Li", company: "New Co" }, custom: { city: "Goa", tier: "A" } };

  it("skip changes nothing", () => {
    expect(mergeForPolicy(existing, incoming, "skip")).toEqual({ standard: {} });
  });

  it("fill_empty only fills blanks", () => {
    expect(mergeForPolicy(existing, incoming, "fill_empty")).toEqual({ standard: { lastName: "Li" }, customFields: { city: "Pune", tier: "A" } });
  });

  it("overwrite replaces differing values", () => {
    expect(mergeForPolicy(existing, incoming, "overwrite")).toEqual({
      standard: { firstName: "Anna", lastName: "Li", company: "New Co" },
      customFields: { city: "Goa", tier: "A" },
    });
  });
});

describe("customFieldName", () => {
  it("builds valid camelCase names", () => {
    expect(customFieldName("Room count (approx)")).toBe("roomCountApprox");
    expect(customFieldName("2024 revenue")).toBe("f2024Revenue");
  });
});
