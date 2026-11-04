// Engineer sections, keyed by a STABLE IDENTITY rather than by display name.
//
// The board's engineer columns used to be keyed by the raw "Assigned To"
// display name, so one person could render twice: once from the static roster
// ("Avery Example", empty) and once from the identity Azure DevOps actually
// returns ("Avery Example (AVERY)", with the work items).
//
// Identity rules (applied to EVERY engineer, no per-person special cases):
//   1. An assignee that carries an email/UPN is keyed by that address,
//      lower-cased and trimmed — the only truly stable identifier ADO gives us.
//   2. An assignee with no address (roster entries, or items whose Assigned To
//      has no email) is keyed by its NORMALIZED display name: lower-cased,
//      parenthetical suffixes like "(AVERY)" removed, punctuation collapsed.
//      If exactly one email was seen anywhere for that normalized name, the
//      entry folds into that email's identity, which is what merges the seeded
//      roster name with the live "(AVERY)" variant.
//   3. Two different addresses are never merged, so two real people who happen
//      to share a display name keep their own sections.
//
// Merging never loses work items: every item lands in its identity's bucket,
// and the section's label is the variant that actually owns work items (ties
// broken toward the longer, more specific display name).

import { compareByStackRank, type WorkItem } from "./work-items-data";

export interface EngineerSection {
  key: string; // stable identity key (email when known)
  name: string; // preferred display name for this person
  email: string | null; // identity used for the profile-photo lookup
  items: WorkItem[]; // every work item assigned to this identity
}

/** Lower-case, drop "(ALIAS)" suffixes, collapse punctuation/whitespace. */
export function normalizeIdentityName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Trimmed, lower-cased address, or null when the value isn't an address. */
export function normalizeIdentityEmail(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  return value.includes("@") ? value : null;
}

interface Group {
  key: string;
  order: number;
  email: string | null;
  items: WorkItem[];
  names: Map<string, number>; // display-name variant -> work items seen with it
}

export function buildEngineerSections(
  items: WorkItem[],
  roster: string[],
): EngineerSection[] {
  // Normalized display name -> every address seen for it in the live data.
  const emailsByName = new Map<string, Set<string>>();
  for (const it of items) {
    if (!it.assignee) continue;
    const name = normalizeIdentityName(it.assignee);
    const email = normalizeIdentityEmail(it.assigneeEmail);
    if (!name || !email) continue;
    const set = emailsByName.get(name) ?? new Set<string>();
    set.add(email);
    emailsByName.set(name, set);
  }

  const keyFor = (display: string, email: string | null): string => {
    if (email) return `id:${email}`;
    const name = normalizeIdentityName(display);
    const known = emailsByName.get(name);
    // Exactly one address for this name -> same person, fold them together.
    if (known && known.size === 1) return `id:${[...known][0]}`;
    return `name:${name || display.trim().toLowerCase()}`;
  };

  const groups = new Map<string, Group>();
  const ensure = (key: string, order: number): Group => {
    const existing = groups.get(key);
    if (existing) {
      if (order < existing.order) existing.order = order;
      return existing;
    }
    const created: Group = { key, order, email: null, items: [], names: new Map() };
    groups.set(key, created);
    return created;
  };

  // Seed the roster first so known engineers keep their board order (and still
  // get a section when they currently own nothing).
  roster.forEach((name, index) => {
    const group = ensure(keyFor(name, null), index);
    if (!group.names.has(name)) group.names.set(name, 0);
  });

  // Assignees returned by the query — anyone new sorts after the roster.
  const EXTRA_ORDER = roster.length;
  for (const it of items) {
    const display = it.assignee?.trim();
    if (!display) continue;
    const email = normalizeIdentityEmail(it.assigneeEmail);
    const group = ensure(keyFor(display, email), EXTRA_ORDER);
    group.items.push(it);
    group.names.set(display, (group.names.get(display) ?? 0) + 1);
    if (!group.email && email) group.email = email;
  }

  const sections = [...groups.values()].map((group) => {
    let name = "";
    let best = -1;
    for (const [variant, count] of group.names) {
      if (count > best || (count === best && variant.length > name.length)) {
        name = variant;
        best = count;
      }
    }
    return { group, name };
  });

  sections.sort(
    (a, b) => a.group.order - b.group.order || a.name.localeCompare(b.name),
  );

  // Each engineer's list renders in backlog (StackRank) order — re-sorted here
  // so an item dropped onto an engineer lands at its correct rank position in
  // the destination list, not at the end.
  return sections.map(({ group, name }) => ({
    key: group.key,
    name,
    email: group.email,
    items: [...group.items].sort(compareByStackRank),
  }));
}
