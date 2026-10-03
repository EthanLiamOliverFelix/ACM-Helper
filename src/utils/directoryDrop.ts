interface DirectoryEntry { path: string; isDirectory: boolean }

/** Return the receiving folder; invalid and unchanged moves have no preview. */
export function directoryDropTarget(source: DirectoryEntry, target: DirectoryEntry | null, rootPath: string, allowUnchanged = false): string | undefined {
  const parent = (path: string) => path.slice(0, Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')))
  const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const destination = target ? target.isDirectory ? target.path : parent(target.path) : rootPath
  const from = normalize(source.path)
  const to = normalize(destination)
  if (!to || to === from || (!allowUnchanged && to === normalize(parent(source.path))) || (source.isDirectory && to.startsWith(`${from}/`))) return undefined
  return destination
}

export function batchDirectoryDropTarget(sources: DirectoryEntry[], target: DirectoryEntry | null, rootPath: string): string | undefined {
  const destinations = sources.map(source => directoryDropTarget(source, target, rootPath, true))
  if (!sources.length || destinations.some(destination => !destination || destination !== destinations[0])) return undefined
  if (!sources.some(source => directoryDropTarget(source, target, rootPath))) return undefined
  return destinations[0]
}
