const fs = require('fs');
const path = require('path');
const { NormalModule } = require('webpack');

const pluginName = 'CssModulePreprocessorPlugin';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class CssModulePreprocessorPlugin {
  constructor(options = {}) {
    this.options = {
      extension: '.module.css',
      baseMarker: '@css-base',
      overrideMarker: '@css-override',
      overrideRoots: [],
      log: false,
      ...options,
    };
  }

  apply(compiler) {
    compiler.hooks.thisCompilation.tap(pluginName, (compilation) => {
      const logger = compilation.getLogger(pluginName);
      const context = compiler.options.context || process.cwd();
      const rootsFromOptions = Array.isArray(this.options.overrideRoots)
        ? this.options.overrideRoots
        : [];
      const defaultRoots = [
        path.resolve(context, 'src/themes'),
        path.resolve(context, 'src'),
      ];
      const overrideRoots = (rootsFromOptions.length ? rootsFromOptions : defaultRoots)
        .map((rootPath) => path.resolve(rootPath))
        .filter((rootPath) => fs.existsSync(rootPath));

      const overrideIndex = this.buildOverrideIndex({
        roots: overrideRoots,
        logger,
      });

      NormalModule.getCompilationHooks(compilation).loader.tap(
        pluginName,
        (loaderContext, module) => {
          if (!module.resource || !module.resource.endsWith(this.options.extension)) {
            return;
          }

          module.loaders.push({
            loader: path.join(__dirname, 'cssModulePreprocessorLoader.js'),
            options: {
              baseMarker: this.options.baseMarker,
              overrideMarker: this.options.overrideMarker,
              extension: this.options.extension,
              overrideIndex,
              overrideRoots,
              log: this.options.log,
            },
          });
        }
      );
    });
  }

  buildOverrideIndex({ roots, logger }) {
    const overrideIndex = {};
    const overrideRegex = new RegExp(
      `/\\*\\s*${escapeRegExp(this.options.overrideMarker)}\\s*:?\\s*([\\w./-]+)\\s*\\*/`
    );

    const visitFile = (filePath) => {
      if (!filePath.endsWith(this.options.extension)) {
        return;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const match = content.match(overrideRegex);
      if (!match) {
        return;
      }

      const overrideId = match[1].trim();
      const cleanedContent = content.replace(overrideRegex, '').trim();
      if (!overrideIndex[overrideId]) {
        overrideIndex[overrideId] = [];
      }
      overrideIndex[overrideId].push({ path: filePath, content: cleanedContent });
    };

    const walk = (dirPath) => {
      let entries;
      try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch (error) {
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
        visitFile(resolved);
      }
    };

    roots.forEach((rootPath) => walk(rootPath));

    if (this.options.log) {
      logger.info(
        `${pluginName}: found ${Object.keys(overrideIndex).length} override group(s)`
      );
    }

    return overrideIndex;
  }
}

module.exports = CssModulePreprocessorPlugin;
