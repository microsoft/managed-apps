export function isUnassignedPersonName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized === "unassigned" || normalized.startsWith("unassigned /");
}
