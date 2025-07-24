import { defaultFileSystem } from './file-system.js';
import type { FileSystemAPI } from './file-system.js';
import type { UsageStatistics } from './types.js';

export interface ReportOptions {
  includeUnused?: boolean;
  sortBy?: 'usage' | 'name' | 'file';
  format?: 'json' | 'text' | 'csv';
}

export class ReportGenerator {
  constructor(private fs: FileSystemAPI = defaultFileSystem) {}

  async generateReport(
    usageStatistics: UsageStatistics,
    outputPath: string,
    options: ReportOptions = {}
  ): Promise<void> {
    const {
      includeUnused = true,
      sortBy = 'usage',
      format = 'text'
    } = options;

    const statisticsArray = Object.values(usageStatistics);
    
    // Filter unused exports if requested
    const filteredStats = includeUnused 
      ? statisticsArray
      : statisticsArray.filter(stat => stat.usageCount > 0);

    // Sort statistics
    const sortedStats = this.sortStatistics(filteredStats, sortBy);

    // Generate report content
    let reportContent: string;
    switch (format) {
      case 'json':
        reportContent = this.generateJsonReport(sortedStats);
        break;
      case 'csv':
        reportContent = this.generateCsvReport(sortedStats);
        break;
      default:
        reportContent = this.generateTextReport(sortedStats);
    }

    await this.fs.writeFile(outputPath, reportContent);
  }

  private sortStatistics(statistics: any[], sortBy: string): any[] {
    return statistics.sort((a, b) => {
      switch (sortBy) {
        case 'usage':
          return b.usageCount - a.usageCount;
        case 'name':
          return a.exportInfo.name.localeCompare(b.exportInfo.name);
        case 'file':
          return a.exportInfo.filePath.localeCompare(b.exportInfo.filePath);
        default:
          return 0;
      }
    });
  }

  private generateTextReport(statistics: any[]): string {
    const lines = [
      'Export Usage Report',
      '==================',
      '',
      `Total exports analyzed: ${statistics.length}`,
      `Used exports: ${statistics.filter(s => s.usageCount > 0).length}`,
      `Unused exports: ${statistics.filter(s => s.usageCount === 0).length}`,
      '',
      'Detailed Statistics:',
      '-------------------'
    ];

    for (const stat of statistics) {
      lines.push('');
      lines.push(`Export: ${stat.exportInfo.name} (${stat.exportInfo.type})`);
      lines.push(`File: ${stat.exportInfo.filePath}`);
      lines.push(`Usage Count: ${stat.usageCount}`);
      
      if (stat.usageCount > 0) {
        lines.push('Used in:');
        for (const location of stat.usageLocations) {
          lines.push(`  - ${location}`);
        }
      }
      lines.push('-'.repeat(50));
    }

    return lines.join('\n');
  }

  private generateJsonReport(statistics: any[]): string {
    const report = {
      summary: {
        totalExports: statistics.length,
        usedExports: statistics.filter(s => s.usageCount > 0).length,
        unusedExports: statistics.filter(s => s.usageCount === 0).length
      },
      statistics: statistics.map(stat => ({
        exportName: stat.exportInfo.name,
        exportType: stat.exportInfo.type,
        filePath: stat.exportInfo.filePath,
        usageCount: stat.usageCount,
        usageLocations: stat.usageLocations
      }))
    };

    return JSON.stringify(report, null, 2);
  }

  private generateCsvReport(statistics: any[]): string {
    const headers = ['Export Name', 'Export Type', 'File Path', 'Usage Count', 'Usage Locations'];
    const rows = statistics.map(stat => [
      stat.exportInfo.name,
      stat.exportInfo.type,
      stat.exportInfo.filePath,
      stat.usageCount.toString(),
      stat.usageLocations.join('; ')
    ]);

    const csvLines = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
    ];

    return csvLines.join('\n');
  }
}

// CLI usage
export async function runGenerateReport(
  usageStatisticsPath: string,
  outputPath: string,
  options: ReportOptions = {}
): Promise<void> {
  const generator = new ReportGenerator();
  
  console.log(`Loading usage statistics from: ${usageStatisticsPath}`);
  const statisticsContent = await defaultFileSystem.readFile(usageStatisticsPath);
  const usageStatistics: UsageStatistics = JSON.parse(statisticsContent);
  
  console.log(`Generating report in ${options.format || 'text'} format`);
  await generator.generateReport(usageStatistics, outputPath, options);
  
  console.log(`Report saved to: ${outputPath}`);
  console.log('Report generation completed!');
} 