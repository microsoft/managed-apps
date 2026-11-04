import { describe, expect, it, vi } from "vitest";
import { safeUrl } from "@/lib/safe-url";
import { renderEtaMessage, requestWorkItemEta } from "@/lib/teams";
import { adoWriteIdentity, toCurrentUser } from "@/lib/current-user";
import { buildEngineerSections } from "@/lib/engineer-identity";
import { toPhotoDataUrl } from "@/lib/people-photos";
import { buildChartStyle, sanitizeCssColor } from "@/components/ui/chart";
import type { WorkItem } from "@/lib/work-items-data";
import { fakeConnectors } from "@/test/fake-connectors";

describe("safeUrl", () => {
  it("allows http(s), mailto and relative links", () => {
    expect(safeUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeUrl("mailto:team@contoso.example")).toBe("mailto:team@contoso.example");
    expect(safeUrl("?tab=board")).toBe("?tab=board");
    expect(safeUrl("/path")).toBe("/path");
  });

  it("rejects script and data URLs and blank values", () => {
    expect(safeUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeUrl(" JaVaScRiPt:alert(1)")).toBeUndefined();
    expect(safeUrl("data:text/html,<script>")).toBeUndefined();
    expect(safeUrl("vbscript:x")).toBeUndefined();
    expect(safeUrl("")).toBeUndefined();
    expect(safeUrl(null)).toBeUndefined();
  });
});

describe("chart style sanitization", () => {
  it("emits CSS variables for safe colours", () => {
    const css = buildChartStyle("chart-1", { done: { color: "#00aa00" }, open: { theme: { light: "hsl(10 50% 50%)", dark: "var(--x)" } } });
    expect(css).toContain("--color-done: #00aa00;");
    expect(css).toContain("--color-open: hsl(10 50% 50%);");
    expect(css).toContain(".dark [data-chart=chart-1]");
  });

  it("drops values and keys that could break out of the style element", () => {
    const css = buildChartStyle("chart-1", {
      evil: { color: "red;}</style><script>alert(1)</script>" },
      "bad}key": { color: "#fff" },
      ok: { color: "blue" },
    });
    expect(css).not.toMatch(/[<>]/);
    expect(css).not.toContain("bad}key");
    expect(css).not.toContain("--color-evil");
    expect(css).toContain("--color-ok: blue;");
    expect(buildChartStyle("x}{", { ok: { color: "blue" } })).toBe("");
    expect(sanitizeCssColor("url(javascript:alert(1))")).toBeNull();
    expect(sanitizeCssColor("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
  });
});

describe("work item identity mapping", () => {
  it("writes the UPN to Azure DevOps, falling back to mail", () => {
    const user = toCurrentUser({ id: "1", displayName: " Avery ", mail: "avery.example@contoso.example", userPrincipalName: "avery@contoso.example" });
    expect(user).toMatchObject({ displayName: "Avery", email: "avery.example@contoso.example" });
    expect(adoWriteIdentity(user)).toBe("avery@contoso.example");
    expect(adoWriteIdentity(toCurrentUser({ displayName: "Jordan", mail: "jordan@contoso.example" }))).toBe("jordan@contoso.example");
    expect(toCurrentUser({ displayName: "  " })).toBeNull();
    expect(adoWriteIdentity(null)).toBeNull();
  });

  it("folds roster names and alias variants into one engineer per identity", () => {
    const item = (id: string, assignee: string, assigneeEmail: string | null): WorkItem => ({
      id,
      title: id,
      area: "Frontend",
      assignee,
      assigneeEmail,
      description: "",
      state: "Active",
    });
    const sections = buildEngineerSections(
      [
        item("#1", "Avery Example (AVERY)", "Avery@Contoso.example"),
        item("#2", "Avery Example", null),
        item("#3", "Sam Sample", "sam@contoso.example"),
        item("#4", "Sam Sample", "sam.other@contoso.example"),
      ],
      ["Avery Example", "Riley Roster"],
    );
    const avery = sections.find((s) => s.email === "avery@contoso.example")!;
    expect(avery.items.map((i) => i.id).sort()).toEqual(["#1", "#2"]);
    expect(sections.find((s) => s.name === "Riley Roster")?.items).toEqual([]);
    expect(sections.filter((s) => s.name === "Sam Sample")).toHaveLength(2);
  });
});

describe("Teams ETA request", () => {
  const request = {
    recipient: "avery@contoso.example",
    assigneeName: "Avery <b>",
    requesterName: "Jordan & Co",
    workItemId: "42",
    workItemTitle: "Fix \"it\"",
    workItemUrl: "https://apps.example.com/task-manager?tab=board&workItem=42",
  };

  it("renders the template with every value escaped", () => {
    const html = renderEtaMessage("Hi {assignee} — {requester} asks about {link} <script>", request);
    expect(html).toContain("Hi Avery &lt;b&gt;");
    expect(html).toContain("Jordan &amp; Co");
    expect(html).toContain('<a href="https://apps.example.com/task-manager?tab=board&amp;workItem=42">42: Fix &quot;it&quot;</a>');
    expect(html).toContain("&lt;script&gt;");
  });

  it("refuses non-https links", () => {
    expect(() => renderEtaMessage("{link}", { ...request, workItemUrl: "javascript:alert(1)" })).toThrow();
  });

  it("posts through the Teams adapter and surfaces failures", async () => {
    const post = vi.fn().mockResolvedValue({ success: true });
    fakeConnectors({ teams: { postChatMessage: post } });
    await requestWorkItemEta(request, "{link}");
    expect(post).toHaveBeenCalledWith("avery@contoso.example", expect.stringContaining("workItem=42"));

    fakeConnectors({ teams: { postChatMessage: vi.fn().mockResolvedValue({ success: false, error: { message: "Bot blocked" } }) } });
    await expect(requestWorkItemEta(request, "{link}")).rejects.toThrow("Bot blocked");
    await expect(requestWorkItemEta({ ...request, recipient: "" })).rejects.toThrow(/address/);
  });
});

describe("profile photos", () => {
  it("accepts only image data", () => {
    const b64 = "A".repeat(80);
    expect(toPhotoDataUrl(b64, "image/png")).toBe(`data:image/png;base64,${b64}`);
    expect(toPhotoDataUrl(b64, "text/html")).toBe(`data:image/jpeg;base64,${b64}`);
    expect(toPhotoDataUrl("data:text/html;base64,AAAA")).toBeNull();
    expect(toPhotoDataUrl("<svg onload=alert(1)>")).toBeNull();
    expect(toPhotoDataUrl(42)).toBeNull();
  });
});
