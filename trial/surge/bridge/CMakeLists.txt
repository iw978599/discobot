# The Discobot trial's bridge into Surge XT's engine. The workflow copies this folder into
# Surge's src/ and adds it to Surge's own build, so it builds with Surge's settings.
project(discobot-surge-trial)

add_executable(surge-trial bridge.cpp)
target_link_libraries(surge-trial PRIVATE surge::surge-common)
set_target_properties(surge-trial PROPERTIES SUFFIX ".js")
target_link_options(surge-trial PRIVATE
  -O3
  -msimd128
  -fwasm-exceptions
  -sMODULARIZE=1
  -sEXPORT_NAME=createSurgeModule
  -sENVIRONMENT=node,shell
  -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=67108864
  -sSTACK_SIZE=1048576
  -sTEXTDECODER=0
  -sEXPORTED_RUNTIME_METHODS=HEAPF32,HEAPU8,UTF8ToString
  "-sEXPORTED_FUNCTIONS=_malloc,_free,_surge_create,_surge_destroy,_surge_load_fxp,_surge_note_on,_surge_note_off,_surge_all_notes_off,_surge_set_macro,_surge_macro_name,_surge_patch_name,_surge_render,_surge_block_size,_surge_seed"
)
