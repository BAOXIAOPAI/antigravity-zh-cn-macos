# Shared by the two Finder launchers. Sourcing this file only defines functions.
ag_find_node() {
  local candidate
  for candidate in "$@"; do
    if [[ -x "$candidate" ]] && "$candidate" -e '
      const major = Number(process.versions.node.split(".")[0]);
      process.exit(major >= 22 && typeof WebSocket === "function" ? 0 : 1);
    ' >/dev/null 2>&1; then
      print -r -- "$candidate"
      return 0
    fi
  done
  return 1
}

ag_run_adapter() {
  local adapter_dir="$1"
  local adapter_mode="$2"
  local path_node="$(command -v node 2>/dev/null)"
  local node_bin
  local -a node_candidates
  node_candidates=(
    "$path_node"
    /opt/homebrew/bin/node
    /usr/local/bin/node
    "$HOME"/.nvm/versions/node/v*/bin/node(NOn)
  )
  node_bin="$(ag_find_node "${node_candidates[@]}")" || {
    print '未找到可用的 Node.js 22 或更新版本（需要内置 WebSocket）。'
    print '请从 https://nodejs.org/ 安装 Node.js 后重试。'
    return 1
  }
  "$node_bin" "$adapter_dir/adapter.mjs" "$adapter_mode"
}
