import type { FileSystemAPI } from "./file-system.js";
import { defaultFileSystem } from "./file-system.js";
import { FileTraverser } from "./file-traverser.js";
import { TypeScriptParser } from "./parser.js";
import type { ExportsMap, UsageStatistics } from "./types.js";

export class UsageAnalyzer {
  constructor(private fs: FileSystemAPI = defaultFileSystem) {
  }

  async analyzeUsage(sourcePath: string, exportsMap: ExportsMap): Promise<UsageStatistics> {
    const traverser = new FileTraverser(this.fs);
    const files = await traverser.findTypeScriptFiles(sourcePath);

    console.log(`analyzeUsage: found ${files.length} files`);

    const usageStatistics: UsageStatistics = {};

    // Initialize statistics for all exports
    for (const [exportName, exportInfos] of Object.entries(exportsMap)) {
      for (const exportInfo of exportInfos) {
        const key = `${exportName}:${exportInfo.filePath}`;
        usageStatistics[key] = {
          exportInfo,
          usageCount: 0,
          usageLocations: [],
        };
      }
    }

    // Analyze imports in each file
    for (const filePath of files) {
      try {
        const content = await this.fs.readFile(filePath);
        const parser = new TypeScriptParser(filePath, content);
        const imports = parser.extractImports();

        for (const importInfo of imports) {
          // Try to match this import with available exports
          const matchingExports = this.findMatchingExports(importInfo, exportsMap, sourcePath);

          for (const exportInfo of matchingExports) {
            const key = `${exportInfo.name}:${exportInfo.filePath}`;
            if (usageStatistics[key]) {
              usageStatistics[key].usageCount++;
              usageStatistics[key].usageLocations.push(filePath);
            }
          }
        }
      } catch (error) {
        console.warn(`Warning: Could not parse file ${filePath}:`, error);
      }
    }

    return usageStatistics;
  }

  async saveUsageStatistics(statistics: UsageStatistics, outputPath: string): Promise<void> {
    const jsonContent = JSON.stringify(statistics, null, 2);
    await this.fs.writeFile(outputPath, jsonContent);
  }

  private findMatchingExports(importInfo: any, exportsMap: ExportsMap, sourcePath: string): any[] {
    const matchingExports = [];

    // Look for exports with matching name
    const exportCandidates = exportsMap[importInfo.name] || [];

    for (const exportInfo of exportCandidates) {
      if (this.isLikelyMatch(importInfo, exportInfo, sourcePath)) {
        matchingExports.push(exportInfo);
      }
    }

    return matchingExports;
  }

  private isLikelyMatch(importInfo: any, exportInfo: any, sourcePath: string): boolean {
    return true;

    /**
     *  TODO: HOUSTON WE HAVE A PROBLEM
     *
     *  `exportInfo.filePath` currently bounds to absolute path of file in which export is located. That leads to bug,
     *  because in import we don't use absolute and rather on either relative or library import. If relative import is
     *  understandable, then the library import have several issues.
     *
     *  First of all, we should found in which package export is located. Then we should account into `exports` property inside
     *  `package.json` to figure out what actual import would be. For example, if `package.json` have smth like that:
     *
     *  ```json
     *  {
     *    "name": "@sb/playerui-core",
     *    "exports": {
     *      "./*": "./src/*.ts"
     *    }
     *  }
     *  ```
     *
     *  Then if we considering file located at `./src/Sportsbookui/Store/Coupon/State.ts`, it's `filePath` will be
     *  `@sb/playerui-core/Sportsbookui/Store/Coupon/State`
     */

    // Simple matching logic - can be improved
    if (importInfo.type !== exportInfo.type) {
      return false;
    }

    // If it's a relative import, try to resolve it
    if (importInfo.source.startsWith(".")) {
      // Simple resolution logic - in real implementation, you'd want proper path resolution
      const importerDir = this.fs.join(importInfo.filePath, "..");
      const resolvedPath = this.fs.join(importerDir, importInfo.source);

      return exportInfo.filePath.includes(resolvedPath.replace(/\.(ts|tsx)$/, ""));
    }

    // For non-relative imports, check if export file contains the source path
    return exportInfo.filePath.includes(importInfo.source);
  }
}

// CLI usage
export async function runAnalyzeUsage(
  sourcePath: string,
  exportsMapPath: string,
  outputPath: string,
): Promise<void> {
  const analyzer = new UsageAnalyzer();

  console.log(`Loading exports map from: ${exportsMapPath}`);
  const exportsMapContent = await defaultFileSystem.readFile(exportsMapPath);
  const exportsMap: ExportsMap = JSON.parse(exportsMapContent);

  console.log(`Analyzing usage in: ${sourcePath}`);
  const usageStatistics = await analyzer.analyzeUsage(sourcePath, exportsMap);

  const totalExports = Object.keys(usageStatistics).length;
  const usedExports = Object.values(usageStatistics).filter((stat) => stat.usageCount > 0).length;

  console.log(`Analyzed ${totalExports} exports, ${usedExports} are used`);
  console.log(`Saving usage statistics to: ${outputPath}`);

  await analyzer.saveUsageStatistics(usageStatistics, outputPath);
  console.log("Usage analysis completed!");
}
