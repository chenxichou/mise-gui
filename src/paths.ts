// mise prints the same file with mixed separators and case
// (`C:\Users\example\.config/mise\config.toml`), so no two paths in this app may be
// compared with `===`. The main process folds the same way in electron/pins.ts.
export function pathKey(p: string): string {
  return p.replace(/[\\/]/g, '\\').toLowerCase()
}
