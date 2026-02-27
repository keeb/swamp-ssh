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

## License

MIT
