#!/usr/bin/env bash
# Disk is tight on the dev Mac. @copilotkit/react-native pulls in web-only packages (mermaid,
# streamdown, lit, katex, ...) that the /headless entry never imports. Remove them after install.
# Run: npm run prune   (safe to run repeatedly; it only deletes folders that exist)
set -euo pipefail
cd "$(dirname "$0")/.."
NM=node_modules
rm_pkg() { [ -e "$NM/$1" ] && rm -rf "$NM/$1" && echo "pruned $1" || true; }
for p in mermaid @mermaid-js streamdown lucide-react lucide shiki @shikijs katex \
         cytoscape cytoscape-cose-bilkent cytoscape-fcose dagre-d3-es langium chevrotain \
         @chevrotain vscode-languageserver vscode-languageserver-types vscode-languageserver-textdocument \
         vscode-uri @braintree khroma roughjs marked-katex-extension; do
  rm_pkg "$p"
done
for d in "$NM"/d3 "$NM"/d3-*; do [ -e "$d" ] && rm -rf "$d" && echo "pruned ${d#$NM/}" || true; done
npm cache clean --force >/dev/null 2>&1 || true
df -h . | tail -1
