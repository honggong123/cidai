#!/usr/bin/env bash
# 验收流水线：一次跑完这轮该跑的探针，每支的输出写进 /tmp/ov/<name>.txt。
#
#   bash tools/_accept.sh [cdpPort] [httpPort] [quick]
#
# ★ 两个端口是**启动 _dev.mjs 时给的参数**，不是常量（默认写的是最近一次的 9447/8932）。
#   照抄一个死端口报 ECONNREFUSED；照抄一个活着的、但不是这个项目的端口**什么都不报** ——
#   所以这里必须传对。
# ★ 每一步都重定向到文件、**绝不接管道**：`node ... | tail` 会让探针收到 SIGTERM 并丢掉
#   输出（本项目已踩过两次）。
# ★ 需要 tools/_dev.mjs 已经在跑（静态服务 + 带 --remote-debugging-port 的浏览器）。
set -u
cd "$(dirname "$0")/.."
CDP=${1:-9447}
HTTP=${2:-8932}
MODE=${3:-all}
N=${NODE_BIN:-node}
DEV="http://127.0.0.1:${HTTP}/"
OUT=${ACCEPT_OUT:-/tmp/ov}
mkdir -p "$OUT"

# name / 命令。`_moves.mjs` 一个人就要九分钟，所以它在最后。
run() { local name=$1; shift; echo "== $name"; "$@" > "$OUT/$name.txt" 2>&1; echo "   exit=$?"; }

run build       $N build.mjs
run standalone  $N tools/standalone.mjs
run ov-default  $N tools/_ov.mjs "$DEV" "$CDP"
# ≤900 是两条带子，分开跑：高窄带（纸挂在页头之下）与手机横屏带（纸被钳到框顶，
# 见 styles.css 的 --plate-floor）。混在一条命令里跑会越过前台超时。
run ov-band     $N tools/_ov.mjs "$DEV" "$CDP" "900x700,820x640,700x600,620x560,480x520,380x640,760x420"
run ov-short    $N tools/_ov.mjs "$DEV" "$CDP" "844x390,780x360,667x375,568x320"
run hit         $N tools/_hit.mjs "$DEV" "$CDP"
run smoke-dev   $N tools/_eval.mjs "${DEV}index.html?intro=0&t=studio" @tools/_smoke.js "$CDP"
run smoke-stand $N tools/_eval.mjs "${DEV}dist/ghost-standalone.html?intro=0&t=studio" @tools/_smoke.js "$CDP"
run pick        $N tools/_pick.mjs "$DEV" "$CDP"
run swap        $N tools/_swap.mjs "$DEV" "$CDP"
run dbl         $N tools/_eval.mjs "$DEV" @tools/_dbl.js "$CDP"
run rew         $N tools/_rew.mjs
run sil         $N tools/_sil.mjs

[ "$MODE" = quick ] && { echo "quick done"; exit 0; }
run song        $N tools/_song.mjs "$DEV" "$CDP"
run sing        $N tools/_sing.mjs "$DEV" "$CDP"
run moves       $N tools/_moves.mjs "$DEV" "$CDP"
echo "all done"
