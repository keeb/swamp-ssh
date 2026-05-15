// SSH helpers shared across extension models.
//
// Transport styles are selected via `connection.via`:
//   - "key"           plain ssh/scp using local agent + ~/.ssh keys (default)
//   - "tailscale"     `tailscale ssh` for exec/wait; piped `cat >` for upload
//   - "bastion"       ssh/scp with `-J user@bastion`
//   - "proxy-command" ssh/scp with `-o ProxyCommand=<cmd>` (e.g. AWS SSM)

export type SshVia = "key" | "tailscale" | "bastion" | "proxy-command";

export interface SshConnection {
  host: string;
  user: string;
  via?: SshVia;
  bastion?: string;
  proxyCommand?: string;
}

export interface SshInvocation {
  bin: string;
  args: string[];
}

export interface SshExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

// Deno is available at runtime in the swamp model host. Declared here so the
// type checker doesn't need --unstable for the namespace.
// deno-lint-ignore no-explicit-any
declare const Deno: any;

const STANDARD_SSH_OPTS: string[] = [
  "-o",
  "StrictHostKeyChecking=no",
  "-o",
  "UserKnownHostsFile=/dev/null",
  "-o",
  "ConnectTimeout=10",
];

export function isValidSshHost(host: unknown): boolean {
  if (!host) return false;
  if (typeof host !== "string") return false;
  if (host === "null" || host === "undefined") return false;
  return true;
}

export function transportOpts(connection: SshConnection): string[] {
  const via = connection.via ?? "key";
  const opts = [...STANDARD_SSH_OPTS];
  if (via === "bastion") {
    if (!connection.bastion) {
      throw new Error("via=bastion requires `bastion` (e.g. user@jump-host)");
    }
    opts.push("-J", connection.bastion);
  } else if (via === "proxy-command") {
    if (!connection.proxyCommand) {
      throw new Error("via=proxy-command requires `proxyCommand`");
    }
    opts.push("-o", `ProxyCommand=${connection.proxyCommand}`);
  }
  return opts;
}

/** Build the binary + argv that would be spawned for an exec call. Pure. */
export function buildExecInvocation(
  connection: SshConnection,
  command: string,
): SshInvocation {
  const via = connection.via ?? "key";
  const target = `${connection.user}@${connection.host}`;
  if (via === "tailscale") {
    return { bin: "tailscale", args: ["ssh", target, command] };
  }
  return {
    bin: "ssh",
    args: [...transportOpts(connection), target, command],
  };
}

/** Build the binary + argv that would be spawned for an upload. Pure. */
export function buildUploadInvocation(
  connection: SshConnection,
  source: string,
  dest: string,
): SshInvocation {
  const via = connection.via ?? "key";
  const target = `${connection.user}@${connection.host}`;
  if (via === "tailscale") {
    return {
      bin: "tailscale",
      args: ["ssh", target, `cat > ${shellQuote(dest)}`],
    };
  }
  return {
    bin: "scp",
    args: [...transportOpts(connection), source, `${target}:${dest}`],
  };
}

function spawnExec(connection: SshConnection, command: string) {
  const { bin, args } = buildExecInvocation(connection, command);
  return new Deno.Command(bin, { args });
}

export async function sshExec(
  connection: SshConnection,
  command: string,
): Promise<SshExecResult> {
  const proc = spawnExec(connection, command);
  const result = await proc.output();
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  if (result.code !== 0) {
    throw new Error(
      `SSH command failed (exit ${result.code}): ${stderr.slice(-500)}`,
    );
  }
  return { code: result.code, stdout, stderr };
}

export async function sshExecRaw(
  connection: SshConnection,
  command: string,
): Promise<SshExecResult> {
  const proc = spawnExec(connection, command);
  const result = await proc.output();
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  return { code: result.code, stdout, stderr };
}

export async function sshUpload(
  connection: SshConnection,
  source: string,
  dest: string,
): Promise<void> {
  const { bin, args } = buildUploadInvocation(connection, source, dest);

  if ((connection.via ?? "key") === "tailscale") {
    // tailscale ssh has no scp counterpart — stream the file over stdin into
    // a remote `cat > dest`. Works for any reasonable size; not the right
    // tool for very large files (no resume, no progress).
    const file = await Deno.open(source, { read: true });
    try {
      const proc = new Deno.Command(bin, {
        args,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      await file.readable.pipeTo(proc.stdin);
      const result = await proc.output();
      if (result.code !== 0) {
        const err = new TextDecoder().decode(result.stderr);
        throw new Error(`tailscale upload failed: ${err}`);
      }
      return;
    } finally {
      try {
        file.close();
      } catch (_) { /* already closed by pipeTo */ }
    }
  }

  const scp = new Deno.Command(bin, { args });
  const result = await scp.output();
  if (result.code !== 0) {
    const err = new TextDecoder().decode(result.stderr);
    throw new Error(`scp failed: ${err}`);
  }
}

export async function waitForSsh(
  connection: SshConnection,
  timeoutSeconds = 60,
  pollInterval = 3,
): Promise<boolean> {
  const deadline = Date.now() + (timeoutSeconds * 1000);

  while (Date.now() < deadline) {
    const result = await sshExecRaw(connection, "echo ready");
    if (result.code === 0 && result.stdout.trim() === "ready") {
      return true;
    }
    await new Promise((r) => setTimeout(r, pollInterval * 1000));
  }

  return false;
}

function shellQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
