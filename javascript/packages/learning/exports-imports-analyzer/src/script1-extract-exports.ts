import { defaultFileSystem } from './file-system.js';
import { FileTraverser } from './file-traverser.js';
import { TypeScriptParser } from './parser.js';
import type { FileSystemAPI } from './file-system.js';
import type { ExportsMap } from './types.js';

export class ExportExtractor {
  constructor(private fs: FileSystemAPI = defaultFileSystem) {}

  async extractExports(sourcePath: string): Promise<ExportsMap> {
    const traverser = new FileTraverser(this.fs);
    const files = await traverser.findTypeScriptFiles(sourcePath);
    
    const exportsMap: ExportsMap = {};
    
    for (const filePath of files) {
      try {
        const content = await this.fs.readFile(filePath);
        const parser = new TypeScriptParser(filePath, content);
        const exports = parser.extractExports();
        
                 for (const exportInfo of exports) {
           if (!exportsMap[exportInfo.name]) {
             exportsMap[exportInfo.name] = [];
           }
           exportsMap[exportInfo.name]!.push(exportInfo);
        }
      } catch (error) {
        console.warn(`Warning: Could not parse file ${filePath}:`, error);
      }
    }
    
    return exportsMap;
  }

  async saveExportsMap(exportsMap: ExportsMap, outputPath: string): Promise<void> {
    const jsonContent = JSON.stringify(exportsMap, null, 2);
    await this.fs.writeFile(outputPath, jsonContent);
  }
}

// CLI usage
export async function runExtractExports(sourcePath: string, outputPath: string): Promise<void> {
  const extractor = new ExportExtractor();
  
  console.log(`Extracting exports from: ${sourcePath}`);
  const exportsMap = await extractor.extractExports(sourcePath);
  
  console.log(`Found ${Object.keys(exportsMap).length} unique export names`);
  console.log(`Saving exports map to: ${outputPath}`);
  
  await extractor.saveExportsMap(exportsMap, outputPath);
  console.log('Export extraction completed!');
} 