#!/usr/bin/env tsx

import * as fs from "fs";
import * as path from "path";

interface ComponentDeclaration {
  name: string;
  file: string;
  line: number;
  column: number;
  type: "function" | "class" | "arrow" | "const";
}

interface ComponentRelation {
  from: string;
  to: string;
  line: number;
  column: number;
}

interface ComponentGraph {
  declarations: ComponentDeclaration[];
  relations: ComponentRelation[];
}

class MermaidGenerator {
  private sanitizeNodeName(name: string): string {
    // Replace special characters that might cause issues in Mermaid
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  private getNodeShape(type: string): string {
    switch (type) {
      case "function":
        return "[]"; // Rectangle for functions
      case "class":
        return "{}"; // Hexagon for classes
      case "arrow":
        return "()"; // Circle for arrow functions
      case "const":
        return "[[]]"; // Subroutine for const declarations
      default:
        return "[]"; // Default rectangle
    }
  }

  private getShortFileName(filePath: string): string {
    const fileName = path.basename(filePath, path.extname(filePath));
    return fileName.length > 20 ? fileName.substring(0, 17) + "..." : fileName;
  }

  generateMermaid(graph: ComponentGraph): string {
    const lines: string[] = [];
    lines.push("flowchart TD");
    lines.push("");

    // Group declarations by file for better organization
    const declarationsByFile = new Map<string, ComponentDeclaration[]>();
    
    for (const declaration of graph.declarations) {
      const fileName = this.getShortFileName(declaration.file);
      if (!declarationsByFile.has(fileName)) {
        declarationsByFile.set(fileName, []);
      }
      declarationsByFile.get(fileName)!.push(declaration);
    }

    // Generate nodes with file grouping information
    const nodeMap = new Map<string, string>();
    
    for (const [fileName, declarations] of declarationsByFile) {
      if (declarations.length > 1) {
        lines.push(`  %% Components from ${fileName}`);
      }
      
      for (const declaration of declarations) {
        const sanitizedName = this.sanitizeNodeName(declaration.name);
        const shape = this.getNodeShape(declaration.type);
        const displayName = declarations.length > 1 ? 
          `${declaration.name}<br/><small>${fileName}</small>` : 
          declaration.name;
        
        nodeMap.set(declaration.name, sanitizedName);
        
        if (shape === "[]") {
          lines.push(`  ${sanitizedName}["${displayName}"]`);
        } else if (shape === "{}") {
          lines.push(`  ${sanitizedName}{"${displayName}"}`);
        } else if (shape === "()") {
          lines.push(`  ${sanitizedName}("${displayName}")`);
        } else if (shape === "[[]]") {
          lines.push(`  ${sanitizedName}[["${displayName}"]]`);
        }
      }
      
      if (declarations.length > 1) {
        lines.push("");
      }
    }

    // Generate relations
    if (graph.relations.length > 0) {
      lines.push("  %% Component Relations");
      
      for (const relation of graph.relations) {
        const fromNode = nodeMap.get(relation.from);
        const toNode = nodeMap.get(relation.to);
        
        if (fromNode && toNode) {
          lines.push(`  ${fromNode} --> ${toNode}`);
        }
      }
    }

    // Add styling
    lines.push("");
    lines.push("  %% Styling");
    lines.push("  classDef functionClass fill:#e1f5fe,stroke:#0277bd,stroke-width:2px");
    lines.push("  classDef classClass fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px");
    lines.push("  classDef arrowClass fill:#e8f5e8,stroke:#2e7d32,stroke-width:2px");
    lines.push("  classDef constClass fill:#fff3e0,stroke:#ef6c00,stroke-width:2px");

    // Apply styling to nodes
    for (const declaration of graph.declarations) {
      const sanitizedName = nodeMap.get(declaration.name);
      if (sanitizedName) {
        lines.push(`  class ${sanitizedName} ${declaration.type}Class`);
      }
    }

    return lines.join("\n");
  }

  generateMermaidWithStats(graph: ComponentGraph): string {
    const mermaidDiagram = this.generateMermaid(graph);
    
    const stats = [
      `%% Analysis Statistics:`,
      `%% Total Components: ${graph.declarations.length}`,
      `%% Total Relations: ${graph.relations.length}`,
      `%% Component Types:`,
    ];

    const typeCounts = graph.declarations.reduce((acc, decl) => {
      acc[decl.type] = (acc[decl.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    for (const [type, count] of Object.entries(typeCounts)) {
      stats.push(`%% - ${type}: ${count}`);
    }

    stats.push("");
    
    return stats.join("\n") + "\n" + mermaidDiagram;
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log("Usage: tsx generate-mermaid.ts <input-json-file> [output-file]");
    console.log("Example: tsx generate-mermaid.ts output/test-App-analysis.json");
    console.log("Example: tsx generate-mermaid.ts output/test-App-analysis.json diagram.mmd");
    process.exit(1);
  }

  const inputFile = args[0];
  const outputFile = args[1];

  if (!inputFile) {
    console.error("Input file is required");
    process.exit(1);
  }

  if (!fs.existsSync(inputFile)) {
    console.error(`Input file not found: ${inputFile}`);
    process.exit(1);
  }

  try {
    const jsonContent = fs.readFileSync(inputFile, "utf-8");
    const graph: ComponentGraph = JSON.parse(jsonContent);

    const generator = new MermaidGenerator();
    const mermaidDiagram = generator.generateMermaidWithStats(graph);

    if (outputFile && outputFile.trim() !== "") {
      fs.writeFileSync(outputFile, mermaidDiagram);
      console.log(`Mermaid diagram saved to: ${outputFile}`);
    } else {
      console.log("Generated Mermaid Diagram:");
      console.log("=" .repeat(50));
      console.log(mermaidDiagram);
    }

    // Show some basic statistics
    console.log("\nAnalysis Summary:");
    console.log(`- Total Components: ${graph.declarations.length}`);
    console.log(`- Total Relations: ${graph.relations.length}`);
    
    const typeCounts = graph.declarations.reduce((acc, decl) => {
      acc[decl.type] = (acc[decl.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log("- Component Types:");
    for (const [type, count] of Object.entries(typeCounts)) {
      console.log(`  - ${type}: ${count}`);
    }

  } catch (error) {
    console.error("Error processing JSON file:", error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
} 