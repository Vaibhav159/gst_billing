function timed(label, fn) {
  return async () => {
    const t0 = Date.now();
    try {
      await fn();
      console.log(`[TIMING] ${label}: ${Date.now() - t0}ms ✓`);
    } catch (e) {
      console.log(`[TIMING] ${label}: ${Date.now() - t0}ms ✗ (${e.message.split('\n')[0]})`);
      throw e;
    }
  };
}
module.exports = { timed };
