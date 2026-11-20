/**
 * Bounded DOM window for Kanban cards. Rows use measured heights, not a fixed
 * CSS height, so expanding notes or changing card content keeps scroll geometry.
 * Pure function: no I/O, cache, timing or clinical state.
 */
export type KanbanWindow = {start:number;end:number;before:number;after:number};

export const kanbanVirtualWindow = (
  heights: readonly number[],
  visibleStart: number,
  visibleEnd: number,
  overscan = 720,
): KanbanWindow => {
  const sizes=heights.map(h=>Number.isFinite(h)&&h>0?h:388);
  const total=sizes.reduce((sum,h)=>sum+h,0);
  const low=Math.max(0,visibleStart-overscan);
  const high=Math.max(low,visibleEnd+overscan);
  let start=0,before=0;
  while(start<sizes.length-1&&before+sizes[start]<low){
    before+=sizes[start++];
  }
  let end=start,seen=before;
  while(end<sizes.length&&(seen<high||end===start)){
    seen+=sizes[end++];
  }
  return {start,end,before,after:Math.max(0,total-seen)};
};
