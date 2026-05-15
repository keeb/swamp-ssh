/**
 * @keeb/ssh/host model — general-purpose SSH operations.
 *
 * Exposes `exec`, `upload`, and `waitForConnection` methods for running
 * shell commands, copying files, and polling reachability over SSH.
 *
 * Transport is selected by the `via` global argument:
 *   - "key"           plain ssh/scp (default)
 *   - "tailscale"     `tailscale ssh` using tailnet identity
 *   - "bastion"       ssh/scp via -J <bastion>
 *   - "proxy-command" ssh/scp via -o ProxyCommand=<cmd>
 */
import { z } from "npm:zod@4";
import {
  type SshConnection,
  sshExec,
  sshUpload,
  waitForSsh,
} from "./lib/ssh.ts";

// Swamp wires args/context at runtime; the model loader doesn't expose types.
// deno-lint-ignore no-explicit-any
type ExecuteArgs = any;
interface ExecuteContext {
  // deno-lint-ignore no-explicit-any
  globalArgs: any;
  writeResource(
    resource: string,
    name: string,
    // deno-lint-ignore no-explicit-any
    body: any,
    // deno-lint-ignore no-explicit-any
  ): Promise<any>;
}

/** Global SSH connection arguments shared by every method. */
const SshConnectionArgs = z.object({
  host: z.string().describe("SSH hostname or IP"),
  user: z.string().default("root").describe("SSH user"),
  via: z.enum(["key", "tailscale", "bastion", "proxy-command"]).default("key")
    .describe("Transport style for the SSH connection"),
  bastion: z.string().optional().describe(
    "user@host of the jump host (required when via=bastion)",
  ),
  proxyCommand: z.string().optional().describe(
    "Command piped into ssh via -o ProxyCommand (required when via=proxy-command)",
  ),
});

// Per-method argument schemas
const ExecArgs = z.object({
  command: z.string().describe("Command to execute"),
  timeout: z.number().default(60).describe("Timeout in seconds"),
});

const UploadArgs = z.object({
  source: z.string().describe("Local source path"),
  dest: z.string().describe("Remote destination path"),
});

const WaitForConnectionArgs = z.object({
  timeout: z.number().default(60).describe("Timeout in seconds"),
});

const ResultSchema = z.object({
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  exitCode: z.number().optional(),
  command: z.string().optional(),
  host: z.string().optional(),
  via: z.string().optional(),
  source: z.string().optional(),
  dest: z.string().optional(),
  connected: z.boolean().optional(),
  success: z.boolean().optional(),
  logs: z.string().optional(),
  timestamp: z.string(),
});

function connectionFrom(globalArgs: ExecuteContext["globalArgs"]): SshConnection {
  return {
    host: globalArgs.host,
    user: globalArgs.user ?? "root",
    via: globalArgs.via ?? "key",
    bastion: globalArgs.bastion,
    proxyCommand: globalArgs.proxyCommand,
  };
}

/** Swamp model definition for `@keeb/ssh/host`. */
export const model: {
  type: string;
  version: string;
  resources: Record<string, unknown>;
  globalArguments: typeof SshConnectionArgs;
  methods: Record<string, unknown>;
} = {
  type: "@keeb/ssh/host",
  version: "2026.05.14.1",
  resources: {
    "result": {
      description: "SSH operation result",
      schema: ResultSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  globalArguments: SshConnectionArgs,
  methods: {
    exec: {
      description: "Run a command over SSH and return stdout/stderr/exitCode",
      arguments: ExecArgs,
      execute: async (args: ExecuteArgs, context: ExecuteContext) => {
        const { command } = args;
        const connection = connectionFrom(context.globalArgs);
        const logs: string[] = [];
        const log = (msg: string) => logs.push(msg);

        log(
          `Running command on ${connection.user}@${connection.host} via ${connection.via}: ${
            command.length > 120 ? command.slice(0, 120) + "..." : command
          }`,
        );
        const result = await sshExec(connection, command);
        log(
          `Command completed (stdout: ${result.stdout.length} bytes, stderr: ${result.stderr.length} bytes)`,
        );

        const handle = await context.writeResource("result", "result", {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.code,
          command,
          host: connection.host,
          via: connection.via,
          logs: logs.join("\n"),
          timestamp: new Date().toISOString(),
        });
        return { dataHandles: [handle] };
      },
    },

    upload: {
      description:
        "Upload a file to a remote host via scp (or piped cat on tailscale)",
      arguments: UploadArgs,
      execute: async (args: ExecuteArgs, context: ExecuteContext) => {
        const { source, dest } = args;
        const connection = connectionFrom(context.globalArgs);
        const logs: string[] = [];
        const log = (msg: string) => logs.push(msg);

        log(
          `Uploading ${source} to ${connection.user}@${connection.host}:${dest} via ${connection.via}`,
        );
        await sshUpload(connection, source, dest);
        log(`Upload complete`);

        const handle = await context.writeResource("result", "result", {
          source,
          dest,
          host: connection.host,
          via: connection.via,
          success: true,
          logs: logs.join("\n"),
          timestamp: new Date().toISOString(),
        });
        return { dataHandles: [handle] };
      },
    },

    waitForConnection: {
      description: "Poll SSH until the host is reachable",
      arguments: WaitForConnectionArgs,
      execute: async (args: ExecuteArgs, context: ExecuteContext) => {
        const { timeout = 60 } = args;
        const connection = connectionFrom(context.globalArgs);
        const logs: string[] = [];
        const log = (msg: string) => logs.push(msg);

        log(
          `Waiting for SSH on ${connection.user}@${connection.host} via ${connection.via} (up to ${timeout}s)`,
        );
        const connected = await waitForSsh(connection, timeout);

        if (!connected) {
          throw new Error(
            `SSH not reachable on ${connection.host} after ${timeout}s`,
          );
        }

        log(`SSH connection established`);

        const handle = await context.writeResource("result", "result", {
          connected: true,
          host: connection.host,
          via: connection.via,
          logs: logs.join("\n"),
          timestamp: new Date().toISOString(),
        });
        return { dataHandles: [handle] };
      },
    },
  },
};
