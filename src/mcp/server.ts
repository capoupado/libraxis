export type ToolHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput
) => Promise<TOutput> | TOutput;

interface RegisteredTool {
  name: string;
  handler: ToolHandler;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  public register(name: string, handler: ToolHandler): void {
    this.tools.set(name, { name, handler });
  }

  public has(name: string): boolean {
    return this.tools.has(name);
  }

  public list(): string[] {
    return Array.from(this.tools.keys()).sort();
  }

  public async call(name: string, input: unknown): Promise<unknown> {
    const tool = this.tools.get(name);

    if (!tool) {
      throw new Error(`Tool not registered: ${name}`);
    }

    try {
      const result = await tool.handler(input);
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: message };
    }
  }
}

export interface BaseMcpServer {
  registry: ToolRegistry;
  registerTool: (name: string, handler: ToolHandler) => void;
  callTool: (name: string, input: unknown) => Promise<unknown>;
}

export function createMcpServer(): BaseMcpServer {
  const registry = new ToolRegistry();

  return {
    registry,
    registerTool: (name, handler) => registry.register(name, handler),
    callTool: (name, input) => registry.call(name, input)
  };
}
