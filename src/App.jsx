import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import React from "react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from "recharts";
import { supabase } from './supabase.js';
import { dbGetUsers, dbSaveUser, dbDeleteUser, dbGetPassword, dbSetPassword, dbGetCompanies, dbSaveCompany, dbDeleteCompany, dbGetClients, dbSaveClient, dbDeleteClient, dbGetTicketTypes, dbSaveTicketType, dbDeleteTicketType, dbGetTickets, dbSaveTicket, dbGetLogs, dbAddLog, dbGetSchedules, dbSaveSchedule, dbGetEmailTemplates, dbSaveEmailTemplate, dbDeleteEmailTemplate } from './db.js';

const PAL = ["#6366f1","#8b5cf6","#0ea5e9","#10b981","#f59e0b","#ef4444","#ec4899","#f97316"];
const STATUS_META = { "Open":{color:"#f59e0b",bg:"#fef3c7"}, "In Progress":{color:"#6366f1",bg:"#eef2ff"}, "Pending":{color:"#0ea5e9",bg:"#e0f2fe"}, "Escalated":{color:"#ef4444",bg:"#fee2e2"}, "Closed":{color:"#94a3b8",bg:"#f1f5f9"} };
const ALL_STATUSES = ["Open","In Progress","Pending","Escalated","Closed"];
const PRI_META = { critical:{color:"#dc2626",bg:"#fee2e2",label:"Critical"}, high:{color:"#ef4444",bg:"#fef2f2",label:"High"}, medium:{color:"#f59e0b",bg:"#fffbeb",label:"Medium"}, low:{color:"#10b981",bg:"#f0fdf4",label:"Low"} };
const IT_ROLES = ["admin","it_manager","it_technician"];
const DEFAULT_STATUS_SLA = { "Open":2, "In Progress":8, "Pending":24, "Escalated":1, "Closed":null };
const DOW_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DEFAULT_ROLES = { admin:{label:"Administrator",color:"#dc2626",system:true}, it_manager:{label:"IT Manager",color:"#7c3aed",system:true}, it_technician:{label:"IT Technician",color:"#2563eb",system:true}, end_user:{label:"End User",color:"#059669",system:true} };
// PHT = UTC+8
const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;

function loadRoles(){ try{ var s=localStorage.getItem("hd_roles"); return s?Object.assign({},DEFAULT_ROLES,JSON.parse(s)):Object.assign({},DEFAULT_ROLES); }catch(e){ return Object.assign({},DEFAULT_ROLES); } }
function saveRoles(v){ try{ localStorage.setItem("hd_roles",JSON.stringify(v)); }catch(e){} }
var ROLE_META = loadRoles();

const uid   = function(){ return "id_"+Date.now()+"_"+Math.random().toString(36).slice(2,6); };
const fdt   = function(iso){ return iso?new Date(iso).toLocaleString("en-PH",{month:"short",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Manila"}):"—"; };
const fdtFull = function(iso){ return iso?new Date(iso).toLocaleString("en-PH",{weekday:"short",month:"short",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"Asia/Manila"}):"—"; };
const ago   = function(iso){ if(!iso)return"—"; var m=Math.floor((Date.now()-new Date(iso))/60000); if(m<1)return"just now"; if(m<60)return m+"m ago"; var h=Math.floor(m/60); if(h<24)return h+"h ago"; return Math.floor(h/24)+"d ago"; };
const inits = function(n){ if(!n)return"??"; var p=n.trim().split(" ").filter(Boolean); return p.length>=2?(p[0][0]+p[1][0]).toUpperCase():n.slice(0,2).toUpperCase(); };
const avCol = function(id){ return PAL[Math.abs((id||"").split("").reduce(function(a,c){return a+c.charCodeAt(0);},0))%PAL.length]; };
const slaColor = function(r){ return r>=90?"#10b981":r>=75?"#f59e0b":"#ef4444"; };
const fmtMs = function(mins){ if(!mins&&mins!==0)return"—"; var s=mins*60; if(s<60)return s.toFixed(2)+"s"; if(s<3600){var m=Math.floor(mins);var sc=parseFloat(((mins-m)*60).toFixed(2));return m+"m "+sc+"s";} var h=Math.floor(mins/60);var rm=mins-h*60;var m2=Math.floor(rm);var s2=parseFloat(((rm-m2)*60).toFixed(2));return h+"h "+m2+"m "+s2+"s"; };
const fmtHrs = function(h){ if(!h&&h!==0)return"0h"; return h.toFixed(1)+"h"; };
const pieLabel = function(p){ return p.value>0?p.name+": "+p.value:""; };

// Generate 30-minute interval options for time select (PHT display)
function genTimeOptions(){
  var opts=[];
  for(var h=0;h<24;h++){
    for(var m=0;m<60;m+=30){
      var totalMins=h*60+m;
      var label=formatTimeSlot(totalMins);
      opts.push({value:totalMins,label:label});
    }
  }
  return opts;
}
function formatTimeSlot(totalMins){
  var h=Math.floor(totalMins/60);
  var m=totalMins%60;
  var ampm=h<12?"AM":"PM";
  var h12=h===0?12:h>12?h-12:h;
  return h12+":"+(m===0?"00":"30")+" "+ampm+" PHT";
}
const TIME_OPTIONS = genTimeOptions();

function nowPHT(){
  // Returns a Date object adjusted to PHT
  return new Date(Date.now()+PHT_OFFSET_MS);
}
function getPHTDow(isoStr){
  // day of week in PHT for a given ISO string
  var d=new Date(new Date(isoStr).getTime()+PHT_OFFSET_MS);
  return d.getUTCDay();
}
function getPHTDateStr(isoStr){
  // YYYY-MM-DD in PHT
  var d=new Date(new Date(isoStr).getTime()+PHT_OFFSET_MS);
  return d.getUTCFullYear()+"-"+(d.getUTCMonth()+1).toString().padStart(2,"0")+"-"+d.getUTCDate().toString().padStart(2,"0");
}
function getPHTHourMins(isoStr){
  // Returns total minutes from midnight PHT
  var d=new Date(new Date(isoStr).getTime()+PHT_OFFSET_MS);
  return d.getUTCHours()*60+d.getUTCMinutes();
}
function getPHTWeekKey(isoStr){
  var d=new Date(new Date(isoStr).getTime()+PHT_OFFSET_MS);
  var dow=d.getUTCDay();
  var weekStart=new Date(d.getTime()-(dow*86400000));
  return weekStart.getUTCFullYear()+"-W"+(weekStart.getUTCMonth()+1).toString().padStart(2,"0")+"-"+weekStart.getUTCDate().toString().padStart(2,"0");
}
function getPHTMonthKey(isoStr){
  var d=new Date(new Date(isoStr).getTime()+PHT_OFFSET_MS);
  return d.getUTCFullYear()+"-"+(d.getUTCMonth()+1).toString().padStart(2,"0");
}

function isCurrentlyOnShiftPHT(schedule){
  if(!schedule||!schedule.days||!schedule.days.length)return true;
  var now=nowPHT();
  var dow=now.getUTCDay();
  var curMins=now.getUTCHours()*60+now.getUTCMinutes();
  if(!schedule.days.includes(dow))return false;
  // Per-day schedule: schedule.dayConfig[dow] = {startMins, endMins}
  if(schedule.dayConfig&&schedule.dayConfig[dow]){
    var cfg=schedule.dayConfig[dow];
    return curMins>=cfg.startMins&&curMins<cfg.endMins;
  }
  // Fallback uniform
  var startMins=(schedule.startHour||9)*60;
  var endMins=(schedule.endHour||17)*60;
  return curMins>=startMins&&curMins<endMins;
}

function calcBusinessHoursElapsedPHT(startMs,endMs,schedule){
  if(!schedule||!schedule.days||!schedule.days.length)return(endMs-startMs)/3600000;
  var total=0,cur=startMs;
  while(cur<endMs){
    var dPHT=new Date(cur+PHT_OFFSET_MS);
    var dow=dPHT.getUTCDay();
    var dayStartPHT=new Date(dPHT.getUTCFullYear(),dPHT.getUTCMonth(),dPHT.getUTCDate()).getTime();
    // Adjust back from PHT epoch
    var dayStartUTC=dayStartPHT-PHT_OFFSET_MS;
    var startMins,endMins;
    if(schedule.dayConfig&&schedule.dayConfig[dow]){
      startMins=schedule.dayConfig[dow].startMins;
      endMins=schedule.dayConfig[dow].endMins;
    } else {
      startMins=(schedule.startHour||9)*60;
      endMins=(schedule.endHour||17)*60;
    }
    if(schedule.days.includes(dow)){
      var ds=dayStartUTC+startMins*60000;
      var de=dayStartUTC+endMins*60000;
      var os=Math.max(cur,ds);
      var oe=Math.min(endMs,de);
      if(oe>os)total+=(oe-os)/3600000;
    }
    cur=dayStartUTC+86400000;
  }
  return total;
}

function calcSlaRate(arr){ return arr.length?Math.round((1-arr.filter(function(t){return t.slaBreached;}).length/arr.length)*100):100; }
function calcAvgClose(arr){ return arr.length?Math.round(arr.reduce(function(a,t){return a+(new Date(t.closedAt||t.updatedAt)-new Date(t.createdAt))/3600000;},0)/arr.length):0; }
function calcClosed(arr){ return arr.filter(function(t){return t.status==="Closed";}); }
function loadStatusSla(){ try{var s=localStorage.getItem("hd_statusSla");return s?JSON.parse(s):DEFAULT_STATUS_SLA;}catch(e){return DEFAULT_STATUS_SLA;} }
function saveStatusSlaStore(v){ try{localStorage.setItem("hd_statusSla",JSON.stringify(v));}catch(e){} }
function getStatusSla(ticket,slaConfig,schedules){
  var cfg=slaConfig||loadStatusSla();var allowed=cfg[ticket.status];
  if(allowed===null||allowed===undefined)return null;
  var hist=ticket.statusHistory||[];var entry=null;
  for(var i=hist.length-1;i>=0;i--){if(hist[i].status===ticket.status&&!hist[i]._noSlaReset){entry=hist[i].timestamp;break;}}
  if(!entry)entry=ticket.updatedAt||ticket.createdAt;
  var schedule=schedules&&ticket.assignedTo?schedules[ticket.assignedTo]:null;
  var spent=schedule?calcBusinessHoursElapsedPHT(new Date(entry).getTime(),Date.now(),schedule):(Date.now()-new Date(entry).getTime())/3600000;
  var pct=Math.min(100,Math.round(spent/allowed*100));var breached=spent>allowed;var remaining=Math.max(0,allowed-spent);var onShift=isCurrentlyOnShiftPHT(schedule);
  return{hoursAllowed:allowed,hoursSpent:parseFloat(spent.toFixed(2)),pct,breached,remaining:parseFloat(remaining.toFixed(2)),enteredAt:entry,onShift,hasSchedule:!!schedule,schedule};
}

// Calculate actual time spent on a ticket (from statusHistory: time between status changes while In Progress)
function calcActualTimeSpentHours(ticket){
  if(!ticket||!ticket.statusHistory||ticket.statusHistory.length===0)return 0;
  var hist=ticket.statusHistory.slice().sort(function(a,b){return new Date(a.timestamp)-new Date(b.timestamp);});
  var total=0;
  for(var i=0;i<hist.length-1;i++){
    if(hist[i].status==="In Progress"){
      var diff=(new Date(hist[i+1].timestamp)-new Date(hist[i].timestamp))/3600000;
      if(diff>0&&diff<720)total+=diff; // cap at 720h (30 days) per segment to avoid bad data
    }
  }
  // If currently In Progress, count up to now (max 72h to avoid runaway)
  if(ticket.status==="In Progress"){
    var last=hist[hist.length-1];
    if(last&&last.status==="In Progress"){
      var elapsed=(Date.now()-new Date(last.timestamp))/3600000;
      if(elapsed>0&&elapsed<720)total+=elapsed;
    }
  }
  return total;
}

async function callSendEmail(opts){
  try{var res=await fetch("/api/send-email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to:opts.to,subject:opts.subject||"(no subject)",text:opts.body||opts.message||""})});var data=await res.json();if(res.ok&&data.id)return{success:true,provider:"Gmail",id:data.id};throw new Error(data.error||("Status "+res.status));}catch(e){return{success:false,error:e.message,provider:"Gmail"};}
}
async function dbGetChats(ticketId){
  try{var{data,error}=await supabase.from("ticket_chats").select("*").eq("ticket_id",ticketId).order("created_at",{ascending:true});if(error)throw error;return data||[];}catch(e){console.error("dbGetChats",e);return[];}
}
async function dbSaveChat(msg){
  try{var{error}=await supabase.from("ticket_chats").upsert([msg]);if(error)throw error;}catch(e){console.error("dbSaveChat",e);}
}

function loadState(key,fb){try{var s=localStorage.getItem(key);return s?JSON.parse(s):fb;}catch(e){return fb;}}
function saveState(key,v){try{localStorage.setItem(key,JSON.stringify(v));}catch(e){}}
function clearAuth(){try{localStorage.removeItem("hd_curUser");}catch(e){}}
function mkOpt(v,l){return{value:v,label:l};}
const OPT_PRIORITY=Object.keys(PRI_META).map(function(k){return mkOpt(k,PRI_META[k].label);});
const OPT_STATUSES=ALL_STATUSES.map(function(s){return mkOpt(s,s);});
function optCompanies(c){return c.map(function(x){return mkOpt(x.id,x.name);});}
function optCompaniesNone(c){return[mkOpt("","— None —")].concat(c.map(function(x){return mkOpt(x.id,x.name);}));}
function optClients(c){return[mkOpt("","— No Client —")].concat(c.map(function(x){return mkOpt(x.id,x.name);}));}
function optLocs(l){return[mkOpt("","— Select Location —")].concat(l.map(function(x){return mkOpt(x.id,x.name);}));}
function optTypes(t){return t.map(function(x){return mkOpt(x.id,x.name+" — "+(PRI_META[x.priority]?.label||x.priority)+", SLA "+x.slaHours+"h");});}
function optTechs(u){return[mkOpt("","— Unassigned —")].concat(u.filter(function(x){return IT_ROLES.includes(x.role)&&x.active;}).map(function(x){return mkOpt(x.id,x.name+" ("+(ROLE_META[x.role]?.label||x.role)+")");}));}
function optAssignees(u){return[mkOpt("","— Auto-assign —")].concat(u.filter(function(x){return IT_ROLES.includes(x.role)&&x.active;}).map(function(x){return mkOpt(x.id,x.name+" ("+(ROLE_META[x.role]?.label||x.role)+")");}));}
function aiAssign(title,desc,typeId,users,types){
  var tt=types.find(function(t){return t.id===typeId;});
  if(tt&&tt.defaultAssignee){var u=users.find(function(u){return u.id===tt.defaultAssignee&&u.active;});if(u)return{id:u.id,reason:"Type \""+tt.name+"\" → "+u.name};}
  var text=(title+" "+desc).toLowerCase();
  for(var i=0;i<types.length;i++){var t=types[i];if(!t.defaultAssignee)continue;var kws=t.keywords||[];for(var j=0;j<kws.length;j++){if(text.includes(kws[j].toLowerCase())){var u2=users.find(function(u){return u.id===t.defaultAssignee&&u.active;});if(u2)return{id:u2.id,reason:"Keyword \""+kws[j]+"\" → "+u2.name};}}}
  var techs=users.filter(function(u){return u.role==="it_technician"&&u.active;});
  if(techs.length)return{id:techs[0].id,reason:"Load-balanced → "+techs[0].name};
  return{id:null,reason:"No technician available"};
}

function useIsMobile(){ var[mob,setMob]=useState(window.innerWidth<768); useEffect(function(){function h(){setMob(window.innerWidth<768);}window.addEventListener("resize",h);return function(){window.removeEventListener("resize",h);};},[]);return mob; }

// ── UI Primitives ─────────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component{constructor(p){super(p);this.state={error:null};}static getDerivedStateFromError(e){return{error:e.message};}render(){if(this.state.error)return<div style={{padding:24,background:"#fef2f2",minHeight:"100vh"}}><div style={{fontSize:18,fontWeight:700,color:"#dc2626",marginBottom:12}}>⚠️ Something went wrong</div><pre style={{background:"#fff",padding:16,borderRadius:8,border:"1px solid #fecaca",fontSize:12,whiteSpace:"pre-wrap",color:"#7f1d1d",marginBottom:16,overflowX:"auto"}}>{this.state.error}</pre><button onClick={function(){try{localStorage.removeItem("hd_page");}catch(e){}window.location.href="/";}} style={{padding:"10px 20px",background:"#dc2626",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700,marginRight:8,marginBottom:8}}>🏠 Dashboard</button><button onClick={function(){try{localStorage.clear();}catch(e){}window.location.href="/";}} style={{padding:"10px 20px",background:"#7f1d1d",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700}}>🗑 Clear &amp; Restart</button></div>;return this.props.children;}}

function Badge(p){return<span style={{background:p.bg||p.color+"22",color:p.color,border:"1px solid "+p.color+"44",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700,whiteSpace:"nowrap",display:"inline-block"}}>{p.label}</span>;}
function Avatar(p){var s=p.size||32;return<div style={{width:s,height:s,borderRadius:"50%",background:avCol(p.id||p.name),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:s*0.35,fontWeight:700,flexShrink:0}}>{inits(p.name)}</div>;}
function Card(p){return<div style={{background:"#fff",borderRadius:12,border:"1px solid #e2e8f0",boxShadow:"0 1px 4px rgba(0,0,0,.06)",padding:16,...p.style}}>{p.children}</div>;}
function Stat(p){return<Card style={{flex:1,minWidth:140}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}><div><div style={{color:"#64748b",fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5}}>{p.label}</div><div style={{fontSize:24,fontWeight:800,color:p.color||"#6366f1",margin:"4px 0 2px"}}>{p.value}</div>{p.sub&&<div style={{fontSize:10,color:"#94a3b8"}}>{p.sub}</div>}</div><span style={{fontSize:20}}>{p.icon}</span></div></Card>;}

function Modal(p){
  var isMob=useIsMobile();
  var mobileStyle=isMob?{borderRadius:"16px 16px 0 0",width:"100%",maxWidth:"100%",maxHeight:"92vh",position:"fixed",bottom:0,left:0,right:0}:{borderRadius:16,width:"100%",maxWidth:p.wide?820:560,maxHeight:"90vh"};
  var containerStyle=isMob?{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:9999,display:"flex",alignItems:"flex-end",justifyContent:"center"}:{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16};
  return<div style={containerStyle}><div style={{background:"#fff",display:"flex",flexDirection:"column",boxShadow:"0 20px 60px rgba(0,0,0,.25)",...mobileStyle}}><div style={{padding:"16px 20px",borderBottom:"1px solid #e2e8f0",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}><div style={{fontSize:14,fontWeight:700,color:"#1e293b",flex:1,paddingRight:8}}>{p.title}</div><button onClick={p.onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:"#94a3b8",lineHeight:1,padding:4,flexShrink:0}}>✕</button></div><div style={{padding:"16px 20px",overflowY:"auto",flex:1,WebkitOverflowScrolling:"touch"}}>{p.children}</div></div></div>;
}

function FInput(p){var label=p.label;var rest=Object.assign({},p);delete rest.label;return<div style={{marginBottom:14}}>{label&&<label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>{label}</label>}<input style={{width:"100%",padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:14,outline:"none",background:"#f8fafc",boxSizing:"border-box"}} {...rest}/></div>;}
function FSelect(p){var label=p.label;var options=p.options||[];var rest=Object.assign({},p);delete rest.label;delete rest.options;return<div style={{marginBottom:14}}>{label&&<label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>{label}</label>}<select style={{width:"100%",padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:14,outline:"none",background:"#f8fafc",boxSizing:"border-box"}} {...rest}>{options.map(function(o){return<option key={o.value} value={o.value}>{o.label}</option>;})}</select></div>;}
function FTextarea(p){var label=p.label;var rest=Object.assign({},p);delete rest.label;return<div style={{marginBottom:14}}>{label&&<label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>{label}</label>}<textarea rows={4} style={{width:"100%",padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:14,outline:"none",background:"#f8fafc",resize:"vertical",boxSizing:"border-box"}} {...rest}/></div>;}
function Btn(p){var v=p.variant||"primary";var sm=p.size==="sm";var base={border:"none",cursor:"pointer",borderRadius:8,fontWeight:600,fontSize:sm?11:13,display:"inline-flex",alignItems:"center",gap:4,padding:sm?"6px 12px":"10px 18px"};var cols={primary:{background:"#6366f1",color:"#fff"},danger:{background:"#ef4444",color:"#fff"},success:{background:"#10b981",color:"#fff"},warning:{background:"#f59e0b",color:"#fff"},ghost:{background:"#f1f5f9",color:"#475569"}};var rest=Object.assign({},p);delete rest.variant;delete rest.size;return<button style={Object.assign({},base,cols[v]||cols.primary,p.style||{})} {...rest}>{p.children}</button>;}
function FocusInput(p){var[focused,setFocused]=useState(false);var extraPad=p.extraPad;var rest=Object.assign({},p);delete rest.extraPad;return<input {...rest} onFocus={function(){setFocused(true);}} onBlur={function(){setFocused(false);}} style={{width:"100%",padding:extraPad?"12px 44px 12px 14px":"12px 14px",border:"1.5px solid "+(focused?"#0ea5e9":"#e2e8f0"),borderRadius:10,fontSize:15,outline:"none",boxSizing:"border-box",background:"#f8fafc",transition:"border-color .2s"}}/>;}

// ── Per-Day Schedule Editor ───────────────────────────────────────────────────
// schedule shape: { days:[0,1,2,...], dayConfig:{ 0:{startMins,endMins}, 1:{startMins,endMins}, ... } }
// All times are stored as minutes-from-midnight in PHT
function ScheduleEditor(p){
  var userId=p.userId;var schedules=p.schedules;var onChange=p.onChange;
  var existing=schedules[userId]||null;
  var[enabled,setEnabled]=useState(!!existing);
  var[days,setDays]=useState(existing?existing.days:[1,2,3,4,5]);
  // dayConfig: per-day start/end in minutes PHT
  var defaultDayConfig=function(){var dc={};[0,1,2,3,4,5,6].forEach(function(d){dc[d]={startMins:9*60,endMins:17*60};});return dc;};
  var[dayConfig,setDayConfig]=useState(existing&&existing.dayConfig?existing.dayConfig:defaultDayConfig());

  function toggleDay(d){
    var nd=days.includes(d)?days.filter(function(x){return x!==d;}):days.concat([d]);
    setDays(nd);
    emit(enabled,nd,dayConfig);
  }
  function emit(en,ds,dc){
    onChange(userId,en?{days:ds,dayConfig:dc}:null);
  }
  function handleEnable(v){setEnabled(v);emit(v,days,dayConfig);}
  function updateDayTime(dow,field,val){
    var newDc=Object.assign({},dayConfig);
    newDc[dow]=Object.assign({},newDc[dow]||{startMins:540,endMins:1020},{[field]:parseInt(val)});
    // Ensure endMins > startMins
    if(field==="startMins"&&newDc[dow].endMins<=parseInt(val)){
      newDc[dow].endMins=parseInt(val)+30;
    }
    setDayConfig(newDc);
    emit(enabled,days,newDc);
  }

  return<div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:14,marginBottom:14}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
      <div style={{fontWeight:700,color:"#0369a1",fontSize:13}}>🗓 Work Schedule <span style={{fontSize:10,color:"#64748b",fontWeight:400}}>(PHT)</span></div>
      <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,fontWeight:600,color:enabled?"#0369a1":"#64748b"}}>
        <input type="checkbox" checked={enabled} onChange={function(e){handleEnable(e.target.checked);}} style={{width:16,height:16,accentColor:"#0369a1"}}/>
        {enabled?"Enabled":"Off (24/7)"}
      </label>
    </div>
    {enabled&&<>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:11,fontWeight:700,color:"#475569",marginBottom:6,textTransform:"uppercase"}}>Working Days</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {DOW_LABELS.map(function(label,i){var active=days.includes(i);return<button key={i} type="button" onClick={function(){toggleDay(i);}} style={{padding:"6px 10px",borderRadius:6,border:"1.5px solid "+(active?"#0369a1":"#e2e8f0"),background:active?"#0369a1":"#fff",color:active?"#fff":"#64748b",fontSize:12,fontWeight:700,cursor:"pointer"}}>{label}</button>;})}
        </div>
      </div>
      {/* Per-day time config */}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {days.slice().sort(function(a,b){return a-b;}).map(function(dow){
          var cfg=dayConfig[dow]||{startMins:540,endMins:1020};
          var endOpts=TIME_OPTIONS.filter(function(o){return o.value>cfg.startMins;});
          return<div key={dow} style={{background:"#fff",borderRadius:8,padding:"10px 12px",border:"1px solid #bae6fd"}}>
            <div style={{fontWeight:700,color:"#0369a1",fontSize:12,marginBottom:8}}>{DOW_LABELS[dow]}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div>
                <label style={{display:"block",fontSize:11,fontWeight:600,color:"#475569",marginBottom:3}}>Start (PHT)</label>
                <select value={cfg.startMins} onChange={function(e){updateDayTime(dow,"startMins",e.target.value);}} style={{width:"100%",padding:"7px 8px",border:"1px solid #e2e8f0",borderRadius:7,fontSize:12,outline:"none",background:"#f8fafc",boxSizing:"border-box"}}>
                  {TIME_OPTIONS.map(function(o){return<option key={o.value} value={o.value}>{o.label}</option>;})}
                </select>
              </div>
              <div>
                <label style={{display:"block",fontSize:11,fontWeight:600,color:"#475569",marginBottom:3}}>End (PHT)</label>
                <select value={cfg.endMins} onChange={function(e){updateDayTime(dow,"endMins",e.target.value);}} style={{width:"100%",padding:"7px 8px",border:"1px solid #e2e8f0",borderRadius:7,fontSize:12,outline:"none",background:"#f8fafc",boxSizing:"border-box"}}>
                  {endOpts.map(function(o){return<option key={o.value} value={o.value}>{o.label}</option>;})}
                </select>
              </div>
            </div>
          </div>;
        })}
      </div>
    </>}
  </div>;
}

