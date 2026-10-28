export type FollowupFilter='all'|'today'|'overdue'|'next7'|'future'|'none';
export declare const followupFilters:ReadOnlyArray<{value:FollowupFilter;label:string}>;
export declare function brazilDateKey(instant:Date|string|number):string;
export declare function callbackDay(followup:{status:string;contact_due_at:string}|null|undefined):string;
export declare function followupBucket(followup:{status:string;contact_due_at:string}|null|undefined,today:string):'none'|'today'|'overdue'|'future';
export declare function isActionable(status:string):boolean;
export declare function matchesFollowup(followup:{status:string;contact_due_at:string}|null|undefined,filter:FollowupFilter,today:string,leadStatus:string):boolean;
export declare function progressColor(attemptCount:number):string;
export declare function progressWidth(attemptCount:number):string;

export type AgendaMoment={at:string;source:'scheduled'|'suggested'};
export type AgendaMode='all'|'priority'|'today'|'overdue'|'next2h'|'date';
export type AgendaSource='all'|'scheduled'|'suggested';
export declare function resolveAgendaMoment(
  followup:{status:string;contact_due_at:string}|null|undefined,
  suggestedDate:Date|string|null|undefined,
  eligible?:boolean,
):AgendaMoment|null;
export declare function agendaMatches(
  moment:AgendaMoment|null|undefined,
  options:{mode?:AgendaMode;source?:AgendaSource;date?:string;from?:string;to?:string;now?:number},
):boolean;
export declare function compareAgendaPriority(
  a:AgendaMoment|null|undefined,b:AgendaMoment|null|undefined,now?:number,
):number;
