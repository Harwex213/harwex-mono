import * as ts from "typescript";
import type { ExportInfo, ImportInfo } from "./types.js";

export class TypeScriptParser {
  private sourceFile: ts.SourceFile;

  constructor(private filePath: string, private content: string) {
    this.sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
    );
  }

  extractExports(): ExportInfo[] {
    const exports: ExportInfo[] = [];

    const visit = (node: ts.Node) => {
      // Handle export declarations
      if (ts.isExportDeclaration(node)) {
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) {
            exports.push({
              name: element.name.text,
              type: "named",
              filePath: this.filePath,
            });
          }
        }
      }

      // Handle export default
      if (ts.isExportAssignment(node) && node.isExportEquals === false) {
        exports.push({
          name: "default",
          type: "default",
          filePath: this.filePath,
        });
      }

      // Handle named exports (export const/function/class/etc)
      if (ts.isVariableStatement(node) && this.hasExportModifier(node)) {
        node.declarationList.declarations.forEach((declaration) => {
          if (ts.isIdentifier(declaration.name)) {
            exports.push({
              name: declaration.name.text,
              type: "named",
              filePath: this.filePath,
            });
          }
        });
      }

      if (ts.isFunctionDeclaration(node) && this.hasExportModifier(node) && node.name) {
        exports.push({
          name: node.name.text,
          type: "named",
          filePath: this.filePath,
        });
      }

      if (ts.isClassDeclaration(node) && this.hasExportModifier(node) && node.name) {
        exports.push({
          name: node.name.text,
          type: "named",
          filePath: this.filePath,
        });
      }

      if (ts.isInterfaceDeclaration(node) && this.hasExportModifier(node)) {
        exports.push({
          name: node.name.text,
          type: "named",
          filePath: this.filePath,
        });
      }

      if (ts.isTypeAliasDeclaration(node) && this.hasExportModifier(node)) {
        exports.push({
          name: node.name.text,
          type: "named",
          filePath: this.filePath,
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(this.sourceFile);
    return exports;
  }

  extractImports(): ImportInfo[] {
    const imports: ImportInfo[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const source = node.moduleSpecifier.text;

        if (node.importClause) {
          // Default import
          if (node.importClause.name) {
            imports.push({
              name: node.importClause.name.text,
              source,
              type: "default",
              filePath: this.filePath,
            });
          }

          // Named imports
          if (node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
            for (const element of node.importClause.namedBindings.elements) {
              imports.push({
                name: element.name.text,
                source,
                type: "named",
                filePath: this.filePath,
              });
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(this.sourceFile);
    return imports;
  }

  private hasExportModifier(node: ts.Node): boolean {
    return (node as any).modifiers?.some((modifier: any) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }
}
