/** Parse a comma/space separated id list (from --id "1, 2 3"). */
export function parseIds(raw: string | undefined): string[] {
  if (!raw) return []
  return raw.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
}

/** Google returns keyword/ad ids as `adGroupId~childId`; that's what mutate wants back. */
export function assertComposite(id: string): string {
  if (!/^\d+~\d+$/.test(id)) {
    throw new Error(`"${id}" is not a valid id — expected adGroupId~criterionId (copy the id column from the list command)`)
  }
  return id
}
