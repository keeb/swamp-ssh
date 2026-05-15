# @keeb/ssh

[Swamp](https://github.com/systeminit/swamp) extension for general-purpose SSH operations.

## Models

### `ssh/host`

Remote command execution, file upload, and connection waiting over SSH.

| Method | Description |
|--------|-------------|
| `exec` | Execute a command on the remote host |
| `upload` | SCP a file to the remote host |
| `waitForConnection` | Wait until SSH is reachable (with timeout) |

#### Transports

Set `via` on the model to pick how the connection is established:

| `via` | Notes |
|-------|-------|
| `key` (default) | Plain `ssh`/`scp` using the local agent + `~/.ssh` keys |
| `tailscale` | `tailscale ssh` — uses tailnet identity; no static keys needed |
| `bastion` | Routes through `-J <bastion>` (e.g. `user@jump-host`) |
| `proxy-command` | Tunnels via an arbitrary `ProxyCommand` (e.g. AWS SSM) |

Extra globalArguments per transport:

- `via: bastion` → `bastion: "user@jump-host"`
- `via: proxy-command` → `proxyCommand: "aws ssm start-session --target i-..."`

## Workflows

None — this is a foundational model used by other extensions.

## Dependencies

None.

## Used by

- [swamp-proxmox](https://github.com/keeb/swamp-proxmox) — SSH helpers for VM operations
- [swamp-docker](https://github.com/keeb/swamp-docker) — Docker install/compose over SSH
- [swamp-alpine](https://github.com/keeb/swamp-alpine) — Alpine disk install over SSH
- [swamp-tailscale](https://github.com/keeb/swamp-tailscale) — Tailscale install over SSH
- [swamp-nginx](https://github.com/keeb/swamp-nginx) — Nginx proxy config over SSH
- [swamp-prometheus](https://github.com/keeb/swamp-prometheus) — Monitoring agent install over SSH
- [swamp-grafana](https://github.com/keeb/swamp-grafana) — Grafana API helpers use SSH lib
- [swamp-minecraft](https://github.com/keeb/swamp-minecraft) — Minecraft server control over SSH
- [swamp-terraria](https://github.com/keeb/swamp-terraria) — Terraria server control over SSH

## Install

```bash
swamp extension pull @keeb/ssh
```

## Example

Wait for a freshly booted VM, run a remote command, then upload a file:

```yaml
models:
  - name: host
    type: "@keeb/ssh/host"
    globalArguments:
      host: "10.0.0.42"
      user: "root"

jobs:
  - name: provision
    steps:
      - model: host
        method: waitForConnection
        inputs: { timeout: 120 }
      - model: host
        method: exec
        inputs: { command: "apk add curl bash" }
      - model: host
        method: upload
        inputs:
          source: "./config.yaml"
          dest: "/etc/app/config.yaml"
```

### Via a bastion / jump host

```yaml
models:
  - name: host
    type: "@keeb/ssh/host"
    globalArguments:
      host: "10.0.0.42"
      user: "root"
      via: bastion
      bastion: "ops@jump.example.com"
```

### Over Tailscale

```yaml
models:
  - name: host
    type: "@keeb/ssh/host"
    globalArguments:
      host: "node-01"
      user: "root"
      via: tailscale
```

### Through AWS SSM (proxy-command)

```yaml
models:
  - name: host
    type: "@keeb/ssh/host"
    globalArguments:
      host: "i-0123456789abcdef0"
      user: "ec2-user"
      via: proxy-command
      proxyCommand: "aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p"
```

## License

MIT
