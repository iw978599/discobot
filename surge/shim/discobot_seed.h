// Included before every file of Discobot's Surge build (surge/build.sh). Surge seeds its random
// number generators from the clock; the build replaces those clock readings with this, which the
// bridge answers from a sequence the seed decides, so a render can be repeated.
#pragma once
#ifdef __cplusplus
extern "C"
#endif
unsigned discobot_surge_next_seed(void);
