most naive implementation:

- first script
    - take source folder
    - start recursievly traversing source folder
    - parse files which extension either `ts` or `tsx`
    - during parse gather info about module exports
    - save to map parsed info
- second script
    - take map of available exports, source folder
    - prepare data structure, which contains statistics of usages per export. Statistics consist of full amount of
      usages and paths list of every module (`ts` or `tsx`, which reference to that export
    - start recursievly traversing source folder
    - parse files which extension either `ts` or `tsx`
    - during parse gather info about moduls imports
    - store statistics for found exports from map
- third script
    - take statistics of export usages and save it to file
- notes to consider about
    - do not use direct API of node and instead abstract it to make it possible to mock this API during scripts testing
      to get around of necessity to have actual folder and files 
