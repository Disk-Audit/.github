#!/bin/sh
# Runs before the .deb is removed. Cleans up the system-wide files we
# installed in linux-after-install.sh so uninstall leaves nothing behind.

set -e

NEMO_ACTION_FILE="/usr/share/nemo/actions/disk-analyzer.nemo_action"

if [ -f "$NEMO_ACTION_FILE" ]; then
    rm -f "$NEMO_ACTION_FILE"
fi

# Refresh databases so the integration disappears immediately.
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database -q /usr/share/applications || true
fi

exit 0
