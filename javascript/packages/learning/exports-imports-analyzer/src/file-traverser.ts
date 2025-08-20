import type { FileSystemAPI } from './file-system.js';

export class FileTraverser {
  constructor(private fs: FileSystemAPI) {}

  async findTypeScriptFiles(sourcePath: string): Promise<string[]> {
    const files: string[] = [];
    
    await this.traverseDirectory(sourcePath, files);
    
    return files.filter(file => this.isTypeScriptFile(file));
  }

  private async traverseDirectory(dirPath: string, files: string[]): Promise<void> {
    try {
      const entries = await this.fs.readdir(dirPath);
      
      for (const entry of entries) {
        const fullPath = this.fs.join(dirPath, entry);
        
        if (await this.fs.isDirectory(fullPath)) {
          await this.traverseDirectory(fullPath, files);
        } else {
          files.push(fullPath);
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not read directory ${dirPath}:`, error);
    }
  }

  private isTypeScriptFile(filePath: string): boolean {
    return filePath.endsWith('.ts') || filePath.endsWith('.tsx');
  }
} 