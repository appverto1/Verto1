import assert from 'node:assert/strict';
import {kanbanVirtualWindow} from '../src/utils/kanbanVirtualWindow';

// 555 leads: only a bounded number of rows belong in the DOM, even when
// scrolling through the middle or end of a very long commercial column.
const heights=Array.from({length:555},()=>388);
for(const from of [0,388,55000,118000,214000]){
  const view=kanbanVirtualWindow(heights,from,from+850);
  assert.ok(view.start>=0&&view.end<=555&&view.end>view.start);
  assert.ok(view.end-view.start<=9,'rendered DOM card count must remain bounded');
  const covered=view.before+heights.slice(view.start,view.end).reduce((a,b)=>a+b,0)+view.after;
  assert.equal(covered,555*388,'spacers preserve scrollable length');
  assert.ok(heights.slice(0,view.start).reduce((a,b)=>a+b,0)<=from);
}
// A height increase (expanded notes or dynamic card content) must not
// corrupt the spacer math; no fixed-height assumption.
const mixed=[300,610,250,520,450,700,280,350,420,380,390,570];
const v=kanbanVirtualWindow(mixed,1200,1700,0);
assert.ok(v.start>0&&v.end<12);
assert.equal(v.before+mixed.slice(v.start,v.end).reduce((a,b)=>a+b,0)+v.after,
  mixed.reduce((a,b)=>a+b,0));
assert.deepEqual(kanbanVirtualWindow([],0,800),{start:0,end:0,before:0,after:0});
assert.equal(kanbanVirtualWindow([NaN],0,800).end,1);
console.log('kanbanVirtualWindow: PASS (555 leads, bounded DOM, variable heights, spacers)');
