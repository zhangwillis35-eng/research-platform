declare module "@citation-js/core" {
  export class Cite {
    static async(input: string): Promise<Cite>;
    format(type: string, options?: Record<string, unknown>): string;
  }
}

declare module "@citation-js/plugin-doi" {}
declare module "@citation-js/plugin-csl" {}
