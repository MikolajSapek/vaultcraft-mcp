#!/bin/sh
# Daily usage from the server's log lines: sessions (initialize), tool calls per tool, errors.
# Usage: sh scripts/usage.sh [days]   (default 14). Runs on sapserver, or on the Mac via ssh.
DAYS=${1:-14}
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx vaultcraft-mcp; then
  logs() { docker logs --timestamps --since "$((DAYS * 24))h" vaultcraft-mcp 2>/dev/null; }
else
  logs() { ssh sapserver "docker logs --timestamps --since $((DAYS * 24))h vaultcraft-mcp" 2>/dev/null; }
fi
logs | awk '
  $2 != "mcp" { next }
  { day = substr($1, 1, 10); days[day] = 1 }
  $4 == "initialize" { init[day]++; split($5, c, "/"); clients[c[1]]++ }
  $4 == "tools/call" { calls[day]++; tool[$5]++; tday[day, $5]++ }
  $3 !~ /^2/ { err[day]++ }
  END {
    printf "%-10s %8s %8s %6s   %s\n", "day", "sessions", "toolcall", "errors", "check_vault/template/config"
    for (k in days) printf "%-10s %8d %8d %6d   %d/%d/%d\n", k, init[k], calls[k], err[k], tday[k,"check_vault"], tday[k,"get_note_template"], tday[k,"get_vault_config"] | "sort"
    close("sort")
    print "\nclients:"; for (n in clients) printf "  %6d %s\n", clients[n], n
    print "tools:";   for (t in tool) printf "  %6d %s\n", tool[t], t
  }'
