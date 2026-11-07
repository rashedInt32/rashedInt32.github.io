#!/bin/zsh
# Samples whole-device GPU utilisation (ioreg) and Chrome renderer / GPU-process
# CPU share (top) for N seconds, with the site in the front tab. macOS only.
# usage: art/sample_gpu.sh <label> [seconds]   -> prints the means, keeps /tmp/harbor-cmp/<label>.csv
label=$1; secs=${2:-8}; mkdir -p /tmp/harbor-cmp; out=/tmp/harbor-cmp/$label.csv
: > $out
rpids=$(ps -eo pid,args | grep -- "--type=renderer" | grep -v grep | awk '{print $1}' | tr '\n' '|' | sed 's/|$//')
gpids=$(ps -eo pid,args | grep -- "--type=gpu-process" | grep -v grep | awk '{print $1}' | tr '\n' '|' | sed 's/|$//')
end=$((SECONDS+secs))
while [ $SECONDS -lt $end ]; do
  gpu=$(ioreg -r -d 1 -c IOAccelerator 2>/dev/null | grep -o '"Device Utilization %"=[0-9]*' | head -1 | cut -d= -f2)
  t=$(top -l 2 -s 1 -stats pid,cpu 2>/dev/null | awk '/^PID/{n++} n==2 && $1 ~ /^[0-9]+$/ {print $1, $2}')
  rend=$(echo "$t" | awk -v p="^($rpids)$" '$1 ~ p {s+=$2} END{print s+0}')
  gpup=$(echo "$t" | awk -v p="^($gpids)$" '$1 ~ p {s+=$2} END{print s+0}')
  echo "$(date +%s),$gpu,$rend,$gpup" >> $out
done
awk -F, '{g+=$2;r+=$3;p+=$4;n++} END{printf "%s: n=%d gpu_util=%.1f%% renderer_cpu=%.1f%% gpu_proc_cpu=%.1f%%\n", "'$label'", n, g/n, r/n, p/n}' $out
