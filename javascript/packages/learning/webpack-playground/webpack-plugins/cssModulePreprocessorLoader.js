const fs = require('fs');
const path = require('path');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = function cssModulePreprocessorLoader(source) {
  const callback = this.async();
  const options = this.getOptions();
  const baseMarker = options.baseMarker || '@css-base';
  const overrideMarker = options.overrideMarker || '@css-override';
  const extension = options.extension || '.module.css';
  const overrideIndex = options.overrideIndex || {};
  const overrideRoots = Array.isArray(options.overrideRoots)
    ? options.overrideRoots
    : [];
  const logEnabled = Boolean(options.log);

  const baseRegex = new RegExp(
    `/\\*\\s*${escapeRegExp(baseMarker)}\\s*:?\\s*([\\w./-]+)\\s*\\*/`
  );
  const match = source.match(baseRegex);

  if (!match) {
    callback(null, source);
    return;
  }

  const baseId = match[1].trim();
  const runtimeOverrideIndex =
    overrideRoots.length > 0
      ? buildOverrideIndexFromFs(overrideRoots, overrideMarker, extension)
      : {};

  const overrides =
    runtimeOverrideIndex[baseId] || overrideIndex[baseId] || [];
  const cleanedBase = source.replace(baseRegex, '').trim();
  const baseResourcePath = this.resourcePath;

  overrideRoots.forEach((root) => {
    if (root) {
      this.addContextDependency(root);
    }
  });

  if (overrides.length === 0) {
    callback(null, cleanedBase);
    return;
  }

  const { preamble: basePreamble, body: baseBody } =
    splitBaseCssPreamble(cleanedBase);
  const collectedImports = [];
  const injectedBodies = [];

  overrides.forEach((override) => {
    if (override.path) {
      this.addDependency(path.resolve(override.path));
    }
    const overrideContent = (override.content || '').trim();
    if (!overrideContent) {
      return;
    }

    const overrideRegex = new RegExp(
      `/\\*\\s*${escapeRegExp(overrideMarker)}\\s*:?\\s*${escapeRegExp(
        baseId
      )}\\s*\\*/`
    );
    const cleanedOverride = overrideContent.replace(overrideRegex, '').trim();

    const rewritten = rewriteRelativeRequests({
      css: cleanedOverride,
      fromFilePath: override.path,
      toFilePath: baseResourcePath,
    });

    const { imports, body } = extractTopLevelImports(rewritten);
    if (imports.length > 0) {
      collectedImports.push(
        `/* injected imports from ${override.path} */\n${imports.join('\n')}`
      );
    }
    if (body.trim()) {
      injectedBodies.push(
        `/* injected override from ${override.path} */\n${body.trim()}`
      );
    }
  });

  if (logEnabled) {
    this._compiler?.getInfrastructureLogger('CssModulePreprocessorPlugin')?.info(
      `Merged ${overrides.length} override(s) into ${baseId}`
    );
  }

  const outParts = [
    basePreamble,
    collectedImports.join('\n\n'),
    baseBody,
    injectedBodies.join('\n\n'),
  ].filter((p) => String(p || '').trim().length > 0);

  callback(null, outParts.join('\n\n'));
};

function buildOverrideIndexFromFs(roots, overrideMarker, extension) {
  const result = {};
  const overrideRegex = new RegExp(
    `/\\*\\s*${escapeRegExp(overrideMarker)}\\s*:?\\s*([\\w./-]+)\\s*\\*/`
  );

  const walk = (dirPath) => {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }
      const resolved = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        walk(resolved);
        continue;
      }
      if (!resolved.endsWith(extension)) {
        continue;
      }

      let content;
      try {
        content = fs.readFileSync(resolved, 'utf8');
      } catch {
        continue;
      }

      const match = content.match(overrideRegex);
      if (!match) {
        continue;
      }
      const overrideId = match[1].trim();
      const cleanedContent = content.replace(overrideRegex, '').trim();
      if (!result[overrideId]) {
        result[overrideId] = [];
      }
      result[overrideId].push({ path: resolved, content: cleanedContent });
    }
  };

  roots.forEach((root) => walk(root));
  return result;
}

function rewriteRelativeRequests({ css, fromFilePath, toFilePath }) {
  if (!css) return css;
  if (!fromFilePath || !toFilePath) return css;

  const fromDir = path.dirname(path.resolve(fromFilePath));
  const toDir = path.dirname(path.resolve(toFilePath));

  const rewriteRequest = (request) => {
    const value = String(request || '').trim();
    if (!value) return value;

    // Don't touch absolute/protocol/data/hash requests.
    if (
      value.startsWith('/') ||
      value.startsWith('#') ||
      value.startsWith('data:') ||
      /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value)
    ) {
      return value;
    }
    if (!(value.startsWith('./') || value.startsWith('../'))) {
      return value;
    }

    const abs = path.resolve(fromDir, value);
    let rel = path.relative(toDir, abs);
    if (!rel.startsWith('.')) rel = `./${rel}`;
    // css-loader expects POSIX-style separators in requests.
    return rel.split(path.sep).join('/');
  };

  // Rewrite url(...) paths.
  const urlRewritten = css.replace(
    /url\(\s*(?:'([^']*)'|"([^"]*)"|([^)\s][^)]*))\s*\)/g,
    (full, s1, s2, s3) => {
      const raw = (s1 ?? s2 ?? s3 ?? '').trim();
      const rewritten = rewriteRequest(raw);
      if (s1 != null) return `url('${rewritten}')`;
      if (s2 != null) return `url("${rewritten}")`;
      return `url(${rewritten})`;
    }
  );

  // Rewrite @import "..." / @import '...' (non-url(...) form).
  const importRewritten = urlRewritten.replace(
    /@import\s+(?:'([^']+)'|"([^"]+)")/g,
    (full, s1, s2) => {
      const raw = (s1 ?? s2 ?? '').trim();
      const rewritten = rewriteRequest(raw);
      if (s1 != null) return `@import '${rewritten}'`;
      return `@import "${rewritten}"`;
    }
  );

  return importRewritten;
}

