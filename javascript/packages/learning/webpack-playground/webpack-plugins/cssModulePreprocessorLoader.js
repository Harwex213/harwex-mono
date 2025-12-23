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

  overrideRoots.forEach((root) => {
    if (root) {
      this.addContextDependency(root);
    }
  });

  if (overrides.length === 0) {
    callback(null, cleanedBase);
    return;
  }

  const parts = [cleanedBase];

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

    parts.push(
      `/* injected override from ${override.path} */\n${cleanedOverride}`
    );
  });

  if (logEnabled) {
    this._compiler?.getInfrastructureLogger('CssModulePreprocessorPlugin')?.info(
      `Merged ${overrides.length} override(s) into ${baseId}`
    );
  }

  callback(null, parts.join('\n\n'));
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
