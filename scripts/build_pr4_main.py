#!/usr/bin/env python3
"""Strip orders-dashboard import and routes from main.ts (for stacked PR 4)."""
import subprocess
import sys


def main() -> None:
    rev = sys.argv[1] if len(sys.argv) > 1 else "ba95e4c"
    text = subprocess.check_output(
        ["git", "show", f"{rev}:src/main.ts"],
        text=True,
    )
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("import {") and "} from" in line:
            if "orders_dashboard.ts" in line:
                i += 1
                continue
            out.append(line)
            i += 1
            continue
        if line.startswith("import {") and "} from" not in line:
            block = [line]
            j = i + 1
            while j < len(lines) and "} from" not in lines[j]:
                block.append(lines[j])
                j += 1
            if j < len(lines):
                block.append(lines[j])
            joined = "".join(block)
            if "orders_dashboard.ts" in joined:
                i = j + 1
                continue
            out.extend(block)
            i = j + 1
            continue
        if "handleOrdersDashboard" in line or "handleListPlacedOrders" in line:
            i += 1
            continue
        out.append(line)
        i += 1
    sys.stdout.write("".join(out))


if __name__ == "__main__":
    main()
