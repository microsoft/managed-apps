import { describe, expect, it } from "vitest";
import { isAdminUser, parseAdmins } from "@/lib/admins";

const user = (userPrincipalName: string | null, mail: string | null = null) => ({ userPrincipalName, mail });

describe("admins", () => {
  it("matches UPN or mail case-insensitively", () => {
    const admins = parseAdmins({ admins: [" Avery@Contoso.example "] });
    expect(isAdminUser(user("avery@contoso.example"), admins)).toBe(true);
    expect(isAdminUser(user("other@contoso.example", "AVERY@contoso.example"), admins)).toBe(true);
    expect(isAdminUser(user("jordan@contoso.example"), admins)).toBe(false);
    expect(isAdminUser(null, admins)).toBe(false);
  });

  it("treats an empty list as nobody", () => {
    expect(isAdminUser(user("avery@contoso.example"), parseAdmins({ admins: [] }))).toBe(false);
  });

  it("treats an invalid file as nobody", () => {
    expect(parseAdmins({ admins: "avery@contoso.example" }).size).toBe(0);
    expect(parseAdmins(null).size).toBe(0);
    expect(isAdminUser(user("avery@contoso.example"), parseAdmins({ nope: [] }))).toBe(false);
  });

});
