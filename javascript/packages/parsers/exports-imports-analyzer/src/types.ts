export interface ExportInfo {
  name: string;
  type: "default" | "named";
  filePath: string;
}

export interface ImportInfo {
  name: string;
  source: string;
  type: "default" | "named";
  filePath: string;
}

export interface ExportUsageStatistics {
  exportInfo: ExportInfo;
  usageCount: number;
  usageLocations: string[];
}

export interface ExportsMap {
  [exportName: string]: ExportInfo[];
}

export interface UsageStatistics {
  [exportName: string]: ExportUsageStatistics;
}
