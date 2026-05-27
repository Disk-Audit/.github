#!/bin/sh
# Runs after the .deb finishes installing. Installs the Nemo right-click
# integration system-wide so every user on the machine gets "Scan with
# Disk Analyzer" in their folder context menu (Mint / Cinnamon).
#
# Also refreshes the desktop + icon databases so the .desktop file and
# new icon appear immediately without a logout.

set -e

INSTALL_DIR="/opt/Disk Analyzer"
NEMO_ACTIONS_DIR="/usr/share/nemo/actions"
NEMO_ACTION_FILE="disk-analyzer.nemo_action"

# Install the Nemo action if the source file is present in our resources.
# Doing it conditionally lets the same package work on systems without
# Nemo (the file just sits there harmlessly under /usr/share/nemo/).
if [ -f "$INSTALL_DIR/resources/$NEMO_ACTION_FILE" ]; then
    mkdir -p "$NEMO_ACTIONS_DIR"
    cp "$INSTALL_DIR/resources/$NEMO_ACTION_FILE" "$NEMO_ACTIONS_DIR/"
    chmod 0644 "$NEMO_ACTIONS_DIR/$NEMO_ACTION_FILE"
fi

# Refresh the system desktop database so the MimeType=inode/directory
# association in our .desktop file gets picked up immediately. Without
# this, file managers may not see Disk Analyzer in "Open With" until the
# next login.
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database -q /usr/share/applications || true
fi

# Refresh the icon cache so the new icon shows in menus right away.
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi

exit 0
