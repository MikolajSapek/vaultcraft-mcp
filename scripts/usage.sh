#!/bin/sh
# Daily usage from the server's log lines: sessions (initialize), tool calls per tool, errors.
# Run on sapserver: sh scripts/usage.sh [days]   (default 14)
DAYS=${1:-14}
docker logs --timestamps --since "${DAYS}d" vaultcraft-mcp 2>/dev/null | awk '
  $2 != "mcp" { next }
  { day = substr($1, 1, 10); days[day] = 1 }
  $4 == "initialize" { init[day]++; split($5, c, "/"); clients[c[1]]++ }
  $4 == "tools/call" { calls[day]++; tool[$5]++; tday[day, $5]++ }
  $3 !~ /^2/ { err[day]++ }
  END {
    n = asorti(days, d)
    printf "%-10s %8s %8s %6s   %s\n", "day", "sessions", "toolcall", "errors", "check_vault/template/config"
    for (i = 1; i <= n; i++) { k = d[i]
      printf "%-10s %8d %8d %6d   %d/%d/%d\n", k, init[k], calls[k], err[k], tday[k,"check_vault"], tday[k,"get_note_template"], tday[k,"get_vault_config"] }
    print "\nclients:"; for (c in clients) printf "  %6d %s\n", clients[c], c
    print "tools:";   for (t in tool) printf "  %6d %s\n", tool[t], t
  }'
