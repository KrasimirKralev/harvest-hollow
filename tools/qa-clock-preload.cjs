// Preload for the QA server only (NODE_OPTIONS=--require): shifts Date.now() by QA_CLOCK_OFFSET_MS so a NEW farm is created at the
// moment the playtest schedule starts (a Monday evening) instead of being created now and time-warped (a warp over hours makes the
// server regrow debris, which would put free XP into the very first minute). Nothing in server/ or shared/ is touched.
const off = Number(process.env.QA_CLOCK_OFFSET_MS || 0);
if (off) {
  const real = Date.now.bind(Date);
  Date.now = () => real() + off;
}
