const ALLOWED_SOURCES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['default-src', new Set(["'self'"])],
  ['script-src', new Set(["'self'"])],
  ['object-src', new Set(["'self'"])],
  ['style-src', new Set(["'self'", "'unsafe-inline'"])],
  ['img-src', new Set(["'self'", 'data:', 'chrome-extension:'])],
  ['font-src', new Set(["'self'"])],
  ['connect-src', new Set(["'none'"])],
  ['form-action', new Set(["'none'"])],
  ['base-uri', new Set(["'none'"])]
]);

export function findCspViolations(csp: string): string[] {
  const violations: string[] = [];
  const directives = new Map<string, Set<string>>();

  for (const directive of csp
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)) {
    const [rawName, ...sources] = directive.split(/\s+/);
    if (rawName === undefined) continue;

    const name = rawName.toLowerCase();
    const allowedSources = ALLOWED_SOURCES.get(name);
    if (allowedSources === undefined) {
      violations.push(`${rawName} (未登记指令)`);
      continue;
    }

    directives.set(name, new Set([...(directives.get(name) ?? []), ...sources]));
    for (const source of sources) {
      if (!allowedSources.has(source)) violations.push(`${rawName} ${source}`);
    }
  }

  for (const [name, requiredSources] of ALLOWED_SOURCES) {
    const actualSources = directives.get(name);
    if (actualSources === undefined) {
      violations.push(`${name} (缺少必需指令)`);
      continue;
    }
    for (const source of requiredSources) {
      if (!actualSources.has(source)) violations.push(`${name} ${source} (缺少必需来源)`);
    }
  }

  return violations;
}
