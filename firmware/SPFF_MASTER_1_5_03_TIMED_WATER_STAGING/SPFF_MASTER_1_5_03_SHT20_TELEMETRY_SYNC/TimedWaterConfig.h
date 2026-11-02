#pragma once
// Set only after validating the physical pump runtime limit. 0 rejects timed ON.
#ifndef SPFF_TIMED_WATER_MAX_SECONDS
#define SPFF_TIMED_WATER_MAX_SECONDS 0U
#endif
static_assert(SPFF_TIMED_WATER_MAX_SECONDS <= 86400U, "Timed water maximum exceeds 24h");
