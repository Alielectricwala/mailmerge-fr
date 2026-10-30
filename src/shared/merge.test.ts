import { describe, it, expect } from "vitest";
import { contactMergeData, extractMergeFields, htmlToText, isPlainTextTemplate, plainTextToHtml, renderEmail, validateTemplate } from "./merge.js";

describe("extractMergeFields", () => {
  it("finds fields with and without fallbacks across all parts", () => {
    const fields = extractMergeFields({
      subject: "Hi {{firstName|there}}",
      bodyHtml: "<p>{{company}} and {{ firstName | friend }}</p>",
      bodyText: "{{title}}",
    });
    expect(fields).toEqual([
      { name: "firstName", fallback: "there", required: false },
      { name: "company", fallback: undefined, required: true },
      { name: "title", fallback: undefined, required: true },
    ]);
  });

  it("marks a field required if any use lacks a fallback", () => {
    const [f] = extractMergeFields({ subject: "{{firstName|there}}", bodyHtml: "{{firstName}}" });
    expect(f!.required).toBe(true);
  });
});

describe("validateTemplate", () => {
  it("accepts several separate fields", () => {
    expect(validateTemplate({ subject: "Hi {{firstName}} at {{company}}", bodyHtml: "<p>{{title|there}}</p>" })).toEqual([]);
  });

  it("rejects nesting, unbalanced braces, bad names and empty parts", () => {
    expect(validateTemplate({ subject: "{{a{{b}}}}", bodyHtml: "x" })[0]).toMatch(/nested/);
    expect(validateTemplate({ subject: "Hi {{firstName", bodyHtml: "x" })[0]).toMatch(/closing/);
    expect(validateTemplate({ subject: "Hi {{first name}}", bodyHtml: "x" })[0]).toMatch(/valid field name/);
    expect(validateTemplate({ subject: " ", bodyHtml: "" })).toEqual(["Subject is empty.", "Email body is empty."]);
  });
});

describe("renderEmail", () => {
  it("fills values, applies fallbacks and reports missing required fields", () => {
    const r = renderEmail(
      { subject: "Hi {{firstName|there}}", bodyHtml: "<p>{{company}}</p>" },
      { firstName: "", company: undefined }
    );
    expect(r.subject).toBe("Hi there");
    expect(r.html).toBe("<p></p>");
    expect(r.missingFields).toEqual(["company"]);
  });

  it("escapes HTML in values but not in the template", () => {
    const r = renderEmail({ subject: "x", bodyHtml: "<b>{{company}}</b>" }, { company: `<script>"A&B"</script>` });
    expect(r.html).toBe("<b>&lt;script&gt;&quot;A&amp;B&quot;&lt;/script&gt;</b>");
  });

  it("removes line breaks from subject values (header safety)", () => {
    expect(renderEmail({ subject: "Hi {{firstName}}", bodyHtml: "x" }, { firstName: "A\r\nBcc: x@y.z" }).subject).toBe("Hi A Bcc: x@y.z");
  });

  it("derives the text version from HTML when no text body is written", () => {
    const r = renderEmail({ subject: "s", bodyHtml: "<p>Hello {{firstName}}</p><p>Visit <a href=\"https://x.io\">our site</a></p>" }, { firstName: "Ana" });
    expect(r.text).toBe("Hello Ana\nVisit our site (https://x.io)");
  });

  it("supports chained fallbacks like {{firstName|company|Hospitality Team}}", () => {
    const template = {
      subject: "Hello {{firstName|company|Hospitality Team}}",
      bodyHtml: "<p>Dear {{firstName|company|Hospitality Team}}, welcome.</p>",
    };

    // 1. When firstName is present, uses firstName
    const r1 = renderEmail(template, { firstName: "Rajesh", company: "HTI India" });
    expect(r1.subject).toBe("Hello Rajesh");
    expect(r1.html).toBe("<p>Dear Rajesh, welcome.</p>");

    // 2. When firstName is empty, uses company
    const r2 = renderEmail(template, { firstName: "", company: "HTI India" });
    expect(r2.subject).toBe("Hello HTI India");
    expect(r2.html).toBe("<p>Dear HTI India, welcome.</p>");

    // 3. When both are empty, uses the literal fallback
    const r3 = renderEmail(template, { firstName: "", company: "" });
    expect(r3.subject).toBe("Hello Hospitality Team");
    expect(r3.html).toBe("<p>Dear Hospitality Team, welcome.</p>");
    expect(r3.missingFields).toEqual([]);
  });
});

describe("contactMergeData", () => {
  it("flattens custom fields and derives fullName", () => {
    const data = contactMergeData({ email: "a@b.co", firstName: "Ana", lastName: "Li", customFields: { city: "Pune", email: "ignored" } });
    expect(data).toMatchObject({ email: "a@b.co", fullName: "Ana Li", city: "Pune" });
  });
});

describe("plainTextToHtml", () => {
  it("builds paragraphs and links, and leaves merge tokens intact", () => {
    const html = plainTextToHtml("Hi {{firstName|you & yours}},\nquick note.\n\nSee https://focusrealm.com/a?b=1.");
    expect(html).toBe('<p>Hi {{firstName|you & yours}},<br>quick note.</p>\n<p>See <a href="https://focusrealm.com/a?b=1">https://focusrealm.com/a?b=1</a>.</p>');
    expect(isPlainTextTemplate({ subject: "s", bodyHtml: html, bodyText: "Hi {{firstName|you & yours}},\nquick note.\n\nSee https://focusrealm.com/a?b=1." })).toBe(true);
  });

  it("escapes HTML typed into plain text", () => {
    expect(plainTextToHtml("a <b> c")).toBe("<p>a &lt;b&gt; c</p>");
  });
});

describe("htmlToText", () => {
  it("drops scripts and decodes entities", () => {
    expect(htmlToText("<style>p{}</style><p>A &amp; B</p>")).toBe("A & B");
  });
});
