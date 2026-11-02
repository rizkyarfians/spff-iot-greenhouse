#include "TimedWaterDeadline.h"
#include <cassert>
#include <cstdint>
int main() {
  spff::TimedWaterDeadline guard;
  assert(!guard.expired(0));
  assert(!guard.arm(100U, 0U, 180U));
  assert(!guard.arm(100U, 105U, 0U));
  assert(!guard.arm(100U, 181U, 180U));
  assert(!guard.arm(100U, UINT32_MAX, UINT32_MAX));
  assert(guard.arm(100U, 105U, 180U));
  assert(!guard.arm(100U, 30U, 180U));
  assert(!guard.expired(105099U));
  assert(guard.expired(105100U));
  guard.reset();
  assert(!guard.expired(105100U));
  assert(guard.arm(UINT32_MAX - 400U, 1U, 10U));
  assert(!guard.expired(598U));
  assert(guard.expired(599U));
  guard.reset();
  return 0;
}
