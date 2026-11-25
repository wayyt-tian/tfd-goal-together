'use strict';
if (process.env.GUOQI_NOW) {
  const NativeDate = Date, instant = NativeDate.parse(process.env.GUOQI_NOW);
  if (!Number.isFinite(instant)) throw new Error('测试时间无效。');
  global.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  };
}