// ── Ticket Chat ───────────────────────────────────────────────────────────────
function TicketChat(p){
  var ticketId=p.ticketId;var curUser=p.curUser;var users=p.users;
  var[msgs,setMsgs]=useState([]);var[text,setText]=useState("");var[sending,setSending]=useState(false);
  var bottomRef=useRef(null);
  useEffect(function(){
    dbGetChats(ticketId).then(function(data){setMsgs(data);});
    var sub=supabase.channel("chat-"+ticketId).on("postgres_changes",{event:"INSERT",schema:"public",table:"ticket_chats",filter:"ticket_id=eq."+ticketId},function(payload){setMsgs(function(prev){if(prev.find(function(m){return m.id===payload.new.id;}))return prev;return prev.concat([payload.new]);});}).subscribe();
    return function(){supabase.removeChannel(sub);};
  },[ticketId]);
  useEffect(function(){if(bottomRef.current)bottomRef.current.scrollIntoView({behavior:"smooth"});},[msgs]);
  async function send(){var trimmed=text.trim();if(!trimmed||sending)return;setSending(true);var msg={id:uid(),ticket_id:ticketId,user_id:curUser.id,message:trimmed,created_at:new Date().toISOString()};setMsgs(function(prev){return prev.concat([msg]);});setText("");setSending(false);await dbSaveChat(msg);}
  function fu(id){return users.find(function(u){return u.id===id;});}
  return<div style={{display:"flex",flexDirection:"column",height:380}}>
    <div style={{flex:1,overflowY:"auto",padding:"4px 0",marginBottom:8,WebkitOverflowScrolling:"touch"}}>
      {msgs.length===0&&<div style={{textAlign:"center",padding:"32px 0",color:"#94a3b8"}}><div style={{fontSize:28,marginBottom:8}}>💬</div><div style={{fontSize:13,fontWeight:600}}>No messages yet</div></div>}
      {msgs.map(function(msg,i){var sender=fu(msg.user_id);var isMe=msg.user_id===curUser.id;var showAvatar=i===0||msgs[i-1].user_id!==msg.user_id;
        return<div key={msg.id} style={{display:"flex",flexDirection:isMe?"row-reverse":"row",gap:8,marginBottom:showAvatar?10:3,alignItems:"flex-end"}}>
          <div style={{width:28,flexShrink:0}}>{showAvatar&&<Avatar name={sender?sender.name:"?"} id={msg.user_id} size={28}/>}</div>
          <div style={{maxWidth:"75%"}}>
            {showAvatar&&<div style={{fontSize:10,fontWeight:700,color:"#64748b",marginBottom:3,textAlign:isMe?"right":"left"}}>{isMe?"You":sender?sender.name:"Unknown"} · {ago(msg.created_at)}</div>}
            <div style={{background:isMe?"#6366f1":"#f1f5f9",color:isMe?"#fff":"#1e293b",borderRadius:isMe?"16px 16px 4px 16px":"16px 16px 16px 4px",padding:"8px 12px",fontSize:14,lineHeight:1.5,wordBreak:"break-word"}}>{msg.message}</div>
          </div>
        </div>;
      })}
      <div ref={bottomRef}/>
    </div>
    <div style={{display:"flex",gap:8,alignItems:"flex-end",borderTop:"1px solid #e2e8f0",paddingTop:10}}>
      <textarea value={text} onChange={function(e){setText(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}} placeholder="Type a message…" rows={2} style={{flex:1,padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:10,fontSize:14,outline:"none",resize:"none",background:"#f8fafc",boxSizing:"border-box"}}/>
      <button onClick={send} disabled={sending||!text.trim()} style={{padding:"12px 16px",background:sending||!text.trim()?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:10,fontWeight:700,fontSize:14,cursor:sending||!text.trim()?"not-allowed":"pointer",flexShrink:0,minHeight:44}}>Send</button>
    </div>
  </div>;
}

// ── Ticket History ────────────────────────────────────────────────────────────
function TicketHistory(p){
  var ticket=p.ticket;var users=p.users;var curUser=p.curUser;
  var[chats,setChats]=useState([]);
  useEffect(function(){dbGetChats(ticket.id).then(function(data){setChats(data);});},[ticket.id]);
  function fu(id){return users.find(function(u){return u.id===id;});}
  var events=[];
  (ticket.statusHistory||[]).filter(function(h){return !h._noSlaReset||h.note;}).forEach(function(h){events.push({type:"status",time:h.timestamp,data:h});});
  (ticket.conversations||[]).forEach(function(m){events.push({type:"email",time:m.timestamp,data:m});});
  chats.forEach(function(m){events.push({type:"chat",time:m.created_at,data:m});});
  events.sort(function(a,b){return new Date(b.time)-new Date(a.time);});
  if(events.length===0)return<div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No history yet.</div>;
  return<div>
    <div style={{fontWeight:700,color:"#1e293b",marginBottom:16}}>📜 Ticket Timeline</div>
    {events.map(function(ev,i){
      if(ev.type==="status"){var h=ev.data;return<div key={i} style={{display:"flex",gap:10,marginBottom:12}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0}}><div style={{width:30,height:30,borderRadius:8,background:(STATUS_META[h.status]?.color||"#6366f1")+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>🔄</div>{i<events.length-1&&<div style={{width:2,flex:1,background:"#e2e8f0",marginTop:4,minHeight:12}}/>}</div>
        <div style={{flex:1,background:"#f8fafc",borderRadius:8,padding:10,marginBottom:4}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4,flexWrap:"wrap",gap:4}}><Badge label={h.status} color={STATUS_META[h.status]?.color||"#6366f1"}/><span style={{fontSize:10,color:"#94a3b8"}}>{fdt(h.timestamp)}</span></div><div style={{fontSize:11,color:"#64748b"}}>Assigned: <strong>{fu(h.assignedTo)?.name||"Unassigned"}</strong></div><div style={{fontSize:11,color:"#475569"}}>By: {fu(h.changedBy)?.name||"System"}</div>{h.note&&<div style={{fontSize:11,color:"#334155",marginTop:4,fontStyle:"italic"}}>{h.note}</div>}</div>
      </div>;}
      if(ev.type==="email"){var m=ev.data;var isReply=m.isExternal||m.status==="received";var sender=isReply?(m.fromName||m.fromEmail):(fu(m.from)?.name||curUser.name);return<div key={i} style={{display:"flex",gap:10,marginBottom:12}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0}}><div style={{width:30,height:30,borderRadius:8,background:"#e0f2fe",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>{isReply?"📬":"📧"}</div>{i<events.length-1&&<div style={{width:2,flex:1,background:"#e2e8f0",marginTop:4,minHeight:12}}/>}</div>
        <div style={{flex:1,background:isReply?"#f0fdf4":"#f0f9ff",borderRadius:8,padding:10,marginBottom:4,border:"1px solid "+(isReply?"#bbf7d0":"#bae6fd")}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4,flexWrap:"wrap",gap:4}}><span style={{fontSize:12,fontWeight:700,color:isReply?"#166534":"#0369a1"}}>{isReply?"📬 Reply":"📧 Sent"}</span><span style={{fontSize:10,color:"#94a3b8"}}>{fdt(m.timestamp)}</span></div><div style={{fontSize:11,color:"#64748b",marginBottom:2}}>From: <strong>{sender}</strong></div><div style={{fontSize:11,color:"#64748b",marginBottom:4}}>Subj: {m.subject}</div><div style={{fontSize:12,color:"#334155",background:"rgba(255,255,255,.6)",borderRadius:6,padding:"6px 8px",maxHeight:50,overflow:"hidden"}}>{m.body?.slice(0,100)}{m.body?.length>100?"…":""}</div></div>
      </div>;}
      if(ev.type==="chat"){var cm=ev.data;var csender=fu(cm.user_id);var isMe=cm.user_id===curUser.id;return<div key={i} style={{display:"flex",gap:10,marginBottom:12}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0}}><div style={{width:30,height:30,borderRadius:8,background:"#eef2ff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>💬</div>{i<events.length-1&&<div style={{width:2,flex:1,background:"#e2e8f0",marginTop:4,minHeight:12}}/>}</div>
        <div style={{flex:1,background:isMe?"#eef2ff":"#f8fafc",borderRadius:8,padding:10,marginBottom:4,border:"1px solid "+(isMe?"#c7d2fe":"#e2e8f0")}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4,flexWrap:"wrap",gap:4}}><span style={{fontSize:12,fontWeight:700,color:isMe?"#4338ca":"#334155"}}>💬 {isMe?"You":csender?.name||"Unknown"}</span><span style={{fontSize:10,color:"#94a3b8"}}>{fdt(cm.created_at)}</span></div><div style={{fontSize:13,color:"#334155"}}>{cm.message}</div></div>
      </div>;}
      return null;
    })}
  </div>;
}

// ── Login ─────────────────────────────────────────────────────────────────────
function LoginPage(p){
  var users=p.users;var setUsers=p.setUsers;var companies=p.companies;var onLogin=p.onLogin;
  var[view,setView]=useState("login");
  var[loginEmail,setLoginEmail]=useState("");var[loginPass,setLoginPass]=useState("");
  var[showP1,setShowP1]=useState(false);var[showP2,setShowP2]=useState(false);var[showP3,setShowP3]=useState(false);
  var[loginErr,setLoginErr]=useState("");var[resetEmail,setResetEmail]=useState("");
  var[sigName,setSigName]=useState("");var[sigEmail,setSigEmail]=useState("");var[sigPass,setSigPass]=useState("");
  var[sigConf,setSigConf]=useState("");var[sigPhone,setSigPhone]=useState("");var[sigDept,setSigDept]=useState("");var[sigErr,setSigErr]=useState("");
  var[loading,setLoading]=useState(false);
  var[rememberMe,setRememberMe]=useState(function(){try{return localStorage.getItem("hd_rememberMe")==="true";}catch(e){return false;}});
  useEffect(function(){try{var saved=localStorage.getItem("hd_savedCreds");if(saved){var creds=JSON.parse(saved);if(creds.email)setLoginEmail(creds.email);if(creds.pass)setLoginPass(creds.pass);setRememberMe(true);}}catch(e){};},[]);
  function pwStr(pw){if(!pw||pw.length<8)return 1;if(pw.length>=12&&/[A-Z]/.test(pw)&&/[0-9]/.test(pw)&&/[^A-Za-z0-9]/.test(pw))return 4;if(pw.length>=10&&/[A-Z]/.test(pw)&&/[0-9]/.test(pw))return 3;return 2;}
  var strLabel=["","Too short","Weak","Good","Strong ✅"];var strColor=["","#ef4444","#f59e0b","#3b82f6","#10b981"];var str=pwStr(sigPass);
  async function doLogin(e){if(e&&e.preventDefault)e.preventDefault();setLoginErr("");if(!loginEmail.trim()||!loginPass.trim()){setLoginErr("Please enter your email and password.");return;}setLoading(true);var user=users.find(function(u){return u.email.toLowerCase()===loginEmail.toLowerCase().trim();});if(!user){setLoginErr("No account found with that email.");setLoading(false);return;}if(!user.active){setLoginErr("Your account is pending admin approval.");setLoading(false);return;}var pw=await dbGetPassword(user.id);if(loginPass!==pw){setLoginErr("Incorrect password.");setLoading(false);return;}try{if(rememberMe){localStorage.setItem("hd_savedCreds",JSON.stringify({email:loginEmail.trim(),pass:loginPass}));localStorage.setItem("hd_rememberMe","true");}else{localStorage.removeItem("hd_savedCreds");localStorage.setItem("hd_rememberMe","false");}}catch(ex){}setLoading(false);onLogin(user);}
  async function doForgot(e){e.preventDefault();if(!resetEmail.trim()){return;}setLoading(true);await new Promise(function(r){setTimeout(r,900);});setLoading(false);setView("sent");}
  async function doSignup(e){e.preventDefault();setSigErr("");if(!sigName.trim()){setSigErr("Full name is required.");return;}if(!sigEmail.trim()){setSigErr("Email is required.");return;}if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sigEmail.trim())){setSigErr("Enter a valid email.");return;}if(users.find(function(u){return u.email.toLowerCase()===sigEmail.toLowerCase().trim();})){setSigErr("An account with this email already exists.");return;}if(sigPass.length<8){setSigErr("Password must be at least 8 characters.");return;}if(sigPass!==sigConf){setSigErr("Passwords do not match.");return;}setLoading(true);var nu={id:uid(),name:sigName.trim(),email:sigEmail.trim().toLowerCase(),role:"end_user",companyId:companies&&companies[0]?companies[0].id:"",phone:sigPhone.trim(),dept:sigDept.trim(),active:false,createdAt:new Date().toISOString(),lastLogin:null};await dbSaveUser(nu);await dbSetPassword(nu.id,sigPass);setUsers(function(prev){return prev.concat([nu]);});setLoading(false);setView("pending");}
  function PBtn(bp){return<button type={bp.type||"button"} onClick={bp.onClick} disabled={bp.disabled} style={{width:"100%",padding:"14px",background:bp.disabled?"#7dd3fc":"linear-gradient(135deg,#0369a1,#0ea5e9)",color:"#fff",border:"none",borderRadius:10,fontSize:16,fontWeight:700,cursor:bp.disabled?"not-allowed":"pointer",marginTop:4}}>{bp.children}</button>;}
  function BackBtn(bp){return<button type="button" onClick={bp.onClick} style={{background:"none",border:"none",color:"#0369a1",fontSize:14,fontWeight:600,cursor:"pointer",padding:"0 0 16px 0",display:"flex",alignItems:"center",gap:4}}>← Back to Sign In</button>;}
  function ErrBox(ep){return ep.msg?<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:14,color:"#dc2626",fontSize:13}}>⚠️ {ep.msg}</div>:null;}
  return<div style={{minHeight:"100vh",background:"linear-gradient(135deg,#020e1f 0%,#041833 30%,#062d6b 65%,#0a3d8f 100%)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,fontFamily:"'Inter',system-ui,sans-serif",position:"relative"}}>
    <div style={{position:"absolute",inset:0,background:"rgba(2,14,31,0.62)"}}/>
    <div style={{width:"100%",maxWidth:440,position:"relative",zIndex:1}}>
      <div style={{textAlign:"center",marginBottom:24}}>
        <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:12,marginBottom:8}}>
          <div style={{width:48,height:48,borderRadius:"50%",background:"linear-gradient(135deg,#fff 60%,#b3d9ff)",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:30,height:30,borderRadius:"50%",background:"linear-gradient(135deg,#0369a1,#0ea5e9)",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:12,height:12,borderRadius:"50%",background:"#020e1f"}}/></div></div>
          <div style={{textAlign:"left"}}><div style={{color:"#fff",fontSize:28,fontWeight:800,letterSpacing:-1,lineHeight:1}}>hoptix</div><div style={{fontSize:11,letterSpacing:1}}><span style={{color:"#7dd3fc"}}>A.</span><span style={{color:"#38bdf8",fontStyle:"italic"}}>eye</span><span style={{color:"#94a3b8"}}> technology</span></div></div>
        </div>
        <p style={{color:"#94a3b8",fontSize:13,margin:0}}>IT Helpdesk · Sign in to your workspace</p>
      </div>
      <div style={{background:"rgba(255,255,255,0.97)",borderRadius:20,padding:"28px 24px",boxShadow:"0 25px 60px rgba(0,0,0,.5)"}}>
        {view==="login"&&<><h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 4px"}}>Welcome back 👋</h2><p style={{fontSize:13,color:"#94a3b8",margin:"0 0 20px"}}>Sign in to access your dashboard</p>
          <form onSubmit={doLogin} autoComplete="on">
            <div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:5}}>Email Address</label><FocusInput type="email" name="email" autoComplete="email" value={loginEmail} onChange={function(e){setLoginEmail(e.target.value);}} placeholder="you@company.com"/></div>
            <div style={{marginBottom:6}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:5}}>Password</label><div style={{position:"relative"}}><FocusInput type={showP1?"text":"password"} name="password" autoComplete="current-password" value={loginPass} onChange={function(e){setLoginPass(e.target.value);}} placeholder="••••••••" extraPad/><button type="button" onClick={function(){setShowP1(!showP1);}} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:18,color:"#94a3b8",padding:0}}>{showP1?"🙈":"👁️"}</button></div></div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13,color:"#475569",fontWeight:600,userSelect:"none"}}><input type="checkbox" checked={rememberMe} onChange={function(e){setRememberMe(e.target.checked);}} style={{width:16,height:16,accentColor:"#6366f1",cursor:"pointer"}}/>Remember me</label>
              <button type="button" onClick={function(){setView("forgot");setResetEmail(loginEmail);}} style={{background:"none",border:"none",color:"#0369a1",fontSize:13,fontWeight:600,cursor:"pointer",padding:0,textDecoration:"underline"}}>Forgot password?</button>
            </div>
            <ErrBox msg={loginErr}/><PBtn type="submit" disabled={loading}>{loading?"⏳ Signing in…":"Sign In →"}</PBtn>
          </form>
          <div style={{marginTop:16,textAlign:"center"}}><span style={{fontSize:13,color:"#94a3b8"}}>Don't have an account? </span><button type="button" onClick={function(){setView("signup");setSigErr("");}} style={{background:"none",border:"none",color:"#0369a1",fontSize:13,fontWeight:700,cursor:"pointer",textDecoration:"underline"}}>Sign Up</button></div>
        </>}
        {view==="signup"&&<><BackBtn onClick={function(){setView("login");setSigErr("");}} /><h2 style={{fontSize:18,fontWeight:700,color:"#1e293b",margin:"0 0 16px"}}>Create an Account 🚀</h2>
          <FInput label="Full Name *" value={sigName} onChange={function(e){setSigName(e.target.value);}} placeholder="Jane Smith"/>
          <FInput label="Work Email *" type="email" value={sigEmail} onChange={function(e){setSigEmail(e.target.value);}} placeholder="you@company.com"/>
          <FInput label="Phone" type="tel" value={sigPhone} onChange={function(e){setSigPhone(e.target.value);}} placeholder="+63-9XX-XXX-XXXX"/>
          <FInput label="Department" value={sigDept} onChange={function(e){setSigDept(e.target.value);}} placeholder="Sales"/>
          <div style={{position:"relative",marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Password *</label><FocusInput type={showP2?"text":"password"} value={sigPass} onChange={function(e){setSigPass(e.target.value);}} placeholder="Min 8 chars" extraPad/><button type="button" onClick={function(){setShowP2(!showP2);}} style={{position:"absolute",right:12,top:30,background:"none",border:"none",cursor:"pointer",fontSize:16,color:"#94a3b8"}}>{showP2?"🙈":"👁️"}</button></div>
          <div style={{position:"relative",marginBottom:sigPass.length>0?4:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Confirm Password *</label><FocusInput type={showP3?"text":"password"} value={sigConf} onChange={function(e){setSigConf(e.target.value);}} placeholder="Repeat" extraPad/><button type="button" onClick={function(){setShowP3(!showP3);}} style={{position:"absolute",right:12,top:30,background:"none",border:"none",cursor:"pointer",fontSize:16,color:"#94a3b8"}}>{showP3?"🙈":"👁️"}</button></div>
          {sigPass.length>0&&<div style={{marginBottom:14}}><div style={{display:"flex",gap:4,marginBottom:3}}>{[1,2,3,4].map(function(i){return<div key={i} style={{flex:1,height:4,borderRadius:2,background:i<=str?strColor[str]:"#e2e8f0"}}/>;})}</div><div style={{fontSize:10,color:strColor[str]}}>{strLabel[str]}</div></div>}
          <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#92400e"}}>⚠️ New accounts require <strong>admin approval</strong>.</div>
          <ErrBox msg={sigErr}/><PBtn onClick={doSignup} disabled={loading}>{loading?"⏳ Creating…":"Create Account →"}</PBtn>
        </>}
        {view==="pending"&&<div style={{textAlign:"center",padding:"10px 0"}}><div style={{fontSize:48,marginBottom:12}}>⏳</div><h2 style={{fontSize:18,fontWeight:700,color:"#1e293b",margin:"0 0 10px"}}>Account Pending Approval</h2><p style={{fontSize:13,color:"#64748b",lineHeight:1.7,margin:"0 0 16px"}}>Your account for <strong>{sigEmail}</strong> has been submitted.</p><PBtn onClick={function(){setView("login");setLoginErr("");}}>← Back to Sign In</PBtn></div>}
        {view==="forgot"&&<><BackBtn onClick={function(){setView("login");}} /><div style={{textAlign:"center",marginBottom:20}}><div style={{fontSize:40,marginBottom:8}}>🔑</div><h2 style={{fontSize:18,fontWeight:700,color:"#1e293b",margin:"0 0 6px"}}>Forgot Password?</h2></div><div style={{marginBottom:16}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:5}}>Email Address</label><FocusInput type="email" value={resetEmail} onChange={function(e){setResetEmail(e.target.value);}} placeholder="you@company.com"/></div><PBtn onClick={doForgot} disabled={loading}>{loading?"⏳ Sending…":"Send Reset Link →"}</PBtn></>}
        {view==="sent"&&<div style={{textAlign:"center",padding:"10px 0"}}><div style={{fontSize:48,marginBottom:12}}>📧</div><h2 style={{fontSize:18,fontWeight:700,color:"#1e293b",margin:"0 0 10px"}}>Check your inbox!</h2><p style={{fontSize:13,color:"#64748b",lineHeight:1.7,margin:"0 0 20px"}}>If an account exists for <strong>{resetEmail}</strong>, a reset link was sent.</p><PBtn onClick={function(){setView("login");setLoginErr("");}}>← Back to Sign In</PBtn></div>}
      </div>
      <p style={{textAlign:"center",color:"rgba(255,255,255,.4)",fontSize:11,marginTop:16}}>© 2025 Hoptix · A.eye Technology</p>
    </div>
  </div>;
}

// ── Profile Modal (with Schedule for IT roles) ────────────────────────────────
function ProfileModal(p){
  var curUser=p.curUser;var setUsers=p.setUsers;var setCurUser=p.setCurUser;var showToast=p.showToast;var addLog=p.addLog;var onClose=p.onClose;
  var schedules=p.schedules||{};var setSchedules=p.setSchedules;var dbSaveSchedule=p.dbSaveSchedule;
  var[tab,setTab]=useState("profile");var[name,setName]=useState(curUser.name);var[phone,setPhone]=useState(curUser.phone||"");var[dept,setDept]=useState(curUser.dept||"");
  var[curPw,setCurPw]=useState("");var[newPw,setNewPw]=useState("");var[confPw,setConfPw]=useState("");
  var[showC,setShowC]=useState(false);var[showN,setShowN]=useState(false);var[showK,setShowK]=useState(false);
  var[pwErr,setPwErr]=useState("");var[pwOk,setPwOk]=useState("");var[saving,setSaving]=useState(false);
  var isTechUser=IT_ROLES.includes(curUser.role);
  var inp={width:"100%",padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:14,outline:"none",background:"#f8fafc",boxSizing:"border-box"};

  function handleScheduleChange(userId,sch){
    setSchedules(function(prev){var n=Object.assign({},prev);if(sch===null){delete n[userId];}else{n[userId]=sch;}return n;});
    if(dbSaveSchedule)dbSaveSchedule(userId,sch);
  }

  async function saveProfile(){if(!name.trim()){showToast("Name cannot be empty","error");return;}setSaving(true);var updated=Object.assign({},curUser,{name:name.trim(),phone:phone.trim(),dept:dept.trim()});await dbSaveUser(updated);setUsers(function(prev){return prev.map(function(u){return u.id===curUser.id?updated:u;});});setCurUser(updated);addLog("PROFILE_UPDATED",curUser.id,curUser.name+" updated profile");showToast("✅ Profile updated!");setSaving(false);onClose();}
  async function changePw(){setPwErr("");setPwOk("");if(!curPw){setPwErr("Enter your current password.");return;}var existingPw=await dbGetPassword(curUser.id);if(curPw!==existingPw){setPwErr("Current password is incorrect.");return;}if(newPw.length<8){setPwErr("Min 8 characters.");return;}if(newPw!==confPw){setPwErr("Passwords do not match.");return;}if(newPw===curPw){setPwErr("Must differ from current.");return;}setSaving(true);await dbSetPassword(curUser.id,newPw);addLog("PASSWORD_CHANGED",curUser.id,curUser.name+" changed password");setSaving(false);setCurPw("");setNewPw("");setConfPw("");setPwOk("✅ Password changed!");showToast("Password updated!");onClose();}

  var tabs=["profile","password"];
  if(isTechUser)tabs.push("schedule");
  var tabLabels={profile:"👤 Profile",password:"🔑 Password",schedule:"🗓 Schedule"};

  return<Modal title="My Profile" onClose={onClose}>
    <div style={{display:"flex",alignItems:"center",gap:14,padding:"0 0 16px",borderBottom:"1px solid #e2e8f0",marginBottom:16}}><div style={{width:56,height:56,borderRadius:"50%",background:avCol(curUser.id),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:20,fontWeight:800}}>{inits(curUser.name)}</div><div><div style={{fontWeight:700,fontSize:15}}>{curUser.name}</div><div style={{fontSize:12,color:"#64748b"}}>{curUser.email}</div><div style={{marginTop:4}}><Badge label={ROLE_META[curUser.role]?.label||curUser.role} color={ROLE_META[curUser.role]?.color||"#6366f1"}/></div></div></div>
    <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>{tabs.map(function(t){return<button key={t} onClick={function(){setTab(t);}} style={{flex:1,minWidth:80,background:tab===t?"#6366f1":"#f1f5f9",color:tab===t?"#fff":"#475569",border:"none",borderRadius:8,padding:"8px",cursor:"pointer",fontSize:12,fontWeight:700}}>{tabLabels[t]}</button>;})}</div>
    {tab==="profile"&&<div><FInput label="Full Name" value={name} onChange={function(e){setName(e.target.value);}}/><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Email</label><input value={curUser.email} disabled style={Object.assign({},inp,{background:"#f1f5f9",color:"#94a3b8"})}/></div><FInput label="Phone" value={phone} onChange={function(e){setPhone(e.target.value);}}/><FInput label="Department" value={dept} onChange={function(e){setDept(e.target.value);}}/><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={saveProfile} disabled={saving}>{saving?"⏳ Saving…":"💾 Save"}</Btn></div></div>}
    {tab==="password"&&<div><div style={{position:"relative",marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Current Password</label><input type={showC?"text":"password"} value={curPw} onChange={function(e){setCurPw(e.target.value);}} placeholder="••••••••" style={Object.assign({},inp,{paddingRight:44})}/><button type="button" onClick={function(){setShowC(!showC);}} style={{position:"absolute",right:12,top:34,background:"none",border:"none",cursor:"pointer",fontSize:16,color:"#94a3b8"}}>{showC?"🙈":"👁️"}</button></div><div style={{position:"relative",marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>New Password</label><input type={showN?"text":"password"} value={newPw} onChange={function(e){setNewPw(e.target.value);}} placeholder="Min 8 characters" style={Object.assign({},inp,{paddingRight:44})}/><button type="button" onClick={function(){setShowN(!showN);}} style={{position:"absolute",right:12,top:34,background:"none",border:"none",cursor:"pointer",fontSize:16,color:"#94a3b8"}}>{showN?"🙈":"👁️"}</button></div><div style={{position:"relative",marginBottom:16}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Confirm New Password</label><input type={showK?"text":"password"} value={confPw} onChange={function(e){setConfPw(e.target.value);}} placeholder="Repeat" style={Object.assign({},inp,{paddingRight:44})}/><button type="button" onClick={function(){setShowK(!showK);}} style={{position:"absolute",right:12,top:34,background:"none",border:"none",cursor:"pointer",fontSize:16,color:"#94a3b8"}}>{showK?"🙈":"👁️"}</button></div>{pwErr&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:14,color:"#dc2626",fontSize:13}}>⚠️ {pwErr}</div>}{pwOk&&<div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"10px 14px",marginBottom:14,color:"#166534",fontSize:13}}>{pwOk}</div>}<div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={changePw} disabled={saving}>{saving?"⏳ Saving…":"🔑 Change"}</Btn></div></div>}
    {tab==="schedule"&&isTechUser&&<div>
      <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#92400e"}}>⚠️ Set your working hours in <strong>Philippine Time (PHT, UTC+8)</strong>. This affects SLA calculations.</div>
      <ScheduleEditor userId={curUser.id} schedules={schedules} onChange={handleScheduleChange}/>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={onClose}>Close</Btn><Btn variant="success" onClick={function(){showToast("✅ Schedule saved!");onClose();}}>✅ Done</Btn></div>
    </div>}
  </Modal>;
}

// ── Root App ──────────────────────────────────────────────────────────────────
export default function App(){
  var[users,setUsers]=useState([]);var[companies,setCompanies]=useState([]);var[clients,setClients]=useState([]);
  var[tickets,setTicketsR]=useState([]);var[ticketTypes,setTTR]=useState([]);
  var[statusSla,setStatusSlaR]=useState(DEFAULT_STATUS_SLA);var[schedules,setSchedulesR]=useState({});
  var[logs,setLogsR]=useState([]);var[emailTemplates,setEmailTemplates]=useState([]);
  var[curUser,setCurUserR]=useState(function(){return loadState("hd_curUser",null);});
  var[page,setPageR]=useState(function(){try{var s=localStorage.getItem("hd_page");var safe=["dashboard","tickets","new_ticket","time_tracking","reports","users","companies","clients","ticket_types","activity_log","integrations"];return(s&&safe.includes(s))?s:"dashboard";}catch(e){return"dashboard";}});
  var[selTicket,setSelTicket]=useState(null);var[toast,setToast]=useState(null);
  var[breaches,setBreaches]=useState([]);var[inboxAlerts,setInboxAlerts]=useState([]);
  var[showProfile,setShowProfile]=useState(false);var[loading,setLoading]=useState(true);
  var[sidebarOpen,setSidebarOpen]=useState(false);
  var isMobile=useIsMobile();

  useEffect(function(){
    async function loadAll(){setLoading(true);var[u,co,cl,tt,tkt,lg,sch,et]=await Promise.all([dbGetUsers(),dbGetCompanies(),dbGetClients(),dbGetTicketTypes(),dbGetTickets(),dbGetLogs(),dbGetSchedules(),dbGetEmailTemplates()]);setUsers(u);setCompanies(co);setClients(cl);setTTR(tt);setTicketsR(tkt);setLogsR(lg);setSchedulesR(sch);setEmailTemplates(et);setLoading(false);}
    loadAll();
  },[]);
  useEffect(function(){
    var sub=supabase.channel('tickets-changes').on('postgres_changes',{event:'*',schema:'public',table:'tickets'},function(){dbGetTickets().then(function(t){setTicketsR(t);});}).on('postgres_changes',{event:'*',schema:'public',table:'users'},function(){dbGetUsers().then(function(u){setUsers(u);});}).subscribe();
    return function(){supabase.removeChannel(sub);};
  },[]);
  async function setTickets(updater){var prev=tickets;var next=typeof updater==="function"?updater(prev):updater;setTicketsR(next);var changed=next.filter(function(t){var old=prev.find(function(p){return p.id===t.id;});return !old||JSON.stringify(old)!==JSON.stringify(t);});for(var i=0;i<changed.length;i++){await dbSaveTicket(changed[i]);}}
  function setCurUser(u){if(u)saveState("hd_curUser",u);else clearAuth();setCurUserR(u);}
  function setPage(v){if(v!=="integrations")saveState("hd_page",v);setPageR(v);setSidebarOpen(false);}
  var addLog=useCallback(function(action,target,detail,uId){var entry={id:uid(),action,userId:uId||curUser?.id,target,detail,timestamp:new Date().toISOString()};setLogsR(function(p){return[entry].concat(p).slice(0,500);});dbAddLog(entry);},[curUser]);
  var showToast=useCallback(function(msg,type){setToast({msg,type:type||"ok"});setTimeout(function(){setToast(null);},3500);},[]);
  useEffect(function(){
    function check(){
      var now=Date.now();
      setBreaches(function(prev){
        var next=tickets.filter(function(t){
          if(t.deleted||t.status==="Closed")return false;
          var s=getStatusSla(t,statusSla,schedules);
          return s&&s.breached;
        });
        // Only update state if the list actually changed (avoid re-render loop)
        if(prev.length===next.length&&prev.every(function(t,i){return t.id===next[i].id;}))return prev;
        return next;
      });
    }
    check();
    var iv=setInterval(check,30000);
    return function(){clearInterval(iv);};
  },[tickets,statusSla,schedules]);
  useEffect(function(){
    if(!curUser)return;
    async function fetchReplies(){try{var res=await fetch("/api/fetch-replies");if(!res.ok)return;var data=await res.json();if(!data.replies||!data.replies.length)return;setTicketsR(function(prev){var updated=prev.slice();var hasNew=false;data.replies.forEach(function(reply){var idx=updated.findIndex(function(t){return t.id===reply.ticketId;});if(idx<0)return;var ticket=updated[idx];var dupId="reply_"+reply.uid;if((ticket.conversations||[]).some(function(c){return c.id===dupId;}))return;hasNew=true;var msg={id:dupId,from:null,fromEmail:reply.fromEmail,fromName:reply.fromName,to:[],toEmails:[],cc:[],subject:reply.subject,body:reply.body.trim(),timestamp:reply.timestamp,isExternal:true,status:"received"};updated[idx]=Object.assign({},ticket,{conversations:(ticket.conversations||[]).concat([msg]),hasUnreadReply:true});});if(hasNew)data.replies.forEach(function(r){dbSaveTicket(updated.find(function(t){return t.id===r.ticketId;})||{});});return updated;});setInboxAlerts(function(prev){return prev.concat(data.replies);});showToast("📬 "+data.replies.length+" new email repl"+(data.replies.length>1?"ies":"y")+" received!");}catch(e){}}
    fetchReplies();var iv=setInterval(fetchReplies,60000);return function(){clearInterval(iv);};
  },[curUser]);

  var isAdmin=["admin","it_manager"].includes(curUser?.role);
  var isTech=IT_ROLES.includes(curUser?.role);
  var pendingUsers=useMemo(function(){return isAdmin?users.filter(function(u){return !u.active;}):[]},[users,isAdmin]);
  var visible=useMemo(function(){return tickets.filter(function(t){return !t.deleted;});},[tickets]);
  var allNonDeleted=useMemo(function(){return tickets.filter(function(t){return !t.deleted;});},[tickets]);

  if(loading)return<div style={{minHeight:"100vh",background:"linear-gradient(135deg,#020e1f,#062d6b)",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}><div style={{width:48,height:48,border:"4px solid rgba(255,255,255,.2)",borderTop:"4px solid #0ea5e9",borderRadius:"50%",animation:"spin 1s linear infinite"}}/><div style={{color:"#7dd3fc",fontSize:14,fontWeight:600}}>Loading Hoptix…</div><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;
  if(!curUser)return<LoginPage users={users} setUsers={setUsers} companies={companies} onLogin={function(u){setCurUser(u);}}/>;

  var NAV=[
    {id:"dashboard",icon:"🏠",label:"Dashboard"},
    {id:"tickets",icon:"🎫",label:"Tickets"},
    {id:"new_ticket",icon:"➕",label:"New Ticket"},
    {id:"time_tracking",icon:"⏱️",label:"Time Tracking"},
    {id:"reports",icon:"📊",label:"Reports",admin:true},
    {id:"users",icon:"👥",label:"Users",admin:true},
    {id:"companies",icon:"🏢",label:"Companies",superAdmin:true},
    {id:"clients",icon:"🤝",label:"Clients",superAdmin:true},
    {id:"ticket_types",icon:"🏷️",label:"Ticket Types",superAdmin:true},
    {id:"activity_log",icon:"📋",label:"Activity Log",superAdmin:true},
    {id:"integrations",icon:"🔌",label:"Integrations",superAdmin:true},
  ].filter(function(n){if(n.superAdmin)return curUser.role==="admin";if(n.admin)return isAdmin;return true;});

  var bottomNav=NAV.slice(0,4);
  var curNav=NAV.find(function(n){return n.id===page;})||{icon:"",label:"—"};

  var sidebar=<div style={{width:220,background:"linear-gradient(180deg,#020e1f,#041833,#062d6b)",display:"flex",flexDirection:"column",flexShrink:0,height:"100%"}}>
    <div style={{padding:"20px 16px 14px",borderBottom:"1px solid rgba(56,189,248,.15)"}}><div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:30,height:30,borderRadius:"50%",background:"linear-gradient(135deg,#fff 60%,#b3d9ff)",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:18,height:18,borderRadius:"50%",background:"linear-gradient(135deg,#0369a1,#0ea5e9)",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:7,height:7,borderRadius:"50%",background:"#020e1f"}}/></div></div><div><div style={{color:"#fff",fontWeight:800,fontSize:14}}>hoptix</div><div style={{color:"#38bdf8",fontSize:9}}>A.eye technology</div></div></div></div>
    <div style={{padding:"8px",flex:1,overflowY:"auto"}}>{NAV.map(function(n){return<div key={n.id} className="nv" onClick={function(){setPage(n.id);}} style={{padding:"10px 12px",borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",gap:8,marginBottom:2,background:page===n.id?"rgba(14,165,233,.25)":"transparent",color:page===n.id?"#fff":"#93c5fd",fontWeight:page===n.id?700:500,fontSize:12,borderLeft:page===n.id?"3px solid #0ea5e9":"3px solid transparent"}}><span style={{fontSize:15}}>{n.icon}</span>{n.label}{n.id==="tickets"&&breaches.length>0&&<span style={{marginLeft:"auto",background:"#ef4444",color:"#fff",borderRadius:10,padding:"1px 6px",fontSize:10}}>{breaches.length}</span>}</div>;})}</div>
    <div style={{padding:"12px 10px",borderTop:"1px solid rgba(56,189,248,.15)"}}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}><Avatar name={curUser.name} id={curUser.id} size={30}/><div style={{flex:1,overflow:"hidden"}}><div style={{color:"#fff",fontSize:11,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{curUser.name}</div><div style={{color:"#7dd3fc",fontSize:10}}>{ROLE_META[curUser.role]?.label||curUser.role}</div></div></div><button onClick={function(){try{if(localStorage.getItem("hd_rememberMe")!=="true")localStorage.removeItem("hd_savedCreds");}catch(e){}setCurUser(null);setPage("dashboard");setSelTicket(null);}} style={{width:"100%",padding:"7px",background:"rgba(239,68,68,.2)",color:"#fca5a5",border:"1px solid rgba(239,68,68,.3)",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>🚪 Sign Out</button></div>
  </div>;

  return<ErrorBoundary>
    <div style={{display:"flex",height:"100vh",fontFamily:"'Inter',system-ui,sans-serif",background:"#f8fafc",fontSize:13,overflow:"hidden"}}>
      <style>{`*{box-sizing:border-box}::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:#f1f5f9}::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:4px}button:active{opacity:.8}.nv:hover{background:rgba(14,165,233,.15)!important;color:#7dd3fc!important}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:767px){.hide-mobile{display:none!important}.desktop-only{display:none!important}}`}</style>

      {!isMobile&&sidebar}
      {isMobile&&sidebarOpen&&<div style={{position:"fixed",inset:0,zIndex:8888,display:"flex"}}>
        <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,.5)"}} onClick={function(){setSidebarOpen(false);}}/>
        <div style={{position:"relative",zIndex:1,width:260,height:"100%"}}>{sidebar}</div>
      </div>}

      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>
        <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",padding:isMobile?"10px 16px":"10px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {isMobile&&<button onClick={function(){setSidebarOpen(true);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:22,padding:2,color:"#334155",display:"flex",alignItems:"center"}}>☰</button>}
            <div style={{fontWeight:700,fontSize:isMobile?13:14,color:"#1e293b",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{curNav.icon} {curNav.label}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            {pendingUsers.length>0&&isAdmin&&<div onClick={function(){setPage("users");}} style={{cursor:"pointer",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:20,padding:"4px 10px",color:"#92400e",fontSize:10,fontWeight:700,display:"flex",alignItems:"center",gap:4}}>⏳ {pendingUsers.length}</div>}
            {breaches.length>0&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:20,padding:"4px 10px",color:"#dc2626",fontSize:10,fontWeight:700}}>⚠️ {breaches.length}</div>}
            {inboxAlerts.length>0&&<div style={{cursor:"pointer",background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:20,padding:"4px 10px",color:"#0369a1",fontSize:10,fontWeight:700,display:"flex",alignItems:"center",gap:4}} onClick={function(){setPage("tickets");}}>📬 {inboxAlerts.length}<button onClick={function(e){e.stopPropagation();setInboxAlerts([]);}} style={{background:"none",border:"none",cursor:"pointer",color:"#64748b",fontSize:11,padding:0,lineHeight:1}}>✕</button></div>}
            <button onClick={function(){setShowProfile(true);}} style={{display:"flex",alignItems:"center",gap:6,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"5px 10px 5px 5px",cursor:"pointer"}}><Avatar name={curUser.name} id={curUser.id} size={26}/>{!isMobile&&<div style={{textAlign:"left"}}><div style={{fontWeight:700,fontSize:11}}>{curUser.name}</div><div style={{fontSize:10,color:"#94a3b8"}}>{ROLE_META[curUser.role]?.label||curUser.role}</div></div>}<span style={{fontSize:10,color:"#94a3b8"}}>▼</span></button>
          </div>
        </div>

        {toast&&<div style={{position:"fixed",top:isMobile?70:20,right:12,left:isMobile?12:"auto",zIndex:10000,background:toast.type==="error"?"#ef4444":"#10b981",color:"#fff",padding:"10px 16px",borderRadius:10,fontWeight:600,fontSize:13,boxShadow:"0 4px 20px rgba(0,0,0,.2)",textAlign:"center"}}>{toast.msg}</div>}

        <div style={{flex:1,overflowY:"auto",padding:isMobile?"12px":"24px",paddingBottom:isMobile?"80px":"24px",WebkitOverflowScrolling:"touch"}}>
          {page==="dashboard"    &&<PageDashboard   tickets={visible} allTickets={allNonDeleted} users={users} ticketTypes={ticketTypes} companies={companies} clients={clients} setPage={setPage} setSelTicket={setSelTicket} breaches={breaches} isMobile={isMobile}/>}
          {page==="tickets"      &&<PageTickets     tickets={visible} users={users} companies={companies} clients={clients} ticketTypes={ticketTypes} curUser={curUser} setTickets={setTickets} addLog={addLog} showToast={showToast} setSelTicket={setSelTicket} setPage={setPage} isAdmin={isAdmin} statusSla={statusSla} schedules={schedules} isMobile={isMobile}/>}
          {page==="new_ticket"   &&<PageNewTicket   users={users} companies={companies} clients={clients} ticketTypes={ticketTypes} curUser={curUser} setTickets={setTickets} addLog={addLog} showToast={showToast} setPage={setPage}/>}
          {page==="time_tracking"&&<PageTimeTracking tickets={visible} users={users} ticketTypes={ticketTypes} curUser={curUser} isAdmin={isAdmin} isTech={isTech} setSelTicket={setSelTicket} isMobile={isMobile}/>}
          {page==="reports"      &&<PageReports     tickets={visible} users={users} ticketTypes={ticketTypes} companies={companies} clients={clients} statusSla={statusSla} schedules={schedules}/>}
          {page==="users"        &&<PageUsers       users={users} companies={companies} setUsers={setUsers} curUser={curUser} addLog={addLog} showToast={showToast} schedules={schedules} setSchedules={setSchedulesR} dbSaveUser={dbSaveUser} dbDeleteUser={dbDeleteUser} dbSetPassword={dbSetPassword} dbSaveSchedule={dbSaveSchedule} isMobile={isMobile}/>}
          {page==="companies"    &&<PageCompanies   companies={companies} users={users} setCompanies={setCompanies} addLog={addLog} showToast={showToast} dbSaveCompany={dbSaveCompany} dbDeleteCompany={dbDeleteCompany}/>}
          {page==="clients"      &&<PageClients     clients={clients} setClients={setClients} companies={companies} addLog={addLog} showToast={showToast} dbSaveClient={dbSaveClient} dbDeleteClient={dbDeleteClient}/>}
          {page==="ticket_types" &&<PageTicketTypes ticketTypes={ticketTypes} users={users} setTicketTypes={setTTR} statusSla={statusSla} setStatusSla={setStatusSlaR} addLog={addLog} showToast={showToast} dbSaveTicketType={dbSaveTicketType} dbDeleteTicketType={dbDeleteTicketType}/>}
          {page==="activity_log" &&<PageActivityLog logs={logs} users={users}/>}
          {page==="integrations" &&<PageIntegrations showToast={showToast} addLog={addLog} emailTemplates={emailTemplates} setEmailTemplates={setEmailTemplates} curUser={curUser} isAdmin={isAdmin}/>}
        </div>

        {isMobile&&<div style={{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderTop:"1px solid #e2e8f0",display:"flex",zIndex:8000,boxShadow:"0 -2px 10px rgba(0,0,0,.08)"}}>
          {bottomNav.map(function(n){var active=page===n.id;return<button key={n.id} onClick={function(){setPage(n.id);}} style={{flex:1,background:"none",border:"none",cursor:"pointer",padding:"8px 4px 10px",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:20}}>{n.icon}</span>
            <span style={{fontSize:9,fontWeight:active?700:500,color:active?"#6366f1":"#94a3b8"}}>{n.label}</span>
            {active&&<div style={{width:4,height:4,borderRadius:"50%",background:"#6366f1"}}/>}
          </button>;})}
          <button onClick={function(){setSidebarOpen(true);}} style={{flex:1,background:"none",border:"none",cursor:"pointer",padding:"8px 4px 10px",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:20}}>☰</span>
            <span style={{fontSize:9,fontWeight:500,color:"#94a3b8"}}>More</span>
          </button>
        </div>}
      </div>

      {selTicket&&<TicketDetail ticket={tickets.find(function(t){return t.id===selTicket;})} tickets={tickets} setTickets={setTickets} users={users} ticketTypes={ticketTypes} companies={companies} clients={clients} curUser={curUser} isAdmin={isAdmin} isTech={isTech} addLog={addLog} showToast={showToast} statusSla={statusSla} schedules={schedules} emailTemplates={emailTemplates} onClose={function(){setSelTicket(null);}}/>}
      {showProfile&&<ProfileModal curUser={curUser} setUsers={setUsers} setCurUser={setCurUser} showToast={showToast} addLog={addLog} schedules={schedules} setSchedules={setSchedulesR} dbSaveSchedule={dbSaveSchedule} onClose={function(){setShowProfile(false);}}/>}
    </div>
  </ErrorBoundary>;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function PageDashboard(p){
  var tickets=p.tickets;var allTickets=p.allTickets||p.tickets;var users=p.users;var ticketTypes=p.ticketTypes;var clients=p.clients;var setPage=p.setPage;var setSelTicket=p.setSelTicket;var breaches=p.breaches;var isMobile=p.isMobile;
  var byStatus=ALL_STATUSES.map(function(s){return{name:s,value:tickets.filter(function(t){return t.status===s;}).length,color:STATUS_META[s].color};});
  var byPri=Object.keys(PRI_META).map(function(k){return{name:PRI_META[k].label,value:tickets.filter(function(t){return t.priority===k;}).length,color:PRI_META[k].color};});
  var daily=Array.from({length:7},function(_,i){var d=new Date(Date.now()-(6-i)*86400000);return{lbl:d.toLocaleDateString("en",{weekday:"short"}),created:tickets.filter(function(t){return new Date(t.createdAt).toDateString()===d.toDateString();}).length,closed:tickets.filter(function(t){return t.closedAt&&new Date(t.closedAt).toDateString()===d.toDateString();}).length};});
  var techs=users.filter(function(u){return["it_technician","it_manager"].includes(u.role);});
  var byType=ticketTypes.map(function(tt,i){return{name:tt.name,value:tickets.filter(function(t){return t.typeId===tt.id;}).length,fill:PAL[i%PAL.length]};}).filter(function(x){return x.value>0;});
  return<div>
    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(auto-fill,minmax(150px,1fr))",gap:10,marginBottom:16}}>
      <Stat label="Total" value={tickets.length} icon="🎫" color="#6366f1"/>
      <Stat label="Open" value={tickets.filter(function(t){return t.status==="Open";}).length} icon="📬" color="#f59e0b"/>
      <Stat label="In Progress" value={tickets.filter(function(t){return t.status==="In Progress";}).length} icon="⚙️" color="#6366f1"/>
      <Stat label="Escalated" value={tickets.filter(function(t){return t.status==="Escalated";}).length} icon="🔺" color="#7c3aed"/>
      <Stat label="Closed" value={allTickets.filter(function(t){return t.status==="Closed";}).length} icon="✅" color="#10b981"/>
      <Stat label="SLA Breaches" value={breaches.length} icon="🚨" color="#ef4444"/>
    </div>
    {breaches.length>0&&<Card style={{marginBottom:16,borderLeft:"4px solid #ef4444",background:"#fef2f2"}}><div style={{fontWeight:700,color:"#dc2626",marginBottom:10,fontSize:13}}>🚨 SLA Breach Alerts</div>{breaches.slice(0,5).map(function(t){return<div key={t.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#fff",padding:"8px 10px",borderRadius:8,border:"1px solid #fecaca",marginBottom:6,gap:8}}><span style={{fontWeight:600,fontSize:12,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</span><Btn size="sm" variant="ghost" onClick={function(){setSelTicket(t.id);}}>View</Btn></div>;})}</Card>}
    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fit,minmax(280px,1fr))",gap:14,marginBottom:14}}>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12,fontSize:13}}>Tickets by Status</div><ResponsiveContainer width="100%" height={180}><PieChart><Pie data={byStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={pieLabel} fontSize={9}>{byStatus.map(function(e,i){return<Cell key={i} fill={e.color}/>;})}</Pie><Tooltip/></PieChart></ResponsiveContainer></Card>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12,fontSize:13}}>7-Day Trend</div><ResponsiveContainer width="100%" height={180}><AreaChart data={daily}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="lbl" tick={{fontSize:9}}/><YAxis tick={{fontSize:9}}/><Tooltip/><Legend wrapperStyle={{fontSize:9}}/><Area type="monotone" dataKey="created" stroke="#6366f1" fill="#eef2ff" name="Created"/><Area type="monotone" dataKey="closed" stroke="#10b981" fill="#d1fae5" name="Closed"/></AreaChart></ResponsiveContainer></Card>
    </div>
    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:14}}>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12,fontSize:13}}>Technician Workload</div>{techs.length===0&&<div style={{color:"#94a3b8",fontSize:12}}>No technicians yet.</div>}{techs.map(function(t){var open=tickets.filter(function(tk){return tk.assignedTo===t.id&&tk.status!=="Closed";}).length;var total=tickets.filter(function(tk){return tk.assignedTo===t.id;}).length;return<div key={t.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}><Avatar name={t.name} id={t.id} size={26}/><div style={{flex:1}}><div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontWeight:600}}><span>{t.name}</span><span style={{color:"#6366f1"}}>{open}/{total}</span></div><div style={{background:"#e2e8f0",borderRadius:4,height:5,marginTop:4}}><div style={{background:"#6366f1",height:5,borderRadius:4,width:(total?Math.min(100,Math.round(open/total*100)):0)+"%"}}/></div></div></div>;})}</Card>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12,fontSize:13}}>Tickets by Type</div>{byType.length===0&&<div style={{color:"#94a3b8",fontSize:12}}>No tickets yet.</div>}{byType.slice(0,6).map(function(t,i){return<div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid #f1f5f9"}}><span style={{fontSize:12,color:"#475569"}}>{t.name}</span><Badge label={t.value} color={PAL[i%PAL.length]}/></div>;})}</Card>
    </div>
  </div>;
}

// ── Tickets (with Assigned To filter) ────────────────────────────────────────
function PageTickets(p){
  var tickets=p.tickets;var users=p.users;var clients=p.clients;var ticketTypes=p.ticketTypes;var curUser=p.curUser;
  var setTickets=p.setTickets;var addLog=p.addLog;var showToast=p.showToast;var setSelTicket=p.setSelTicket;var setPage=p.setPage;var isAdmin=p.isAdmin;var statusSla=p.statusSla;var schedules=p.schedules||{};var isMobile=p.isMobile;
  var[search,setSearch]=useState("");var[fStat,setFStat]=useState("");var[fPri,setFPri]=useState("");var[fType,setFType]=useState("");
  var[fAssignee,setFAssignee]=useState(function(){
    // Default: if tech, show their own tickets
    return IT_ROLES.includes(curUser.role)&&!["admin","it_manager"].includes(curUser.role)?curUser.id:"";
  });
  var filtered=tickets.filter(function(t){var q=search.toLowerCase();return(!q||t.title.toLowerCase().includes(q)||t.id.includes(q)||t.description.toLowerCase().includes(q))&&(!fStat||t.status===fStat)&&(!fPri||t.priority===fPri)&&(!fType||t.typeId===fType)&&(!fAssignee||(fAssignee==="__unassigned__"?!t.assignedTo:t.assignedTo===fAssignee));});
  function delTicket(id){setTickets(function(prev){return prev.map(function(t){return t.id===id?Object.assign({},t,{deleted:true}):t;});});addLog("TICKET_DELETED",id,"Ticket #"+id+" deleted");showToast("Ticket deleted");}
  function fu(id){return users.find(function(x){return x.id===id;});}
  function ftt(id){return ticketTypes.find(function(x){return x.id===id;});}
  function fcl(id){return clients.find(function(x){return x.id===id;});}
  var techUsers=users.filter(function(u){return IT_ROLES.includes(u.role)&&u.active;});
  return<div>
    <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
      <input value={search} onChange={function(e){setSearch(e.target.value);}} placeholder="🔍 Search tickets..." style={{flex:1,minWidth:140,padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none"}}/>
      <Btn onClick={function(){setPage("new_ticket");}}>➕ New</Btn>
    </div>
    <div style={{display:"flex",gap:6,marginBottom:14,overflowX:"auto",paddingBottom:4,flexWrap:"wrap"}}>
      <select value={fStat} onChange={function(e){setFStat(e.target.value);}} style={{padding:"7px 8px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none",flexShrink:0}}><option value="">All Status</option>{ALL_STATUSES.map(function(s){return<option key={s} value={s}>{s}</option>;})}</select>
      <select value={fPri} onChange={function(e){setFPri(e.target.value);}} style={{padding:"7px 8px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none",flexShrink:0}}><option value="">All Priority</option>{Object.keys(PRI_META).map(function(k){return<option key={k} value={k}>{PRI_META[k].label}</option>;})}</select>
      <select value={fType} onChange={function(e){setFType(e.target.value);}} style={{padding:"7px 8px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none",flexShrink:0}}><option value="">All Types</option>{ticketTypes.map(function(t){return<option key={t.id} value={t.id}>{t.name}</option>;})}</select>
      <select value={fAssignee} onChange={function(e){setFAssignee(e.target.value);}} style={{padding:"7px 8px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none",flexShrink:0,background:"#eef2ff",color:"#4338ca",fontWeight:600}}>
        <option value="">All Assigned</option>
        <option value="__unassigned__">— Unassigned</option>
        {techUsers.map(function(u){return<option key={u.id} value={u.id}>{u.name}</option>;})}
      </select>
    </div>

    {isMobile?(
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {filtered.length===0&&<Card><div style={{textAlign:"center",padding:32,color:"#94a3b8"}}>No tickets found</div></Card>}
        {filtered.map(function(t){
          var asgn=fu(t.assignedTo);var type=ftt(t.typeId);var client=fcl(t.clientId);
          var pri=PRI_META[t.priority]||PRI_META.medium;var sm=STATUS_META[t.status]||STATUS_META.Open;
          var sSla=getStatusSla(t,statusSla,schedules);
          return<div key={t.id} style={{background:"#fff",borderRadius:12,border:"1px solid #e2e8f0",padding:14,boxShadow:"0 1px 4px rgba(0,0,0,.05)"}} onClick={function(){setSelTicket(t.id);}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8,gap:8}}>
              <div style={{flex:1}}><div style={{fontWeight:700,color:"#1e293b",fontSize:14,marginBottom:2}}>{t.title}</div><div style={{fontSize:11,color:"#94a3b8"}}>{ago(t.createdAt)}</div></div>
              {t.hasUnreadReply&&<span style={{background:"#10b981",color:"#fff",borderRadius:10,padding:"2px 8px",fontSize:10,fontWeight:700,flexShrink:0}}>📬 New</span>}
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
              <Badge label={t.status} color={sm.color} bg={sm.bg}/>
              <Badge label={pri.label} color={pri.color} bg={pri.bg}/>
              {type&&<Badge label={type.name} color={type.color||"#94a3b8"}/>}
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:11,color:"#64748b"}}>{asgn?<span>👤 {asgn.name}</span>:<span style={{color:"#ef4444"}}>Unassigned</span>}{client&&<span> · 🤝 {client.name}</span>}</div>
              {sSla&&<div style={{fontSize:10,color:sSla.breached?"#ef4444":"#64748b",fontWeight:600}}>{sSla.breached?"⚠️ Breached":"⏱ "+sSla.remaining.toFixed(1)+"h"}</div>}
            </div>
            {isAdmin&&<div style={{marginTop:8,display:"flex",justifyContent:"flex-end"}} onClick={function(e){e.stopPropagation();delTicket(t.id);}}><Btn size="sm" variant="danger">🗑 Delete</Btn></div>}
          </div>;
        })}
      </div>
    ):(
      <div style={{background:"#fff",borderRadius:12,border:"1px solid #e2e8f0",overflow:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:800}}>
          <thead><tr style={{background:"#f8fafc"}}>{["#","Title","Type","Priority","Status","Client","Assigned To","SLA",""].map(function(h){return<th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>{h}</th>;})}</tr></thead>
          <tbody>
            {filtered.length===0&&<tr><td colSpan={9} style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No tickets found</td></tr>}
            {filtered.map(function(t,i){
              var asgn=fu(t.assignedTo);var type=ftt(t.typeId);var client=fcl(t.clientId);
              var pri=PRI_META[t.priority]||PRI_META.medium;var sm=STATUS_META[t.status]||STATUS_META.Open;
              var sSla=getStatusSla(t,statusSla,schedules);
              return<tr key={t.id} style={{borderBottom:"1px solid #f1f5f9",background:i%2===0?"#fff":"#fafafa"}}>
                <td style={{padding:"9px 12px",fontSize:11,color:"#94a3b8",fontWeight:600}}>#{t.id.slice(-6)}</td>
                <td style={{padding:"9px 12px",maxWidth:200}}><div style={{fontWeight:600,color:"#1e293b",fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div><div style={{fontSize:10,color:"#94a3b8"}}>{ago(t.createdAt)}</div>{t.hasUnreadReply&&<span style={{background:"#10b981",color:"#fff",borderRadius:10,padding:"1px 6px",fontSize:10,fontWeight:700}}>📬</span>}</td>
                <td style={{padding:"9px 12px"}}><Badge label={type?.name||"—"} color={type?.color||"#94a3b8"}/></td>
                <td style={{padding:"9px 12px"}}><Badge label={pri.label} color={pri.color} bg={pri.bg}/></td>
                <td style={{padding:"9px 12px"}}><Badge label={t.status} color={sm.color} bg={sm.bg}/></td>
                <td style={{padding:"9px 12px",fontSize:11,color:"#334155"}}>{client?<span>🤝 {client.name}</span>:<span style={{color:"#94a3b8"}}>—</span>}</td>
                <td style={{padding:"9px 12px"}}>{asgn?<div style={{display:"flex",alignItems:"center",gap:5}}><Avatar name={asgn.name} id={asgn.id} size={20}/><span style={{fontSize:11}}>{asgn.name}</span></div>:<span style={{fontSize:11,color:"#ef4444"}}>Unassigned</span>}</td>
                <td style={{padding:"9px 12px",minWidth:120}}>{sSla?<div><div style={{fontSize:10,color:sSla.breached?"#ef4444":"#64748b",fontWeight:600,marginBottom:2}}>{sSla.breached?"⚠️ Breached":"⏱ "+sSla.remaining.toFixed(1)+"h left"}</div><div style={{height:4,background:"#e2e8f0",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:sSla.pct+"%",background:sSla.pct>=100?"#ef4444":sSla.pct>=75?"#f59e0b":"#10b981",borderRadius:3}}/></div></div>:<span style={{fontSize:10,color:"#94a3b8"}}>—</span>}</td>
                <td style={{padding:"9px 12px"}}><div style={{display:"flex",gap:4}}><Btn size="sm" variant="ghost" onClick={function(){setSelTicket(t.id);}}>View</Btn>{isAdmin&&<Btn size="sm" variant="danger" onClick={function(){delTicket(t.id);}}>🗑</Btn>}</div></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    )}
  </div>;
}

// ── New Ticket ────────────────────────────────────────────────────────────────
function PageNewTicket(p){
  var users=p.users;var companies=p.companies;var clients=p.clients;var ticketTypes=p.ticketTypes;var curUser=p.curUser;
  var setTickets=p.setTickets;var addLog=p.addLog;var showToast=p.showToast;var setPage=p.setPage;
  var[form,setForm]=useState({title:"",description:"",typeId:ticketTypes[0]?.id||"",companyId:curUser.companyId||companies[0]?.id||"",clientId:"",locationId:"",externalEmail:"",customTypeName:""});
  var[start]=useState(Date.now());var[preview,setPreview]=useState(null);var[attachments,setAttachments]=useState([]);
  function fld(k,v){setForm(function(prev){return Object.assign({},prev,{[k]:v});});}
  var selType=ticketTypes.find(function(t){return t.id===form.typeId;});
  var selClient=clients.find(function(c){return c.id===form.clientId;});var availLocs=selClient?selClient.locations:[];
  var ACCEPTED=["image/jpeg","image/png","image/gif","image/webp","video/mp4","video/quicktime","video/webm"];
  function fmtSize(b){return b>1048576?(b/1048576).toFixed(1)+"MB":(b/1024).toFixed(0)+"KB";}
  function processFiles(files){Array.from(files).forEach(function(file){if(!ACCEPTED.includes(file.type)){showToast("Unsupported: "+file.name,"error");return;}if(file.size>20*1024*1024){showToast(file.name+" > 20MB","error");return;}var r=new FileReader();r.onload=function(e){setAttachments(function(prev){if(prev.length>=10){showToast("Max 10 attachments","error");return prev;}return prev.concat([{id:uid(),name:file.name,type:file.type,size:file.size,dataUrl:e.target.result}]);});};r.readAsDataURL(file);});}
  function removeAtt(id){setAttachments(function(prev){return prev.filter(function(a){return a.id!==id;});});}
  function handlePreview(){
    if(!form.title.trim()||!form.description.trim()){showToast("Fill in title and description","error");return;}
    var assign=aiAssign(form.title,form.description,form.typeId,users,ticketTypes);
    var tt=ticketTypes.find(function(t){return t.id===form.typeId;});
    var now=new Date().toISOString();var sla=new Date(Date.now()+(tt?tt.slaHours:24)*3600000).toISOString();
    var mins=Math.max(0.017,(Date.now()-start)/60000);
    var draft=Object.assign({},form,{id:"t"+Date.now(),status:"Open",priority:tt?tt.priority:"medium",submittedBy:curUser.id,assignedTo:assign.id,createdAt:now,updatedAt:now,submittedAt:now,formOpenedAt:new Date(start).toISOString(),slaDeadline:sla,slaBreached:false,timeToCreateMins:mins,statusHistory:[{status:"Open",assignedTo:assign.id,timestamp:now,changedBy:curUser.id,note:"Ticket created — "+assign.reason}],conversations:[],closedAt:null,deleted:false,aiReason:assign.reason,attachments:attachments});
    setPreview({draft:draft,assign:assign});
  }
  function handleSubmit(){setTickets(function(prev){return prev.concat([preview.draft]);});addLog("TICKET_CREATED",preview.draft.id,"Ticket \""+preview.draft.title+"\" created.");showToast("✅ Ticket submitted!");setPage("tickets");}
  return<div style={{maxWidth:640,margin:"0 auto"}}>
    <Card>
      <div style={{fontWeight:700,fontSize:15,color:"#1e293b",marginBottom:16}}>📋 Submit New Ticket</div>
      {ticketTypes.length===0&&<div style={{background:"#fef3c7",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#92400e"}}>⚠️ No ticket types configured yet.</div>}
      <FInput label="Title *" value={form.title} onChange={function(e){fld("title",e.target.value);}} placeholder="Brief description"/>
      {ticketTypes.length>0&&<FSelect label="Ticket Type *" value={form.typeId} onChange={function(e){fld("typeId",e.target.value);}} options={optTypes(ticketTypes)}/>}
      {companies.length>0&&<FSelect label="Company *" value={form.companyId} onChange={function(e){fld("companyId",e.target.value);}} options={optCompanies(companies)}/>}
      <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:14,marginBottom:14}}>
        <div style={{fontWeight:700,color:"#1e293b",fontSize:12,marginBottom:12}}>🤝 Client &amp; Location</div>
        <FSelect label="Client" value={form.clientId} onChange={function(e){fld("clientId",e.target.value);fld("locationId","");}} options={optClients(clients)}/>
        <FSelect label="Location" value={form.locationId} onChange={function(e){fld("locationId",e.target.value);}} options={optLocs(availLocs)} disabled={!form.clientId}/>
      </div>
      <FTextarea label="Description *" value={form.description} onChange={function(e){fld("description",e.target.value);}} placeholder="Detailed description..." rows={5}/>
      <FInput label="External Email (optional)" value={form.externalEmail} onChange={function(e){fld("externalEmail",e.target.value);}} placeholder="external@client.com" type="email"/>
      <div style={{marginBottom:14}}>
        <label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:6}}>📎 Attachments</label>
        <button type="button" onClick={function(){document.getElementById("tfi").click();}} style={{width:"100%",padding:"14px",border:"2px dashed #cbd5e1",borderRadius:10,background:"#f8fafc",color:"#475569",fontSize:13,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>📁 Tap to attach files</button>
        <input id="tfi" type="file" multiple accept="image/*,video/*" style={{display:"none"}} onChange={function(e){processFiles(e.target.files);e.target.value="";}}/>
        {attachments.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(90px,1fr))",gap:8,marginTop:8}}>{attachments.map(function(a){return<div key={a.id} style={{position:"relative",borderRadius:8,overflow:"hidden",border:"1px solid #e2e8f0"}}>{a.type.startsWith("image/")?<img src={a.dataUrl} alt={a.name} style={{width:"100%",height:70,objectFit:"cover",display:"block"}}/>:<div style={{height:70,display:"flex",alignItems:"center",justifyContent:"center",background:"#1e1b4b"}}><span style={{fontSize:24}}>🎬</span></div>}<button onClick={function(){removeAtt(a.id);}} style={{position:"absolute",top:3,right:3,background:"rgba(0,0,0,.55)",color:"#fff",border:"none",borderRadius:"50%",width:20,height:20,cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button></div>;})}</div>}
      </div>
      {selType&&<div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:8,padding:12,marginBottom:14,fontSize:12}}><div style={{fontWeight:700,color:"#0369a1",marginBottom:4}}>Auto-settings for "{selType.name}"</div><div style={{color:"#0c4a6e"}}>⚡ {PRI_META[selType.priority]?.label} · ⏱ {selType.slaHours}h SLA · 🤖 AI assign</div></div>}
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setPage("tickets");}}>Cancel</Btn><Btn onClick={handlePreview}>🔍 Preview &amp; Submit</Btn></div>
    </Card>
    {preview&&<Modal title="Confirm Submission" onClose={function(){setPreview(null);}}>
      <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:12,marginBottom:14}}><div style={{fontWeight:700,color:"#166534",marginBottom:4}}>🤖 AI Assignment</div><div style={{fontSize:13,color:"#14532d"}}>{preview.assign.reason}</div></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>{[["Title",preview.draft.title],["Priority",PRI_META[preview.draft.priority]?.label],["Assigned To",(users.find(function(u){return u.id===preview.draft.assignedTo;})||{name:"Unassigned"}).name],["Attachments",preview.draft.attachments.length+" files"]].map(function(pair){return<div key={pair[0]} style={{background:"#f8fafc",padding:10,borderRadius:8}}><div style={{color:"#64748b",fontSize:10,fontWeight:700,textTransform:"uppercase"}}>{pair[0]}</div><div style={{fontWeight:600,color:"#1e293b",marginTop:2,fontSize:13}}>{pair[1]||"—"}</div></div>;})}</div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setPreview(null);}}>Edit</Btn><Btn variant="success" onClick={handleSubmit}>✅ Submit</Btn></div>
    </Modal>}
  </div>;
}

// ── Ticket Detail ─────────────────────────────────────────────────────────────
function TicketDetail(p){
  var ticket=p.ticket;var setTickets=p.setTickets;var users=p.users;var ticketTypes=p.ticketTypes;
  var tickets=p.tickets||[];var liveTicket=tickets.find(function(t){return t.id===ticket.id;})||ticket;
  var companies=p.companies;var clients=p.clients;var curUser=p.curUser;var isAdmin=p.isAdmin;var isTech=p.isTech;
  var addLog=p.addLog;var showToast=p.showToast;var onClose=p.onClose;var statusSla=p.statusSla;var schedules=p.schedules||{};
  var[tab,setTab]=useState("details");var[status,setStatus]=useState(ticket.status);var[asgn,setAsgn]=useState(ticket.assignedTo||"");var[note,setNote]=useState("");var[typeId,setTypeId]=useState(ticket.typeId||"");
  var[msgTo,setMsgTo]=useState("");var[msgCC,setMsgCC]=useState("");var[msgSubj,setMsgSubj]=useState("Re: [#"+ticket.id+"] "+ticket.title);var[msgBody,setMsgBody]=useState("");
  var emailTemplates=p.emailTemplates||[];var clients2=p.clients||[];var assignedUser=users.find(function(u){return u.id===ticket.assignedTo;});
  function applyTemplate(tid){var tmpl=emailTemplates.find(function(t){return t.id===tid;});if(!tmpl)return;var cl2=clients2.find(function(c){return c.id===ticket.clientId;});var loc2=cl2?cl2.locations.find(function(l){return l.id===ticket.locationId;}):null;var body=tmpl.body.replace(/{{client_name}}/g,cl2?cl2.name:"[Client]").replace(/{{agent_name}}/g,assignedUser?assignedUser.name:"[Agent]");var subj=tmpl.subject.replace(/{{client_name}}/g,cl2?cl2.name:"[Client]").replace(/{{agent_name}}/g,assignedUser?assignedUser.name:"[Agent]");if(cl2)subj=subj+(loc2?" — "+cl2.name+", "+loc2.name:" — "+cl2.name);setMsgSubj(subj);setMsgBody(body);}
  var[emailSending,setEmailSending]=useState(false);
  function fu(id){return users.find(function(x){return x.id===id;});}
  var tt=ticketTypes.find(function(t){return t.id===ticket.typeId;});var co=companies.find(function(c){return c.id===ticket.companyId;});var client=clients.find(function(c){return c.id===ticket.clientId;});var loc=client?client.locations.find(function(l){return l.id===ticket.locationId;}):null;
  if(!ticket)return null;
  var sSla=getStatusSla(ticket,statusSla,schedules);
  var createMins=ticket.timeToCreateMins||0;

  function saveStatus(){
    var statusChanged=status!==ticket.status;
    var hist={status,assignedTo:asgn||null,timestamp:new Date().toISOString(),changedBy:curUser.id,note:note||(statusChanged?"Status changed to "+status:"Details updated")};
    if(!statusChanged)hist._noSlaReset=true;
    var newTT=ticketTypes.find(function(t){return t.id===typeId;});var typeChanged=typeId&&typeId!==ticket.typeId;
    var newSlaDeadline=typeChanged&&newTT?new Date(new Date(ticket.createdAt).getTime()+newTT.slaHours*3600000).toISOString():ticket.slaDeadline;
    var newPriority=typeChanged&&newTT?newTT.priority:ticket.priority;
    if(typeChanged)hist.note=(note||"")+(note?" | ":"")+"Type changed to: "+newTT.name;
    setTickets(function(prev){return prev.map(function(t){if(t.id!==ticket.id)return t;var newHist=statusChanged?(t.statusHistory||[]).concat([hist]):(t.statusHistory||[]).concat([Object.assign({},hist,{_noSlaReset:true})]);return Object.assign({},t,{status,assignedTo:asgn||null,typeId:typeId||t.typeId,priority:newPriority,slaDeadline:newSlaDeadline,updatedAt:new Date().toISOString(),slaBreached:new Date()>new Date(newSlaDeadline)&&status!=="Closed",closedAt:status==="Closed"&&!t.closedAt?new Date().toISOString():t.closedAt,statusHistory:newHist});});});
    addLog("TICKET_STATUS",ticket.id,(statusChanged?"Status → "+status:"Details updated")+". Assigned: "+(fu(asgn)?.name||"nobody"));
    showToast("Ticket updated");setNote("");onClose();
  }

  async function sendEmail(){
    if(!msgTo.trim()||!msgBody.trim()){showToast("Recipient and body required","error");return;}
    setEmailSending(true);
    var toList=msgTo.split(",").map(function(e){return e.trim();});
    var ccList=msgCC?msgCC.split(",").map(function(e){return e.trim();}).filter(Boolean):[];
    var msgId=uid();
    var msg={id:msgId,from:curUser.id,fromEmail:curUser.email,to:[],toEmails:toList,cc:ccList,subject:msgSubj,body:msgBody,timestamp:new Date().toISOString(),isExternal:false,status:"sending"};
    setTickets(function(prev){return prev.map(function(t){return t.id===ticket.id?Object.assign({},t,{conversations:(t.conversations||[]).concat([msg])}):t;});});
    var results=await Promise.all(toList.map(function(email){return callSendEmail({to:email,subject:msgSubj,body:msgBody});}));
    var allOk=results.every(function(r){return r.success;});
    var failMsg=!allOk?results.filter(function(r){return !r.success;}).map(function(r){return r.error;}).join(", "):"";
    var finalConvs=(ticket.conversations||[]).concat([msg]).map(function(c){return c.id===msgId?Object.assign({},c,{status:allOk?"sent":"failed",failReason:failMsg}):c;});
    setTickets(function(prev){return prev.map(function(t){if(t.id!==ticket.id)return t;return Object.assign({},t,{conversations:finalConvs});});});
    var updatedConvs=(ticket.conversations||[]).concat([msg]).map(function(c){return c.id===msgId?Object.assign({},c,{status:allOk?"sent":"failed",failReason:failMsg}):c;});
    await dbSaveTicket(Object.assign({},ticket,{conversations:updatedConvs}));
    addLog("EMAIL_SENT",ticket.id,"Email to "+msgTo);showToast(allOk?"📧 Email sent!":"⚠️ Failed",allOk?"ok":"error");
    setEmailSending(false);if(allOk){setMsgTo("");setMsgCC("");setMsgBody("");}
  }

  var TABS=["details","status","email","chat","history"].filter(function(t){if(t==="status")return isTech;return true;});
  var tabLabels={details:"📋",status:"🔄",email:"📧",chat:"💬",history:"📜"};
  var tabFullLabels={details:"Details",status:"Status",email:"Email",chat:"Chat",history:"History"};

  return<Modal title={ticket.title} onClose={onClose} wide>
    {liveTicket.hasUnreadReply&&<div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
      <span style={{fontSize:16}}>📬</span><div style={{flex:1}}><div style={{fontWeight:700,color:"#166534",fontSize:13}}>New reply received</div></div>
      <button onClick={function(){setTab("email");setTickets(function(prev){return prev.map(function(tk){return tk.id===ticket.id?Object.assign({},tk,{hasUnreadReply:false}):tk;});});}} style={{padding:"6px 12px",background:"#10b981",color:"#fff",border:"none",borderRadius:8,fontWeight:700,fontSize:12,cursor:"pointer",flexShrink:0}}>View</button>
    </div>}

    <div style={{display:"flex",gap:4,marginBottom:14,overflowX:"auto",paddingBottom:2}}>
      {TABS.map(function(t){return<button key={t} onClick={function(){if(t==="email"&&ticket.hasUnreadReply)setTickets(function(prev){return prev.map(function(tk){return tk.id===ticket.id?Object.assign({},tk,{hasUnreadReply:false}):tk;});});setTab(t);}} style={{background:tab===t?"#6366f1":"#f1f5f9",color:tab===t?"#fff":"#475569",border:"none",borderRadius:8,padding:"7px 14px",cursor:"pointer",fontSize:12,fontWeight:700,flexShrink:0,position:"relative"}}>
        {tabLabels[t]} {tabFullLabels[t]}{t==="email"&&ticket.hasUnreadReply&&<span style={{position:"absolute",top:-3,right:-3,background:"#10b981",color:"#fff",borderRadius:"50%",width:14,height:14,fontSize:8,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>!</span>}
      </button>;})}
    </div>

    {tab==="details"&&<div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
        {[["Type",tt?.name||"—"],["Priority",<Badge key="p" label={PRI_META[ticket.priority]?.label||ticket.priority} color={PRI_META[ticket.priority]?.color||"#6366f1"}/>],["Status",<Badge key="s" label={ticket.status} color={STATUS_META[ticket.status]?.color||"#6366f1"}/>],["Company",co?.name||"—"],["Submitted By",fu(ticket.submittedBy)?.name||"—"],["Assigned To",fu(ticket.assignedTo)?.name||"Unassigned"],["Created",fdt(ticket.createdAt)],["SLA Deadline",fdt(ticket.slaDeadline)]].map(function(pair){return<div key={pair[0]} style={{background:"#f8fafc",padding:10,borderRadius:8}}><div style={{color:"#64748b",fontSize:10,fontWeight:700,textTransform:"uppercase",marginBottom:3}}>{pair[0]}</div><div style={{fontWeight:600,color:"#1e293b",fontSize:12}}>{pair[1]}</div></div>;})}
      </div>
      {client&&<div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:12,marginBottom:12}}><div style={{fontWeight:700,color:"#0369a1",fontSize:12,marginBottom:8}}>🤝 {client.name}</div><div style={{fontSize:11,color:"#64748b"}}>📧 {client.email} · 📞 {client.phone}</div>{loc&&<div style={{fontSize:11,color:"#64748b",marginTop:4}}>📍 {loc.name} — {loc.address}</div>}</div>}
      <div style={{background:"#f8fafc",padding:12,borderRadius:8,fontSize:13,lineHeight:1.6,whiteSpace:"pre-wrap",color:"#334155",marginBottom:12}}>{ticket.description}</div>
      {sSla&&<div style={{background:sSla.breached?"#fef2f2":"#f0fdf4",border:"1px solid "+(sSla.breached?"#fecaca":"#bbf7d0"),borderRadius:10,padding:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><div style={{fontWeight:700,color:sSla.breached?"#dc2626":"#166534",fontSize:12}}>⏱ Status SLA</div><Badge label={sSla.breached?"BREACHED":"✓ OK"} color={sSla.breached?"#ef4444":"#10b981"}/></div>
        <div style={{height:6,background:"#e2e8f0",borderRadius:3,overflow:"hidden",marginBottom:8}}><div style={{height:"100%",width:sSla.pct+"%",background:sSla.pct>=100?"#ef4444":sSla.pct>=75?"#f59e0b":"#10b981",borderRadius:3}}/></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,fontSize:11}}><div style={{textAlign:"center"}}><div style={{color:"#64748b",fontSize:10}}>Allowed</div><div style={{fontWeight:700}}>{sSla.hoursAllowed}h</div></div><div style={{textAlign:"center"}}><div style={{color:"#64748b",fontSize:10}}>Spent</div><div style={{fontWeight:700}}>{sSla.hoursSpent}h</div></div><div style={{textAlign:"center"}}><div style={{color:"#64748b",fontSize:10}}>Left</div><div style={{fontWeight:700,color:sSla.breached?"#ef4444":"#10b981"}}>{sSla.breached?"0h":sSla.remaining+"h"}</div></div></div>
      </div>}
      {ticket.attachments&&ticket.attachments.length>0&&<div style={{marginTop:12}}><div style={{fontWeight:700,color:"#1e293b",fontSize:12,marginBottom:8}}>📎 Attachments ({ticket.attachments.length})</div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(100px,1fr))",gap:8}}>{ticket.attachments.map(function(a){var isImg=a.type.startsWith("image/");return<div key={a.id} style={{borderRadius:8,overflow:"hidden",border:"1px solid #e2e8f0",cursor:"pointer"}} onClick={function(){var w=window.open();w.document.write(isImg?'<img src="'+a.dataUrl+'" style="max-width:100%;"/>':'<video src="'+a.dataUrl+'" controls style="max-width:100%;"></video>');}}>{isImg?<img src={a.dataUrl} alt={a.name} style={{width:"100%",height:80,objectFit:"cover",display:"block"}}/>:<div style={{height:80,display:"flex",alignItems:"center",justifyContent:"center",background:"#1e1b4b"}}><span style={{fontSize:28}}>▶️</span></div>}</div>;})}</div></div>}
    </div>}

    {tab==="status"&&isTech&&<div>
      <FSelect label="Update Status" value={status} onChange={function(e){setStatus(e.target.value);}} options={OPT_STATUSES}/>
      <FSelect label="Assign To" value={asgn} onChange={function(e){setAsgn(e.target.value);}} options={optTechs(users)}/>
      <FSelect label="Ticket Type" value={typeId} onChange={function(e){setTypeId(e.target.value);}} options={ticketTypes.map(function(t){return mkOpt(t.id,t.name+" — "+t.slaHours+"h SLA");})}/>
      {typeId!==ticket.typeId&&<div style={{fontSize:11,color:"#f59e0b",marginBottom:14}}>⚠️ Changing type will update priority and SLA deadline.</div>}
      <FTextarea label="Note" value={note} onChange={function(e){setNote(e.target.value);}} placeholder="What was done or why?" rows={3}/>
      <Btn onClick={saveStatus} style={{width:"100%"}}>💾 Save Changes</Btn>
    </div>}

    {tab==="email"&&<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <div style={{fontWeight:700,color:"#1e293b"}}>📧 Send Email</div>
        {emailTemplates.length>0&&<select onChange={function(e){if(e.target.value)applyTemplate(e.target.value);e.target.value="";}} style={{padding:"6px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#f8fafc"}}><option value="">Use template…</option>{emailTemplates.map(function(t){return<option key={t.id} value={t.id}>{t.name}</option>;})}</select>}
      </div>
      <FInput label="To" value={msgTo} onChange={function(e){setMsgTo(e.target.value);}} placeholder="email@example.com"/>
      <FInput label="Subject" value={msgSubj} onChange={function(e){setMsgSubj(e.target.value);}}/>
      <FTextarea label="Message" value={msgBody} onChange={function(e){setMsgBody(e.target.value);}} rows={4} placeholder="Type your message…"/>
      <button onClick={sendEmail} disabled={emailSending} style={{background:emailSending?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:8,padding:"10px 18px",fontWeight:600,fontSize:14,cursor:emailSending?"not-allowed":"pointer",width:"100%",marginBottom:16}}>{emailSending?"⏳ Sending…":"📤 Send Email"}</button>
      <div style={{fontWeight:700,color:"#1e293b",marginBottom:10}}>📬 Conversation Trail ({(liveTicket.conversations||[]).length})</div>
      {(liveTicket.conversations||[]).length===0&&<div style={{color:"#94a3b8",fontSize:13}}>No messages yet.</div>}
      {(liveTicket.conversations||[]).map(function(m){var isReply=m.isExternal||m.status==="received";return<div key={m.id} style={{background:isReply?"#f0fdf4":"#f8fafc",border:"1px solid "+(isReply?"#bbf7d0":"#e2e8f0"),borderRadius:10,padding:12,marginBottom:10}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6,flexWrap:"wrap",gap:4}}>
          <div style={{fontWeight:700,fontSize:12,color:isReply?"#166534":"#1e293b"}}>{isReply?"📬 REPLY":"📧"} {isReply?(m.fromName||m.fromEmail):m.fromEmail}</div>
          <div style={{display:"flex",gap:4,alignItems:"center"}}>{m.status==="sent"&&<span style={{fontSize:10,color:"#10b981"}}>✅</span>}{m.status==="failed"&&<span style={{fontSize:10,color:"#ef4444"}}>❌</span>}<span style={{fontSize:10,color:"#94a3b8"}}>{fdt(m.timestamp)}</span></div>
        </div>
        <div style={{fontSize:11,color:"#64748b",marginBottom:4}}>Subj: {m.subject}</div>
        <div style={{fontSize:13,color:"#334155",whiteSpace:"pre-wrap",lineHeight:1.6}}>{m.body}</div>
      </div>;})}
    </div>}

    {tab==="chat"&&<TicketChat ticketId={ticket.id} curUser={curUser} users={users}/>}
    {tab==="history"&&<TicketHistory ticket={ticket} users={users} curUser={curUser}/>}
  </Modal>;
}

// ── Time Tracking (enhanced) ──────────────────────────────────────────────────
function PageTimeTracking(p){
  var tickets=p.tickets;var users=p.users;var ticketTypes=p.ticketTypes;var curUser=p.curUser;var isAdmin=p.isAdmin;var setSelTicket=p.setSelTicket;var isMobile=p.isMobile;
  var[search,setSearch]=useState("");var[filterUser,setFilterUser]=useState("");var[rangeMode,setRangeMode]=useState("all");
  var[view,setView]=useState("list"); // list | day | week | month

  // Compute range dates in PHT
  var now=nowPHT();
  var todayStr=getPHTDateStr(new Date().toISOString());
  var rangeStart=useMemo(function(){
    if(rangeMode==="day")return todayStr;
    if(rangeMode==="week"){
      var d=new Date(now.getTime()-now.getUTCDay()*86400000);
      return d.getUTCFullYear()+"-"+(d.getUTCMonth()+1).toString().padStart(2,"0")+"-"+d.getUTCDate().toString().padStart(2,"0");
    }
    if(rangeMode==="month"){
      return now.getUTCFullYear()+"-"+(now.getUTCMonth()+1).toString().padStart(2,"0")+"-01";
    }
    return null;
  },[rangeMode,todayStr]);

  var scope=useMemo(function(){
    var base=tickets.filter(function(t){return !t.deleted;});
    if(!isAdmin)base=base.filter(function(t){return t.submittedBy===curUser.id||t.assignedTo===curUser.id;});
    else if(filterUser)base=base.filter(function(t){return t.submittedBy===filterUser||t.assignedTo===filterUser;});
    if(rangeStart){
      base=base.filter(function(t){
        var dateStr=getPHTDateStr(t.createdAt);
        return dateStr>=rangeStart;
      });
    }
    return base;
  },[tickets,curUser,isAdmin,filterUser,rangeStart]);

  var filtered=useMemo(function(){
    var q=search.toLowerCase();
    return scope.filter(function(t){return(!q||(t.title.toLowerCase().includes(q)||t.id.includes(q)));});
  },[scope,search]);

  // Totals
  var totalCreateMins=filtered.reduce(function(a,t){return a+(t.timeToCreateMins||0);},0);
  var avgCreateMins=filtered.length?totalCreateMins/filtered.length:0;
  var totalActualHrs=filtered.reduce(function(a,t){return a+calcActualTimeSpentHours(t);},0);

  // Per-day breakdown
  var dayMap={};
  filtered.forEach(function(t){
    var dateStr=getPHTDateStr(t.createdAt);
    if(!dayMap[dateStr])dayMap[dateStr]={date:dateStr,createMins:0,actualHrs:0,count:0};
    dayMap[dateStr].createMins+=(t.timeToCreateMins||0);
    dayMap[dateStr].actualHrs+=calcActualTimeSpentHours(t);
    dayMap[dateStr].count++;
  });
  var dayData=Object.values(dayMap).sort(function(a,b){return a.date.localeCompare(b.date);}).slice(-14);

  // Per-week breakdown
  var weekMap={};
  filtered.forEach(function(t){
    var wk=getPHTWeekKey(t.createdAt);
    if(!weekMap[wk])weekMap[wk]={week:wk,createMins:0,actualHrs:0,count:0};
    weekMap[wk].createMins+=(t.timeToCreateMins||0);
    weekMap[wk].actualHrs+=calcActualTimeSpentHours(t);
    weekMap[wk].count++;
  });
  var weekData=Object.values(weekMap).sort(function(a,b){return a.week.localeCompare(b.week);}).slice(-8);

  // Per-month breakdown
  var monthMap={};
  filtered.forEach(function(t){
    var mo=getPHTMonthKey(t.createdAt);
    if(!monthMap[mo])monthMap[mo]={month:mo,createMins:0,actualHrs:0,count:0};
    monthMap[mo].createMins+=(t.timeToCreateMins||0);
    monthMap[mo].actualHrs+=calcActualTimeSpentHours(t);
    monthMap[mo].count++;
  });
  var monthData=Object.values(monthMap).sort(function(a,b){return a.month.localeCompare(b.month);}).slice(-12);

  function fu(id){return users.find(function(x){return x.id===id;});}
  function ftt(id){return ticketTypes.find(function(x){return x.id===id;});}

  return<div>
    <div style={{fontWeight:800,fontSize:16,color:"#1e293b",marginBottom:14}}>⏱️ Time Tracking <span style={{fontSize:11,color:"#64748b",fontWeight:400}}>(PHT)</span></div>

    {/* Summary stats */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10,marginBottom:16}}>
      <Stat label="Total Form Time" value={fmtMs(totalCreateMins)} icon="✍️" color="#8b5cf6" sub={filtered.length+" tickets"}/>
      <Stat label="Avg Form Time" value={fmtMs(avgCreateMins)} icon="⏱" color="#0ea5e9"/>
      <Stat label="Total IT Hours" value={fmtHrs(totalActualHrs)} icon="🔧" color="#6366f1" sub="actual work"/>
      <Stat label="Avg IT Hours" value={fmtHrs(filtered.length?totalActualHrs/filtered.length:0)} icon="📊" color="#10b981"/>
    </div>

    {/* Filters */}
    <Card style={{marginBottom:14,padding:"12px 14px"}}>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
        <input value={search} onChange={function(e){setSearch(e.target.value);}} placeholder="🔍 Search…" style={{flex:1,minWidth:120,padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
        {isAdmin&&<select value={filterUser} onChange={function(e){setFilterUser(e.target.value);}} style={{padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",boxSizing:"border-box"}}><option value="">All Users</option>{users.filter(function(u){return u.active;}).map(function(u){return<option key={u.id} value={u.id}>{u.name}</option>;})}</select>}
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {["all","day","week","month"].map(function(r){return<button key={r} onClick={function(){setRangeMode(r);}} style={{padding:"5px 12px",borderRadius:8,border:"1px solid "+(rangeMode===r?"#6366f1":"#e2e8f0"),background:rangeMode===r?"#6366f1":"#fff",color:rangeMode===r?"#fff":"#475569",fontSize:11,fontWeight:600,cursor:"pointer"}}>{r==="all"?"All Time":r==="day"?"Today":r==="week"?"This Week":"This Month"}</button>;})}
      </div>
    </Card>

    {/* View toggle */}
    <div style={{display:"flex",gap:6,marginBottom:14,overflowX:"auto"}}>
      {[["list","📋 List"],["day","📅 Daily"],["week","📆 Weekly"],["month","🗓 Monthly"]].map(function(vp){return<button key={vp[0]} onClick={function(){setView(vp[0]);}} style={{padding:"7px 12px",borderRadius:8,border:"none",background:view===vp[0]?"#6366f1":"#f1f5f9",color:view===vp[0]?"#fff":"#475569",fontSize:12,fontWeight:600,cursor:"pointer",flexShrink:0}}>{vp[1]}</button>;})}
    </div>

    {/* Daily view */}
    {view==="day"&&<Card style={{marginBottom:14}}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>📅 Daily IT Hours Spent</div>
      {dayData.length===0&&<div style={{textAlign:"center",padding:24,color:"#94a3b8"}}>No data in range.</div>}
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={dayData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
          <XAxis dataKey="date" tick={{fontSize:9}} tickFormatter={function(v){return v.slice(5);}}/>
          <YAxis tick={{fontSize:9}}/>
          <Tooltip formatter={function(v,n){return n==="actualHrs"?v.toFixed(2)+"h":fmtMs(v);}}/>
          <Legend wrapperStyle={{fontSize:10}}/>
          <Bar dataKey="actualHrs" name="IT Hours" fill="#6366f1" radius={[3,3,0,0]}/>
          <Bar dataKey="count" name="Tickets" fill="#0ea5e9" radius={[3,3,0,0]}/>
        </BarChart>
      </ResponsiveContainer>
      <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:6}}>
        {dayData.map(function(d){return<div key={d.date} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 10px",background:"#f8fafc",borderRadius:8,fontSize:12}}>
          <span style={{fontWeight:600,color:"#475569"}}>{d.date}</span>
          <div style={{display:"flex",gap:12}}>
            <span style={{color:"#6366f1"}}><strong>{d.actualHrs.toFixed(2)}h</strong> IT work</span>
            <span style={{color:"#0ea5e9"}}><strong>{d.count}</strong> tickets</span>
            <span style={{color:"#8b5cf6"}}><strong>{fmtMs(d.createMins)}</strong> form</span>
          </div>
        </div>;})}
      </div>
    </Card>}

    {/* Weekly view */}
    {view==="week"&&<Card style={{marginBottom:14}}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>📆 Weekly IT Hours Spent</div>
      {weekData.length===0&&<div style={{textAlign:"center",padding:24,color:"#94a3b8"}}>No data in range.</div>}
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={weekData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
          <XAxis dataKey="week" tick={{fontSize:8}} tickFormatter={function(v){return "W/"+v.slice(5,10);}}/>
          <YAxis tick={{fontSize:9}}/>
          <Tooltip formatter={function(v,n){return n==="actualHrs"?v.toFixed(2)+"h":fmtMs(v);}}/>
          <Legend wrapperStyle={{fontSize:10}}/>
          <Bar dataKey="actualHrs" name="IT Hours" fill="#6366f1" radius={[3,3,0,0]}/>
          <Bar dataKey="count" name="Tickets" fill="#10b981" radius={[3,3,0,0]}/>
        </BarChart>
      </ResponsiveContainer>
      <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:6}}>
        {weekData.map(function(d){return<div key={d.week} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 10px",background:"#f8fafc",borderRadius:8,fontSize:12}}>
          <span style={{fontWeight:600,color:"#475569"}}>Wk of {d.week.slice(5)}</span>
          <div style={{display:"flex",gap:12}}>
            <span style={{color:"#6366f1"}}><strong>{d.actualHrs.toFixed(2)}h</strong> IT work</span>
            <span style={{color:"#10b981"}}><strong>{d.count}</strong> tickets</span>
          </div>
        </div>;})}
      </div>
    </Card>}

    {/* Monthly view */}
    {view==="month"&&<Card style={{marginBottom:14}}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>🗓 Monthly IT Hours Spent</div>
      {monthData.length===0&&<div style={{textAlign:"center",padding:24,color:"#94a3b8"}}>No data in range.</div>}
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={monthData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
          <XAxis dataKey="month" tick={{fontSize:9}}/>
          <YAxis tick={{fontSize:9}}/>
          <Tooltip formatter={function(v,n){return n==="actualHrs"?v.toFixed(2)+"h":fmtMs(v);}}/>
          <Legend wrapperStyle={{fontSize:10}}/>
          <Bar dataKey="actualHrs" name="IT Hours" fill="#6366f1" radius={[3,3,0,0]}/>
          <Bar dataKey="count" name="Tickets" fill="#f59e0b" radius={[3,3,0,0]}/>
        </BarChart>
      </ResponsiveContainer>
      <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:6}}>
        {monthData.map(function(d){return<div key={d.month} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 10px",background:"#f8fafc",borderRadius:8,fontSize:12}}>
          <span style={{fontWeight:600,color:"#475569"}}>{d.month}</span>
          <div style={{display:"flex",gap:12}}>
            <span style={{color:"#6366f1"}}><strong>{d.actualHrs.toFixed(2)}h</strong> IT work</span>
            <span style={{color:"#f59e0b"}}><strong>{d.count}</strong> tickets</span>
          </div>
        </div>;})}
      </div>
    </Card>}

    {/* List view */}
    {view==="list"&&<div style={{display:"flex",flexDirection:"column",gap:8}}>
      {filtered.length===0&&<Card><div style={{textAlign:"center",padding:32,color:"#94a3b8"}}>No tickets found.</div></Card>}
      {filtered.map(function(t){
        var sub=fu(t.submittedBy);var tt2=ftt(t.typeId);var sm=STATUS_META[t.status]||STATUS_META.Open;
        var cm=t.timeToCreateMins||0;var cc=cm<=5?"#10b981":cm<=15?"#f59e0b":"#ef4444";
        var actualH=calcActualTimeSpentHours(t);
        return<div key={t.id} style={{background:"#fff",borderRadius:10,border:"1px solid #e2e8f0",padding:14,cursor:"pointer"}} onClick={function(){setSelTicket(t.id);}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
            <div style={{flex:1,overflow:"hidden"}}><div style={{fontWeight:600,color:"#1e293b",fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div><div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>{fdt(t.submittedAt||t.createdAt)} (PHT)</div></div>
            <Badge label={t.status} color={sm.color} bg={sm.bg}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>{sub&&<Avatar name={sub.name} id={sub.id} size={18}/>}<span style={{fontSize:11,color:"#64748b"}}>{sub?sub.name:"—"}</span></div>
            <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11}}>
                <span style={{color:"#64748b"}}>Form:</span>
                <div style={{width:30,height:5,background:"#e2e8f0",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:Math.min(100,cm/30*100)+"%",background:cc,borderRadius:3}}/></div>
                <span style={{fontWeight:700,color:cc}}>{fmtMs(cm)}</span>
              </div>
              <div style={{fontSize:11,display:"flex",alignItems:"center",gap:4}}>
                <span style={{color:"#64748b"}}>IT Time:</span>
                <span style={{fontWeight:700,color:"#6366f1"}}>{actualH.toFixed(2)}h</span>
              </div>
            </div>
          </div>
        </div>;
      })}
    </div>}
  </div>;
}

// ── Reports (enhanced with client/location filter + IT hours) ─────────────────
function PageReports(p){
  var tickets=p.tickets;var users=p.users;var ticketTypes=p.ticketTypes;var clients=p.clients||[];var statusSla=p.statusSla||DEFAULT_STATUS_SLA;var schedules=p.schedules||{};
  var[view,setView]=useState("summary");var[range,setRange]=useState("month");var[aiInsight,setAiInsight]=useState("");var[aiLoading,setAiLoading]=useState(false);
  var[fClient,setFClient]=useState("");var[fLocation,setFLocation]=useState("");

  var rangeStart=useMemo(function(){var now=new Date();if(range==="day")return new Date(now.getFullYear(),now.getMonth(),now.getDate()).toISOString();if(range==="week")return new Date(now.getTime()-7*86400000).toISOString();if(range==="month")return new Date(now.getTime()-30*86400000).toISOString();if(range==="year")return new Date(now.getTime()-365*86400000).toISOString();return new Date(0).toISOString();},[range]);
  var rangeLabel={day:"Today",week:"7 Days",month:"30 Days",year:"12 Mo",all:"All"};
  var techs=users.filter(function(u){return IT_ROLES.includes(u.role);});

  // Client's locations for location filter
  var selClientObj=clients.find(function(c){return c.id===fClient;});
  var availLocations=selClientObj?selClientObj.locations:[];

  // Base filtered tickets
  var active=useMemo(function(){
    return tickets.filter(function(t){
      if(t.deleted)return false;
      if(new Date(t.createdAt)<new Date(rangeStart))return false;
      if(fClient&&t.clientId!==fClient)return false;
      if(fLocation&&t.locationId!==fLocation)return false;
      return true;
    });
  },[tickets,rangeStart,fClient,fLocation]);

  var allActive=useMemo(function(){return tickets.filter(function(t){return !t.deleted;});},[tickets]);
  var byType=ticketTypes.map(function(tt,i){var mine=active.filter(function(t){return t.typeId===tt.id;});var res=calcClosed(mine);return{id:tt.id,name:tt.name,color:tt.color,total:mine.length,open:mine.filter(function(t){return t.status==="Open";}).length,resolved:res.length,breached:mine.filter(function(t){return t.slaBreached;}).length,slaRate:calcSlaRate(mine),avgClose:calcAvgClose(res),fill:PAL[i%PAL.length]};}).filter(function(x){return x.total>0;});
  var byUser=techs.map(function(t){var mine=active.filter(function(tk){return tk.assignedTo===t.id;});var res=calcClosed(mine);return{id:t.id,name:t.name,role:t.role,total:mine.length,open:mine.filter(function(t){return t.status==="Open";}).length,resolved:res.length,breached:mine.filter(function(t){return t.slaBreached;}).length,slaRate:calcSlaRate(mine),avgClose:calcAvgClose(res),actualHrs:mine.reduce(function(a,tk){return a+calcActualTimeSpentHours(tk);},0)};});
  var totalBreached=active.filter(function(t){return t.slaBreached;}).length;
  var totalSlaRate=calcSlaRate(active);var avgCloseAll=calcAvgClose(calcClosed(active));
  var statusPieData=ALL_STATUSES.map(function(s){return{name:s,value:active.filter(function(t){return t.status===s;}).length,color:STATUS_META[s].color};});
  var totalActualHrs=active.reduce(function(a,t){return a+calcActualTimeSpentHours(t);},0);

  // IT hours per day
  var dayHrsMap={};
  active.forEach(function(t){
    var dateStr=getPHTDateStr(t.createdAt);
    if(!dayHrsMap[dateStr])dayHrsMap[dateStr]={date:dateStr,hrs:0,count:0};
    dayHrsMap[dateStr].hrs+=calcActualTimeSpentHours(t);
    dayHrsMap[dateStr].count++;
  });
  var dayHrsData=Object.values(dayHrsMap).sort(function(a,b){return a.date.localeCompare(b.date);}).slice(-14);

  // IT hours per week
  var weekHrsMap={};
  active.forEach(function(t){
    var wk=getPHTWeekKey(t.createdAt);
    if(!weekHrsMap[wk])weekHrsMap[wk]={week:wk,hrs:0,count:0};
    weekHrsMap[wk].hrs+=calcActualTimeSpentHours(t);
    weekHrsMap[wk].count++;
  });
  var weekHrsData=Object.values(weekHrsMap).sort(function(a,b){return a.week.localeCompare(b.week);}).slice(-8);

  // IT hours per month
  var monthHrsMap={};
  active.forEach(function(t){
    var mo=getPHTMonthKey(t.createdAt);
    if(!monthHrsMap[mo])monthHrsMap[mo]={month:mo,hrs:0,count:0};
    monthHrsMap[mo].hrs+=calcActualTimeSpentHours(t);
    monthHrsMap[mo].count++;
  });
  var monthHrsData=Object.values(monthHrsMap).sort(function(a,b){return a.month.localeCompare(b.month);}).slice(-12);

  // Client issues breakdown
  var clientBreakdown=useMemo(function(){
    return clients.map(function(cl){
      var mine=active.filter(function(t){return t.clientId===cl.id;});
      var locBreakdown=(cl.locations||[]).map(function(loc){
        var lmine=mine.filter(function(t){return t.locationId===loc.id;});
        var typeCount={};
        lmine.forEach(function(t){
          var tt2=ticketTypes.find(function(x){return x.id===t.typeId;});
          var nm=tt2?tt2.name:"Unknown";
          typeCount[nm]=(typeCount[nm]||0)+1;
        });
        return{id:loc.id,name:loc.name,address:loc.address,count:lmine.length,typeCount:typeCount,actualHrs:lmine.reduce(function(a,t){return a+calcActualTimeSpentHours(t);},0)};
      }).filter(function(l){return l.count>0;}).sort(function(a,b){return b.count-a.count;});
      var typeCount={};
      mine.forEach(function(t){
        var tt2=ticketTypes.find(function(x){return x.id===t.typeId;});
        var nm=tt2?tt2.name:"Unknown";
        typeCount[nm]=(typeCount[nm]||0)+1;
      });
      return{id:cl.id,name:cl.name,count:mine.length,typeCount:typeCount,locBreakdown:locBreakdown,actualHrs:mine.reduce(function(a,t){return a+calcActualTimeSpentHours(t);},0)};
    }).filter(function(x){return x.count>0;}).sort(function(a,b){return b.count-a.count;});
  },[clients,active,ticketTypes]);

  var top3=useMemo(function(){return ticketTypes.map(function(tt){return{name:tt.name,color:tt.color,total:allActive.filter(function(t){return t.typeId===tt.id;}).length};}).sort(function(a,b){return b.total-a.total;}).slice(0,3);},[allActive,ticketTypes]);
  var weeklyTrend=useMemo(function(){return Array.from({length:8},function(_,i){var wEnd=new Date(Date.now()-(7-i)*7*86400000);var wStart=new Date(wEnd.getTime()-7*86400000);var wT=allActive.filter(function(t){var d=new Date(t.createdAt);return d>=wStart&&d<wEnd;});return{label:"W"+(i+1),total:wT.length,closed:calcClosed(wT).length,breached:wT.filter(function(t){return t.slaBreached;}).length};});},[allActive]);

  async function generateInsight(){setAiLoading(true);setAiInsight("");var summary={totalTickets:allActive.length,slaRate:calcSlaRate(allActive),breached:allActive.filter(function(t){return t.slaBreached;}).length,topTypes:top3.map(function(t){return t.name+" ("+t.total+")";}).join(", "),openCount:allActive.filter(function(t){return t.status==="Open";}).length,totalITHours:totalActualHrs.toFixed(1),topClient:clientBreakdown[0]?clientBreakdown[0].name+" ("+clientBreakdown[0].count+" tickets)":"none"};try{var res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:800,messages:[{role:"user",content:"IT helpdesk analyst. Analyze and give: top issues, SLA performance, 3 recommendations. Be concise, use bullets.\n\nData:\n"+JSON.stringify(summary,null,2)}]})});var data=await res.json();setAiInsight(data.content&&data.content[0]?data.content[0].text:"Unable to generate.");}catch(e){setAiInsight("Error: "+e.message);}setAiLoading(false);}

  var VIEWS=[{id:"summary",label:"📊 Summary"},{id:"trend",label:"📈 Trend"},{id:"it_hours",label:"🔧 IT Hours"},{id:"clients",label:"🤝 Clients"},{id:"by_type",label:"🏷️ By Type"},{id:"per_user",label:"👤 Per User"}];
  return<div>
    {/* View tabs */}
    <div style={{display:"flex",gap:6,marginBottom:12,overflowX:"auto",paddingBottom:4}}>
      {VIEWS.map(function(v){return<button key={v.id} onClick={function(){setView(v.id);}} style={{padding:"7px 12px",borderRadius:8,border:"none",background:view===v.id?"#6366f1":"#f1f5f9",color:view===v.id?"#fff":"#475569",fontSize:12,fontWeight:600,cursor:"pointer",flexShrink:0}}>{v.label}</button>;})}
    </div>

    {/* Range filter */}
    <div style={{display:"flex",gap:6,marginBottom:10,overflowX:"auto",paddingBottom:2}}>
      {["day","week","month","year","all"].map(function(r){return<button key={r} onClick={function(){setRange(r);}} style={{padding:"5px 10px",borderRadius:8,border:"1px solid "+(range===r?"#6366f1":"#e2e8f0"),background:range===r?"#6366f1":"#fff",color:range===r?"#fff":"#475569",fontSize:11,fontWeight:600,cursor:"pointer",flexShrink:0}}>{rangeLabel[r]}</button>;})}
    </div>

    {/* Client / Location filter */}
    <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
      <select value={fClient} onChange={function(e){setFClient(e.target.value);setFLocation("");}} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none",flex:1,minWidth:120}}>
        <option value="">All Clients</option>
        {clients.map(function(c){return<option key={c.id} value={c.id}>{c.name}</option>;})}
      </select>
      <select value={fLocation} onChange={function(e){setFLocation(e.target.value);}} disabled={!fClient} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none",flex:1,minWidth:120,background:fClient?"#f8fafc":"#f1f5f9"}}>
        <option value="">All Locations</option>
        {availLocations.map(function(l){return<option key={l.id} value={l.id}>{l.name}</option>;})}
      </select>
    </div>

    <div style={{background:"#eef2ff",border:"1px solid #c7d2fe",borderRadius:8,padding:"7px 12px",marginBottom:14,fontSize:12,color:"#4338ca",fontWeight:600}}>
      {active.length} tickets {fClient?"· Client: "+clients.find(function(c){return c.id===fClient;})?.name:""}{fLocation?"· "+availLocations.find(function(l){return l.id===fLocation;})?.name:""}
    </div>

    {view==="summary"&&<div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        <Stat label="SLA Rate" value={totalSlaRate+"%"} icon="🎯" color={slaColor(totalSlaRate)} sub={totalBreached+" breached"}/>
        <Stat label="Avg Close" value={avgCloseAll+"h"} icon="⏱" color="#0ea5e9"/>
        <Stat label="Total" value={active.length} icon="🎫" color="#6366f1"/>
        <Stat label="IT Hours" value={fmtHrs(totalActualHrs)} icon="🔧" color="#10b981"/>
      </div>
      <Card><div style={{fontWeight:700,marginBottom:12,fontSize:13}}>Tickets by Status</div><ResponsiveContainer width="100%" height={180}><PieChart><Pie data={statusPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={pieLabel} fontSize={9}>{statusPieData.map(function(e,i){return<Cell key={i} fill={e.color}/>;})}</Pie><Tooltip/></PieChart></ResponsiveContainer></Card>
    </div>}

    {view==="trend"&&<div>
      <Card style={{marginBottom:14}}><div style={{fontWeight:700,marginBottom:12,fontSize:13}}>Weekly Volume</div><ResponsiveContainer width="100%" height={200}><AreaChart data={weeklyTrend}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="label" tick={{fontSize:9}}/><YAxis tick={{fontSize:9}}/><Tooltip/><Legend wrapperStyle={{fontSize:10}}/><Area type="monotone" dataKey="total" stroke="#6366f1" fill="#eef2ff" name="Total" strokeWidth={2}/><Area type="monotone" dataKey="closed" stroke="#10b981" fill="#d1fae5" name="Closed" strokeWidth={2}/></AreaChart></ResponsiveContainer></Card>
      <Card style={{borderLeft:"4px solid #6366f1"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><div style={{fontWeight:700,fontSize:13,color:"#1e293b"}}>🤖 AI Insights</div><button onClick={generateInsight} disabled={aiLoading} style={{padding:"8px 14px",background:aiLoading?"#a5b4fc":"linear-gradient(135deg,#6366f1,#4338ca)",color:"#fff",border:"none",borderRadius:8,fontWeight:700,fontSize:12,cursor:aiLoading?"not-allowed":"pointer"}}>{aiLoading?"⏳ Analyzing…":"✨ Generate"}</button></div>{!aiInsight&&!aiLoading&&<div style={{textAlign:"center",padding:20,color:"#94a3b8",fontSize:13}}>Ready to analyze your data</div>}{aiInsight&&<div style={{background:"#f8fafc",borderRadius:8,padding:14,fontSize:12,color:"#334155",lineHeight:1.9,whiteSpace:"pre-wrap"}}>{aiInsight}</div>}</Card>
    </div>}

    {view==="it_hours"&&<div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>
        <Stat label="Daily Avg" value={fmtHrs(dayHrsData.length?dayHrsData.reduce(function(a,d){return a+d.hrs;},0)/dayHrsData.length:0)} icon="📅" color="#6366f1"/>
        <Stat label="Weekly Total" value={fmtHrs(weekHrsData.length?weekHrsData[weekHrsData.length-1]?.hrs||0:0)} icon="📆" color="#0ea5e9"/>
        <Stat label="Monthly Total" value={fmtHrs(monthHrsData.length?monthHrsData[monthHrsData.length-1]?.hrs||0:0)} icon="🗓" color="#10b981"/>
      </div>
      <Card style={{marginBottom:14}}>
        <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>📅 IT Hours Per Day (PHT)</div>
        {dayHrsData.length===0&&<div style={{textAlign:"center",padding:20,color:"#94a3b8"}}>No data.</div>}
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={dayHrsData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey="date" tick={{fontSize:9}} tickFormatter={function(v){return v.slice(5);}}/>
            <YAxis tick={{fontSize:9}} unit="h"/>
            <Tooltip formatter={function(v){return v.toFixed(2)+"h";}}/>
            <Bar dataKey="hrs" name="IT Hours" fill="#6366f1" radius={[3,3,0,0]}/>
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <Card style={{marginBottom:14}}>
        <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>📆 IT Hours Per Week (PHT)</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={weekHrsData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey="week" tick={{fontSize:8}} tickFormatter={function(v){return v.slice(5,10);}}/>
            <YAxis tick={{fontSize:9}} unit="h"/>
            <Tooltip formatter={function(v){return v.toFixed(2)+"h";}}/>
            <Bar dataKey="hrs" name="IT Hours" fill="#0ea5e9" radius={[3,3,0,0]}/>
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <Card>
        <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>🗓 IT Hours Per Month (PHT)</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={monthHrsData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey="month" tick={{fontSize:9}}/>
            <YAxis tick={{fontSize:9}} unit="h"/>
            <Tooltip formatter={function(v){return v.toFixed(2)+"h";}}/>
            <Bar dataKey="hrs" name="IT Hours" fill="#10b981" radius={[3,3,0,0]}/>
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>}

    {view==="clients"&&<div>
      {clientBreakdown.length===0&&<Card><div style={{textAlign:"center",padding:32,color:"#94a3b8"}}>No client data in this range.</div></Card>}
      {clientBreakdown.map(function(cl){return<Card key={cl.id} style={{marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{display:"flex",gap:10,alignItems:"center"}}><div style={{width:36,height:36,borderRadius:8,background:avCol(cl.id),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:16}}>{cl.name[0]}</div><div><div style={{fontWeight:700,fontSize:14}}>{cl.name}</div><div style={{fontSize:11,color:"#64748b"}}>{cl.count} tickets · {cl.actualHrs.toFixed(2)}h IT time</div></div></div>
          <span style={{fontWeight:800,fontSize:22,color:"#6366f1"}}>{cl.count}</span>
        </div>
        {/* Issue types for this client */}
        {Object.keys(cl.typeCount).length>0&&<div style={{marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:700,color:"#475569",marginBottom:6}}>Issues by Type</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {Object.entries(cl.typeCount).sort(function(a,b){return b[1]-a[1];}).map(function(entry){return<Badge key={entry[0]} label={entry[0]+": "+entry[1]} color="#6366f1"/>;})}
          </div>
        </div>}
        {/* Location breakdown */}
        {cl.locBreakdown.length>0&&<div>
          <div style={{fontSize:11,fontWeight:700,color:"#475569",marginBottom:8}}>📍 Locations</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {cl.locBreakdown.map(function(loc){return<div key={loc.id} style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"10px 12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div><div style={{fontWeight:700,fontSize:12}}>📍 {loc.name}</div><div style={{fontSize:10,color:"#64748b"}}>{loc.address}</div></div>
                <div style={{textAlign:"right"}}><div style={{fontWeight:700,color:"#6366f1"}}>{loc.count} tickets</div><div style={{fontSize:10,color:"#94a3b8"}}>{loc.actualHrs.toFixed(2)}h</div></div>
              </div>
              {Object.keys(loc.typeCount).length>0&&<div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                {Object.entries(loc.typeCount).sort(function(a,b){return b[1]-a[1];}).map(function(entry){return<span key={entry[0]} style={{background:"#eef2ff",color:"#4338ca",borderRadius:4,padding:"2px 6px",fontSize:10,fontWeight:600}}>{entry[0]}: {entry[1]}</span>;})}
              </div>}
            </div>;})}
          </div>
        </div>}
      </Card>;})}
    </div>}

    {view==="by_type"&&<div style={{display:"flex",flexDirection:"column",gap:10}}>
      {byType.length===0&&<Card><div style={{textAlign:"center",padding:32,color:"#94a3b8"}}>No data yet.</div></Card>}
      {byType.map(function(t){return<Card key={t.id}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><Badge label={t.name} color={t.color}/><span style={{fontWeight:700,color:"#6366f1",fontSize:16}}>{t.total}</span></div><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><span style={{fontSize:11,color:"#64748b"}}>Open: <strong>{t.open}</strong></span><span style={{fontSize:11,color:"#64748b"}}>Closed: <strong>{t.resolved}</strong></span><span style={{fontSize:11,color:"#64748b"}}>SLA: <strong style={{color:slaColor(t.slaRate)}}>{t.slaRate}%</strong></span><span style={{fontSize:11,color:"#64748b"}}>Avg: <strong>{t.avgClose}h</strong></span></div></Card>;})}
    </div>}

    {view==="per_user"&&<div style={{display:"flex",flexDirection:"column",gap:10}}>
      {byUser.length===0&&<Card><div style={{textAlign:"center",padding:32,color:"#94a3b8"}}>No data yet.</div></Card>}
      {byUser.map(function(t){return<Card key={t.id}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}><Avatar name={t.name} id={t.id} size={32}/><div><div style={{fontWeight:600,fontSize:13}}>{t.name}</div><div style={{fontSize:11,color:"#94a3b8"}}>{ROLE_META[t.role]?.label||t.role}</div></div><span style={{marginLeft:"auto",fontWeight:700,color:"#6366f1",fontSize:18}}>{t.total}</span></div><div style={{display:"flex",gap:10,flexWrap:"wrap"}}><span style={{fontSize:11,color:"#64748b"}}>Open: <strong>{t.open}</strong></span><span style={{fontSize:11,color:"#64748b"}}>Closed: <strong>{t.resolved}</strong></span><span style={{fontSize:11,color:"#64748b"}}>SLA: <strong style={{color:slaColor(t.slaRate)}}>{t.slaRate}%</strong></span><span style={{fontSize:11,color:"#64748b"}}>IT Hrs: <strong style={{color:"#6366f1"}}>{t.actualHrs.toFixed(2)}h</strong></span></div></Card>;})}
    </div>}
  </div>;
}

// ── Users ─────────────────────────────────────────────────────────────────────
function PageUsers(p){
  var users=p.users;var companies=p.companies;var setUsers=p.setUsers;var curUser=p.curUser;var addLog=p.addLog;var showToast=p.showToast;var schedules=p.schedules||{};var setSchedules=p.setSchedules;var isMobile=p.isMobile;
  var dbSaveUser=p.dbSaveUser;var dbDeleteUser=p.dbDeleteUser;var dbSetPassword=p.dbSetPassword;var dbSaveSchedule=p.dbSaveSchedule;
  var[modal,setModal]=useState(null);var[form,setForm]=useState({});var[emailStatus,setEmailStatus]=useState(null);
  var[pwModal,setPwModal]=useState(null);var[newPw,setNewPw]=useState("");var[pwErr,setPwErr]=useState("");
  var[roles,setRolesState]=useState(function(){return loadRoles();});
  var[rolesModal,setRolesModal]=useState(false);
  var[roleForm,setRoleForm]=useState({key:"",label:"",color:"#6366f1"});var[roleEdit,setRoleEdit]=useState(null);
  function fld(k,v){setForm(function(prev){return Object.assign({},prev,{[k]:v});});}
  function syncRoles(next){saveRoles(next);setRolesState(next);Object.keys(ROLE_META).forEach(function(k){delete ROLE_META[k];});Object.assign(ROLE_META,next);}
  function addRole(){if(!roleForm.key.trim()||!roleForm.label.trim()){showToast("Key and label required","error");return;}var key=roleForm.key.trim().toLowerCase().replace(/\s+/g,"_");if(roles[key]){showToast("Role key already exists","error");return;}var next=Object.assign({},roles);next[key]={label:roleForm.label.trim(),color:roleForm.color,system:false};syncRoles(next);showToast("Role added!");setRoleForm({key:"",label:"",color:"#6366f1"});}
  function saveRoleEdit(){if(!roleForm.label.trim()){showToast("Label required","error");return;}var next=Object.assign({},roles);next[roleEdit]=Object.assign({},next[roleEdit],{label:roleForm.label.trim(),color:roleForm.color});syncRoles(next);showToast("Role updated!");setRoleEdit(null);setRoleForm({key:"",label:"",color:"#6366f1"});}
  function deleteRole(key){if(roles[key]?.system){showToast("Cannot delete system roles","error");return;}if(users.some(function(u){return u.role===key;})){showToast("Cannot delete — in use","error");return;}var next=Object.assign({},roles);delete next[key];syncRoles(next);showToast("Role deleted!");}
  async function resetPassword(){if(!newPw||newPw.length<6){setPwErr("Minimum 6 characters");return;}await dbSetPassword(pwModal.id,newPw);addLog("PASSWORD_RESET",pwModal.id,"Password reset for "+pwModal.name);showToast("✅ Password reset!");setPwModal(null);setNewPw("");setPwErr("");}
  async function approveUser(u){var updated=Object.assign({},u,{active:true});await dbSaveUser(updated);setUsers(function(prev){return prev.map(function(x){return x.id===u.id?updated:x;});});addLog("USER_APPROVED",u.id,u.name+" approved");showToast("✅ Account approved!");}
  function handleScheduleChange(userId,sch){setSchedules(function(prev){var n=Object.assign({},prev);if(sch===null){delete n[userId];}else{n[userId]=sch;}return n;});dbSaveSchedule(userId,sch);}
  var allRoleOpts=Object.keys(roles).map(function(k){return mkOpt(k,roles[k].label);});
  var pendingUsers=users.filter(function(u){return !u.active;});
  var inp={width:"100%",padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:14,outline:"none",background:"#f8fafc",boxSizing:"border-box"};
  async function save(){
    if(!form.name||!form.email){showToast("Name and email required","error");return;}
    if(modal==="new"){var nu=Object.assign({},form,{id:uid(),createdAt:new Date().toISOString(),lastLogin:null});await dbSaveUser(nu);await dbSetPassword(nu.id,"password123");setUsers(function(prev){return prev.concat([nu]);});addLog("USER_CREATED",nu.id,"New user "+nu.name+" created");showToast("User created");setEmailStatus("sending");var emailBody=["Hi "+nu.name+",","","An account has been created for you on the Hoptix IT Helpdesk portal.","","📧 Email: "+nu.email,"🔑 Temporary Password: password123","","⚠️ Please sign in and change your password immediately.","","— The Hoptix IT Team"].join("\n");var result=await callSendEmail({to:nu.email,subject:"🎉 Your Hoptix IT Helpdesk account is ready",body:emailBody});setEmailStatus(result.success?"sent":"failed");}
    else{var old=users.find(function(u){return u.id===form.id;});await dbSaveUser(form);setUsers(function(prev){return prev.map(function(u){return u.id===form.id?Object.assign({},form):u;});});if(old&&old.role!==form.role)addLog("USER_ROLE_CHANGE",form.id,"Role changed");showToast("User updated");}
    setModal(null);
  }
  return<div>
    {pendingUsers.length>0&&<div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:12,padding:14,marginBottom:16}}>
      <div style={{fontWeight:700,color:"#92400e",marginBottom:10,fontSize:13}}>⏳ {pendingUsers.length} Account{pendingUsers.length>1?"s":""} Awaiting Approval</div>
      {pendingUsers.map(function(u){return<div key={u.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#fff",padding:"10px 12px",borderRadius:8,border:"1px solid #fde68a",marginBottom:6,gap:8}}>
        <div style={{display:"flex",gap:8,alignItems:"center",flex:1,overflow:"hidden"}}><Avatar name={u.name} id={u.id} size={30}/><div style={{overflow:"hidden"}}><div style={{fontWeight:600,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.name}</div><div style={{fontSize:11,color:"#64748b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div></div></div>
        <div style={{display:"flex",gap:6,flexShrink:0}}><Btn size="sm" variant="success" onClick={function(){approveUser(u);}}>✅</Btn><Btn size="sm" variant="danger" onClick={async function(){await dbDeleteUser(u.id);setUsers(function(prev){return prev.filter(function(x){return x.id!==u.id;});});showToast("Rejected");}}>✕</Btn></div>
      </div>;})}
    </div>}
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:14,gap:8,flexWrap:"wrap",alignItems:"center"}}>
      <div style={{fontWeight:700,fontSize:14}}>Users ({users.length})</div>
      <div style={{display:"flex",gap:8}}><Btn variant="ghost" size="sm" onClick={function(){setRolesModal(true);}}>🏷️ Roles</Btn><Btn onClick={function(){setEmailStatus(null);setForm({name:"",email:"",role:"end_user",companyId:companies[0]?.id||"",phone:"",dept:"",active:true});setModal("new");}}>➕ Add</Btn></div>
    </div>
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      {users.map(function(u){var co=companies.find(function(c){return c.id===u.companyId;});var rm=roles[u.role]||{label:u.role,color:"#6366f1"};
        return<Card key={u.id} style={{padding:14}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <Avatar name={u.name} id={u.id} size={36}/>
            <div style={{flex:1,overflow:"hidden"}}>
              <div style={{fontWeight:700,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.name}</div>
              <div style={{fontSize:11,color:"#64748b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div>
            </div>
            <Badge label={u.active?"Active":"Pending"} color={u.active?"#10b981":"#f59e0b"}/>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
            <Badge label={rm.label} color={rm.color}/>
            {co&&<span style={{fontSize:11,color:"#64748b"}}>🏢 {co.name}</span>}
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            <Btn size="sm" variant="ghost" onClick={function(){setEmailStatus(null);setForm(Object.assign({},u));setModal("edit");}}>✏️ Edit</Btn>
            <Btn size="sm" variant="ghost" onClick={function(){setPwModal(u);setNewPw("");setPwErr("");}}>🔑 Password</Btn>
            <Btn size="sm" variant={u.active?"warning":"success"} onClick={async function(){var updated=Object.assign({},u,{active:!u.active});await dbSaveUser(updated);setUsers(function(prev){return prev.map(function(x){return x.id===u.id?updated:x;});});showToast(u.active?"Deactivated":"Activated");}}>{u.active?"Disable":"Enable"}</Btn>
            {u.id!==curUser.id&&<Btn size="sm" variant="danger" onClick={async function(){await dbDeleteUser(u.id);setUsers(function(prev){return prev.filter(function(x){return x.id!==u.id;});});addLog("USER_DELETED",u.id,"User "+u.name+" deleted");showToast("Deleted");}}>🗑</Btn>}
          </div>
        </Card>;
      })}
    </div>
    {modal&&<Modal title={modal==="new"?"Add User":"Edit User"} onClose={function(){setModal(null);}}>
      <FInput label="Full Name *" value={form.name||""} onChange={function(e){fld("name",e.target.value);}}/><FInput label="Email *" value={form.email||""} onChange={function(e){fld("email",e.target.value);}} type="email"/><FInput label="Phone" value={form.phone||""} onChange={function(e){fld("phone",e.target.value);}}/><FInput label="Department" value={form.dept||""} onChange={function(e){fld("dept",e.target.value);}}/><FSelect label="Role" value={form.role||"end_user"} onChange={function(e){fld("role",e.target.value);}} options={allRoleOpts}/><FSelect label="Company" value={form.companyId||""} onChange={function(e){fld("companyId",e.target.value);}} options={optCompanies(companies)}/>
      {IT_ROLES.includes(form.role)&&<ScheduleEditor userId={form.id||"__new__"} schedules={schedules} onChange={handleScheduleChange}/>}
      {modal==="new"&&<div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#0369a1"}}>📧 A welcome email will be sent upon creation.</div>}
      {emailStatus==="sending"&&<div style={{background:"#fef3c7",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#92400e"}}>⏳ Sending welcome email…</div>}
      {emailStatus==="sent"&&<div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#166534"}}>✅ Welcome email sent!</div>}
      {emailStatus==="failed"&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#dc2626"}}>⚠️ Email failed. Account still created.</div>}
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setModal(null);}}>Cancel</Btn><Btn onClick={save}>{modal==="new"?"Create & Email":"Save"}</Btn></div>
    </Modal>}
    {pwModal&&<Modal title={"🔑 Reset — "+pwModal.name} onClose={function(){setPwModal(null);setNewPw("");setPwErr("");}}>
      <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:13,color:"#92400e"}}>Resetting password for <strong>{pwModal.name}</strong></div>
      <div style={{marginBottom:8}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>New Password (min 6 chars)</label><input type="password" value={newPw} onChange={function(e){setNewPw(e.target.value);setPwErr("");}} placeholder="••••••••" style={inp}/></div>
      {pwErr&&<div style={{fontSize:12,color:"#dc2626",marginBottom:10}}>⚠️ {pwErr}</div>}
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}><Btn variant="ghost" onClick={function(){setPwModal(null);}}>Cancel</Btn><Btn variant="danger" onClick={resetPassword}>🔑 Reset</Btn></div>
    </Modal>}
    {rolesModal&&<Modal title="🏷️ Manage Roles" onClose={function(){setRolesModal(false);setRoleEdit(null);setRoleForm({key:"",label:"",color:"#6366f1"});}}>
      <div style={{marginBottom:16}}>{Object.keys(roles).map(function(key){var r=roles[key];var isEditing=roleEdit===key;return<div key={key} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:"#f8fafc",borderRadius:8,marginBottom:6,border:"1px solid #e2e8f0"}}>
        {isEditing?<><input value={roleForm.label} onChange={function(e){setRoleForm(function(prev){return Object.assign({},prev,{label:e.target.value});});}} style={{flex:1,padding:"6px 8px",border:"1px solid #e2e8f0",borderRadius:6,fontSize:13,outline:"none"}}/><input type="color" value={roleForm.color} onChange={function(e){setRoleForm(function(prev){return Object.assign({},prev,{color:e.target.value});});}} style={{width:32,height:30,border:"none",borderRadius:4,cursor:"pointer",padding:0}}/><Btn size="sm" variant="success" onClick={saveRoleEdit}>✓</Btn><Btn size="sm" variant="ghost" onClick={function(){setRoleEdit(null);}}>✕</Btn></>:<><div style={{width:10,height:10,borderRadius:"50%",background:r.color,flexShrink:0}}/><span style={{flex:1,fontSize:13,fontWeight:600}}>{r.label}</span><span style={{fontSize:10,color:"#94a3b8",background:"#e2e8f0",borderRadius:4,padding:"2px 6px"}}>{key}</span>{r.system&&<span style={{fontSize:10,color:"#6366f1",fontWeight:600}}>sys</span>}<Btn size="sm" variant="ghost" onClick={function(){setRoleEdit(key);setRoleForm({key:key,label:r.label,color:r.color});}}>✏️</Btn>{!r.system&&<Btn size="sm" variant="danger" onClick={function(){deleteRole(key);}}>🗑</Btn>}</>}
      </div>;})}
      </div>
      <div style={{borderTop:"1px solid #e2e8f0",paddingTop:14}}>
        <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>➕ Add Role</div>
        <FInput label="Key" value={roleForm.key} onChange={function(e){setRoleForm(function(prev){return Object.assign({},prev,{key:e.target.value});});}} placeholder="e.g. supervisor"/>
        <FInput label="Label" value={roleForm.label} onChange={function(e){setRoleForm(function(prev){return Object.assign({},prev,{label:e.target.value});});}} placeholder="Supervisor"/>
        <Btn onClick={addRole}>➕ Add Role</Btn>
      </div>
    </Modal>}
  </div>;
}

// ── Companies ─────────────────────────────────────────────────────────────────
function PageCompanies(p){
  var companies=p.companies;var users=p.users;var setCompanies=p.setCompanies;var addLog=p.addLog;var showToast=p.showToast;var dbSaveCompany=p.dbSaveCompany;var dbDeleteCompany=p.dbDeleteCompany;
  var[modal,setModal]=useState(null);var[form,setForm]=useState({});
  function fld(k,v){setForm(function(prev){return Object.assign({},prev,{[k]:v});});}
  async function save(){if(!form.name){showToast("Name required","error");return;}if(modal==="new"){var nc=Object.assign({},form,{id:uid(),createdAt:new Date().toISOString()});await dbSaveCompany(nc);setCompanies(function(prev){return prev.concat([nc]);});addLog("COMPANY_CREATED",nc.id,'"'+nc.name+'" created');showToast("Created");}else{await dbSaveCompany(form);setCompanies(function(prev){return prev.map(function(c){return c.id===form.id?Object.assign({},form):c;});});showToast("Updated");}setModal(null);}
  return<div>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:14,alignItems:"center"}}><div style={{fontWeight:700,fontSize:14}}>Companies ({companies.length})</div><Btn onClick={function(){setForm({name:"",domain:"",address:"",phone:"",industry:"",size:""});setModal("new");}}>➕ Add</Btn></div>
    {companies.length===0&&<Card><div style={{textAlign:"center",padding:32,color:"#94a3b8"}}>No companies yet.</div></Card>}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
      {companies.map(function(c){var members=users.filter(function(u){return u.companyId===c.id;});return<Card key={c.id}><div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}><div style={{width:40,height:40,borderRadius:10,background:avCol(c.id),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:16}}>{c.name[0]}</div><div style={{display:"flex",gap:6}}><Btn size="sm" variant="ghost" onClick={function(){setForm(Object.assign({},c));setModal("edit");}}>✏️</Btn><Btn size="sm" variant="danger" onClick={async function(){await dbDeleteCompany(c.id);setCompanies(function(prev){return prev.filter(function(x){return x.id!==c.id;});});showToast("Deleted");}}>🗑</Btn></div></div><div style={{fontWeight:700,color:"#1e293b",marginBottom:6,fontSize:14}}>{c.name}</div><div style={{fontSize:12,color:"#64748b"}}>🌐 {c.domain||"—"} · 📍 {c.address||"—"}</div><div style={{fontSize:12,color:"#64748b",marginBottom:10}}>🏭 {c.industry||"—"} · {c.size||"—"}</div><div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{members.slice(0,5).map(function(m){return<Avatar key={m.id} name={m.name} id={m.id} size={22}/>;})}{members.length>5&&<div style={{fontSize:10,color:"#94a3b8",alignSelf:"center"}}>+{members.length-5}</div>}</div></Card>;})}
    </div>
    {modal&&<Modal title={modal==="new"?"Add Company":"Edit Company"} onClose={function(){setModal(null);}}>
      <FInput label="Name *" value={form.name||""} onChange={function(e){fld("name",e.target.value);}}/><FInput label="Domain" value={form.domain||""} onChange={function(e){fld("domain",e.target.value);}}/><FInput label="Address" value={form.address||""} onChange={function(e){fld("address",e.target.value);}}/><FInput label="Phone" value={form.phone||""} onChange={function(e){fld("phone",e.target.value);}}/><FInput label="Industry" value={form.industry||""} onChange={function(e){fld("industry",e.target.value);}}/><FInput label="Size" value={form.size||""} onChange={function(e){fld("size",e.target.value);}}/>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setModal(null);}}>Cancel</Btn><Btn onClick={save}>{modal==="new"?"Create":"Save"}</Btn></div>
    </Modal>}
  </div>;
}

// ── Clients ───────────────────────────────────────────────────────────────────
function PageClients(p){
  var clients=p.clients;var setClients=p.setClients;var companies=p.companies;var addLog=p.addLog;var showToast=p.showToast;var dbSaveClient=p.dbSaveClient;var dbDeleteClient=p.dbDeleteClient;
  var[modal,setModal]=useState(null);var[selCl,setSelCl]=useState(null);var[form,setForm]=useState({});var[lForm,setLForm]=useState({});
  function fld(k,v){setForm(function(prev){return Object.assign({},prev,{[k]:v});});}function lfld(k,v){setLForm(function(prev){return Object.assign({},prev,{[k]:v});});}
  async function saveCl(){if(!form.name){showToast("Name required","error");return;}if(modal==="newCl"){var nc=Object.assign({},form,{id:uid(),locations:[]});await dbSaveClient(nc);setClients(function(prev){return prev.concat([nc]);});addLog("CLIENT_CREATED",nc.id,"Client \""+nc.name+"\" added");showToast("Client added");}else{var updated=Object.assign({},form,{locations:clients.find(function(c){return c.id===form.id;})?.locations||[]});await dbSaveClient(updated);setClients(function(prev){return prev.map(function(c){return c.id===form.id?updated:c;});});showToast("Updated");}setModal(null);}
  async function saveLoc(){if(!lForm.name||!lForm.address){showToast("Name and address required","error");return;}var cl=clients.find(function(c){return c.id===selCl;});if(!cl)return;var newLocs;if(modal==="newLoc"){var nl=Object.assign({},lForm,{id:uid()});newLocs=cl.locations.concat([nl]);}else{newLocs=cl.locations.map(function(l){return l.id===lForm.id?Object.assign({},lForm):l;});}var updated=Object.assign({},cl,{locations:newLocs});await dbSaveClient(updated);setClients(function(prev){return prev.map(function(c){return c.id===selCl?updated:c;});});showToast(modal==="newLoc"?"Location added":"Updated");setModal(null);}
  return<div>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:14,alignItems:"center"}}><div style={{fontWeight:700,fontSize:14}}>Clients ({clients.length})</div><Btn onClick={function(){setForm({name:"",email:"",phone:"",industry:"",companyId:companies[0]?.id||""});setModal("newCl");}}>➕ Add Client</Btn></div>
    {clients.length===0&&<Card><div style={{textAlign:"center",padding:32,color:"#94a3b8"}}>No clients yet.</div></Card>}
    <div style={{display:"flex",flexDirection:"column",gap:14}}>{clients.map(function(cl){var co=companies.find(function(c){return c.id===cl.companyId;});return<Card key={cl.id}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
        <div style={{display:"flex",gap:12,alignItems:"center",flex:1,overflow:"hidden"}}><div style={{width:42,height:42,borderRadius:10,background:avCol(cl.id),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:16,flexShrink:0}}>{cl.name[0]}</div><div style={{overflow:"hidden"}}><div style={{fontWeight:700,color:"#1e293b",fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cl.name}</div><div style={{fontSize:11,color:"#64748b"}}>📧 {cl.email}</div></div></div>
        <div style={{display:"flex",gap:6,flexShrink:0}}><Btn size="sm" variant="ghost" onClick={function(){setForm(Object.assign({},cl));setModal("editCl");}}>✏️</Btn><Btn size="sm" variant="danger" onClick={async function(){await dbDeleteClient(cl.id);setClients(function(prev){return prev.filter(function(x){return x.id!==cl.id;});});showToast("Removed");}}>🗑</Btn></div>
      </div>
      <div style={{background:"#f8fafc",borderRadius:10,padding:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div style={{fontWeight:700,fontSize:12,color:"#475569"}}>📍 Locations ({cl.locations.length})</div><Btn size="sm" onClick={function(){setSelCl(cl.id);setLForm({name:"",address:"",floor:"",contact:""});setModal("newLoc");}}>➕ Add</Btn></div>
        {cl.locations.length===0&&<div style={{fontSize:12,color:"#94a3b8",textAlign:"center",padding:"8px 0"}}>No locations yet.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:8}}>{cl.locations.map(function(loc){return<div key={loc.id} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:8,padding:10}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}><div><div style={{fontWeight:700,fontSize:12}}>📍 {loc.name}</div><div style={{fontSize:11,color:"#64748b",marginTop:2}}>{loc.address}</div>{loc.floor&&<div style={{fontSize:11,color:"#64748b"}}>🏢 {loc.floor}</div>}</div><div style={{display:"flex",gap:4}}><Btn size="sm" variant="ghost" onClick={function(){setSelCl(cl.id);setLForm(Object.assign({},loc));setModal("editLoc");}}>✏️</Btn><Btn size="sm" variant="danger" onClick={async function(){var newLocs=cl.locations.filter(function(l){return l.id!==loc.id;});var updated=Object.assign({},cl,{locations:newLocs});await dbSaveClient(updated);setClients(function(prev){return prev.map(function(c){return c.id===cl.id?updated:c;});});showToast("Removed");}}>🗑</Btn></div></div></div>;})}</div>
      </div>
    </Card>;})}
    </div>
    {(modal==="newCl"||modal==="editCl")&&<Modal title={modal==="newCl"?"Add Client":"Edit Client"} onClose={function(){setModal(null);}}><FInput label="Client Name *" value={form.name||""} onChange={function(e){fld("name",e.target.value);}}/><FInput label="Email" value={form.email||""} onChange={function(e){fld("email",e.target.value);}} type="email"/><FInput label="Phone" value={form.phone||""} onChange={function(e){fld("phone",e.target.value);}}/><FInput label="Industry" value={form.industry||""} onChange={function(e){fld("industry",e.target.value);}}/><FSelect label="Company" value={form.companyId||""} onChange={function(e){fld("companyId",e.target.value);}} options={optCompaniesNone(companies)}/><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setModal(null);}}>Cancel</Btn><Btn onClick={saveCl}>{modal==="newCl"?"Add Client":"Save"}</Btn></div></Modal>}
    {(modal==="newLoc"||modal==="editLoc")&&<Modal title={modal==="newLoc"?"Add Location":"Edit Location"} onClose={function(){setModal(null);}}><FInput label="Location Name *" value={lForm.name||""} onChange={function(e){lfld("name",e.target.value);}} placeholder="e.g. HQ — New York"/><FInput label="Address *" value={lForm.address||""} onChange={function(e){lfld("address",e.target.value);}}/><FInput label="Floor / Area" value={lForm.floor||""} onChange={function(e){lfld("floor",e.target.value);}}/><FInput label="On-site Contact" value={lForm.contact||""} onChange={function(e){lfld("contact",e.target.value);}}/><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setModal(null);}}>Cancel</Btn><Btn onClick={saveLoc}>{modal==="newLoc"?"Add Location":"Save"}</Btn></div></Modal>}
  </div>;
}

// ── Ticket Types ──────────────────────────────────────────────────────────────
function PageTicketTypes(p){
  var ticketTypes=p.ticketTypes;var users=p.users;var setTicketTypes=p.setTicketTypes;var statusSla=p.statusSla;var setStatusSla=p.setStatusSla;var addLog=p.addLog;var showToast=p.showToast;var dbSaveTicketType=p.dbSaveTicketType;var dbDeleteTicketType=p.dbDeleteTicketType;
  var[modal,setModal]=useState(null);var[form,setForm]=useState({});var[kwInput,setKwInput]=useState("");
  var[slaEdit,setSlaEdit]=useState(function(){return Object.assign({},statusSla);});var[slaChanged,setSlaChanged]=useState(false);
  function fld(k,v){setForm(function(prev){return Object.assign({},prev,{[k]:v});});}
  async function save(){if(!form.name){showToast("Name required","error");return;}if(modal==="new"){var nt=Object.assign({},form,{id:uid(),keywords:form.keywords||[]});await dbSaveTicketType(nt);setTicketTypes(function(prev){return prev.concat([nt]);});showToast("Created");}else{await dbSaveTicketType(form);setTicketTypes(function(prev){return prev.map(function(t){return t.id===form.id?Object.assign({},form):t;});});showToast("Updated");}setModal(null);}
  function addKw(){if(kwInput.trim()){fld("keywords",(form.keywords||[]).concat([kwInput.trim()]));setKwInput("");}}
  function updateSlaField(status,val){var n=Object.assign({},slaEdit);n[status]=val===""||val===null?null:parseFloat(val);setSlaEdit(n);setSlaChanged(true);}
  function saveSla(){setStatusSla(slaEdit);saveStatusSlaStore(slaEdit);addLog("SLA_UPDATED","system","SLA thresholds updated");showToast("✅ SLA settings saved!");setSlaChanged(false);}
  var SLA_DESC={"Open":"Acknowledgement time","In Progress":"Resolution time","Pending":"Awaiting requester","Escalated":"Senior staff response","Closed":"No SLA"};
  return<div>
    <Card style={{marginBottom:20,borderTop:"3px solid #6366f1"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div><div style={{fontWeight:800,fontSize:14,color:"#1e293b"}}>⏱ Status SLA Thresholds</div></div>
        <div style={{display:"flex",gap:8}}><Btn size="sm" variant="ghost" onClick={function(){setSlaEdit(Object.assign({},DEFAULT_STATUS_SLA));setSlaChanged(true);}}>↺ Reset</Btn><Btn size="sm" variant={slaChanged?"primary":"ghost"} onClick={saveSla} style={{opacity:slaChanged?1:0.5}}>💾 Save</Btn></div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {ALL_STATUSES.map(function(status){var sm=STATUS_META[status];var isClosed=status==="Closed";var val=slaEdit[status];return<div key={status} style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:12}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:8,height:8,borderRadius:"50%",background:sm.color}}/><div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>{status}</div></div>{!isClosed&&val!==null?<Badge label={val+"h"} color={sm.color}/>:<Badge label="No SLA" color="#94a3b8"/>}</div><div style={{fontSize:11,color:"#64748b",marginBottom:isClosed?0:10}}>{SLA_DESC[status]}</div>{!isClosed&&<div style={{display:"flex",alignItems:"center",gap:8}}><input type="number" min="0.5" step="0.5" value={val===null||val===undefined?"":val} onChange={function(e){updateSlaField(status,e.target.value);}} style={{width:80,padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:14,outline:"none",background:"#fff",boxSizing:"border-box"}}/><span style={{fontSize:13,color:"#64748b",fontWeight:600}}>hours</span></div>}</div>;})}
      </div>
      {slaChanged&&<div style={{marginTop:12,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#92400e"}}>⚠️ Unsaved changes — click Save.</div>}
    </Card>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:14,alignItems:"center"}}><div style={{fontWeight:700,fontSize:14}}>Ticket Types ({ticketTypes.length})</div><Btn onClick={function(){setForm({name:"",priority:"medium",slaHours:24,color:"#6366f1",keywords:[],defaultAssignee:""});setModal("new");}}>➕ Add Type</Btn></div>
    {ticketTypes.length===0&&<Card><div style={{textAlign:"center",padding:32,color:"#94a3b8"}}>No ticket types yet.</div></Card>}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:12}}>
      {ticketTypes.map(function(tt){var asgn=users.find(function(u){return u.id===tt.defaultAssignee;});return<Card key={tt.id}><div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><div style={{display:"flex",gap:8,alignItems:"center"}}><div style={{width:10,height:10,borderRadius:"50%",background:tt.color}}/><span style={{fontWeight:700,color:"#1e293b"}}>{tt.name}</span></div><div style={{display:"flex",gap:4}}><Btn size="sm" variant="ghost" onClick={function(){setForm(Object.assign({},tt,{keywords:(tt.keywords||[]).slice()}));setModal("edit");}}>✏️</Btn><Btn size="sm" variant="danger" onClick={async function(){await dbDeleteTicketType(tt.id);setTicketTypes(function(prev){return prev.filter(function(t){return t.id!==tt.id;});});showToast("Deleted");}}>🗑</Btn></div></div><div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}><Badge label={PRI_META[tt.priority]?.label||tt.priority} color={PRI_META[tt.priority]?.color||"#6366f1"}/><Badge label={"SLA "+tt.slaHours+"h"} color="#0ea5e9"/></div>{asgn&&<div style={{fontSize:11,color:"#64748b",marginBottom:6}}>👤 {asgn.name}</div>}<div style={{display:"flex",flexWrap:"wrap",gap:4}}>{(tt.keywords||[]).slice(0,4).map(function(k){return<span key={k} style={{background:"#f1f5f9",color:"#475569",fontSize:10,padding:"2px 6px",borderRadius:4}}>{k}</span>;})}{ (tt.keywords||[]).length>4&&<span style={{fontSize:10,color:"#94a3b8"}}>+{(tt.keywords||[]).length-4}</span>}</div></Card>;})}
    </div>
    {modal&&<Modal title={modal==="new"?"Add Ticket Type":"Edit Ticket Type"} onClose={function(){setModal(null);}}><FInput label="Type Name *" value={form.name||""} onChange={function(e){fld("name",e.target.value);}}/><FSelect label="Priority" value={form.priority||"medium"} onChange={function(e){fld("priority",e.target.value);}} options={OPT_PRIORITY}/><FInput label="SLA Hours" value={form.slaHours||24} onChange={function(e){fld("slaHours",Number(e.target.value));}} type="number" min={1}/><FInput label="Color" value={form.color||"#6366f1"} onChange={function(e){fld("color",e.target.value);}} type="color"/><FSelect label="Default Assignee" value={form.defaultAssignee||""} onChange={function(e){fld("defaultAssignee",e.target.value);}} options={optAssignees(users)}/><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Keywords</label><div style={{display:"flex",gap:6,marginBottom:6}}><input value={kwInput} onChange={function(e){setKwInput(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")addKw();}} placeholder="e.g. printer" style={{flex:1,padding:"8px 10px",border:"1px solid #e2e8f0",borderRadius:6,fontSize:13,outline:"none"}}/><Btn size="sm" onClick={addKw}>Add</Btn></div><div style={{display:"flex",flexWrap:"wrap",gap:4}}>{(form.keywords||[]).map(function(k,i){return<span key={i} onClick={function(){fld("keywords",(form.keywords||[]).filter(function(_,j){return j!==i;}));}} style={{background:"#eef2ff",color:"#4338ca",fontSize:12,padding:"3px 10px",borderRadius:4,cursor:"pointer"}}>{k} ×</span>;})}</div></div><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setModal(null);}}>Cancel</Btn><Btn onClick={save}>{modal==="new"?"Create":"Save"}</Btn></div></Modal>}
  </div>;
}

// ── Activity Log ──────────────────────────────────────────────────────────────
const ACTION_META={INTEGRATIONS_UPDATED:{icon:"🔌",color:"#6366f1",label:"Integrations Updated"},USER_ROLE_CHANGE:{icon:"🔑",color:"#7c3aed",label:"Role Changed"},USER_CREATED:{icon:"👤",color:"#2563eb",label:"User Created"},USER_APPROVED:{icon:"✅",color:"#10b981",label:"User Approved"},USER_DELETED:{icon:"🗑",color:"#ef4444",label:"User Deleted"},PROFILE_UPDATED:{icon:"✏️",color:"#0ea5e9",label:"Profile Updated"},PASSWORD_CHANGED:{icon:"🔑",color:"#7c3aed",label:"Password Changed"},PASSWORD_RESET:{icon:"🔑",color:"#ef4444",label:"Password Reset"},ROLE_CREATED:{icon:"🏷️",color:"#10b981",label:"Role Created"},ROLE_UPDATED:{icon:"🏷️",color:"#0ea5e9",label:"Role Updated"},ROLE_DELETED:{icon:"🏷️",color:"#ef4444",label:"Role Deleted"},COMPANY_CREATED:{icon:"🏢",color:"#10b981",label:"Company Created"},COMPANY_DELETED:{icon:"🗑",color:"#ef4444",label:"Company Deleted"},TICKET_CREATED:{icon:"🎫",color:"#6366f1",label:"Ticket Created"},TICKET_STATUS:{icon:"🔄",color:"#f59e0b",label:"Status Updated"},TICKET_DELETED:{icon:"🗑",color:"#dc2626",label:"Ticket Deleted"},TICKET_TYPE_CHANGE:{icon:"🏷️",color:"#0ea5e9",label:"Type Changed"},EMAIL_SENT:{icon:"📧",color:"#0ea5e9",label:"Email Sent"},CLIENT_CREATED:{icon:"🤝",color:"#10b981",label:"Client Added"},CLIENT_DELETED:{icon:"🗑",color:"#ef4444",label:"Client Removed"},LOCATION_ADDED:{icon:"📍",color:"#10b981",label:"Location Added"},LOCATION_REMOVED:{icon:"📍",color:"#ef4444",label:"Location Removed"},TICKET_TYPE_CREATED:{icon:"🏷️",color:"#10b981",label:"Type Created"},TICKET_TYPE_DELETED:{icon:"🏷️",color:"#ef4444",label:"Type Deleted"},SLA_UPDATED:{icon:"⏱",color:"#6366f1",label:"SLA Updated"}};
function PageActivityLog(p){
  var logs=p.logs;var users=p.users;var[filter,setFilter]=useState("");
  function fu(id){return users.find(function(x){return x.id===id;});}
  var filtered=filter?logs.filter(function(l){return l.action===filter;}):logs;
  return<div>
    <div style={{display:"flex",gap:8,marginBottom:14,alignItems:"center",flexWrap:"wrap"}}>
      <div style={{fontWeight:700,fontSize:14,flex:1}}>Activity Log ({filtered.length})</div>
      <select value={filter} onChange={function(e){setFilter(e.target.value);}} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}><option value="">All Actions</option>{Object.keys(ACTION_META).map(function(k){return<option key={k} value={k}>{ACTION_META[k].label}</option>;})}</select>
    </div>
    <Card style={{padding:0}}>
      {filtered.length===0&&<div style={{textAlign:"center",padding:32,color:"#94a3b8"}}>No activity found</div>}
      {filtered.map(function(log,i){var am=ACTION_META[log.action]||{icon:"📝",color:"#6366f1",label:log.action};var actor=fu(log.userId);return<div key={log.id} style={{display:"flex",gap:12,padding:"12px 16px",borderBottom:i<filtered.length-1?"1px solid #f1f5f9":"none",alignItems:"flex-start"}}><div style={{width:32,height:32,borderRadius:8,background:am.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{am.icon}</div><div style={{flex:1,minWidth:0}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4,flexWrap:"wrap",gap:4}}><Badge label={am.label} color={am.color}/><span style={{fontSize:10,color:"#94a3b8"}}>{fdt(log.timestamp)}</span></div><div style={{fontSize:12,color:"#334155",marginTop:4,overflow:"hidden",textOverflow:"ellipsis"}}>{log.detail}</div>{actor&&<div style={{fontSize:11,color:"#94a3b8",marginTop:4,display:"flex",alignItems:"center",gap:4}}><Avatar name={actor.name} id={actor.id} size={14}/>By {actor.name}</div>}</div></div>;})}
    </Card>
  </div>;
}

// ── Integrations ──────────────────────────────────────────────────────────────
function PageIntegrations(p){
  var emailTemplates=p.emailTemplates||[];var setEmailTemplates=p.setEmailTemplates||function(){};var isAdmin=p.isAdmin;var showToast=p.showToast;
  var[testTo,setTestTo]=useState("");var[sending,setSending]=useState(false);var[status,setStatus]=useState("");
  var[tmplModal,setTmplModal]=useState(false);var[tmplForm,setTmplForm]=useState({name:"",subject:"",body:""});var[tmplEdit,setTmplEdit]=useState(null);
  function openNew(){setTmplForm({name:"",subject:"",body:""});setTmplEdit(null);setTmplModal(true);}
  function openEdit(t){setTmplForm({name:t.name,subject:t.subject,body:t.body});setTmplEdit(t.id);setTmplModal(true);}
  async function saveTmpl(){if(!tmplForm.name.trim()||!tmplForm.subject.trim()||!tmplForm.body.trim()){showToast("All fields required","error");return;}var t={id:tmplEdit||uid(),name:tmplForm.name.trim(),subject:tmplForm.subject.trim(),body:tmplForm.body.trim(),createdAt:new Date().toISOString()};await dbSaveEmailTemplate(t);setEmailTemplates(function(prev){return tmplEdit?prev.map(function(x){return x.id===tmplEdit?t:x;}):prev.concat([t]);});showToast(tmplEdit?"Template updated!":"Template created!");setTmplModal(false);}
  async function deleteTmpl(id){await dbDeleteEmailTemplate(id);setEmailTemplates(function(prev){return prev.filter(function(x){return x.id!==id;});});showToast("Template deleted");}
  async function runTest(){if(!testTo.trim()){showToast("Enter a recipient email","error");return;}setSending(true);setStatus("");try{var r=await callSendEmail({to:testTo.trim(),subject:"Hoptix Test",body:"Your email integration is working!"});if(r.success){setStatus("ok");showToast("📧 Test sent!");}else{setStatus("fail");showToast("Failed: "+r.error,"error");}}catch(e){setStatus("fail");showToast("Error: "+e.message,"error");}setSending(false);}
  return<div style={{maxWidth:600}}>
    <div style={{fontWeight:800,fontSize:16,color:"#1e293b",marginBottom:4}}>🔌 Integrations</div>
    <div style={{fontSize:12,color:"#64748b",marginBottom:20}}>Configure your email provider.</div>
    <Card style={{borderTop:"3px solid #6366f1",marginBottom:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:18}}>📧</span><span style={{fontWeight:700,fontSize:14,color:"#1e293b"}}>Gmail</span><span style={{background:"#d1fae5",color:"#065f46",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700}}>Active</span></div>
        <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:"#6366f1",fontWeight:700,textDecoration:"none"}}>App Passwords ↗</a>
      </div>
      <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#0369a1",lineHeight:1.8}}>Set in Vercel → Settings → Environment Variables:<br/><code style={{background:"#e0f2fe",padding:"1px 5px",borderRadius:3}}>GMAIL_USER</code> and <code style={{background:"#e0f2fe",padding:"1px 5px",borderRadius:3}}>GMAIL_APP_PASSWORD</code></div>
      <label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:6}}>Send Test Email</label>
      <div style={{display:"flex",gap:8,marginBottom:8}}>
        <input type="email" value={testTo} onChange={function(e){setTestTo(e.target.value);}} placeholder="recipient@example.com" style={{flex:1,padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:14,outline:"none",background:"#f8fafc",boxSizing:"border-box"}}/>
        <button onClick={runTest} disabled={sending} style={{padding:"10px 16px",background:sending?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:8,fontWeight:700,fontSize:13,cursor:sending?"not-allowed":"pointer",flexShrink:0}}>{sending?"Sending…":"📤 Test"}</button>
      </div>
      {status==="ok"&&<div style={{padding:"8px 14px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,fontSize:12,color:"#166534"}}>✅ Test email delivered!</div>}
      {status==="fail"&&<div style={{padding:"8px 14px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,fontSize:12,color:"#dc2626"}}>❌ Failed — check env variables.</div>}
    </Card>
    {isAdmin&&<Card style={{borderTop:"3px solid #6366f1"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div><div style={{fontWeight:800,fontSize:14,color:"#1e293b"}}>📝 Email Templates</div><div style={{fontSize:11,color:"#64748b",marginTop:2}}>Use <code style={{background:"#f1f5f9",padding:"1px 4px",borderRadius:3}}>{"{{client_name}}"}</code> and <code style={{background:"#f1f5f9",padding:"1px 4px",borderRadius:3}}>{"{{agent_name}}"}</code></div></div>
        <Btn onClick={openNew}>➕ Add Template</Btn>
      </div>
      {emailTemplates.length===0&&<div style={{textAlign:"center",padding:"20px 0",color:"#94a3b8",fontSize:13}}>No templates yet.</div>}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {emailTemplates.map(function(t){return<div key={t.id} style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"12px 14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
            <div style={{flex:1,overflow:"hidden"}}><div style={{fontWeight:700,color:"#1e293b",fontSize:13,marginBottom:3}}>{t.name}</div><div style={{fontSize:11,color:"#64748b",marginBottom:4}}>Subject: {t.subject}</div><div style={{fontSize:11,color:"#94a3b8",background:"#fff",borderRadius:6,padding:"5px 8px",border:"1px solid #e2e8f0",maxHeight:44,overflow:"hidden"}}>{t.body.slice(0,100)}{t.body.length>100?"…":""}</div></div>
            <div style={{display:"flex",gap:6,flexShrink:0}}><Btn size="sm" variant="ghost" onClick={function(){openEdit(t);}}>✏️</Btn><Btn size="sm" variant="danger" onClick={function(){deleteTmpl(t.id);}}>🗑</Btn></div>
          </div>
        </div>;})}
      </div>
    </Card>}
    {tmplModal&&<Modal title={tmplEdit?"Edit Template":"New Email Template"} onClose={function(){setTmplModal(false);}}>
      <FInput label="Template Name *" value={tmplForm.name} onChange={function(e){setTmplForm(function(prev){return Object.assign({},prev,{name:e.target.value});});}} placeholder="e.g. Initial Response"/>
      <FInput label="Subject *" value={tmplForm.subject} onChange={function(e){setTmplForm(function(prev){return Object.assign({},prev,{subject:e.target.value});});}} placeholder="Re: Your IT Request"/>
      <FTextarea label="Body *" value={tmplForm.body} onChange={function(e){setTmplForm(function(prev){return Object.assign({},prev,{body:e.target.value});});}} rows={8} placeholder={"Hi {{client_name}},\n\nThank you for reaching out...\n\nBest regards,\n{{agent_name}}"}/>
      <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:8,padding:"8px 12px",marginBottom:14,fontSize:11,color:"#0369a1"}}>💡 <strong>{"{{client_name}}"}</strong> and <strong>{"{{agent_name}}"}</strong> auto-fill on tickets.</div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setTmplModal(false);}}>Cancel</Btn><Btn onClick={saveTmpl}>{tmplEdit?"Save Changes":"Create Template"}</Btn></div>
    </Modal>}
  </div>;
}
