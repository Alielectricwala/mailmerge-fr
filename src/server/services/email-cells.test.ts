import { describe, it, expect } from "vitest";
import { extractEmails, likelyTypo, suggestEmailFix } from "./email-cells.js";

describe("extractEmails", () => {
  it("splits on commas, semicolons, slashes, pipes and new lines", () => {
    expect(extractEmails("a@x.com, B@Y.com; c@z.co.in / d@w.io | e@v.org\nf@u.net").emails).toEqual([
      "a@x.com",
      "b@y.com",
      "c@z.co.in",
      "d@w.io",
      "e@v.org",
      "f@u.net",
    ]);
  });

  it("splits addresses joined without spaces", () => {
    expect(extractEmails("a@x.com/b@y.com|c@z.com").emails).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
  });

  it("drops non-email text and reports that something was cleaned", () => {
    expect(extractEmails("Work: priya.nair@seaside.in (primary)")).toEqual({ emails: ["priya.nair@seaside.in"], hadExtraText: true });
    expect(extractEmails("mailto:sam@hotel.com")).toEqual({ emails: ["sam@hotel.com"], hadExtraText: false });
    expect(extractEmails("Priya Nair <priya@seaside.in>").emails).toEqual(["priya@seaside.in"]);
  });

  it("de-duplicates and returns nothing for junk", () => {
    expect(extractEmails("a@x.com; A@X.COM").emails).toEqual(["a@x.com"]);
    expect(extractEmails("N/A").emails).toEqual([]);
    expect(extractEmails("john at gmail dot com").emails).toEqual([]);
  });
});

describe("suggestEmailFix", () => {
  it("repairs common spelling-out and punctuation slips", () => {
    expect(suggestEmailFix("john (at) gmail (dot) com")).toBe("john@gmail.com");
    expect(suggestEmailFix("john at gmail dot com")).toBe("john@gmail.com");
    expect(suggestEmailFix("john@gmail,com")).toBe("john@gmail.com");
    expect(suggestEmailFix("john @ hotel.com")).toBe("john@hotel.com");
    expect(suggestEmailFix("john@@hotel..com")).toBe("john@hotel.com");
  });

  it("fixes well-known provider typos and missing .com", () => {
    expect(suggestEmailFix("priya@gmial.com")).toBe("priya@gmail.com");
    expect(suggestEmailFix("priya@gmail")).toBe("priya@gmail.com");
  });

  it("gives no suggestion when there's nothing confident to offer", () => {
    expect(suggestEmailFix("N/A")).toBeNull();
    expect(suggestEmailFix("Front office")).toBeNull();
    expect(suggestEmailFix("a@b@c.com")).toBeNull();
    expect(suggestEmailFix("")).toBeNull();
  });
});

describe("likelyTypo", () => {
  it("flags misspelt providers only", () => {
    expect(likelyTypo("Lotus@Gmial.com")).toBe("lotus@gmail.com");
    expect(likelyTypo("sam@hotmail.con")).toBe("sam@hotmail.com");
    expect(likelyTypo("sam@gmail.com")).toBeNull();
    expect(likelyTypo("gm@seaview.in")).toBeNull();
  });
});
