#!/usr/bin/env node

export * from './types.js';
export * from './file-system.js';
export * from './parser.js';
export * from './file-traverser.js';
export * from './script1-extract-exports.js';
export * from './script2-analyze-usage.js';
export * from './script3-generate-report.js';

// CLI functionality
import { runExtractExports } from './script1-extract-exports.js';
import { runAnalyzeUsage } from './script2-analyze-usage.js';
import { runGenerateReport } from './script3-generate-report.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case 'extract-exports': {
        const [sourcePath, outputPath] = args.slice(1);
        if (!sourcePath || !outputPath) {
          console.error('Usage: extract-exports <sourcePath> <outputPath>');
          process.exit(1);
        }
        await runExtractExports(sourcePath, outputPath);
        break;
      }

      case 'analyze-usage': {
        const [sourcePath, exportsMapPath, outputPath] = args.slice(1);
        if (!sourcePath || !exportsMapPath || !outputPath) {
          console.error('Usage: analyze-usage <sourcePath> <exportsMapPath> <outputPath>');
          process.exit(1);
        }
        await runAnalyzeUsage(sourcePath, exportsMapPath, outputPath);
        break;
      }

      case 'generate-report': {
        const [usageStatisticsPath, outputPath, format] = args.slice(1);
        if (!usageStatisticsPath || !outputPath) {
          console.error('Usage: generate-report <usageStatisticsPath> <outputPath> [format]');
          process.exit(1);
        }
        await runGenerateReport(usageStatisticsPath, outputPath, { 
          format: (format as any) || 'text' 
        });
        break;
      }

      case 'full-analysis': {
        const [sourcePath, outputDir] = args.slice(1);
        if (!sourcePath || !outputDir) {
          console.error('Usage: full-analysis <sourcePath> <outputDir>');
          process.exit(1);
        }
        
        console.log('Running full analysis...');
        const exportsMapPath = `${outputDir}/exports-map.json`;
        const usageStatsPath = `${outputDir}/usage-statistics.json`;
        const reportPath = `${outputDir}/report.txt`;
        
        await runExtractExports(sourcePath, exportsMapPath);
        await runAnalyzeUsage(sourcePath, exportsMapPath, usageStatsPath);
        await runGenerateReport(usageStatsPath, reportPath);
        
        console.log('Full analysis completed!');
        break;
      }

      default:
        console.log(`
Export-Import Analyzer

Usage:
  extract-exports <sourcePath> <outputPath>              - Extract exports to JSON
  analyze-usage <sourcePath> <exportsMapPath> <outputPath> - Analyze import usage
  generate-report <usageStatsPath> <outputPath> [format] - Generate report (format: text|json|csv)
  full-analysis <sourcePath> <outputDir>                 - Run complete analysis

Examples:
  npm run extract-exports ./src ./output/exports.json
  npm run analyze-usage ./src ./output/exports.json ./output/usage.json
  npm run generate-report ./output/usage.json ./output/report.txt
  npm run full-analysis ./src ./output
        `);
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Only run CLI if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
} 