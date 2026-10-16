#!/bin/bash
# run.sh HOME WAIT ACTIONS-SCRIPT [strace]
H=$1; export HOME=$H DISPLAY=:81; mkdir -p $H
inner="./lwc"; [ -n "$4" ] && inner="strace -f -qq -e trace=connect,openat,rename,unlink -o $H/strace.log ./lwc"
dbus-run-session -- bash -c "$inner >$H/out.txt 2>&1 & P=\$!; sleep $2; bash $3 > $HOME/actions.log 2>&1; kill -TERM \$(pgrep -P \$P -x lwc || echo \$P) 2>/dev/null; kill -TERM \$P 2>/dev/null; sleep 2" >/dev/null 2>&1
for m in $(mount | grep "$H/" | awk '{print $3}'); do sudo umount -l $m; done
