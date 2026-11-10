#!/usr/bin/env bash
# Builds Surge XT's engine for the browser into <out dir>: surge-engine.wasm, surge-engine.js,
# BUILD.json and licences/. Runs on Linux with Emscripten active (see .github/workflows/surge-build.yml).
# docs/SURGE_XT_PLAN.md says why each change below is made.
#   surge/build.sh <work dir> <out dir>
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mkdir -p "$1" && cd "$1" && pwd)"
out="$(mkdir -p "$2" && cd "$2" && pwd)"
commit="$(tr -d '[:space:]' < "$here/SURGE_COMMIT")"
source_dir="$work/surge"
build_dir="$work/build"

# Surge's source at the pinned commit, with only the libraries the engine needs.
if [ ! -d "$source_dir/.git" ]; then
  git init -q "$source_dir"
  git -C "$source_dir" remote add origin https://github.com/surge-synthesizer/surge.git
  git -C "$source_dir" sparse-checkout set --cone src libs cmake resources/surge-shared
  git -C "$source_dir" fetch -q --depth 1 origin "$commit"
  git -C "$source_dir" checkout -q FETCH_HEAD
  for path in libs/eurorack/eurorack libs/fmt libs/simde libs/tuning-library libs/PEGTL libs/pffft \
    libs/sst/sst-basic-blocks libs/sst/sst-cpputils libs/sst/sst-effects libs/sst/sst-filters \
    libs/sst/sst-plugininfra libs/sst/sst-waveshapers libs/sst/sst-cmake libs/r8brain-free-src \
    libs/zstd libs/oddsound-mts/MTS-ESP; do
    git -C "$source_dir" submodule update -q --init --recursive --depth 1 "$path" \
      || git -C "$source_dir" submodule update -q --init --recursive "$path"
  done
fi
test "$(git -C "$source_dir" rev-parse HEAD)" = "$commit"

# Discobot's changes, each checked to have taken.
rm -rf "$source_dir/src/discobot-engine"
cp -r "$here/bridge" "$source_dir/src/discobot-engine"
grep -q 'add_subdirectory(discobot-engine)' "$source_dir/src/CMakeLists.txt" \
  || echo 'add_subdirectory(discobot-engine)' >> "$source_dir/src/CMakeLists.txt"
# 1. A Linux linker option the browser's linker does not know.
sed -i '/-Wl,--no-undefined/d' "$source_dir/src/common/CMakeLists.txt"
# 2. A browser cannot say which file it is running from; Surge only uses it to look for data
#    folders beside itself, and Discobot hands it every patch directly.
paths="$source_dir/libs/sst/sst-plugininfra/src/paths_linux.cpp"
sed -i 's|throw std::runtime_error{"Failed to retrieve shared object file name"};|return fs::path{"/surge/bin/surge.so"};|' "$paths"
grep -q '/surge/bin/surge.so' "$paths"
# 3. Surge seeds its random number generators from the clock; seed them from the bridge instead.
clock='std::chrono::system_clock::now().time_since_epoch().count()'
grep -rlF "$clock" "$source_dir/src/common" "$source_dir/libs/sst" | xargs -r sed -i "s/$clock/discobot_surge_next_seed()/g"
if grep -rqF "$clock" "$source_dir/src/common" "$source_dir/libs/sst"; then echo "A clock seed was left" >&2; exit 1; fi
# 4 and 5, a stand-in for execinfo.h and the bridge's own getentropy, are in shim/ and bridge/.

flags="-msimd128 -fwasm-exceptions -I$here/shim -include $here/shim/discobot_seed.h"
emcmake cmake -S "$source_dir" -B "$build_dir" -DCMAKE_BUILD_TYPE=Release -DENABLE_LTO=OFF \
  -DSURGE_SKIP_JUCE_FOR_RACK=ON -DSURGE_SKIP_LUA=ON -DSURGE_SKIP_ODDSOUND_MTS=ON \
  -DSURGE_SKIP_VST3=ON -DSURGE_SKIP_STANDALONE=ON -DSURGE_BUILD_CLAP=OFF \
  -DSURGE_BUILD_XT=OFF -DSURGE_BUILD_FX=OFF -DSURGE_BUILD_TESTRUNNER=OFF \
  -DSURGE_SKIP_WERROR=ON -DSURGE_BUILD_32BIT_LINUX=ON \
  -DCMAKE_C_FLAGS="$flags" -DCMAKE_CXX_FLAGS="$flags" > "$out/configure.log" 2>&1 \
  || { tail -50 "$out/configure.log"; exit 1; }
if ! cmake --build "$build_dir" --target surge-engine -j "$(nproc)" -- -k > "$out/build.log" 2>&1; then
  grep -nE -B2 -A12 "error:|undefined symbol|Error [0-9]" "$out/build.log" | head -400
  exit 1
fi

built="$build_dir/src/discobot-engine"
cp "$built/surge-engine.wasm" "$built/surge-engine.js" "$out/"

# The licence of Surge and of every library it was built with, to be read before anything ships.
rm -rf "$out/licences"
(cd "$source_dir" && find . -maxdepth 6 -type f \( -iname 'LICENSE*' -o -iname 'LICENCE*' -o -iname 'COPYING*' \) \
  -not -path './.git/*' -not -path '*/test*' -not -path '*/doc*' | sort) | while read -r file; do
  mkdir -p "$out/licences/$(dirname "$file")"
  cp "$source_dir/$file" "$out/licences/$file"
done

emcc_version="$(emcc --version | head -1)"
node -e '
  const fs = require("fs"), crypto = require("crypto"), path = require("path");
  const [out, commit, emcc] = process.argv.slice(1);
  const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(out, f))).digest("hex");
  const files = Object.fromEntries(["surge-engine.wasm", "surge-engine.js"].map((f) => [f, { sha256: sha(f), bytes: fs.statSync(path.join(out, f)).size }]));
  fs.writeFileSync(path.join(out, "BUILD.json"), JSON.stringify({ surge: { repository: "https://github.com/surge-synthesizer/surge", commit }, emscripten: emcc, files }, null, 2) + "\n");
' "$out" "$commit" "$emcc_version"
cat "$out/BUILD.json"
