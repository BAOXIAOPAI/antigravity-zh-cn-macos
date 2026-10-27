#!/bin/zsh
adapter_dir="${0:A:h}"
source "$adapter_dir/scripts/launcher.zsh" || exit 1
ag_run_adapter "$adapter_dir" --restore
launch_exit=$?
print '\n按回车关闭此窗口。'
read -r
exit "$launch_exit"
