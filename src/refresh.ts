export function coalescedRefresh(task: () => Promise<void>) {
  let active: Promise<void> | null = null, dirty = false
  return () => {
    dirty = true
    if (!active) active = (async () => {
      while (dirty) { dirty = false; await task() }
    })().finally(() => { active = null })
    return active
  }
}
