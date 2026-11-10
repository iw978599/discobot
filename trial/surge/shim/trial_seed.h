// Included before every file of the trial build. Surge seeds its random number generators from
// the clock; the workflow replaces those clock readings with this, which the bridge answers from
// a sequence the seed decides, so a render can be repeated.
#pragma once
#ifdef __cplusplus
extern "C"
#endif
unsigned surge_trial_next_seed(void);
