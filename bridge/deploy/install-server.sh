#!/bin/sh
set -eu
getent passwd desktopbridge >/dev/null || useradd --system --home-dir /var/lib/desktop-bridge --shell /usr/sbin/nologin desktopbridge
install -d -m 700 -o desktopbridge -g desktopbridge /var/lib/desktop-bridge
install -d -m 750 -o root -g desktopbridge /etc/desktop-bridge
install -d -m 755 /opt/desktop-bridge/releases
release="/opt/desktop-bridge/releases/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 755 "$release"
tar -xzf /tmp/desktop-bridge-source.tar.gz -C "$release"
cd "$release"
npm ci --omit=dev --ignore-scripts
install -m 400 -o desktopbridge -g desktopbridge /tmp/desktop-bridge-config.json /etc/desktop-bridge/config.json
rm /tmp/desktop-bridge-config.json
ln -sfn "$release" /opt/desktop-bridge/current
install -m 644 deploy/desktop-bridge.service /etc/systemd/system/desktop-bridge.service
install -m 644 deploy/desktop-bridge-watchdog.service /etc/systemd/system/desktop-bridge-watchdog.service
install -m 644 deploy/desktop-bridge-watchdog.timer /etc/systemd/system/desktop-bridge-watchdog.timer
systemctl daemon-reload
systemctl enable --now desktop-bridge.service desktop-bridge-watchdog.timer
systemctl restart desktop-bridge.service
python3 - <<'PY'
import time,urllib.request,urllib.error
for i in range(20):
    try:
        with urllib.request.urlopen('http://127.0.0.1:8787/healthz',timeout=2) as response:
            assert response.status==200
        break
    except Exception:
        time.sleep(0.5)
else: raise RuntimeError('Bridge health check failed')
request=urllib.request.Request('http://127.0.0.1:8787/mcp',data=b'{}',headers={'Content-Type':'application/json'})
try:
    urllib.request.urlopen(request,timeout=3)
    raise RuntimeError('MCP endpoint was accessible without credentials')
except urllib.error.HTTPError as e:
    assert e.code==401, e.code
print('Bridge health and authorization checks passed')
PY
python3 - <<'PY'
from pathlib import Path
import shutil,datetime,subprocess
config=Path('/etc/caddy/Caddyfile')
text=config.read_text()
if 'mcp.ilovestudy.de' not in text:
    backup=Path('/var/backups/desktop-bridge');backup.mkdir(mode=0o700,exist_ok=True)
    filename=backup/('Caddyfile.'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    shutil.copy2(config,filename)
    config.write_text(text+'\n\n# Personal Desktop Bridge\nmcp.ilovestudy.de {\n    reverse_proxy 127.0.0.1:8787\n}\n')
    result=subprocess.run(['caddy','validate','--config',str(config),'--adapter','caddyfile'],capture_output=True,text=True)
    if result.returncode:
        shutil.copy2(filename,config)
        raise RuntimeError('Caddy validation failed; original configuration restored')
    subprocess.run(['systemctl','reload','caddy'],check=True)
    print('Added and validated the MCP HTTPS site; original Caddy configuration backed up')
else:
    print('MCP hostname already present; Caddy configuration unchanged')
PY
systemctl is-active desktop-bridge.service desktop-bridge-watchdog.timer caddy
