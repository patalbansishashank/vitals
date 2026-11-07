/**
 * Test clock for the Ring fixture: the fixture's last night ends at its wake time (07:14–07:36) or at `now`, whichever
 * comes first, so before then every "last night" assertion depended on the hour the suite ran (0.6.3: they failed until
 * about 07:30). `Date` is always moved to 12:00 of the current calendar day (time still flows from there), so the
 * suite reads the same day at any hour. Import first in a test file.
 */
const RealDate = Date;
const noon = new RealDate();
noon.setHours(12, 0, 0, 0);
const offset = noon.getTime() - RealDate.now();
class ShiftedDate extends RealDate {
  constructor(...args: ConstructorParameters<typeof Date> | []) {
    if (args.length === 0) super(RealDate.now() + offset);
    else super(...(args as ConstructorParameters<typeof Date>));
  }
  static override now(): number {
    return RealDate.now() + offset;
  }
}
globalThis.Date = ShiftedDate as DateConstructor;
export {};
