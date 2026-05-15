// Unit tests for transport arg construction.
//
// Tests the pure builders that decide which binary and argv to invoke for
// each `via` style. The actual ssh/scp/tailscale processes are never spawned.
//
// Run: deno test extensions/models/lib/ssh_test.ts

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  buildExecInvocation,
  buildUploadInvocation,
  isValidSshHost,
  transportOpts,
} from "./ssh.ts";

const STD_OPTS = [
  "-o",
  "StrictHostKeyChecking=no",
  "-o",
  "UserKnownHostsFile=/dev/null",
  "-o",
  "ConnectTimeout=10",
];

// ---------- transportOpts ----------

Deno.test("transportOpts: default (no via) returns standard ssh flags", () => {
  assertEquals(transportOpts({ host: "h", user: "u" }), STD_OPTS);
});

Deno.test("transportOpts: via=key is identical to default", () => {
  assertEquals(
    transportOpts({ host: "h", user: "u", via: "key" }),
    STD_OPTS,
  );
});

Deno.test("transportOpts: via=bastion appends -J <bastion>", () => {
  assertEquals(
    transportOpts({
      host: "h",
      user: "u",
      via: "bastion",
      bastion: "ops@jump.example.com",
    }),
    [...STD_OPTS, "-J", "ops@jump.example.com"],
  );
});

Deno.test("transportOpts: via=bastion without bastion throws", () => {
  assertThrows(
    () => transportOpts({ host: "h", user: "u", via: "bastion" }),
    Error,
    "via=bastion requires `bastion`",
  );
});

Deno.test("transportOpts: via=proxy-command appends -o ProxyCommand=…", () => {
  const cmd =
    "aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p";
  assertEquals(
    transportOpts({
      host: "h",
      user: "u",
      via: "proxy-command",
      proxyCommand: cmd,
    }),
    [...STD_OPTS, "-o", `ProxyCommand=${cmd}`],
  );
});

Deno.test("transportOpts: via=proxy-command without proxyCommand throws", () => {
  assertThrows(
    () => transportOpts({ host: "h", user: "u", via: "proxy-command" }),
    Error,
    "via=proxy-command requires `proxyCommand`",
  );
});

// ---------- buildExecInvocation ----------

Deno.test("exec invocation: key uses ssh with target + command at the end", () => {
  const { bin, args } = buildExecInvocation(
    { host: "10.0.0.1", user: "root" },
    "uptime",
  );
  assertEquals(bin, "ssh");
  assertEquals(args, [...STD_OPTS, "root@10.0.0.1", "uptime"]);
});

Deno.test("exec invocation: tailscale uses tailscale ssh and drops strict-host flags", () => {
  const { bin, args } = buildExecInvocation(
    { host: "node-01", user: "root", via: "tailscale" },
    "uname -a",
  );
  assertEquals(bin, "tailscale");
  assertEquals(args, ["ssh", "root@node-01", "uname -a"]);
});

Deno.test("exec invocation: bastion includes -J before target", () => {
  const { bin, args } = buildExecInvocation(
    {
      host: "10.0.5.7",
      user: "root",
      via: "bastion",
      bastion: "ops@jump.example.com",
    },
    "id",
  );
  assertEquals(bin, "ssh");
  // -J must appear before user@host so ssh routes through it.
  const dashJ = args.indexOf("-J");
  const target = args.indexOf("root@10.0.5.7");
  assertEquals(dashJ < target, true, "-J should precede target");
  assertEquals(args[dashJ + 1], "ops@jump.example.com");
  assertEquals(args[args.length - 1], "id");
});

Deno.test("exec invocation: proxy-command splices ProxyCommand option", () => {
  const cmd = "aws ssm start-session --target %h";
  const { bin, args } = buildExecInvocation(
    {
      host: "i-abc",
      user: "ec2-user",
      via: "proxy-command",
      proxyCommand: cmd,
    },
    "whoami",
  );
  assertEquals(bin, "ssh");
  assertEquals(
    args.includes(`ProxyCommand=${cmd}`),
    true,
    "ProxyCommand value should be present",
  );
  assertEquals(args[args.length - 2], "ec2-user@i-abc");
  assertEquals(args[args.length - 1], "whoami");
});

// ---------- buildUploadInvocation ----------

Deno.test("upload invocation: key uses scp with host:dest target", () => {
  const { bin, args } = buildUploadInvocation(
    { host: "10.0.0.1", user: "root" },
    "/local/file",
    "/remote/file",
  );
  assertEquals(bin, "scp");
  assertEquals(args, [
    ...STD_OPTS,
    "/local/file",
    "root@10.0.0.1:/remote/file",
  ]);
});

Deno.test("upload invocation: bastion adds -J to scp", () => {
  const { args } = buildUploadInvocation(
    {
      host: "10.0.0.1",
      user: "root",
      via: "bastion",
      bastion: "ops@jump",
    },
    "/a",
    "/b",
  );
  const dashJ = args.indexOf("-J");
  assertEquals(args[dashJ + 1], "ops@jump");
  assertEquals(args[args.length - 1], "root@10.0.0.1:/b");
});

Deno.test("upload invocation: tailscale uses cat-redirect over tailscale ssh", () => {
  const { bin, args } = buildUploadInvocation(
    { host: "node-01", user: "root", via: "tailscale" },
    "/local/file",
    "/remote/file",
  );
  assertEquals(bin, "tailscale");
  assertEquals(args, ["ssh", "root@node-01", "cat > '/remote/file'"]);
});

Deno.test("upload invocation: tailscale shell-quotes single quotes in dest", () => {
  // A remote path with an embedded single quote must not break out of the
  // surrounding shell-quoting we use for `cat > <dest>`.
  const { args } = buildUploadInvocation(
    { host: "node-01", user: "root", via: "tailscale" },
    "/local",
    "/tmp/it's-fine.conf",
  );
  // POSIX single-quote escape: ' → '\''
  assertEquals(args[2], `cat > '/tmp/it'\\''s-fine.conf'`);
});

// ---------- isValidSshHost ----------

Deno.test("isValidSshHost: accepts non-empty strings", () => {
  assertEquals(isValidSshHost("10.0.0.1"), true);
  assertEquals(isValidSshHost("host.example.com"), true);
});

Deno.test("isValidSshHost: rejects falsy, non-string, and sentinel values", () => {
  assertEquals(isValidSshHost(""), false);
  assertEquals(isValidSshHost(null), false);
  assertEquals(isValidSshHost(undefined), false);
  assertEquals(isValidSshHost(123), false);
  assertEquals(isValidSshHost("null"), false);
  assertEquals(isValidSshHost("undefined"), false);
});
