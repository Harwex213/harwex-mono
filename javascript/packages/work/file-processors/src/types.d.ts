type ProcessorId = string;

type Processor = {
  id: ProcessorId;
  fileExt: string;
  fileHandler: (path: string) => Promise<void>;
};

type ProcessorOutputMap = Record<ProcessorId, any>;

type TraverseFolder = (path: string, processors: Processor[]) => Promise<ProcessorOutputMap>;
