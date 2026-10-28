/** A background refresh can replace an untouched draft, but never discard local edits. */
export function mergeAutomaticDraft<T>(current:T,previousServerKey:string,nextServerKey:string):T {
  return JSON.stringify(current)===previousServerKey?JSON.parse(nextServerKey) as T:current
}