function splitBaseCssPreamble(css) {
  const input = String(css || '');
  let i = 0;

  const consumeWsAndComments = () => {
    while (i < input.length) {
      const ch = input[i];
      if (/\s/.test(ch)) {
        i += 1;
        continue;
      }
      if (input.startsWith('/*', i)) {
        const end = input.indexOf('*/', i + 2);
        if (end === -1) {
          i = input.length;
          return;
        }
        i = end + 2;
        continue;
      }
      return;
    }
  };

  const readStatementToSemicolon = (start) => {
    let j = start;
    let inSingle = false;
    let inDouble = false;
    while (j < input.length) {
      const ch = input[j];
      if (!inDouble && ch === "'" && input[j - 1] !== '\\') {
        inSingle = !inSingle;
        j += 1;
        continue;
      }
      if (!inSingle && ch === '"' && input[j - 1] !== '\\') {
        inDouble = !inDouble;
        j += 1;
        continue;
      }
      if (!inSingle && !inDouble && ch === ';') {
        return j + 1;
      }
      j += 1;
    }
    return -1;
  };

  const preambleParts = [];

  consumeWsAndComments();
  while (i < input.length) {
    const start = i;
    if (input.startsWith('@charset', i) || input.startsWith('@import', i)) {
      const end = readStatementToSemicolon(i);
      if (end === -1) break;
      preambleParts.push(input.slice(start, end).trim());
      i = end;
      consumeWsAndComments();
      continue;
    }
    break;
  }

  if (preambleParts.length === 0) {
    return { preamble: '', body: input.trim() };
  }

  // Keep the original leading whitespace/comments by slicing from 0..i and rebuilding:
  // (we already trimmed statements; produce a clean preamble block).
  return {
    preamble: preambleParts.join('\n'),
    body: input.slice(i).trim(),
  };
}

function extractTopLevelImports(css) {
  const input = String(css || '');
  const imports = [];
  let out = '';

  let i = 0;
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inComment = false;

  const startsWithAtImport = () => input.startsWith('@import', i);

  while (i < input.length) {
    const ch = input[i];

    if (inComment) {
      if (input.startsWith('*/', i)) {
        inComment = false;
        out += '*/';
        i += 2;
      } else {
        out += ch;
        i += 1;
      }
      continue;
    }

    if (!inSingle && !inDouble && input.startsWith('/*', i)) {
      inComment = true;
      out += '/*';
      i += 2;
      continue;
    }

    if (!inDouble && ch === "'" && input[i - 1] !== '\\') {
      inSingle = !inSingle;
      out += ch;
      i += 1;
      continue;
    }
    if (!inSingle && ch === '"' && input[i - 1] !== '\\') {
      inDouble = !inDouble;
      out += ch;
      i += 1;
      continue;
    }

    if (!inSingle && !inDouble) {
      if (ch === '{') depth += 1;
      if (ch === '}') depth = Math.max(0, depth - 1);
    }

    if (!inSingle && !inDouble && !inComment && depth === 0 && startsWithAtImport()) {
      const start = i;
      i += '@import'.length;

      // Read until the next ';' at top-level, respecting simple quote/comment states.
      let innerSingle = false;
      let innerDouble = false;
      let innerComment = false;
      while (i < input.length) {
        if (innerComment) {
          if (input.startsWith('*/', i)) {
            innerComment = false;
            i += 2;
            continue;
          }
          i += 1;
          continue;
        }
        if (!innerSingle && !innerDouble && input.startsWith('/*', i)) {
          innerComment = true;
          i += 2;
          continue;
        }

        const c = input[i];
        if (!innerDouble && c === "'" && input[i - 1] !== '\\') {
          innerSingle = !innerSingle;
          i += 1;
          continue;
        }
        if (!innerSingle && c === '"' && input[i - 1] !== '\\') {
          innerDouble = !innerDouble;
          i += 1;
          continue;
        }
        if (!innerSingle && !innerDouble && c === ';') {
          i += 1;
          break;
        }
        i += 1;
      }

      const stmt = input.slice(start, i).trim();
      if (stmt) imports.push(stmt);
      continue; // don't copy stmt into out
    }

    out += ch;
    i += 1;
  }

  return { imports, body: out };
}
