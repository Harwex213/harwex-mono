#!/usr/bin/env tsx

import { parse } from '@typescript-eslint/parser';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ComponentDeclaration {
  name: string;
  file: string;
  line: number;
  column: number;
  type: 'function' | 'class' | 'arrow' | 'const';
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

class ReactComponentAnalyzer {
  private graph: ComponentGraph;
  private processedFiles: Set<string>;
  private baseDir: string = '';

  constructor() {
    this.graph = {
      declarations: [],
      relations: [],
    };
    this.processedFiles = new Set();
  }

  async analyzeComponent(filePath: string, componentName: string): Promise<ComponentGraph> {
    this.baseDir = path.dirname(path.resolve(filePath));
    this.graph = { declarations: [], relations: [] };
    this.processedFiles.clear();

    await this.processFile(filePath, componentName);
    return this.graph;
  }

  private async processFile(filePath: string, targetComponentName?: string): Promise<void> {
    const absolutePath = path.resolve(filePath);
    
    if (this.processedFiles.has(absolutePath)) {
      return;
    }
    
    this.processedFiles.add(absolutePath);

    if (!fs.existsSync(absolutePath)) {
      console.warn(`File not found: ${absolutePath}`);
      return;
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');
    const ast = parse(content, {
      filePath: absolutePath,
      ecmaVersion: 2020,
      sourceType: 'module',
      ecmaFeatures: {
        jsx: true,
      },
      useJSXTextNode: false,
    });

    // Find component declarations
    const declarations = this.findComponentDeclarations(ast, absolutePath);
    this.graph.declarations.push(...declarations);

    // If we're looking for a specific component, only process that one
    if (targetComponentName) {
      const targetDeclaration = declarations.find(d => d.name === targetComponentName);
      if (targetDeclaration) {
        await this.findComponentDependencies(ast, absolutePath, targetComponentName);
      }
    } else {
      // Process all components
      for (const declaration of declarations) {
        await this.findComponentDependencies(ast, absolutePath, declaration.name);
      }
    }
  }

  private findComponentDeclarations(ast: any, filePath: string): ComponentDeclaration[] {
    const declarations: ComponentDeclaration[] = [];

    const traverse = (node: any) => {
      if (!node) return;

      // Function declaration
      if (node.type === 'FunctionDeclaration' && node.id && this.isReactComponent(node.id.name)) {
        declarations.push({
          name: node.id.name,
          file: filePath,
          line: node.loc.start.line,
          column: node.loc.start.column,
          type: 'function',
        });
      }

      // Variable declaration with function/arrow function
      if (node.type === 'VariableDeclarator' && node.id && this.isReactComponent(node.id.name)) {
        let type: 'function' | 'class' | 'arrow' | 'const' = 'const';
        
        if (node.init) {
          if (node.init.type === 'FunctionExpression') {
            type = 'function';
          } else if (node.init.type === 'ArrowFunctionExpression') {
            type = 'arrow';
          } else if (node.init.type === 'ClassExpression') {
            type = 'class';
          }
        }

        declarations.push({
          name: node.id.name,
          file: filePath,
          line: node.loc.start.line,
          column: node.loc.start.column,
          type,
        });
      }

      // Class declaration
      if (node.type === 'ClassDeclaration' && node.id && this.isReactComponent(node.id.name)) {
        declarations.push({
          name: node.id.name,
          file: filePath,
          line: node.loc.start.line,
          column: node.loc.start.column,
          type: 'class',
        });
      }

      // Traverse children
      for (const key in node) {
        if (node[key] && typeof node[key] === 'object') {
          if (Array.isArray(node[key])) {
            node[key].forEach(traverse);
          } else {
            traverse(node[key]);
          }
        }
      }
    };

    traverse(ast);
    return declarations;
  }

  private isReactComponent(name: string): boolean {
    // React components typically start with uppercase letter
    return /^[A-Z]/.test(name);
  }

  private async findComponentDependencies(ast: any, filePath: string, componentName: string): Promise<void> {
    const imports = this.findLocalImports(ast, filePath);
    const usedComponents = this.findUsedComponents(ast, componentName);

    for (const usedComponent of usedComponents) {
      // Check if it's imported locally
      const importInfo = imports.find(imp => imp.localName === usedComponent);
      
      if (importInfo) {
        // Add relation
        this.graph.relations.push({
          from: componentName,
          to: usedComponent,
          line: importInfo.line,
          column: importInfo.column,
        });

        // Recursively process the imported file
        const importedFilePath = path.resolve(this.baseDir, importInfo.filePath);
        await this.processFile(importedFilePath);
      }
    }
  }

  private findLocalImports(ast: any, currentFilePath: string): Array<{localName: string, filePath: string, line: number, column: number}> {
    const imports: Array<{localName: string, filePath: string, line: number, column: number}> = [];

    const traverse = (node: any) => {
      if (!node) return;

      if (node.type === 'ImportDeclaration') {
        const source = node.source.value;
        
        // Check if it's a local import (not from node_modules)
        if (source.startsWith('.') || source.startsWith('/')) {
          const importPath = path.resolve(path.dirname(currentFilePath), source);
          
          // Add .tsx extension if not present
          let fullPath = importPath;
          if (!fullPath.endsWith('.tsx') && !fullPath.endsWith('.ts')) {
            if (fs.existsSync(importPath + '.tsx')) {
              fullPath = importPath + '.tsx';
            } else if (fs.existsSync(importPath + '.ts')) {
              fullPath = importPath + '.ts';
            } else if (fs.existsSync(importPath + '/index.tsx')) {
              fullPath = importPath + '/index.tsx';
            } else if (fs.existsSync(importPath + '/index.ts')) {
              fullPath = importPath + '/index.ts';
            }
          }

          node.specifiers.forEach((specifier: any) => {
            if (specifier.type === 'ImportSpecifier') {
              imports.push({
                localName: specifier.local.name,
                filePath: fullPath,
                line: node.loc.start.line,
                column: node.loc.start.column,
              });
            } else if (specifier.type === 'ImportDefaultSpecifier') {
              imports.push({
                localName: specifier.local.name,
                filePath: fullPath,
                line: node.loc.start.line,
                column: node.loc.start.column,
              });
            }
          });
        }
      }

      // Traverse children
      for (const key in node) {
        if (node[key] && typeof node[key] === 'object') {
          if (Array.isArray(node[key])) {
            node[key].forEach(traverse);
          } else {
            traverse(node[key]);
          }
        }
      }
    };

    traverse(ast);
    return imports;
  }

  private findUsedComponents(ast: any, componentName: string): string[] {
    const usedComponents: string[] = [];
    let inTargetComponent = false;
    let currentFunctionDepth = 0;

    const traverse = (node: any) => {
      if (!node) return;

      // Track when we're inside the target component
      if (node.type === 'FunctionDeclaration' && node.id && node.id.name === componentName) {
        inTargetComponent = true;
        currentFunctionDepth = 1;
      } else if (node.type === 'VariableDeclarator' && node.id && node.id.name === componentName) {
        inTargetComponent = true;
        currentFunctionDepth = 1;
      } else if (node.type === 'ClassDeclaration' && node.id && node.id.name === componentName) {
        inTargetComponent = true;
        currentFunctionDepth = 1;
      }

      // Track function depth
      if (inTargetComponent) {
        if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || 
            node.type === 'ArrowFunctionExpression' || node.type === 'ClassDeclaration' || 
            node.type === 'ClassExpression') {
          currentFunctionDepth++;
        }
      }

      // Look for JSX elements (component usage)
      if (inTargetComponent && node.type === 'JSXElement' && node.openingElement) {
        const elementName = node.openingElement.name;
        if (elementName.type === 'JSXIdentifier' && this.isReactComponent(elementName.name)) {
          usedComponents.push(elementName.name);
        }
      }

      // Traverse children
      for (const key in node) {
        if (node[key] && typeof node[key] === 'object') {
          if (Array.isArray(node[key])) {
            node[key].forEach(traverse);
          } else {
            traverse(node[key]);
          }
        }
      }

      // Track when we exit the target component
      if (inTargetComponent) {
        if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || 
            node.type === 'ArrowFunctionExpression' || node.type === 'ClassDeclaration' || 
            node.type === 'ClassExpression') {
          currentFunctionDepth--;
          if (currentFunctionDepth === 0) {
            inTargetComponent = false;
          }
        }
      }
    };

    traverse(ast);
    return [...new Set(usedComponents)]; // Remove duplicates
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length !== 2) {
    console.error('Usage: tsx index.ts <file.tsx> <component-name>');
    process.exit(1);
  }

  const [filePath, componentName] = args;
  
  if (!filePath || !componentName) {
    console.error('Both file path and component name are required');
    process.exit(1);
  }

  if (!filePath.endsWith('.tsx')) {
    console.error('File must have .tsx extension');
    process.exit(1);
  }

  const analyzer = new ReactComponentAnalyzer();
  
  try {
    const graph = await analyzer.analyzeComponent(filePath, componentName);
    
    // Output to console
    console.log('Component Analysis Result:');
    console.log('========================');
    console.log(JSON.stringify(graph, null, 2));
    
    // Create output directory if it doesn't exist
    const outputDir = path.join(process.cwd(), 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Generate output filename
    const inputFileName = path.basename(filePath, '.tsx');
    const outputFileName = `${inputFileName}-${componentName}-analysis.json`;
    const outputPath = path.join(outputDir, outputFileName);
    
    // Write to file
    fs.writeFileSync(outputPath, JSON.stringify(graph, null, 2), 'utf-8');
    console.log('\n========================');
    console.log(`Analysis saved to: ${outputPath}`);
    
  } catch (error) {
    console.error('Error analyzing component:', error);
    process.exit(1);
  }
}

if (import.meta.url.startsWith(`file://${process.argv[1]}`)) {
  main();
}

export { ReactComponentAnalyzer, type ComponentGraph, type ComponentDeclaration, type ComponentRelation };
