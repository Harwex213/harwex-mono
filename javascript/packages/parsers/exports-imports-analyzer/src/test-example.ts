import { ExportExtractor } from './script1-extract-exports.js';
import { UsageAnalyzer } from './script2-analyze-usage.js';
import { ReportGenerator } from './script3-generate-report.js';
import type { FileSystemAPI } from './file-system.js';

// Mock file system for testing
class MockFileSystem implements FileSystemAPI {
  private files = new Map<string, string>();
  private directories = new Set<string>();

  constructor() {
    // Mock directory structure
    this.directories.add('/test-project/src');
    this.directories.add('/test-project/src/components');
    this.directories.add('/test-project/src/utils');

    // Mock files
    this.files.set('/test-project/src/index.ts', `
export { Button } from './components/Button.js';
export { formatDate } from './utils/date.js';
export const API_URL = 'https://api.example.com';
`);

    this.files.set('/test-project/src/components/Button.tsx', `
import React from 'react';
import { formatDate } from '../utils/date.js';

export interface ButtonProps {
  onClick: () => void;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({ onClick, children }) => {
  return <button onClick={onClick}>{children}</button>;
};

export default Button;
`);

    this.files.set('/test-project/src/utils/date.ts', `
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function parseDate(dateString: string): Date {
  return new Date(dateString);
}
`);

    this.files.set('/test-project/src/components/Header.tsx', `
import React from 'react';
import { Button } from './Button.js';
import { API_URL } from '../index.js';

export const Header: React.FC = () => {
  return (
    <header>
      <h1>My App</h1>
      <Button onClick={() => console.log('clicked')}>
        Click me
      </Button>
      <p>API: {API_URL}</p>
    </header>
  );
};
`);
  }

  async readdir(path: string): Promise<string[]> {
    if (path === '/test-project/src') {
      return ['index.ts', 'components', 'utils'];
    }
    if (path === '/test-project/src/components') {
      return ['Button.tsx', 'Header.tsx'];
    }
    if (path === '/test-project/src/utils') {
      return ['date.ts'];
    }
    return [];
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (!content) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    console.log(`Mock: Written to ${path}`);
  }

  async isDirectory(path: string): Promise<boolean> {
    return this.directories.has(path);
  }

  join(...paths: string[]): string {
    return paths.join('/').replace(/\/+/g, '/');
  }

  getWrittenFiles(): Map<string, string> {
    return this.files;
  }
}

async function runTest() {
  console.log('🧪 Running Export-Import Analyzer Test\n');

  const mockFs = new MockFileSystem();
  const sourcePath = '/test-project/src';

  // Step 1: Extract exports
  console.log('📤 Step 1: Extracting exports...');
  const extractor = new ExportExtractor(mockFs);
  const exportsMap = await extractor.extractExports(sourcePath);
  
  console.log('Found exports:');
  for (const [name, infos] of Object.entries(exportsMap)) {
    console.log(`  - ${name}: ${infos.length} occurrence(s)`);
    for (const info of infos) {
      console.log(`    📍 ${info.type} export in ${info.filePath}`);
    }
  }
  console.log();

  // Step 2: Analyze usage
  console.log('📊 Step 2: Analyzing usage...');
  const analyzer = new UsageAnalyzer(mockFs);
  const usageStats = await analyzer.analyzeUsage(sourcePath, exportsMap);

  console.log('Usage statistics:');
  for (const [key, stats] of Object.entries(usageStats)) {
    console.log(`  - ${stats.exportInfo.name}: used ${stats.usageCount} time(s)`);
    if (stats.usageCount > 0) {
      for (const location of stats.usageLocations) {
        console.log(`    📍 used in ${location}`);
      }
    }
  }
  console.log();

  // Step 3: Generate report
  console.log('📋 Step 3: Generating report...');
  const generator = new ReportGenerator(mockFs);
  
  await generator.generateReport(usageStats, '/test-project/report.txt', {
    format: 'text',
    includeUnused: true,
    sortBy: 'usage'
  });

  await generator.generateReport(usageStats, '/test-project/report.json', {
    format: 'json',
    includeUnused: true,
    sortBy: 'usage'
  });

  console.log('✅ Test completed successfully!');
  console.log('\nGenerated files:');
  for (const [path, content] of mockFs.getWrittenFiles()) {
    if (path.includes('report')) {
      console.log(`📄 ${path} (${content.length} bytes)`);
    }
  }

  // Show a snippet of the text report
  const textReport = mockFs.getWrittenFiles().get('/test-project/report.txt');
  if (textReport) {
    console.log('\n📄 Report Preview (first 500 chars):');
    console.log('─'.repeat(50));
    console.log(textReport.substring(0, 500) + '...');
    console.log('─'.repeat(50));
  }
}

runTest().catch(console.error); 