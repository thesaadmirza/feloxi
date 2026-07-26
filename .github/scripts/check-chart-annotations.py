#!/usr/bin/env python3
"""Validate the chart's Artifact Hub annotations.

artifacthub.io/changes is a YAML document embedded in a string, so a typo in it
parses fine as far as Helm is concerned and only shows up as a broken listing
on Artifact Hub. Check it here instead.
"""

import sys

import yaml

CHART = "charts/feloxi/Chart.yaml"

# https://artifacthub.io/docs/topics/annotations/helm/
VALID_KINDS = {"added", "changed", "deprecated", "removed", "fixed", "security"}


def main() -> int:
    try:
        with open(CHART) as fh:
            chart = yaml.safe_load(fh)
    except yaml.YAMLError as exc:
        print(f"{CHART}: not valid YAML: {exc}")
        return 1

    annotations = chart.get("annotations") or {}
    raw = annotations.get("artifacthub.io/changes")
    if raw is None:
        print(f"{CHART}: missing artifacthub.io/changes annotation")
        return 1

    try:
        changes = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        print(f"{CHART}: artifacthub.io/changes is not valid YAML: {exc}")
        return 1

    if not isinstance(changes, list) or not changes:
        print(f"{CHART}: artifacthub.io/changes must be a non-empty list")
        return 1

    errors = []
    for i, change in enumerate(changes):
        if not isinstance(change, dict):
            errors.append(f"entry {i}: expected a mapping, got {type(change).__name__}")
            continue
        kind = change.get("kind")
        if kind not in VALID_KINDS:
            errors.append(f"entry {i}: kind {kind!r} is not one of {sorted(VALID_KINDS)}")
        if not (change.get("description") or "").strip():
            errors.append(f"entry {i}: description is empty")

    if errors:
        for err in errors:
            print(f"{CHART}: {err}")
        return 1

    print(f"{CHART}: {len(changes)} change entries, appVersion {chart['appVersion']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
