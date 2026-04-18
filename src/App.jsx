import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import React from "react";
import ReactDOM from "react-dom";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from "recharts";
import { supabase } from './supabase.js';
import { dbGetUsers, dbSaveUser, dbDeleteUser, dbGetPassword, dbSetPassword, dbGetCompanies, dbSaveCompany, dbDeleteCompany, dbGetClients, dbSaveClient, dbDeleteClient, dbGetTicketTypes, dbSaveTicketType, dbDeleteTicketType, dbGetTickets, dbSaveTicket, dbGetLogs, dbAddLog, dbGetSchedules, dbSaveSchedule, dbGetEmailTemplates, dbSaveEmailTemplate, dbDeleteEmailTemplate, dbGetTimeSessions, dbSaveTimeSession, dbGetAllTimeSessions } from './db.js';

const PAL = ["#6366f1","#8b5cf6","#0ea5e9","#10b981","#f59e0b","#ef4444","#ec4899","#f97316"];
const STATUS_META = { "Open":{color:"#f59e0b",bg:"#fef3c7"}, "In Progress":{color:"#6366f1",bg:"#eef2ff"}, "Pending":{color:"#0ea5e9",bg:"#e0f2fe"}, "Escalated":{color:"#ef4444",bg:"#fee2e2"}, "Closed":{color:"#94a3b8",bg:"#f1f5f9"} };
const ALL_STATUSES = ["Open","In Progress","Pending","Escalated","Closed"];
const PRI_META = { critical:{color:"#dc2626",bg:"#fee2e2",label:"Critical"}, high:{color:"#ef4444",bg:"#fef2f2",label:"High"}, medium:{color:"#f59e0b",bg:"#fffbeb",label:"Medium"}, low:{color:"#10b981",bg:"#f0fdf4",label:"Low"} };
const IT_ROLES = ["admin","it_manager","it_technician"];
const DEFAULT_STATUS_SLA = { "Open":2, "In Progress":8, "Pending":24, "Escalated":1, "Closed":null };
const DOW_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DEFAULT_ROLES = { admin:{label:"Administrator",color:"#dc2626",system:true}, it_manager:{label:"IT Manager",color:"#7c3aed",system:true}, it_technician:{label:"IT Technician",color:"#2563eb",system:true}, end_user:{label:"End User",color:"#059669",system:true} };
function loadRoles(){ try{ var s=localStorage.getItem("hd_roles"); return s?Object.assign({},DEFAULT_ROLES,JSON.parse(s)):Object.assign({},DEFAULT_ROLES); }catch(e){ return Object.assign({},DEFAULT_ROLES); } }
function saveRoles(v){ try{ localStorage.setItem("hd_roles",JSON.stringify(v)); }catch(e){} }
var ROLE_META = loadRoles();

const uid     = function(){ return "id_"+Date.now()+"_"+Math.random().toString(36).slice(2,6); };
const fdt     = function(iso){ return iso?new Date(iso).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit"}):"—"; };
const ago     = function(iso){ if(!iso)return"—"; var m=Math.floor((Date.now()-new Date(iso))/60000); if(m<1)return"just now"; if(m<60)return m+"m ago"; var h=Math.floor(m/60); if(h<24)return h+"h ago"; return Math.floor(h/24)+"d ago"; };
const inits   = function(n){ if(!n)return"??"; var p=n.trim().split(" ").filter(Boolean); return p.length>=2?(p[0][0]+p[1][0]).toUpperCase():n.slice(0,2).toUpperCase(); };
const avCol   = function(id){ return PAL[Math.abs((id||"").split("").reduce(function(a,c){return a+c.charCodeAt(0);},0))%PAL.length]; };
const slaColor= function(r){ return r>=90?"#10b981":r>=75?"#f59e0b":"#ef4444"; };
const fmtMs   = function(mins){ if(!mins&&mins!==0)return"—"; var s=mins*60; if(s<60)return s.toFixed(2)+"s"; if(s<3600){var m=Math.floor(mins);var sc=parseFloat(((mins-m)*60).toFixed(2));return m+"m "+sc+"s";} var h=Math.floor(mins/60);var rm=mins-h*60;var m2=Math.floor(rm);var s2=parseFloat(((rm-m2)*60).toFixed(2));return h+"h "+m2+"m "+s2+"s"; };
const pieLabel= function(p){ return p.value>0?p.name+": "+p.value:""; };
const fmtHour = function(h){ if(h===0)return"12:00 AM"; if(h<12)return h+":00 AM"; if(h===12)return"12:00 PM"; return (h-12)+":00 PM"; };
const fmtDuration = function(mins){ if(!mins||mins<=0)return"0m"; var h=Math.floor(mins/60); var m=Math.round(mins%60); if(h===0)return m+"m"; if(m===0)return h+"h"; return h+"h "+m+"m"; };
const fmtElapsed = function(secs){ var h=Math.floor(secs/3600); var m=Math.floor((secs%3600)/60); var s=secs%60; return (h>0?String(h).padStart(2,"0")+":":"")+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0"); };

function useIsMobile(){ var[mob,setMob]=useState(window.innerWidth<768); useEffect(function(){function h(){setMob(window.innerWidth<768);}window.addEventListener("resize",h);return function(){window.removeEventListener("resize",h);};},[]);return mob; }
function slotToHours(slot){ return slot*0.5; }
function getPHTDayKey(dateMs){ var PHT_OFFSET_MS=8*3600000; var phtMs=dateMs+PHT_OFFSET_MS; var dow=new Date(phtMs).getUTCDay(); return DAY_KEYS[dow]; }
function getPHTMidnightUTC(dateMs){ var PHT_OFFSET_MS=8*3600000; var phtMs=dateMs+PHT_OFFSET_MS; var d=new Date(phtMs); var phtMidnight=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()); return phtMidnight-PHT_OFFSET_MS; }

function calcBusinessHoursElapsed(startMs,endMs,schedule){
  if(!schedule)return(endMs-startMs)/3600000;
  if(schedule.perDay&&schedule.daySchedule){
    var total=0; var cur=startMs; var safety=0;
    while(cur<endMs&&safety<400){
      safety++;
      var dayKey=getPHTDayKey(cur); var ds=schedule.daySchedule[dayKey]; var dayMidnightUTC=getPHTMidnightUTC(cur);
      if(ds&&ds.active){var dayStartUTC=dayMidnightUTC+slotToHours(ds.start)*3600000;var dayEndUTC=dayMidnightUTC+slotToHours(ds.end)*3600000;var os=Math.max(cur,dayStartUTC);var oe=Math.min(endMs,dayEndUTC);if(oe>os)total+=(oe-os)/3600000;}
      cur=dayMidnightUTC+86400000;
    }
    return total;
  }
  if(!schedule.days||!schedule.days.length)return(endMs-startMs)/3600000;
  var total2=0,cur2=startMs;
  while(cur2<endMs){
    var d=new Date(cur2);var dow=d.getDay();
    var ds2=new Date(d.getFullYear(),d.getMonth(),d.getDate(),schedule.startHour,0,0,0).getTime();
    var de2=new Date(d.getFullYear(),d.getMonth(),d.getDate(),schedule.endHour,0,0,0).getTime();
    if(schedule.days.includes(dow)){var os2=Math.max(cur2,ds2);var oe2=Math.min(endMs,de2);if(oe2>os2)total2+=(oe2-os2)/3600000;}
    cur2=new Date(d.getFullYear(),d.getMonth(),d.getDate()+1,0,0,0,0).getTime();
  }
  return total2;
}
function isCurrentlyOnShift(schedule){
  if(!schedule)return true;
  if(schedule.perDay&&schedule.daySchedule){
    var nowMs=Date.now(); var dayKey=getPHTDayKey(nowMs); var ds=schedule.daySchedule[dayKey];
    if(!ds||!ds.active)return false;
    var dayMidnightUTC=getPHTMidnightUTC(nowMs); var dayStartUTC=dayMidnightUTC+slotToHours(ds.start)*3600000; var dayEndUTC=dayMidnightUTC+slotToHours(ds.end)*3600000;
    return nowMs>=dayStartUTC&&nowMs<dayEndUTC;
  }
  if(!schedule.days||!schedule.days.length)return true;
  var now=new Date();var dow=now.getDay();var h=now.getHours()+(now.getMinutes()/60);
  return schedule.days.includes(dow)&&h>=schedule.startHour&&h<schedule.endHour;
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
  var spent=schedule?calcBusinessHoursElapsed(new Date(entry).getTime(),Date.now(),schedule):(Date.now()-new Date(entry).getTime())/3600000;
  var pct=Math.min(100,Math.round(spent/allowed*100));var breached=spent>allowed;var remaining=Math.max(0,allowed-spent);var onShift=isCurrentlyOnShift(schedule);
  return{hoursAllowed:allowed,hoursSpent:parseFloat(spent.toFixed(2)),pct,breached,remaining:parseFloat(remaining.toFixed(2)),enteredAt:entry,onShift,hasSchedule:!!schedule,schedule};
}
function sumLoggedMinutes(sessions,ticketIds){
  return sessions.filter(function(s){return ticketIds?ticketIds.includes(s.ticket_id):true;}).reduce(function(sum,s){return sum+(s.duration_minutes||0);},0);
}

async function callSendEmail(opts){
  try{
    var body={to:opts.to,subject:opts.subject||"(no subject)",text:opts.body||opts.message||""};
    if(opts.cc&&opts.cc.trim()){body.cc=opts.cc;}
    var res=await fetch("/api/send-email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    var data=await res.json();
    if(res.ok&&data.id)return{success:true,provider:"Gmail",id:data.id};
    throw new Error(data.error||("Status "+res.status));
  }catch(e){return{success:false,error:e.message,provider:"Gmail"};}
}

async function notifyAdmin(subject,body){
  try{ await callSendEmail({to:"randy@omnisecurityinc.com",subject:subject,body:body}); }catch(e){ console.error("notifyAdmin failed:",e); }
}

// ── Notify all involved users on ticket events ────────────────────────────────
// recipients: array of email strings, deduped internally
async function notifyUsers(recipients,subject,body){
  if(!recipients||!recipients.length)return;
  var deduped=recipients.filter(function(e,i,a){return e&&e.trim()&&a.indexOf(e)===i;});
  for(var i=0;i<deduped.length;i++){
    try{ await callSendEmail({to:deduped[i],subject:subject,body:body}); }catch(e){ console.error("notifyUsers failed for "+deduped[i],e); }
  }
}

// Returns array of emails for everyone involved in a ticket
function getTicketEmails(ticket,users){
  var emails=["randy@omnisecurityinc.com"];
  if(ticket.submittedBy){var sub=users.find(function(u){return u.id===ticket.submittedBy;});if(sub&&sub.email)emails.push(sub.email);}
  if(ticket.assignedTo){var asgn=users.find(function(u){return u.id===ticket.assignedTo;});if(asgn&&asgn.email)emails.push(asgn.email);}
  if(ticket.externalEmail&&ticket.externalEmail.trim())emails.push(ticket.externalEmail.trim());
  return emails.filter(function(e,i,a){return e&&a.indexOf(e)===i;});
}

// ── Supabase: app_notifications table ────────────────────────────────────────
async function dbGetNotifications(userId){
  try{var{data,error}=await supabase.from("app_notifications").select("*").eq("user_id",userId).order("created_at",{ascending:false}).limit(50);if(error)throw error;return data||[];}catch(e){console.error("dbGetNotifications",e);return[];}
}
async function dbSaveNotification(notif){
  try{var{error}=await supabase.from("app_notifications").upsert([notif]);if(error)throw error;}catch(e){console.error("dbSaveNotification",e);}
}
async function dbMarkNotificationsRead(userId){
  try{var{error}=await supabase.from("app_notifications").update({read:true}).eq("user_id",userId).eq("read",false);if(error)throw error;}catch(e){console.error("dbMarkNotificationsRead",e);}
}

// Creates in-app notifications for all IT users + ticket submitter (excludes excludeUserId)
async function createNotificationsForTicket(ticket,users,message,type,excludeUserId){
  var targets=users.filter(function(u){
    if(!u.active)return false;
    if(u.id===excludeUserId)return false;
    // notify all IT staff + admin + submitter
    if(IT_ROLES.includes(u.role))return true;
    if(u.id===ticket.submittedBy)return true;
    return false;
  });
  for(var i=0;i<targets.length;i++){
    var notif={id:uid(),user_id:targets[i].id,ticket_id:ticket.id,ticket_title:ticket.title,message:message,type:type||"info",read:false,created_at:new Date().toISOString()};
    await dbSaveNotification(notif);
  }
}

// ── Supabase: chat_groups + team_chats tables ─────────────────────────────────
async function dbGetTeamGroups(){
  try{var{data,error}=await supabase.from("chat_groups").select("*").order("created_at",{ascending:true});if(error)throw error;return data||[];}catch(e){console.error("dbGetTeamGroups",e);return[];}
}
async function dbSaveTeamGroup(g){
  try{var{error}=await supabase.from("chat_groups").upsert([g]);if(error)throw error;}catch(e){console.error("dbSaveTeamGroup",e);}
}
async function dbDeleteTeamGroup(id){
  try{var{error}=await supabase.from("chat_groups").delete().eq("id",id);if(error)throw error;}catch(e){console.error("dbDeleteTeamGroup",e);}
}
async function dbGetTeamChats(groupId){
  try{var{data,error}=await supabase.from("team_chats").select("*").eq("group_id",groupId).order("created_at",{ascending:true}).limit(200);if(error)throw error;return data||[];}catch(e){console.error("dbGetTeamChats",e);return[];}
}
async function dbSaveTeamChat(msg){
  try{var{error}=await supabase.from("team_chats").upsert([msg]);if(error)throw error;}catch(e){console.error("dbSaveTeamChat",e);}
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

// ── UI Primitives ─────────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component{constructor(p){super(p);this.state={error:null};}static getDerivedStateFromError(e){return{error:e.message};}render(){if(this.state.error)return<div style={{padding:24,background:"#fef2f2",minHeight:"100vh"}}><div style={{fontSize:18,fontWeight:700,color:"#dc2626",marginBottom:12}}>⚠️ Something went wrong</div><pre style={{background:"#fff",padding:16,borderRadius:8,border:"1px solid #fecaca",fontSize:12,whiteSpace:"pre-wrap",color:"#7f1d1d",marginBottom:16,overflowX:"auto"}}>{this.state.error}</pre><button onClick={function(){try{localStorage.removeItem("hd_page");}catch(e){}window.location.href="/";}} style={{padding:"10px 20px",background:"#dc2626",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700,marginRight:8,marginBottom:8}}>🏠 Dashboard</button><button onClick={function(){try{localStorage.clear();}catch(e){}window.location.href="/";}} style={{padding:"10px 20px",background:"#7f1d1d",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700}}>🗑 Clear &amp; Restart</button></div>;return this.props.children;}}

function Badge(p){return<span style={{background:p.bg||p.color+"22",color:p.color,border:"1px solid "+p.color+"44",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700,whiteSpace:"nowrap",display:"inline-block"}}>{p.label}</span>;}
function Avatar(p){var s=p.size||32;return<div style={{width:s,height:s,borderRadius:"50%",background:avCol(p.id||p.name),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:s*0.35,fontWeight:700,flexShrink:0}}>{inits(p.name)}</div>;}
function Card(p){return<div style={{background:"#fff",borderRadius:12,border:"1px solid #e2e8f0",boxShadow:"0 1px 4px rgba(0,0,0,.06)",padding:16,...p.style}}>{p.children}</div>;}
function Stat(p){
  var[tip,setTip]=useState(false);
  return<Card style={{flex:1,minWidth:140,position:"relative"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:2}}>
          <div style={{color:"#64748b",fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5}}>{p.label}</div>
          {p.help&&<button onClick={function(){setTip(!tip);}} style={{background:"none",border:"none",cursor:"pointer",padding:0,lineHeight:1,color:"#94a3b8",fontSize:11,fontWeight:700,flexShrink:0}}>ⓘ</button>}
        </div>
        <div style={{fontSize:24,fontWeight:800,color:p.color||"#6366f1",margin:"4px 0 2px"}}>{p.value}</div>
        {p.sub&&<div style={{fontSize:10,color:"#94a3b8"}}>{p.sub}</div>}
      </div>
      <span style={{fontSize:20}}>{p.icon}</span>
    </div>
    {tip&&p.help&&<div style={{position:"absolute",bottom:"calc(100% + 6px)",left:0,right:0,background:"#1e293b",color:"#f1f5f9",borderRadius:8,padding:"8px 10px",fontSize:11,lineHeight:1.6,zIndex:999,boxShadow:"0 4px 16px rgba(0,0,0,.25)"}}>
      {p.help}
      <div style={{position:"absolute",bottom:-5,left:16,width:10,height:10,background:"#1e293b",transform:"rotate(45deg)"}}/>
    </div>}
  </Card>;
}
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

// ── Notification Bell ─────────────────────────────────────────────────────────
function NotificationBell(p){
  var notifications=p.notifications||[];
  var onMarkRead=p.onMarkRead||function(){};
  var onGoTicket=p.onGoTicket||function(){};
  var[open,setOpen]=useState(false);
  var unread=notifications.filter(function(n){return !n.read;}).length;
  var bellRef=useRef(null);
  useEffect(function(){
    function handleClick(e){if(bellRef.current&&!bellRef.current.contains(e.target))setOpen(false);}
    document.addEventListener("mousedown",handleClick);
    return function(){document.removeEventListener("mousedown",handleClick);};
  },[]);
  var TYPE_ICON={"ticket":"🎫","status":"🔄","chat":"💬","email":"📧","sla":"🚨","team_chat":"💬","info":"🔔"};
  return<div ref={bellRef} style={{position:"relative"}}>
    <button onClick={function(){setOpen(!open);if(!open&&unread>0)onMarkRead();}} style={{position:"relative",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,width:38,height:38,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:18}}>
      🔔
      {unread>0&&<span style={{position:"absolute",top:-4,right:-4,background:"#ef4444",color:"#fff",borderRadius:10,padding:"1px 5px",fontSize:9,fontWeight:800,minWidth:16,textAlign:"center",lineHeight:"14px"}}>{unread>99?"99+":unread}</span>}
    </button>
    {open&&<div style={{position:"absolute",top:"calc(100% + 8px)",right:0,width:320,maxHeight:440,background:"#fff",borderRadius:14,boxShadow:"0 8px 32px rgba(0,0,0,.18)",border:"1px solid #e2e8f0",zIndex:9999,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"12px 16px",borderBottom:"1px solid #e2e8f0",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
        <div style={{fontWeight:700,fontSize:13,color:"#1e293b"}}>🔔 Notifications</div>
        {unread>0&&<button onClick={onMarkRead} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:"#6366f1",fontWeight:700,padding:0}}>Mark all read</button>}
      </div>
      <div style={{overflowY:"auto",flex:1}}>
        {notifications.length===0&&<div style={{padding:"28px 16px",textAlign:"center",color:"#94a3b8",fontSize:12}}>No notifications yet</div>}
        {notifications.map(function(n){return<div key={n.id} onClick={function(){if(n.ticket_id)onGoTicket(n.ticket_id);setOpen(false);}} style={{padding:"10px 16px",borderBottom:"1px solid #f1f5f9",cursor:n.ticket_id?"pointer":"default",background:n.read?"#fff":"#eef2ff",display:"flex",gap:10,alignItems:"flex-start"}}>
          <span style={{fontSize:16,flexShrink:0,marginTop:2}}>{TYPE_ICON[n.type]||"🔔"}</span>
          <div style={{flex:1,minWidth:0}}>
            {n.ticket_title&&<div style={{fontWeight:600,fontSize:11,color:"#6366f1",marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{n.ticket_title}</div>}
            <div style={{fontSize:12,color:"#334155",lineHeight:1.5}}>{n.message}</div>
            <div style={{fontSize:10,color:"#94a3b8",marginTop:3}}>{ago(n.created_at)}</div>
          </div>
          {!n.read&&<div style={{width:8,height:8,borderRadius:"50%",background:"#6366f1",flexShrink:0,marginTop:4}}/>}
        </div>;})}
      </div>
    </div>}
  </div>;
}

// ── Time Session Timer Component ──────────────────────────────────────────────
function TicketTimer(p){
  var ticketId=p.ticketId;
  var curUser=p.curUser;
  var users=p.users;
  var autoStart=p.autoStart||false;
  var onAutoStarted=p.onAutoStarted||function(){};
  var forceStopRef=p.forceStopRef;

  var[sessions,setSessions]=useState([]);
  var[activeSession,setActiveSession]=useState(null);
  var[elapsed,setElapsed]=useState(0);
  var[note,setNote]=useState("");
  var[loading,setLoading]=useState(true);
  var intervalRef=useRef(null);
  var autoStartedRef=useRef(false);

  useEffect(function(){
    dbGetTimeSessions(ticketId).then(function(data){
      setSessions(data);
      var open=data.find(function(s){return s.user_id===curUser.id&&!s.ended_at;});
      if(open){
        setActiveSession({id:open.id,started_at:open.started_at});
        setElapsed(Math.floor((Date.now()-new Date(open.started_at))/1000));
        setLoading(false);
      } else {
        setLoading(false);
        if(autoStart&&!autoStartedRef.current){
          autoStartedRef.current=true;
          var now=new Date().toISOString();
          var session={id:uid(),ticket_id:ticketId,user_id:curUser.id,started_at:now,ended_at:null,duration_minutes:null,note:null,created_at:now};
          dbSaveTimeSession(session).then(function(){
            setSessions(function(prev){return prev.concat([session]);});
            setActiveSession({id:session.id,started_at:now});
            setElapsed(0);
            onAutoStarted();
          });
        }
      }
    });
  },[ticketId]);

  useEffect(function(){
    if(!forceStopRef)return;
    forceStopRef.current=async function(){
      if(!activeSession)return 0;
      var now=new Date().toISOString();
      var mins=parseFloat(((Date.now()-new Date(activeSession.started_at))/60000).toFixed(4));
      var updated=sessions.find(function(s){return s.id===activeSession.id;});
      if(!updated)return 0;
      var finished=Object.assign({},updated,{ended_at:now,duration_minutes:mins});
      await dbSaveTimeSession(finished);
      setSessions(function(prev){return prev.map(function(s){return s.id===finished.id?finished:s;});});
      setActiveSession(null);setElapsed(0);
      return mins;
    };
  },[activeSession,sessions]);

  useEffect(function(){
    if(activeSession){intervalRef.current=setInterval(function(){setElapsed(function(e){return e+1;});},1000);}
    else{clearInterval(intervalRef.current);}
    return function(){clearInterval(intervalRef.current);};
  },[activeSession]);

  async function startTimer(){
    var now=new Date().toISOString();
    var session={id:uid(),ticket_id:ticketId,user_id:curUser.id,started_at:now,ended_at:null,duration_minutes:null,note:note.trim()||null,created_at:now};
    await dbSaveTimeSession(session);
    setSessions(function(prev){return prev.concat([session]);});
    setActiveSession({id:session.id,started_at:now});setElapsed(0);
  }
  async function stopTimer(){
    if(!activeSession)return;
    var now=new Date().toISOString();
    var mins=parseFloat(((Date.now()-new Date(activeSession.started_at))/60000).toFixed(4));
    var updated=sessions.find(function(s){return s.id===activeSession.id;});
    if(!updated)return;
    var finished=Object.assign({},updated,{ended_at:now,duration_minutes:mins,note:note.trim()||updated.note||null});
    await dbSaveTimeSession(finished);
    setSessions(function(prev){return prev.map(function(s){return s.id===finished.id?finished:s;});});
    setActiveSession(null);setElapsed(0);setNote("");
  }

  function fu(id){return users.find(function(u){return u.id===id;});}
  var completedSessions=sessions.filter(function(s){return s.ended_at;});
  var totalMins=completedSessions.reduce(function(sum,s){return sum+(s.duration_minutes||0);},0);
  if(loading)return<div style={{textAlign:"center",padding:24,color:"#94a3b8",fontSize:13}}>Loading timer…</div>;

  return<div>
    <div style={{background:activeSession?"linear-gradient(135deg,#064e3b,#065f46)":"linear-gradient(135deg,#1e1b4b,#312e81)",borderRadius:16,padding:24,textAlign:"center",marginBottom:16}}>
      <div style={{fontSize:11,fontWeight:700,color:activeSession?"#6ee7b7":"#a5b4fc",textTransform:"uppercase",letterSpacing:2,marginBottom:8}}>{activeSession?"⏱ Timer Running":"⏸ Timer Stopped"}</div>
      <div style={{fontSize:48,fontWeight:800,color:"#fff",fontVariantNumeric:"tabular-nums",letterSpacing:2,marginBottom:16,fontFamily:"'Courier New',monospace"}}>{fmtElapsed(elapsed)}</div>
      {!activeSession&&<div style={{marginBottom:12}}><input value={note} onChange={function(e){setNote(e.target.value);}} placeholder="What are you working on? (optional)" style={{width:"100%",padding:"10px 14px",border:"1px solid rgba(255,255,255,.2)",borderRadius:10,fontSize:13,outline:"none",background:"rgba(255,255,255,.1)",color:"#fff",boxSizing:"border-box"}}/></div>}
      {activeSession?<button onClick={stopTimer} style={{background:"#ef4444",color:"#fff",border:"none",borderRadius:12,padding:"14px 40px",fontSize:16,fontWeight:800,cursor:"pointer",letterSpacing:0.5}}>⏹ Stop &amp; Save</button>:<button onClick={startTimer} style={{background:"#10b981",color:"#fff",border:"none",borderRadius:12,padding:"14px 40px",fontSize:16,fontWeight:800,cursor:"pointer",letterSpacing:0.5}}>▶ Start Timer</button>}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
      <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:12,textAlign:"center"}}><div style={{fontSize:22,fontWeight:800,color:"#059669"}}>{fmtDuration(totalMins)}</div><div style={{fontSize:10,color:"#64748b",fontWeight:700,textTransform:"uppercase",marginTop:2}}>Total IT Hours</div></div>
      <div style={{background:"#eef2ff",border:"1px solid #c7d2fe",borderRadius:10,padding:12,textAlign:"center"}}><div style={{fontSize:22,fontWeight:800,color:"#6366f1"}}>{completedSessions.length}</div><div style={{fontSize:10,color:"#64748b",fontWeight:700,textTransform:"uppercase",marginTop:2}}>Sessions Logged</div></div>
    </div>
    {completedSessions.length>0&&<div>
      <div style={{fontWeight:700,color:"#1e293b",fontSize:12,marginBottom:10,textTransform:"uppercase",letterSpacing:0.5}}>📋 Session Log</div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {completedSessions.slice().reverse().map(function(s){var worker=fu(s.user_id);return<div key={s.id} style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>{worker&&<Avatar name={worker.name} id={worker.id} size={18}/>}<span style={{fontSize:12,fontWeight:700,color:"#1e293b"}}>{worker?worker.name:"Unknown"}</span><Badge label={fmtDuration(s.duration_minutes)} color="#6366f1"/></div>
            <div style={{fontSize:10,color:"#94a3b8"}}>{fdt(s.started_at)} → {fdt(s.ended_at)}</div>
            {s.note&&<div style={{fontSize:11,color:"#475569",marginTop:4,fontStyle:"italic"}}>"{s.note}"</div>}
          </div>
        </div>;})}
      </div>
    </div>}
    {completedSessions.length===0&&!activeSession&&<div style={{textAlign:"center",padding:"20px 0",color:"#94a3b8",fontSize:13}}><div style={{fontSize:28,marginBottom:6}}>⏱</div>No time logged yet. Start the timer when you begin working.</div>}
  </div>;
}

// ── Schedule Editor ───────────────────────────────────────────────────────────
var SLOT_COUNT=49;
function fmtSlot(slot){if(slot===48)return"12:00 AM (Midnight)";var totalMins=slot*30;var h=Math.floor(totalMins/60);var m=totalMins%60;var ampm=h<12?"AM":"PM";var h12=h===0?12:h>12?h-12:h;return h12+":"+(m===0?"00":"30")+" "+ampm;}
var ALL_SLOTS=Array.from({length:SLOT_COUNT},function(_,i){return{value:i,label:fmtSlot(i)};});
function defaultDaySchedule(){return{mon:{active:true,start:18,end:36},tue:{active:true,start:18,end:36},wed:{active:true,start:18,end:36},thu:{active:true,start:18,end:36},fri:{active:true,start:18,end:36},sat:{active:false,start:18,end:36},sun:{active:false,start:18,end:36}};}
var DAY_KEYS=["sun","mon","tue","wed","thu","fri","sat"];
var DAY_LABELS_FULL=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
function migrateSchedule(sch){if(!sch)return null;if(sch.perDay)return sch;var pd=defaultDaySchedule();var startSlot=Math.round((sch.startHour||9)*2);var endSlot=Math.round((sch.endHour||17)*2);(sch.days||[]).forEach(function(dow){var key=DAY_KEYS[dow];if(key){pd[key]={active:true,start:startSlot,end:endSlot};}});return{perDay:true,daySchedule:pd};}

function ScheduleEditor(p){
  var userId=p.userId;var schedules=p.schedules;var onChange=p.onChange;
  var existing=schedules[userId]||null;var migrated=migrateSchedule(existing);
  var[enabled,setEnabled]=useState(!!existing);var[daySchedule,setDaySchedule]=useState(migrated?migrated.daySchedule:defaultDaySchedule());
  function emit(en,ds){onChange(userId,en?{perDay:true,daySchedule:ds}:null);}
  function handleEnable(v){setEnabled(v);emit(v,daySchedule);}
  function toggleDay(key){var nd=Object.assign({},daySchedule);nd[key]=Object.assign({},nd[key],{active:!nd[key].active});setDaySchedule(nd);emit(enabled,nd);}
  function setDayStart(key,val){var nd=Object.assign({},daySchedule);nd[key]=Object.assign({},nd[key],{start:val,end:Math.max(nd[key].end,val+1)});setDaySchedule(nd);emit(enabled,nd);}
  function setDayEnd(key,val){var nd=Object.assign({},daySchedule);nd[key]=Object.assign({},nd[key],{end:val});setDaySchedule(nd);emit(enabled,nd);}
  var selSt={padding:"6px 8px",border:"1px solid #e2e8f0",borderRadius:6,fontSize:11,outline:"none",background:"#fff",width:"100%",boxSizing:"border-box"};
  return<div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:14,marginBottom:14}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
      <div><div style={{fontWeight:700,color:"#0369a1",fontSize:13}}>🗓 Work Schedule</div><div style={{fontSize:10,color:"#0369a1",marginTop:1}}>🇵🇭 All times in Philippine Time (PHT · UTC+8)</div></div>
      <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,fontWeight:600,color:enabled?"#0369a1":"#64748b"}}><input type="checkbox" checked={enabled} onChange={function(e){handleEnable(e.target.checked);}} style={{width:16,height:16,accentColor:"#0369a1"}}/>{enabled?"Enabled":"Off (24/7)"}</label>
    </div>
    {enabled&&<div style={{marginTop:12}}>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {DAY_KEYS.map(function(key,i){var ds=daySchedule[key]||{active:false,start:18,end:36};return<div key={key} style={{background:ds.active?"#fff":"#f8fafc",border:"1px solid "+(ds.active?"#bae6fd":"#e2e8f0"),borderRadius:8,padding:"8px 12px"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",minWidth:100,flexShrink:0}}><input type="checkbox" checked={ds.active} onChange={function(){toggleDay(key);}} style={{width:14,height:14,accentColor:"#0369a1"}}/><span style={{fontSize:12,fontWeight:ds.active?700:500,color:ds.active?"#0369a1":"#94a3b8"}}>{DAY_LABELS_FULL[i]}</span></label>
            {ds.active&&<div style={{display:"flex",alignItems:"center",gap:6,flex:1,flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:110}}><div style={{fontSize:9,fontWeight:700,color:"#64748b",textTransform:"uppercase",marginBottom:2}}>Start (PHT)</div><select value={ds.start} onChange={function(e){setDayStart(key,parseInt(e.target.value));}} style={selSt}>{ALL_SLOTS.slice(0,48).map(function(o){return<option key={o.value} value={o.value}>{o.label}</option>;})}</select></div>
              <div style={{fontSize:11,color:"#94a3b8",fontWeight:700,paddingTop:14}}>→</div>
              <div style={{flex:1,minWidth:110}}><div style={{fontSize:9,fontWeight:700,color:"#64748b",textTransform:"uppercase",marginBottom:2}}>End (PHT)</div><select value={ds.end} onChange={function(e){setDayEnd(key,parseInt(e.target.value));}} style={selSt}>{ALL_SLOTS.filter(function(o){return o.value>ds.start;}).map(function(o){return<option key={o.value} value={o.value}>{o.label}</option>;})}</select></div>
              <div style={{fontSize:10,color:"#64748b",paddingTop:14,flexShrink:0}}>{(function(){var mins=(ds.end-ds.start)*30;var h=Math.floor(mins/60);var m=mins%60;return h+"h"+(m>0?" "+m+"m":"");})()}</div>
            </div>}
            {!ds.active&&<span style={{fontSize:11,color:"#94a3b8",fontStyle:"italic"}}>Day off</span>}
          </div>
        </div>;})}
      </div>
      <div style={{marginTop:10,background:"#e0f2fe",borderRadius:6,padding:"6px 10px",fontSize:10,color:"#0369a1"}}>💡 SLA timers will only count down during your scheduled hours in Philippine Time.</div>
    </div>}
  </div>;
}

// ── Ticket Chat ───────────────────────────────────────────────────────────────
function TicketChat(p){
  var ticketId=p.ticketId;var curUser=p.curUser;var users=p.users;var ticket=p.ticket;
  var[msgs,setMsgs]=useState([]);var[text,setText]=useState("");var[sending,setSending]=useState(false);
  var bottomRef=useRef(null);
  useEffect(function(){
    dbGetChats(ticketId).then(function(data){setMsgs(data);});
    var sub=supabase.channel("chat-"+ticketId).on("postgres_changes",{event:"INSERT",schema:"public",table:"ticket_chats",filter:"ticket_id=eq."+ticketId},function(payload){setMsgs(function(prev){if(prev.find(function(m){return m.id===payload.new.id;}))return prev;return prev.concat([payload.new]);});}).subscribe();
    return function(){supabase.removeChannel(sub);};
  },[ticketId]);
  useEffect(function(){if(bottomRef.current)bottomRef.current.scrollIntoView({behavior:"smooth"});},[msgs]);
  async function send(){
    var trimmed=text.trim();if(!trimmed||sending)return;setSending(true);
    var msg={id:uid(),ticket_id:ticketId,user_id:curUser.id,message:trimmed,created_at:new Date().toISOString()};
    setMsgs(function(prev){return prev.concat([msg]);});setText("");setSending(false);
    await dbSaveChat(msg);
    // Notify involved users by email (exclude sender)
    if(ticket){
      var emails=getTicketEmails(ticket,users).filter(function(e){
        var sender=users.find(function(u){return u.id===curUser.id;});
        return !sender||e!==sender.email;
      });
      var subj="💬 New Chat Message — "+ticket.title;
      var body="A new chat message was posted on ticket #"+ticket.id.slice(-8)+".\n\nTicket: "+ticket.title+"\nFrom: "+curUser.name+"\n\nMessage:\n"+trimmed+"\n\nLog in to Hoptix to view the full conversation.";
      notifyUsers(emails,subj,body);
    }
  }
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
        <div style={{flex:1,background:"#f8fafc",borderRadius:8,padding:10,marginBottom:4}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,flexWrap:"wrap",gap:4}}><Badge label={h.status} color={STATUS_META[h.status]?.color||"#6366f1"}/><span style={{fontSize:10,color:"#94a3b8"}}>{fdt(h.timestamp)}</span></div>
          <div style={{fontSize:11,color:"#64748b"}}>Assigned: <strong>{fu(h.assignedTo)?.name||"Unassigned"}</strong></div>
          <div style={{fontSize:11,color:"#475569"}}>By: {fu(h.changedBy)?.name||"System"}</div>
          {h.durationMins!=null&&<div style={{fontSize:11,color:"#8b5cf6",marginTop:3}}>⏱ Time in status: <strong>{fmtDuration(h.durationMins)}</strong></div>}
          {h.note&&<div style={{fontSize:11,color:"#334155",marginTop:4,fontStyle:"italic"}}>{h.note}</div>}
        </div>
      </div>;}
      if(ev.type==="email"){var m=ev.data;var isReply=m.isExternal||m.status==="received";var sender=isReply?(m.fromName||m.fromEmail):(fu(m.from)?.name||curUser.name);return<div key={i} style={{display:"flex",gap:10,marginBottom:12}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0}}><div style={{width:30,height:30,borderRadius:8,background:"#e0f2fe",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>{isReply?"📬":"📧"}</div>{i<events.length-1&&<div style={{width:2,flex:1,background:"#e2e8f0",marginTop:4,minHeight:12}}/>}</div>
        <div style={{flex:1,background:isReply?"#f0fdf4":"#f0f9ff",borderRadius:8,padding:10,marginBottom:4,border:"1px solid "+(isReply?"#bbf7d0":"#bae6fd")}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4,flexWrap:"wrap",gap:4}}><span style={{fontSize:12,fontWeight:700,color:isReply?"#166534":"#0369a1"}}>{isReply?"📬 Reply":"📧 Sent"}</span><span style={{fontSize:10,color:"#94a3b8"}}>{fdt(m.timestamp)}</span></div><div style={{fontSize:11,color:"#64748b",marginBottom:2}}>From: <strong>{sender}</strong></div>{m.cc&&<div style={{fontSize:11,color:"#64748b",marginBottom:2}}>CC: {m.cc}</div>}<div style={{fontSize:11,color:"#64748b",marginBottom:4}}>Subj: {m.subject}</div><div style={{fontSize:12,color:"#334155",background:"rgba(255,255,255,.6)",borderRadius:6,padding:"6px 8px",maxHeight:50,overflow:"hidden"}}>{m.body?.slice(0,100)}{m.body?.length>100?"…":""}</div></div>
      </div>;}
      if(ev.type==="chat"){var cm=ev.data;var csender=fu(cm.user_id);var isMe=cm.user_id===curUser.id;return<div key={i} style={{display:"flex",gap:10,marginBottom:12}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0}}><div style={{width:30,height:30,borderRadius:8,background:"#eef2ff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>💬</div>{i<events.length-1&&<div style={{width:2,flex:1,background:"#e2e8f0",marginTop:4,minHeight:12}}/>}</div>
        <div style={{flex:1,background:isMe?"#eef2ff":"#f8fafc",borderRadius:8,padding:10,marginBottom:4,border:"1px solid "+(isMe?"#c7d2fe":"#e2e8f0")}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4,flexWrap:"wrap",gap:4}}><span style={{fontSize:12,fontWeight:700,color:isMe?"#4338ca":"#334155"}}>💬 {isMe?"You":csender?.name||"Unknown"}</span><span style={{fontSize:10,color:"#94a3b8"}}>{fdt(cm.created_at)}</span></div><div style={{fontSize:13,color:"#334155"}}>{cm.message}</div></div>
      </div>;}
      return null;
    })}
  </div>;
}// ── Login ─────────────────────────────────────────────────────────────────────
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
  async function doSignup(e){
    e.preventDefault();setSigErr("");
    if(!sigName.trim()){setSigErr("Full name is required.");return;}
    if(!sigEmail.trim()){setSigErr("Email is required.");return;}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sigEmail.trim())){setSigErr("Enter a valid email.");return;}
    if(users.find(function(u){return u.email.toLowerCase()===sigEmail.toLowerCase().trim();})){setSigErr("An account with this email already exists.");return;}
    if(sigPass.length<8){setSigErr("Password must be at least 8 characters.");return;}
    if(sigPass!==sigConf){setSigErr("Passwords do not match.");return;}
    setLoading(true);
    var nu={id:uid(),name:sigName.trim(),email:sigEmail.trim().toLowerCase(),role:"end_user",companyId:companies&&companies[0]?companies[0].id:"",phone:sigPhone.trim(),dept:sigDept.trim(),active:false,createdAt:new Date().toISOString(),lastLogin:null};
    await dbSaveUser(nu);await dbSetPassword(nu.id,sigPass);
    setUsers(function(prev){return prev.concat([nu]);});
    notifyAdmin("🆕 New User Signup — Pending Approval","A new user has registered on Hoptix and is awaiting your approval.\n\nName: "+sigName.trim()+"\nEmail: "+sigEmail.trim()+"\nPhone: "+(sigPhone.trim()||"—")+"\nDepartment: "+(sigDept.trim()||"—")+"\nRegistered At: "+new Date().toLocaleString("en-US",{timeZone:"Asia/Manila"})+" PHT\n\nLog in to the Hoptix admin panel → Users page to approve or reject this account.");
    setLoading(false);setView("pending");
  }
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
          <FInput label="Phone" type="tel" value={sigPhone} onChange={function(e){setSigPhone(e.target.value);}} placeholder="+1-555-0100"/>
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

// ── Profile Modal ─────────────────────────────────────────────────────────────
function ProfileModal(p){
  var curUser=p.curUser;var setUsers=p.setUsers;var setCurUser=p.setCurUser;var showToast=p.showToast;var addLog=p.addLog;var onClose=p.onClose;
  var schedules=p.schedules||{};var setSchedules=p.setSchedules||function(){};var dbSaveSchedule=p.dbSaveSchedule||function(){};
  var isTechUser=IT_ROLES.includes(curUser.role);
  var[tab,setTab]=useState("profile");var[name,setName]=useState(curUser.name);var[phone,setPhone]=useState(curUser.phone||"");var[dept,setDept]=useState(curUser.dept||"");
  var[curPw,setCurPw]=useState("");var[newPw,setNewPw]=useState("");var[confPw,setConfPw]=useState("");
  var[showC,setShowC]=useState(false);var[showN,setShowN]=useState(false);var[showK,setShowK]=useState(false);
  var[pwErr,setPwErr]=useState("");var[pwOk,setPwOk]=useState("");var[saving,setSaving]=useState(false);
  var inp={width:"100%",padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:14,outline:"none",background:"#f8fafc",boxSizing:"border-box"};
  function handleScheduleChange(userId,sch){setSchedules(function(prev){var n=Object.assign({},prev);if(sch===null){delete n[userId];}else{n[userId]=sch;}return n;});dbSaveSchedule(userId,sch);showToast("✅ Schedule saved!");}
  async function saveProfile(){if(!name.trim()){showToast("Name cannot be empty","error");return;}setSaving(true);var updated=Object.assign({},curUser,{name:name.trim(),phone:phone.trim(),dept:dept.trim()});await dbSaveUser(updated);setUsers(function(prev){return prev.map(function(u){return u.id===curUser.id?updated:u;});});setCurUser(updated);addLog("PROFILE_UPDATED",curUser.id,curUser.name+" updated profile");showToast("✅ Profile updated!");setSaving(false);onClose();}
  async function changePw(){setPwErr("");setPwOk("");if(!curPw){setPwErr("Enter your current password.");return;}var existingPw=await dbGetPassword(curUser.id);if(curPw!==existingPw){setPwErr("Current password is incorrect.");return;}if(newPw.length<8){setPwErr("Min 8 characters.");return;}if(newPw!==confPw){setPwErr("Passwords do not match.");return;}if(newPw===curPw){setPwErr("Must differ from current.");return;}setSaving(true);await dbSetPassword(curUser.id,newPw);addLog("PASSWORD_CHANGED",curUser.id,curUser.name+" changed password");setSaving(false);setCurPw("");setNewPw("");setConfPw("");setPwOk("✅ Password changed!");showToast("Password updated!");onClose();}
  var tabs=["profile","password"];if(isTechUser)tabs.push("schedule");
  var tabIcons={profile:"👤 Profile",password:"🔑 Password",schedule:"🗓 Schedule"};
  return<Modal title="My Profile" onClose={onClose} wide={isTechUser&&tab==="schedule"}>
    <div style={{display:"flex",alignItems:"center",gap:14,padding:"0 0 16px",borderBottom:"1px solid #e2e8f0",marginBottom:16}}>
      <div style={{width:56,height:56,borderRadius:"50%",background:avCol(curUser.id),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:20,fontWeight:800}}>{inits(curUser.name)}</div>
      <div><div style={{fontWeight:700,fontSize:15}}>{curUser.name}</div><div style={{fontSize:12,color:"#64748b"}}>{curUser.email}</div><div style={{marginTop:4}}><Badge label={ROLE_META[curUser.role]?.label||curUser.role} color={ROLE_META[curUser.role]?.color||"#6366f1"}/></div></div>
    </div>
    <div style={{display:"flex",gap:6,marginBottom:16}}>{tabs.map(function(t){return<button key={t} onClick={function(){setTab(t);}} style={{flex:1,background:tab===t?"#6366f1":"#f1f5f9",color:tab===t?"#fff":"#475569",border:"none",borderRadius:8,padding:"8px",cursor:"pointer",fontSize:12,fontWeight:700}}>{tabIcons[t]}</button>;})}</div>
    {tab==="profile"&&<div>
      <FInput label="Full Name" value={name} onChange={function(e){setName(e.target.value);}}/>
      <div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Email</label><input value={curUser.email} disabled style={Object.assign({},inp,{background:"#f1f5f9",color:"#94a3b8"})}/></div>
      <FInput label="Phone" value={phone} onChange={function(e){setPhone(e.target.value);}}/>
      <FInput label="Department" value={dept} onChange={function(e){setDept(e.target.value);}}/>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={saveProfile} disabled={saving}>{saving?"⏳ Saving…":"💾 Save"}</Btn></div>
    </div>}
    {tab==="password"&&<div>
      <div style={{position:"relative",marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Current Password</label><input type={showC?"text":"password"} value={curPw} onChange={function(e){setCurPw(e.target.value);}} placeholder="••••••••" style={Object.assign({},inp,{paddingRight:44})}/><button type="button" onClick={function(){setShowC(!showC);}} style={{position:"absolute",right:12,top:34,background:"none",border:"none",cursor:"pointer",fontSize:16,color:"#94a3b8"}}>{showC?"🙈":"👁️"}</button></div>
      <div style={{position:"relative",marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>New Password</label><input type={showN?"text":"password"} value={newPw} onChange={function(e){setNewPw(e.target.value);}} placeholder="Min 8 characters" style={Object.assign({},inp,{paddingRight:44})}/><button type="button" onClick={function(){setShowN(!showN);}} style={{position:"absolute",right:12,top:34,background:"none",border:"none",cursor:"pointer",fontSize:16,color:"#94a3b8"}}>{showN?"🙈":"👁️"}</button></div>
      <div style={{position:"relative",marginBottom:16}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Confirm New Password</label><input type={showK?"text":"password"} value={confPw} onChange={function(e){setConfPw(e.target.value);}} placeholder="Repeat" style={Object.assign({},inp,{paddingRight:44})}/><button type="button" onClick={function(){setShowK(!showK);}} style={{position:"absolute",right:12,top:34,background:"none",border:"none",cursor:"pointer",fontSize:16,color:"#94a3b8"}}>{showK?"🙈":"👁️"}</button></div>
      {pwErr&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:14,color:"#dc2626",fontSize:13}}>⚠️ {pwErr}</div>}
      {pwOk&&<div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"10px 14px",marginBottom:14,color:"#166534",fontSize:13}}>{pwOk}</div>}
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={changePw} disabled={saving}>{saving?"⏳ Saving…":"🔑 Change"}</Btn></div>
    </div>}
    {tab==="schedule"&&isTechUser&&<div>
      <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#92400e"}}>⚠️ Your work schedule determines when SLA timers count against your tickets.</div>
      <ScheduleEditor userId={curUser.id} schedules={schedules} onChange={handleScheduleChange}/>
    </div>}
  </Modal>;
}

// ── Team Chat Page ─────────────────────────────────────────────────────────────
function PageTeamChat(p){
  var curUser=p.curUser;var users=p.users;var isAdmin=p.isAdmin;var isMobile=p.isMobile;
  var[groups,setGroups]=useState([]);
  var[selGroup,setSelGroup]=useState(null);
  var[msgs,setMsgs]=useState([]);
  var[text,setText]=useState("");
  var[sending,setSending]=useState(false);
  var[showNewGroup,setShowNewGroup]=useState(false);
  var[newGroupName,setNewGroupName]=useState("");
  var[newGroupMembers,setNewGroupMembers]=useState([]);
  var[showGroupList,setShowGroupList]=useState(true);
  var bottomRef=useRef(null);
  var channelRef=useRef(null);

  // Load custom groups only
  useEffect(function(){
    dbGetTeamGroups().then(function(data){setGroups(data);});
  },[]);

  // Admin sees all groups; others only see groups they are members of
  function isMember(group){
    if(curUser.role==="admin")return true;
    var ids=group.memberIds||[];
    return ids.includes(curUser.id);
  }

  var visibleGroups=groups.filter(function(g){return isMember(g);});

  // Load messages when group changes + real-time
  useEffect(function(){
    if(!selGroup){setMsgs([]);return;}
    dbGetTeamChats(selGroup.id).then(function(data){setMsgs(data);});
    if(channelRef.current)supabase.removeChannel(channelRef.current);
    var sub=supabase.channel("team-chat-"+selGroup.id)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"team_chats",filter:"group_id=eq."+selGroup.id},function(payload){
        setMsgs(function(prev){if(prev.find(function(m){return m.id===payload.new.id;}))return prev;return prev.concat([payload.new]);});
      }).subscribe();
    channelRef.current=sub;
    return function(){supabase.removeChannel(sub);};
  },[selGroup?.id]);

  useEffect(function(){if(bottomRef.current)bottomRef.current.scrollIntoView({behavior:"smooth"});},[msgs]);

  async function sendMsg(){
    var trimmed=text.trim();if(!trimmed||sending||!selGroup)return;setSending(true);
    var msg={id:uid(),group_id:selGroup.id,user_id:curUser.id,message:trimmed,created_at:new Date().toISOString()};
    setMsgs(function(prev){return prev.concat([msg]);});setText("");setSending(false);
    await dbSaveTeamChat(msg);
  }

  async function createGroup(){
    if(!newGroupName.trim()||newGroupMembers.length===0){return;}
    var g={id:uid(),name:newGroupName.trim(),type:"custom",roleFilter:null,memberIds:newGroupMembers,createdBy:curUser.id,created_at:new Date().toISOString()};
    await dbSaveTeamGroup(g);
    setGroups(function(prev){return prev.concat([g]);});
    setNewGroupName("");setNewGroupMembers([]);setShowNewGroup(false);
  }

  async function deleteGroup(gid){
    await dbDeleteTeamGroup(gid);
    setGroups(function(prev){return prev.filter(function(g){return g.id!==gid;});});
    if(selGroup&&selGroup.id===gid)setSelGroup(null);
  }

  function fu(id){return users.find(function(u){return u.id===id;});}

  function GroupList(){
    return<div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"14px 16px",borderBottom:"1px solid #e2e8f0",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
        <div style={{fontWeight:800,fontSize:14,color:"#1e293b"}}>💬 Team Chat</div>
        {isAdmin&&<Btn size="sm" onClick={function(){setShowNewGroup(true);}}>➕ Group</Btn>}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:8}}>
        {visibleGroups.length===0&&<div style={{textAlign:"center",padding:"32px 16px",color:"#94a3b8",fontSize:12}}>{isAdmin?"No groups yet — click ➕ to create one.":"No groups available. Ask an admin."}</div>}
        {visibleGroups.map(function(g){var active=selGroup&&selGroup.id===g.id;var mc=(g.memberIds||[]).length;return<div key={g.id} onClick={function(){setSelGroup(g);if(isMobile)setShowGroupList(false);}} style={{padding:"10px 12px",borderRadius:10,cursor:"pointer",background:active?"#eef2ff":"transparent",border:"1px solid "+(active?"#c7d2fe":"transparent"),marginBottom:4,display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,borderRadius:10,background:active?"#6366f1":avCol(g.id),display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0,color:"#fff"}}>💬</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontWeight:600,fontSize:13,color:active?"#4338ca":"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.name}</div>
            <div style={{fontSize:10,color:"#94a3b8"}}>{mc} member{mc!==1?"s":""}</div>
          </div>
          {isAdmin&&<button onClick={function(e){e.stopPropagation();deleteGroup(g.id);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ef4444",fontSize:14,padding:4,flexShrink:0,lineHeight:1}}>🗑</button>}
        </div>;})}
      </div>
    </div>;
  }

  function ChatArea(){
    if(!selGroup)return<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:"#94a3b8"}}>
      <div style={{fontSize:48}}>💬</div>
      <div style={{fontSize:14,fontWeight:600}}>Select a group to start chatting</div>
      <div style={{fontSize:12}}>Choose from the {isMobile?"list above":"list on the left"}</div>
    </div>;

    return<div style={{flex:1,display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
      <div style={{padding:"12px 16px",borderBottom:"1px solid #e2e8f0",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
        {isMobile&&<button onClick={function(){setShowGroupList(true);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,padding:0,color:"#64748b"}}>←</button>}
        <div style={{width:32,height:32,borderRadius:8,background:avCol(selGroup.id),display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,color:"#fff"}}>💬</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:700,fontSize:14,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{selGroup.name}</div>
          <div style={{fontSize:10,color:"#94a3b8"}}>{(selGroup.memberIds||[]).length} members</div>
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"12px 16px",WebkitOverflowScrolling:"touch"}}>
        {msgs.length===0&&<div style={{textAlign:"center",padding:"40px 0",color:"#94a3b8"}}><div style={{fontSize:32,marginBottom:8}}>💬</div><div style={{fontSize:13,fontWeight:600}}>No messages yet</div><div style={{fontSize:11,marginTop:4}}>Be the first to say something!</div></div>}
        {msgs.map(function(msg,i){
          var sender=fu(msg.user_id);var isMe=msg.user_id===curUser.id;
          var showAvatar=i===0||msgs[i-1].user_id!==msg.user_id;
          var showDate=i===0||new Date(msgs[i].created_at).toDateString()!==new Date(msgs[i-1].created_at).toDateString();
          return<div key={msg.id}>
            {showDate&&<div style={{textAlign:"center",margin:"12px 0 8px"}}><span style={{background:"#f1f5f9",color:"#94a3b8",fontSize:10,fontWeight:600,borderRadius:6,padding:"3px 10px"}}>{new Date(msg.created_at).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}</span></div>}
            <div style={{display:"flex",flexDirection:isMe?"row-reverse":"row",gap:8,marginBottom:showAvatar?10:3,alignItems:"flex-end"}}>
              <div style={{width:28,flexShrink:0}}>{showAvatar&&<Avatar name={sender?sender.name:"?"} id={msg.user_id} size={28}/>}</div>
              <div style={{maxWidth:"70%"}}>
                {showAvatar&&<div style={{fontSize:10,fontWeight:700,color:"#64748b",marginBottom:3,textAlign:isMe?"right":"left"}}>{isMe?"You":sender?sender.name:"Unknown"}{sender&&sender.role&&<span style={{color:ROLE_META[sender.role]?.color||"#94a3b8"}}> · {ROLE_META[sender.role]?.label||sender.role}</span>} · {ago(msg.created_at)}</div>}
                <div style={{background:isMe?"#6366f1":"#f1f5f9",color:isMe?"#fff":"#1e293b",borderRadius:isMe?"16px 16px 4px 16px":"16px 16px 16px 4px",padding:"10px 14px",fontSize:13,lineHeight:1.5,wordBreak:"break-word"}}>{msg.message}</div>
              </div>
            </div>
          </div>;
        })}
        <div ref={bottomRef}/>
      </div>
      <div style={{padding:"10px 16px",borderTop:"1px solid #e2e8f0",display:"flex",gap:8,alignItems:"flex-end",flexShrink:0}}>
        <textarea value={text} onChange={function(e){setText(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMsg();}}} placeholder={"Message "+selGroup.name+"…"} rows={2} style={{flex:1,padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:10,fontSize:14,outline:"none",resize:"none",background:"#f8fafc",boxSizing:"border-box"}}/>
        <button onClick={sendMsg} disabled={sending||!text.trim()} style={{padding:"12px 18px",background:sending||!text.trim()?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:10,fontWeight:700,fontSize:14,cursor:sending||!text.trim()?"not-allowed":"pointer",flexShrink:0,minHeight:46}}>Send</button>
      </div>
    </div>;
  }

  return<div style={{height:"calc(100vh - 120px)",display:"flex",gap:0,background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",overflow:"hidden"}}>
    {(!isMobile||showGroupList)&&<div style={{width:isMobile?"100%":260,borderRight:isMobile?"none":"1px solid #e2e8f0",flexShrink:0,display:"flex",flexDirection:"column",height:"100%"}}><GroupList/></div>}
    {(!isMobile||!showGroupList)&&<div style={{flex:1,display:"flex",flexDirection:"column",height:"100%",minWidth:0}}><ChatArea/></div>}
    {showNewGroup&&<Modal title="➕ New Group" onClose={function(){setShowNewGroup(false);}}>
      <FInput label="Group Name *" value={newGroupName} onChange={function(e){setNewGroupName(e.target.value);}} placeholder="e.g. Project Alpha"/>
      <div style={{marginBottom:14}}>
        <label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:8}}>Members (pick at least 1)</label>
        <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:240,overflowY:"auto",border:"1px solid #e2e8f0",borderRadius:8,padding:8}}>
          {users.filter(function(u){return u.active&&u.id!==curUser.id;}).map(function(u){var checked=newGroupMembers.includes(u.id);return<label key={u.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",borderRadius:8,background:checked?"#eef2ff":"transparent",cursor:"pointer"}}>
            <input type="checkbox" checked={checked} onChange={function(){setNewGroupMembers(function(prev){return checked?prev.filter(function(id){return id!==u.id;}):prev.concat([u.id]);});}} style={{accentColor:"#6366f1"}}/>
            <Avatar name={u.name} id={u.id} size={22}/>
            <div style={{flex:1}}><div style={{fontSize:12,fontWeight:600,color:"#1e293b"}}>{u.name}</div><div style={{fontSize:10,color:"#94a3b8"}}>{ROLE_META[u.role]?.label||u.role}</div></div>
          </label>;})}
        </div>
        <div style={{fontSize:11,color:"#64748b",marginTop:6}}>{newGroupMembers.length} member{newGroupMembers.length!==1?"s":""} selected</div>
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setShowNewGroup(false);}}>Cancel</Btn><Btn onClick={createGroup}>Create Group</Btn></div>
    </Modal>}
  </div>;
}

// ── Root App ──────────────────────────────────────────────────────────────────
export default function App(){
  var[users,setUsers]=useState([]);var[companies,setCompanies]=useState([]);var[clients,setClients]=useState([]);
  var[tickets,setTicketsR]=useState([]);var[ticketTypes,setTTR]=useState([]);
  var[statusSla,setStatusSlaR]=useState(DEFAULT_STATUS_SLA);var[schedules,setSchedulesR]=useState({});
  var[logs,setLogsR]=useState([]);var[emailTemplates,setEmailTemplates]=useState([]);
  var[allTimeSessions,setAllTimeSessions]=useState([]);
  var[curUser,setCurUserR]=useState(function(){return loadState("hd_curUser",null);});
  var[page,setPageR]=useState(function(){try{var s=localStorage.getItem("hd_page");var safe=["dashboard","tickets","new_ticket","time_tracking","reports","users","companies","clients","ticket_types","activity_log","integrations","team_chat"];return(s&&safe.includes(s))?s:"dashboard";}catch(e){return"dashboard";}});
  var[selTicket,setSelTicket]=useState(null);var[toast,setToast]=useState(null);
  var[breaches,setBreaches]=useState([]);var[inboxAlerts,setInboxAlerts]=useState([]);
  var[showProfile,setShowProfile]=useState(false);var[loading,setLoading]=useState(true);
  var[sidebarOpen,setSidebarOpen]=useState(false);
  var[notifications,setNotifications]=useState([]);
  var prevBreachIdsRef=useRef([]);
  var isMobile=useIsMobile();

  useEffect(function(){
    async function loadAll(){
      setLoading(true);
      var[u,co,cl,tt,tkt,lg,sch,et,ts]=await Promise.all([dbGetUsers(),dbGetCompanies(),dbGetClients(),dbGetTicketTypes(),dbGetTickets(),dbGetLogs(),dbGetSchedules(),dbGetEmailTemplates(),dbGetAllTimeSessions()]);
      setUsers(u);setCompanies(co);setClients(cl);setTTR(tt);setTicketsR(tkt);setLogsR(lg);setSchedulesR(sch);setEmailTemplates(et);setAllTimeSessions(ts);
      setLoading(false);
    }
    loadAll();
  },[]);

  // Load notifications when user logs in
  useEffect(function(){
    if(!curUser)return;
    dbGetNotifications(curUser.id).then(function(data){setNotifications(data);});
    var sub=supabase.channel("notifs-"+curUser.id)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"app_notifications",filter:"user_id=eq."+curUser.id},function(payload){
        setNotifications(function(prev){if(prev.find(function(n){return n.id===payload.new.id;}))return prev;return[payload.new].concat(prev);});
      }).subscribe();
    return function(){supabase.removeChannel(sub);};
  },[curUser?.id]);

  // Update browser tab title with separate SLA breach + unread notification counts
  var unreadCount=useMemo(function(){return notifications.filter(function(n){return !n.read;}).length;},[notifications]);
  useEffect(function(){
    var parts=[];
    if(breaches.length>0)parts.push("\uD83D\uDEA8"+breaches.length);
    if(unreadCount>0)parts.push("\uD83D\uDD14"+unreadCount);
    document.title=parts.length>0?"("+parts.join(" | ")+") Hoptix":"Hoptix";
  },[unreadCount,breaches]);

  var refreshTimeSessions=useCallback(async function(){
    var ts=await dbGetAllTimeSessions();setAllTimeSessions(ts);
  },[]);

  useEffect(function(){
    var sub=supabase.channel('tickets-changes')
      .on('postgres_changes',{event:'*',schema:'public',table:'tickets'},function(){dbGetTickets().then(function(t){setTicketsR(t);});})
      .on('postgres_changes',{event:'*',schema:'public',table:'users'},function(){dbGetUsers().then(function(u){setUsers(u);});})
      .on('postgres_changes',{event:'*',schema:'public',table:'time_sessions'},function(){dbGetAllTimeSessions().then(function(ts){setAllTimeSessions(ts);});})
      .subscribe();
    return function(){supabase.removeChannel(sub);};
  },[]);

  async function setTickets(updater){var prev=tickets;var next=typeof updater==="function"?updater(prev):updater;setTicketsR(next);var changed=next.filter(function(t){var old=prev.find(function(p){return p.id===t.id;});return !old||JSON.stringify(old)!==JSON.stringify(t);});for(var i=0;i<changed.length;i++){await dbSaveTicket(changed[i]);}}
  function setCurUser(u){if(u)saveState("hd_curUser",u);else clearAuth();setCurUserR(u);}
  function setPage(v){saveState("hd_page",v);setPageR(v);setSidebarOpen(false);}
  var addLog=useCallback(function(action,target,detail,uId){var entry={id:uid(),action,userId:uId||curUser?.id,target,detail,timestamp:new Date().toISOString()};setLogsR(function(p){return[entry].concat(p).slice(0,500);});dbAddLog(entry);},[curUser]);
  var showToast=useCallback(function(msg,type){setToast({msg,type:type||"ok"});setTimeout(function(){setToast(null);},3500);},[]);

  // SLA breach checking + email notifications on new breaches
  useEffect(function(){
    function check(){
      var newBreaches=tickets.filter(function(t){if(t.deleted||t.status==="Closed")return false;var s=getStatusSla(t,statusSla,schedules);return s&&s.breached;});
      setBreaches(newBreaches);
      // Notify on newly detected breaches
      if(curUser){
        newBreaches.forEach(function(t){
          if(!prevBreachIdsRef.current.includes(t.id)){
            var emails=getTicketEmails(t,users);
            var subj="🚨 SLA Breach — "+t.title;
            var body="A ticket has exceeded its SLA time limit.\n\nTicket: "+t.title+"\nStatus: "+t.status+"\nAssigned To: "+(users.find(function(u){return u.id===t.assignedTo;})?.name||"Unassigned")+"\n\nPlease attend to this ticket immediately.";
            notifyUsers(emails,subj,body);
            createNotificationsForTicket(t,users,"SLA breach on ticket: "+t.title,"sla",null);
          }
        });
        prevBreachIdsRef.current=newBreaches.map(function(t){return t.id;});
      }
    }
    check();var iv=setInterval(check,30000);return function(){clearInterval(iv);};},[tickets,statusSla,schedules,users,curUser]);

  useEffect(function(){
    if(!curUser)return;
    async function fetchReplies(){try{var res=await fetch("/api/fetch-replies");if(!res.ok)return;var data=await res.json();if(!data.replies||!data.replies.length)return;var updated=tickets.slice();data.replies.forEach(function(reply){var idx=updated.findIndex(function(t){return t.id===reply.ticketId;});if(idx<0)return;var ticket=updated[idx];var dupId="reply_"+reply.uid;if((ticket.conversations||[]).some(function(c){return c.id===dupId;}))return;var msg={id:dupId,from:null,fromEmail:reply.fromEmail,fromName:reply.fromName,to:[],toEmails:[],cc:[],subject:reply.subject,body:reply.body.trim(),timestamp:reply.timestamp,isExternal:true,status:"received"};updated[idx]=Object.assign({},ticket,{conversations:(ticket.conversations||[]).concat([msg]),hasUnreadReply:true});});setTickets(function(){return updated;});setInboxAlerts(function(prev){return prev.concat(data.replies);});showToast("📬 "+data.replies.length+" new email repl"+(data.replies.length>1?"ies":"y")+" received!");}catch(e){}}
    fetchReplies();var iv=setInterval(fetchReplies,60000);return function(){clearInterval(iv);};
  },[curUser]);

  async function handleMarkNotificationsRead(){
    if(!curUser)return;
    await dbMarkNotificationsRead(curUser.id);
    setNotifications(function(prev){return prev.map(function(n){return Object.assign({},n,{read:true});});});
  }

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
    {id:"team_chat",icon:"💬",label:"Team Chat"},
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
      {isMobile&&sidebarOpen&&<div style={{position:"fixed",inset:0,zIndex:8888,display:"flex"}}><div style={{position:"absolute",inset:0,background:"rgba(0,0,0,.5)"}} onClick={function(){setSidebarOpen(false);}}/><div style={{position:"relative",zIndex:1,width:260,height:"100%"}}>{sidebar}</div></div>}
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
            <NotificationBell notifications={notifications} onMarkRead={handleMarkNotificationsRead} onGoTicket={function(ticketId){setSelTicket(ticketId);}}/>
            <button onClick={function(){setShowProfile(true);}} style={{display:"flex",alignItems:"center",gap:6,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"5px 10px 5px 5px",cursor:"pointer"}}><Avatar name={curUser.name} id={curUser.id} size={26}/>{!isMobile&&<div style={{textAlign:"left"}}><div style={{fontWeight:700,fontSize:11}}>{curUser.name}</div><div style={{fontSize:10,color:"#94a3b8"}}>{ROLE_META[curUser.role]?.label||curUser.role}</div></div>}<span style={{fontSize:10,color:"#94a3b8"}}>▼</span></button>
          </div>
        </div>
        {toast&&<div style={{position:"fixed",top:isMobile?70:20,right:12,left:isMobile?12:"auto",zIndex:10000,background:toast.type==="error"?"#ef4444":toast.type==="warn"?"#f59e0b":"#10b981",color:"#fff",padding:"10px 16px",borderRadius:10,fontWeight:600,fontSize:13,boxShadow:"0 4px 20px rgba(0,0,0,.2)",textAlign:"center"}}>{toast.msg}</div>}
        <div style={{flex:1,overflowY:"auto",padding:isMobile?"12px":"24px",paddingBottom:isMobile?"80px":"24px",WebkitOverflowScrolling:"touch"}}>
          {page==="dashboard"    &&<PageDashboard   tickets={visible} allTickets={allNonDeleted} users={users} ticketTypes={ticketTypes} companies={companies} clients={clients} setPage={setPage} setSelTicket={setSelTicket} breaches={breaches} isMobile={isMobile} allTimeSessions={allTimeSessions}/>}
          {page==="tickets"      &&<PageTickets     tickets={visible} users={users} companies={companies} clients={clients} ticketTypes={ticketTypes} curUser={curUser} setTickets={setTickets} addLog={addLog} showToast={showToast} setSelTicket={setSelTicket} setPage={setPage} isAdmin={isAdmin} statusSla={statusSla} schedules={schedules} isMobile={isMobile}/>}
          {page==="new_ticket"   &&<PageNewTicket   users={users} companies={companies} clients={clients} ticketTypes={ticketTypes} curUser={curUser} setTickets={setTickets} addLog={addLog} showToast={showToast} setPage={setPage} setSelTicket={setSelTicket} allTimeSessions={allTimeSessions}/>}
          {page==="time_tracking"&&<PageTimeTracking tickets={visible} users={users} ticketTypes={ticketTypes} curUser={curUser} isAdmin={isAdmin} isTech={isTech} setSelTicket={setSelTicket} isMobile={isMobile} allTimeSessions={allTimeSessions}/>}
          {page==="team_chat"    &&<PageTeamChat    curUser={curUser} users={users} isAdmin={isAdmin} isMobile={isMobile}/>}
          {page==="reports"      &&<PageReports     tickets={visible} users={users} ticketTypes={ticketTypes} companies={companies} clients={clients} statusSla={statusSla} schedules={schedules} allTimeSessions={allTimeSessions}/>}
          {page==="users"        &&<PageUsers       users={users} companies={companies} setUsers={setUsers} curUser={curUser} addLog={addLog} showToast={showToast} schedules={schedules} setSchedules={setSchedulesR} dbSaveUser={dbSaveUser} dbDeleteUser={dbDeleteUser} dbSetPassword={dbSetPassword} dbSaveSchedule={dbSaveSchedule} isMobile={isMobile}/>}
          {page==="companies"    &&<PageCompanies   companies={companies} users={users} setCompanies={setCompanies} addLog={addLog} showToast={showToast} dbSaveCompany={dbSaveCompany} dbDeleteCompany={dbDeleteCompany}/>}
          {page==="clients"      &&<PageClients     clients={clients} setClients={setClients} companies={companies} addLog={addLog} showToast={showToast} dbSaveClient={dbSaveClient} dbDeleteClient={dbDeleteClient}/>}
          {page==="ticket_types" &&<PageTicketTypes ticketTypes={ticketTypes} users={users} setTicketTypes={setTTR} statusSla={statusSla} setStatusSla={setStatusSlaR} addLog={addLog} showToast={showToast} dbSaveTicketType={dbSaveTicketType} dbDeleteTicketType={dbDeleteTicketType}/>}
          {page==="activity_log" &&<PageActivityLog logs={logs} users={users}/>}
          {page==="integrations" &&<PageIntegrations showToast={showToast} addLog={addLog} emailTemplates={emailTemplates} setEmailTemplates={setEmailTemplates} curUser={curUser} isAdmin={isAdmin}/>}
        </div>
        {isMobile&&<div style={{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderTop:"1px solid #e2e8f0",display:"flex",zIndex:8000,boxShadow:"0 -2px 10px rgba(0,0,0,.08)"}}>
          {bottomNav.map(function(n){var active=page===n.id;return<button key={n.id} onClick={function(){setPage(n.id);}} style={{flex:1,background:"none",border:"none",cursor:"pointer",padding:"8px 4px 10px",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}><span style={{fontSize:20}}>{n.icon}</span><span style={{fontSize:9,fontWeight:active?700:500,color:active?"#6366f1":"#94a3b8"}}>{n.label}</span>{active&&<div style={{width:4,height:4,borderRadius:"50%",background:"#6366f1"}}/>}</button>;})}
          <button onClick={function(){setSidebarOpen(true);}} style={{flex:1,background:"none",border:"none",cursor:"pointer",padding:"8px 4px 10px",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}><span style={{fontSize:20}}>☰</span><span style={{fontSize:9,fontWeight:500,color:"#94a3b8"}}>More</span></button>
        </div>}
      </div>
      {selTicket&&<TicketDetail ticket={tickets.find(function(t){return t.id===selTicket;})} tickets={tickets} setTickets={setTickets} users={users} ticketTypes={ticketTypes} companies={companies} clients={clients} curUser={curUser} isAdmin={isAdmin} isTech={isTech} addLog={addLog} showToast={showToast} statusSla={statusSla} schedules={schedules} emailTemplates={emailTemplates} onClose={function(){setSelTicket(null);}} refreshTimeSessions={refreshTimeSessions} allTimeSessions={allTimeSessions}/>}
      {showProfile&&<ProfileModal curUser={curUser} setUsers={setUsers} setCurUser={setCurUser} showToast={showToast} addLog={addLog} schedules={schedules} setSchedules={setSchedulesR} dbSaveSchedule={dbSaveSchedule} onClose={function(){setShowProfile(false);}}/>}
    </div>
  </ErrorBoundary>;
}// ── Dashboard ─────────────────────────────────────────────────────────────────
function PageDashboard(p){
  var tickets=p.tickets;var allTickets=p.allTickets||p.tickets;var users=p.users;var ticketTypes=p.ticketTypes;var setPage=p.setPage;var setSelTicket=p.setSelTicket;var breaches=p.breaches||[];var isMobile=p.isMobile;var allTimeSessions=p.allTimeSessions||[];
  var byStatus=ALL_STATUSES.map(function(s){return{name:s,value:tickets.filter(function(t){return t.status===s;}).length,color:STATUS_META[s].color};});
  var daily=Array.from({length:7},function(_,i){var d=new Date(Date.now()-(6-i)*86400000);return{lbl:d.toLocaleDateString("en",{weekday:"short"}),created:tickets.filter(function(t){return new Date(t.createdAt).toDateString()===d.toDateString();}).length,closed:tickets.filter(function(t){return t.closedAt&&new Date(t.closedAt).toDateString()===d.toDateString();}).length};});
  var techs=users.filter(function(u){return["it_technician","it_manager"].includes(u.role);});
  var byType=ticketTypes.map(function(tt,i){return{name:tt.name,value:tickets.filter(function(t){return t.typeId===tt.id;}).length,fill:PAL[i%PAL.length]};}).filter(function(x){return x.value>0;});
  var totalLoggedMins=allTimeSessions.filter(function(s){return s.ended_at;}).reduce(function(sum,s){return sum+(s.duration_minutes||0);},0);
  return<div>
    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(auto-fill,minmax(150px,1fr))",gap:10,marginBottom:16}}>
      <Stat label="Total" value={tickets.length} icon="🎫" color="#6366f1" help="All active (non-deleted) tickets in the system."/>
      <Stat label="Open" value={tickets.filter(function(t){return t.status==="Open";}).length} icon="📬" color="#f59e0b" help="Submitted but not yet assigned or started."/>
      <Stat label="In Progress" value={tickets.filter(function(t){return t.status==="In Progress";}).length} icon="⚙️" color="#6366f1" help="Currently being worked on by an assigned technician."/>
      <Stat label="Pending" value={tickets.filter(function(t){return t.status==="Pending";}).length} icon="⏳" color="#0ea5e9" help="Awaiting response or action from the requester."/>
      <Stat label="Escalated" value={tickets.filter(function(t){return t.status==="Escalated";}).length} icon="🔺" color="#7c3aed" help="Raised to senior staff."/>
      <Stat label="Closed" value={allTickets.filter(function(t){return t.status==="Closed";}).length} icon="✅" color="#10b981" help="Fully resolved and closed tickets."/>
      <Stat label="IT Hours Logged" value={fmtDuration(totalLoggedMins)} icon="🕐" color="#8b5cf6" sub="actual time worked" help="Real work time logged by IT staff using the Start/Stop timer."/>
    </div>
    <div style={{background:breaches.length>0?"#fef2f2":"#f0fdf4",border:"2px solid "+(breaches.length>0?"#ef4444":"#bbf7d0"),borderRadius:12,padding:14,marginBottom:16}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:breaches.length>0?12:0}}>
        <span style={{fontSize:22}}>{breaches.length>0?"🚨":"✅"}</span>
        <div style={{flex:1}}><div style={{fontWeight:800,color:breaches.length>0?"#dc2626":"#166534",fontSize:14}}>SLA Breach Alerts</div><div style={{fontSize:11,color:breaches.length>0?"#ef4444":"#16a34a",marginTop:2}}>{breaches.length===0?"All active tickets are within their SLA targets — great work!":breaches.length+" ticket"+(breaches.length!==1?"s are":" is")+" past the SLA threshold"}</div></div>
        <div style={{textAlign:"center",background:breaches.length>0?"#fecaca":"#bbf7d0",borderRadius:10,padding:"6px 14px",flexShrink:0}}><div style={{fontSize:26,fontWeight:800,color:breaches.length>0?"#dc2626":"#166534",lineHeight:1}}>{breaches.length}</div><div style={{fontSize:9,color:breaches.length>0?"#dc2626":"#166634",textTransform:"uppercase",fontWeight:700}}>Breached</div></div>
      </div>
      {breaches.length>0&&<div style={{display:"flex",flexDirection:"column",gap:6}}>
        {breaches.slice(0,5).map(function(t){var pri=PRI_META[t.priority]||PRI_META.medium;var asgn=users.find(function(u){return u.id===t.assignedTo;});return<div key={t.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#fff",padding:"10px 12px",borderRadius:8,border:"1px solid #fecaca",gap:8}}>
          <div style={{flex:1,minWidth:0}}><div style={{fontWeight:600,fontSize:12,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div><div style={{display:"flex",gap:6,marginTop:3,flexWrap:"wrap"}}><Badge label={pri.label} color={pri.color} bg={pri.bg}/><Badge label={t.status} color={STATUS_META[t.status]?.color||"#6366f1"}/>{asgn&&<span style={{fontSize:10,color:"#64748b"}}>👤 {asgn.name}</span>}</div></div>
          <Btn size="sm" variant="danger" onClick={function(){setSelTicket(t.id);}}>View →</Btn>
        </div>;})}
        {breaches.length>5&&<div style={{fontSize:11,color:"#ef4444",textAlign:"center",fontWeight:600,padding:"4px 0"}}>+{breaches.length-5} more — check the Tickets page</div>}
      </div>}
    </div>
    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fit,minmax(280px,1fr))",gap:14,marginBottom:14}}>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12,fontSize:13}}>Tickets by Status</div><ResponsiveContainer width="100%" height={180}><PieChart><Pie data={byStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={pieLabel} fontSize={9}>{byStatus.map(function(e,i){return<Cell key={i} fill={e.color}/>;})}</Pie><Tooltip/></PieChart></ResponsiveContainer></Card>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12,fontSize:13}}>7-Day Trend</div><ResponsiveContainer width="100%" height={180}><AreaChart data={daily}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="lbl" tick={{fontSize:9}}/><YAxis tick={{fontSize:9}}/><Tooltip/><Legend wrapperStyle={{fontSize:9}}/><Area type="monotone" dataKey="created" stroke="#6366f1" fill="#eef2ff" name="Created"/><Area type="monotone" dataKey="closed" stroke="#10b981" fill="#d1fae5" name="Closed"/></AreaChart></ResponsiveContainer></Card>
    </div>
    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:14}}>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12,fontSize:13}}>Technician Workload</div>{techs.length===0&&<div style={{color:"#94a3b8",fontSize:12}}>No technicians yet.</div>}{techs.map(function(t){var open=tickets.filter(function(tk){return tk.assignedTo===t.id&&tk.status!=="Closed";}).length;var total=tickets.filter(function(tk){return tk.assignedTo===t.id;}).length;var techMins=allTimeSessions.filter(function(s){return s.user_id===t.id&&s.ended_at;}).reduce(function(sum,s){return sum+(s.duration_minutes||0);},0);return<div key={t.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}><Avatar name={t.name} id={t.id} size={26}/><div style={{flex:1}}><div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontWeight:600}}><span>{t.name}</span><span style={{color:"#6366f1"}}>{open}/{total} · <span style={{color:"#8b5cf6"}}>{fmtDuration(techMins)}</span></span></div><div style={{background:"#e2e8f0",borderRadius:4,height:5,marginTop:4}}><div style={{background:"#6366f1",height:5,borderRadius:4,width:(total?Math.min(100,Math.round(open/total*100)):0)+"%"}}/></div></div></div>;})}</Card>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12,fontSize:13}}>Tickets by Type</div>{byType.length===0&&<div style={{color:"#94a3b8",fontSize:12}}>No tickets yet.</div>}{byType.slice(0,6).map(function(t,i){return<div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid #f1f5f9"}}><span style={{fontSize:12,color:"#475569"}}>{t.name}</span><Badge label={t.value} color={PAL[i%PAL.length]}/></div>;})}</Card>
    </div>
  </div>;
}

// ── New Ticket — stays on page after submit, clears form ──────────────────────
function blankForm(ticketTypes,companies,curUser){
  return{title:"",description:"",typeId:ticketTypes[0]?.id||"",companyId:curUser.companyId||companies[0]?.id||"",clientId:"",locationId:"",externalEmail:"",customTypeName:""};
}
function PageNewTicket(p){
  var users=p.users;var companies=p.companies;var clients=p.clients;var ticketTypes=p.ticketTypes;var curUser=p.curUser;
  var setTickets=p.setTickets;var addLog=p.addLog;var showToast=p.showToast;var setPage=p.setPage;var setSelTicket=p.setSelTicket;
  var[form,setForm]=useState(function(){return blankForm(ticketTypes,companies,curUser);});
  var[startTime,setStartTime]=useState(Date.now());
  var[preview,setPreview]=useState(null);
  var[attachments,setAttachments]=useState([]);

  function fld(k,v){setForm(function(prev){return Object.assign({},prev,{[k]:v});});}
  var selType=ticketTypes.find(function(t){return t.id===form.typeId;});
  var selClient=clients.find(function(c){return c.id===form.clientId;});var availLocs=selClient?selClient.locations:[];
  var ACCEPTED=["image/jpeg","image/png","image/gif","image/webp","video/mp4","video/quicktime","video/webm"];
  function processFiles(files){Array.from(files).forEach(function(file){if(!ACCEPTED.includes(file.type)){showToast("Unsupported: "+file.name,"error");return;}if(file.size>20*1024*1024){showToast(file.name+" > 20MB","error");return;}var r=new FileReader();r.onload=function(e){setAttachments(function(prev){if(prev.length>=10){showToast("Max 10 attachments","error");return prev;}return prev.concat([{id:uid(),name:file.name,type:file.type,size:file.size,dataUrl:e.target.result}]);});};r.readAsDataURL(file);});}
  function removeAtt(id){setAttachments(function(prev){return prev.filter(function(a){return a.id!==id;});});}
  function handlePreview(){
    if(!form.title.trim()||!form.description.trim()){showToast("Fill in title and description","error");return;}
    var assign=aiAssign(form.title,form.description,form.typeId,users,ticketTypes);
    var tt=ticketTypes.find(function(t){return t.id===form.typeId;});
    var now=new Date().toISOString();var sla=new Date(Date.now()+(tt?tt.slaHours:24)*3600000).toISOString();
    var mins=Math.max(0.017,(Date.now()-startTime)/60000);
    var draft=Object.assign({},form,{id:"t"+Date.now(),status:"Open",priority:tt?tt.priority:"medium",submittedBy:curUser.id,assignedTo:assign.id,createdAt:now,updatedAt:now,submittedAt:now,formOpenedAt:new Date(startTime).toISOString(),slaDeadline:sla,slaBreached:false,timeToCreateMins:mins,statusHistory:[{status:"Open",assignedTo:assign.id,timestamp:now,changedBy:curUser.id,note:"Ticket created — "+assign.reason}],statusTimeLog:[{status:"Open",enteredAt:now,exitedAt:null,durationMins:null}],conversations:[],closedAt:null,deleted:false,aiReason:assign.reason,attachments:attachments});
    setPreview({draft:draft,assign:assign});
  }
  function handleSubmit(){
    setTickets(function(prev){return prev.concat([preview.draft]);});
    addLog("TICKET_CREATED",preview.draft.id,"Ticket \""+preview.draft.title+"\" created.");
    var assignedUser=users.find(function(u){return u.id===preview.draft.assignedTo;});
    var tt2=ticketTypes.find(function(t){return t.id===preview.draft.typeId;});
    // Notify all involved users
    var emails=getTicketEmails(preview.draft,users);
    var subjNew="🎫 New Ticket: "+preview.draft.title;
    var bodyNew="A new support ticket has been submitted.\n\nTicket: "+preview.draft.title+"\nType: "+(tt2?tt2.name:"—")+"\nPriority: "+(PRI_META[preview.draft.priority]?.label||preview.draft.priority)+"\nSubmitted By: "+(users.find(function(u){return u.id===preview.draft.submittedBy;})?.name||"Unknown")+"\nAssigned To: "+(assignedUser?assignedUser.name:"Unassigned")+"\n\nDescription:\n"+preview.draft.description.slice(0,300)+(preview.draft.description.length>300?"…":"");
    notifyUsers(emails,subjNew,bodyNew);
    notifyAdmin("🎫 New Ticket Created — "+preview.draft.title,bodyNew);
    createNotificationsForTicket(preview.draft,users,"New ticket submitted: "+preview.draft.title,"ticket",null);
    // Open the new ticket detail immediately
    var newId=preview.draft.id;
    setPreview(null);
    showToast("✅ Ticket submitted!");
    setSelTicket(newId);
  }
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
  var refreshTimeSessions=p.refreshTimeSessions||function(){};
  var allTimeSessions=p.allTimeSessions||[];

  var[tab,setTab]=useState("details");
  var[status,setStatus]=useState(ticket.status);
  var[asgn,setAsgn]=useState(ticket.assignedTo||"");
  var[note,setNote]=useState("");
  var[typeId,setTypeId]=useState(ticket.typeId||"");
  var[showTimerBanner,setShowTimerBanner]=useState(false);
  var forceStopRef=useRef(null);

  var shouldAutoStart=isTech&&ticket.status!=="Closed";

  function handleAutoStarted(){
    setShowTimerBanner(true);
    setTimeout(function(){setShowTimerBanner(false);},8000);
  }

  var[msgTo,setMsgTo]=useState("");var[msgCC,setMsgCC]=useState("");
  var[msgSubj,setMsgSubj]=useState("Re: [#"+ticket.id+"] "+ticket.title);
  var[msgBody,setMsgBody]=useState("");
  var emailTemplates=p.emailTemplates||[];
  var assignedUser=users.find(function(u){return u.id===ticket.assignedTo;});
  function applyTemplate(tid){
    var tmpl=emailTemplates.find(function(t){return t.id===tid;});if(!tmpl)return;
    var cl2=clients.find(function(c){return c.id===ticket.clientId;});
    var body=tmpl.body.replace(/{{client_name}}/g,cl2?cl2.name:"[Client]").replace(/{{agent_name}}/g,assignedUser?assignedUser.name:"[Agent]");
    var subj=tmpl.subject.replace(/{{client_name}}/g,cl2?cl2.name:"[Client]").replace(/{{agent_name}}/g,assignedUser?assignedUser.name:"[Agent]");
    setMsgSubj(subj);setMsgBody(body);
    if(tmpl.defaultCC&&tmpl.defaultCC.trim())setMsgCC(tmpl.defaultCC.trim());
  }
  var[emailSending,setEmailSending]=useState(false);
  function fu(id){return users.find(function(x){return x.id===id;});}
  var tt=ticketTypes.find(function(t){return t.id===ticket.typeId;});
  var co=companies.find(function(c){return c.id===ticket.companyId;});
  var client=clients.find(function(c){return c.id===ticket.clientId;});
  var loc=client?client.locations.find(function(l){return l.id===ticket.locationId;}):null;
  if(!ticket)return null;
  var sSla=getStatusSla(ticket,statusSla,schedules);

  var ticketSessions=allTimeSessions.filter(function(s){return s.ticket_id===ticket.id&&s.ended_at;});
  var hasLoggedTime=ticketSessions.length>0;
  var totalLoggedMins=ticketSessions.reduce(function(sum,s){return sum+(s.duration_minutes||0);},0);

  async function saveStatus(){
    var statusChanged=status!==ticket.status;
    var now=new Date().toISOString();

    if(status==="Closed"&&forceStopRef.current){
      await forceStopRef.current();
      refreshTimeSessions();
    }

    var prevLog=ticket.statusTimeLog||[];
    var newLog=prevLog.map(function(entry){
      if(entry.exitedAt===null&&statusChanged){
        var durMins=parseFloat(((new Date(now)-new Date(entry.enteredAt))/60000).toFixed(2));
        return Object.assign({},entry,{exitedAt:now,durationMins:durMins});
      }
      return entry;
    });
    if(statusChanged){
      newLog=newLog.concat([{status:status,enteredAt:now,exitedAt:null,durationMins:null}]);
    }

    var hist={status,assignedTo:asgn||null,timestamp:now,changedBy:curUser.id,note:note||(statusChanged?"Status changed to "+status:"Details updated")};
    if(!statusChanged)hist._noSlaReset=true;

    if(statusChanged&&prevLog.length>0){
      var lastEntry=prevLog[prevLog.length-1];
      if(lastEntry&&lastEntry.exitedAt===null){
        hist.durationMins=parseFloat(((new Date(now)-new Date(lastEntry.enteredAt))/60000).toFixed(2));
      }
    }

    var newTT=ticketTypes.find(function(t){return t.id===typeId;});var typeChanged=typeId&&typeId!==ticket.typeId;
    var newSlaDeadline=typeChanged&&newTT?new Date(new Date(ticket.createdAt).getTime()+newTT.slaHours*3600000).toISOString():ticket.slaDeadline;
    var newPriority=typeChanged&&newTT?newTT.priority:ticket.priority;
    if(typeChanged)hist.note=(note||"")+(note?" | ":"")+"Type changed to: "+newTT.name;

    setTickets(function(prev){return prev.map(function(t){if(t.id!==ticket.id)return t;var newHist=statusChanged?(t.statusHistory||[]).concat([hist]):(t.statusHistory||[]).concat([Object.assign({},hist,{_noSlaReset:true})]);return Object.assign({},t,{status,assignedTo:asgn||null,typeId:typeId||t.typeId,priority:newPriority,slaDeadline:newSlaDeadline,updatedAt:now,slaBreached:new Date()>new Date(newSlaDeadline)&&status!=="Closed",closedAt:status==="Closed"&&!t.closedAt?now:t.closedAt,statusHistory:newHist,statusTimeLog:newLog});});});

    addLog("TICKET_STATUS",ticket.id,(statusChanged?"Status → "+status:"Details updated")+". Assigned: "+(fu(asgn)?.name||"nobody"));

    if(statusChanged){
      var assigneeName=fu(asgn)?.name||"Unassigned";
      // Notify all involved users
      var emails=getTicketEmails(ticket,users).filter(function(e){var me=users.find(function(u){return u.id===curUser.id;});return !me||e!==me.email;});
      var subjStatus="🔄 Ticket Updated: "+ticket.title+" → "+status;
      var bodyStatus="A ticket status has been changed.\n\nTicket: "+ticket.title+"\nNew Status: "+status+"\nAssigned To: "+assigneeName+"\nChanged By: "+curUser.name+"\n"+(note?"Note: "+note+"\n":"");
      notifyUsers(emails,subjStatus,bodyStatus);
      notifyAdmin("🔄 Ticket Status Updated — "+ticket.title,bodyStatus);
      createNotificationsForTicket(ticket,users,"Status changed to "+status+": "+ticket.title,"status",curUser.id);
      if(status==="Closed"){
        var latestSessions=allTimeSessions.filter(function(s){return s.ticket_id===ticket.id&&s.ended_at;});
        if(latestSessions.length===0){
          notifyAdmin("⚠️ Ticket Closed Without Timer — "+ticket.title,"A ticket was closed without any IT work time being logged.\n\nTicket: "+ticket.title+"\nClosed By: "+curUser.name+"\nAssigned To: "+assigneeName);
        }
      }
    }
    showToast("Ticket updated");setNote("");onClose();
  }

  async function sendEmail(){
    if(!msgTo.trim()||!msgBody.trim()){showToast("Recipient and body required","error");return;}
    setEmailSending(true);
    var toList=msgTo.split(",").map(function(e){return e.trim();}).filter(Boolean);
    var ccStr=msgCC.trim();
    var msgId=uid();
    var msg={id:msgId,from:curUser.id,fromEmail:curUser.email,to:[],toEmails:toList,cc:ccStr,subject:msgSubj,body:msgBody,timestamp:new Date().toISOString(),isExternal:false,status:"sending"};
    setTickets(function(prev){return prev.map(function(t){return t.id===ticket.id?Object.assign({},t,{conversations:(t.conversations||[]).concat([msg])}):t;});});
    var results=await Promise.all(toList.map(function(email){return callSendEmail({to:email,subject:msgSubj,body:msgBody,cc:ccStr});}));
    var allOk=results.every(function(r){return r.success;});
    var failMsg=!allOk?results.filter(function(r){return !r.success;}).map(function(r){return r.error;}).join(", "):"";
    var finalConvs=(ticket.conversations||[]).concat([msg]).map(function(c){return c.id===msgId?Object.assign({},c,{status:allOk?"sent":"failed",failReason:failMsg}):c;});
    setTickets(function(prev){return prev.map(function(t){if(t.id!==ticket.id)return t;return Object.assign({},t,{conversations:finalConvs});});});
    await dbSaveTicket(Object.assign({},ticket,{conversations:finalConvs}));
    addLog("EMAIL_SENT",ticket.id,"Email to "+msgTo+(ccStr?" CC: "+ccStr:""));
    // Notify involved users that email was sent
    if(allOk){
      var notifEmails=getTicketEmails(ticket,users).filter(function(e){return !toList.includes(e)&&e!==curUser.email;});
      notifyUsers(notifEmails,"📧 Email Sent on Ticket: "+ticket.title,"An email was sent on ticket: "+ticket.title+"\n\nFrom: "+curUser.name+"\nTo: "+msgTo+"\nSubject: "+msgSubj);
      createNotificationsForTicket(ticket,users,"Email sent by "+curUser.name+": "+msgSubj,"email",curUser.id);
    }
    showToast(allOk?"📧 Email sent!":"⚠️ Failed",allOk?"ok":"error");
    setEmailSending(false);
    if(allOk){setMsgTo("");setMsgCC("");setMsgBody("");}
  }

  var TABS=["details","status","timer","email","chat","history"].filter(function(t){if(t==="status"||t==="timer")return isTech;return true;});
  var tabLabels={details:"📋",status:"🔄",timer:"⏱️",email:"📧",chat:"💬",history:"📜"};
  var tabFullLabels={details:"Details",status:"Status",timer:"Timer",email:"Email",chat:"Chat",history:"History"};

  return<Modal title={ticket.title} onClose={onClose} wide>
    {showTimerBanner&&<div style={{background:"linear-gradient(135deg,#064e3b,#065f46)",borderRadius:10,padding:"12px 16px",marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
      <span style={{fontSize:18}}>⏱</span>
      <div style={{flex:1}}><div style={{fontWeight:700,color:"#6ee7b7",fontSize:13}}>Timer automatically started</div><div style={{fontSize:11,color:"#a7f3d0",marginTop:2}}>Remember to stop the timer when you are done working on this ticket.</div></div>
      <button onClick={function(){setShowTimerBanner(false);setTab("timer");}} style={{background:"#10b981",color:"#fff",border:"none",borderRadius:8,padding:"6px 12px",fontSize:11,fontWeight:700,cursor:"pointer",flexShrink:0}}>View Timer</button>
    </div>}
    {ticket.status==="Closed"&&!hasLoggedTime&&<div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
      <span style={{fontSize:16}}>⚠️</span>
      <div style={{flex:1}}><div style={{fontWeight:700,color:"#92400e",fontSize:13}}>No time was logged for this ticket</div><div style={{fontSize:11,color:"#b45309",marginTop:2}}>This ticket was closed without any IT work time being recorded.</div></div>
      <button onClick={function(){setTab("timer");}} style={{background:"#f59e0b",color:"#fff",border:"none",borderRadius:8,padding:"6px 12px",fontSize:11,fontWeight:700,cursor:"pointer",flexShrink:0}}>Add Time</button>
    </div>}
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
      <div style={{background:hasLoggedTime?"#f0fdf4":"#fffbeb",border:"1px solid "+(hasLoggedTime?"#bbf7d0":"#fde68a"),borderRadius:10,padding:10,marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:18}}>{hasLoggedTime?"🕐":"⚠️"}</span>
        <div style={{flex:1}}><div style={{fontWeight:700,fontSize:12,color:hasLoggedTime?"#166534":"#92400e"}}>IT Time Logged</div><div style={{fontSize:11,color:hasLoggedTime?"#16a34a":"#b45309",marginTop:1}}>{hasLoggedTime?fmtDuration(totalLoggedMins)+" logged across "+ticketSessions.length+" session"+(ticketSessions.length!==1?"s":""):"No time logged yet"}</div></div>
        {isTech&&<button onClick={function(){setTab("timer");}} style={{padding:"5px 10px",background:hasLoggedTime?"#10b981":"#f59e0b",color:"#fff",border:"none",borderRadius:6,fontSize:11,fontWeight:700,cursor:"pointer",flexShrink:0}}>{hasLoggedTime?"View":"Add Time"}</button>}
      </div>
      {client&&<div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:12,marginBottom:12}}><div style={{fontWeight:700,color:"#0369a1",fontSize:12,marginBottom:8}}>🤝 {client.name}</div><div style={{fontSize:11,color:"#64748b"}}>📧 {client.email} · 📞 {client.phone}</div>{loc&&<div style={{fontSize:11,color:"#64748b",marginTop:4}}>📍 {loc.name} — {loc.address}</div>}</div>}
      <div style={{background:"#f8fafc",padding:12,borderRadius:8,fontSize:13,lineHeight:1.6,whiteSpace:"pre-wrap",color:"#334155",marginBottom:12}}>{ticket.description}</div>
      {sSla&&<div style={{background:sSla.breached?"#fef2f2":"#f0fdf4",border:"1px solid "+(sSla.breached?"#fecaca":"#bbf7d0"),borderRadius:10,padding:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><div style={{fontWeight:700,color:sSla.breached?"#dc2626":"#166534",fontSize:12}}>⏱ Status SLA</div><Badge label={sSla.breached?"BREACHED":"✓ OK"} color={sSla.breached?"#ef4444":"#10b981"}/></div>
        <div style={{height:6,background:"#e2e8f0",borderRadius:3,overflow:"hidden",marginBottom:8}}><div style={{height:"100%",width:sSla.pct+"%",background:sSla.pct>=100?"#ef4444":sSla.pct>=75?"#f59e0b":"#10b981",borderRadius:3}}/></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,fontSize:11}}><div style={{textAlign:"center"}}><div style={{color:"#64748b",fontSize:10}}>Allowed</div><div style={{fontWeight:700}}>{sSla.hoursAllowed}h</div></div><div style={{textAlign:"center"}}><div style={{color:"#64748b",fontSize:10}}>Spent</div><div style={{fontWeight:700}}>{sSla.hoursSpent}h</div></div><div style={{textAlign:"center"}}><div style={{color:"#64748b",fontSize:10}}>Left</div><div style={{fontWeight:700,color:sSla.breached?"#ef4444":"#10b981"}}>{sSla.breached?"0h":sSla.remaining+"h"}</div></div></div>
      </div>}
      {ticket.statusTimeLog&&ticket.statusTimeLog.length>0&&<div style={{marginTop:12}}>
        <div style={{fontWeight:700,color:"#1e293b",fontSize:12,marginBottom:8}}>⏳ Time Per Status</div>
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          {ticket.statusTimeLog.map(function(entry,i){var sm=STATUS_META[entry.status]||STATUS_META.Open;var dur=entry.durationMins!=null?fmtDuration(entry.durationMins):(entry.exitedAt===null?"Ongoing…":"—");return<div key={i} style={{display:"flex",alignItems:"center",gap:8,background:"#f8fafc",borderRadius:8,padding:"7px 10px"}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:sm.color,flexShrink:0}}/>
            <span style={{fontSize:12,fontWeight:600,color:sm.color,minWidth:90}}>{entry.status}</span>
            <span style={{fontSize:11,color:entry.exitedAt===null?"#6366f1":"#64748b",fontWeight:entry.exitedAt===null?700:400,flex:1}}>{dur}</span>
            {entry.exitedAt===null&&<Badge label="Current" color="#6366f1"/>}
          </div>;})}
        </div>
      </div>}
      {ticket.attachments&&ticket.attachments.length>0&&<div style={{marginTop:12}}><div style={{fontWeight:700,color:"#1e293b",fontSize:12,marginBottom:8}}>📎 Attachments ({ticket.attachments.length})</div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(100px,1fr))",gap:8}}>{ticket.attachments.map(function(a){var isImg=a.type.startsWith("image/");return<div key={a.id} style={{borderRadius:8,overflow:"hidden",border:"1px solid #e2e8f0",cursor:"pointer"}} onClick={function(){var w=window.open();w.document.write(isImg?'<img src="'+a.dataUrl+'" style="max-width:100%;"/>':'<video src="'+a.dataUrl+'" controls style="max-width:100%;"></video>');}}>{isImg?<img src={a.dataUrl} alt={a.name} style={{width:"100%",height:80,objectFit:"cover",display:"block"}}/>:<div style={{height:80,display:"flex",alignItems:"center",justifyContent:"center",background:"#1e1b4b"}}><span style={{fontSize:28}}>▶️</span></div>}</div>;})}</div></div>}
    </div>}
    {tab==="status"&&isTech&&<div>
      <FSelect label="Update Status" value={status} onChange={function(e){setStatus(e.target.value);}} options={OPT_STATUSES}/>
      {status==="Closed"&&<div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#92400e"}}>⚠️ Closing this ticket will automatically stop the timer if it is running.</div>}
      <FSelect label="Assign To" value={asgn} onChange={function(e){setAsgn(e.target.value);}} options={optTechs(users)}/>
      <FSelect label="Ticket Type" value={typeId} onChange={function(e){setTypeId(e.target.value);}} options={ticketTypes.map(function(t){return mkOpt(t.id,t.name+" — "+t.slaHours+"h SLA");})}/>
      {typeId!==ticket.typeId&&<div style={{fontSize:11,color:"#f59e0b",marginBottom:14}}>⚠️ Changing type will update priority and SLA deadline.</div>}
      <FTextarea label="Note" value={note} onChange={function(e){setNote(e.target.value);}} placeholder="What was done or why?" rows={3}/>
      <Btn onClick={saveStatus} style={{width:"100%"}}>💾 Save Changes</Btn>
    </div>}
    {tab==="timer"&&isTech&&<TicketTimer ticketId={ticket.id} curUser={curUser} users={users} onSessionSaved={refreshTimeSessions} autoStart={shouldAutoStart} onAutoStarted={handleAutoStarted} forceStopRef={forceStopRef}/>}
    {tab==="email"&&<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <div style={{fontWeight:700,color:"#1e293b"}}>📧 Send Email</div>
        {emailTemplates.length>0&&<select onChange={function(e){if(e.target.value)applyTemplate(e.target.value);e.target.value="";}} style={{padding:"6px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#f8fafc"}}><option value="">Use template…</option>{emailTemplates.map(function(t){return<option key={t.id} value={t.id}>{t.name}</option>;})}</select>}
      </div>
      <FInput label="To" value={msgTo} onChange={function(e){setMsgTo(e.target.value);}} placeholder="email@example.com"/>
      <FInput label="CC (optional)" value={msgCC} onChange={function(e){setMsgCC(e.target.value);}} placeholder="cc@example.com"/>
      <FInput label="Subject" value={msgSubj} onChange={function(e){setMsgSubj(e.target.value);}}/>
      <FTextarea label="Message" value={msgBody} onChange={function(e){setMsgBody(e.target.value);}} rows={4} placeholder="Type your message…"/>
      <button onClick={sendEmail} disabled={emailSending} style={{background:emailSending?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:8,padding:"10px 18px",fontWeight:600,fontSize:14,cursor:emailSending?"not-allowed":"pointer",width:"100%",marginBottom:16}}>{emailSending?"⏳ Sending…":"📤 Send Email"}</button>
      <div style={{fontWeight:700,color:"#1e293b",marginBottom:10}}>📬 Conversation Trail ({(liveTicket.conversations||[]).length})</div>
      {(liveTicket.conversations||[]).length===0&&<div style={{color:"#94a3b8",fontSize:13}}>No messages yet.</div>}
      {(liveTicket.conversations||[]).map(function(m){var isReply=m.isExternal||m.status==="received";return<div key={m.id} style={{background:isReply?"#f0fdf4":"#f8fafc",border:"1px solid "+(isReply?"#bbf7d0":"#e2e8f0"),borderRadius:10,padding:12,marginBottom:10}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6,flexWrap:"wrap",gap:4}}><div style={{fontWeight:700,fontSize:12,color:isReply?"#166534":"#1e293b"}}>{isReply?"📬 REPLY":"📧"} {isReply?(m.fromName||m.fromEmail):m.fromEmail}</div><div style={{display:"flex",gap:4,alignItems:"center"}}>{m.status==="sent"&&<span style={{fontSize:10,color:"#10b981"}}>✅</span>}{m.status==="failed"&&<span style={{fontSize:10,color:"#ef4444"}}>❌</span>}<span style={{fontSize:10,color:"#94a3b8"}}>{fdt(m.timestamp)}</span></div></div>
        <div style={{fontSize:11,color:"#64748b",marginBottom:2}}>Subj: {m.subject}</div>
        {m.cc&&m.cc.trim()&&<div style={{fontSize:11,color:"#64748b",marginBottom:4}}>CC: {m.cc}</div>}
        <div style={{fontSize:13,color:"#334155",whiteSpace:"pre-wrap",lineHeight:1.6}}>{m.body}</div>
      </div>;})}
    </div>}
    {tab==="chat"&&<TicketChat ticketId={ticket.id} curUser={curUser} users={users} ticket={ticket}/>}
    {tab==="history"&&<TicketHistory ticket={ticket} users={users} curUser={curUser}/>}
  </Modal>;
}

// ── Time Tracking ─────────────────────────────────────────────────────────────
function PageTimeTracking(p){
  var tickets=p.tickets;var users=p.users;var ticketTypes=p.ticketTypes;var curUser=p.curUser;var isAdmin=p.isAdmin;var setSelTicket=p.setSelTicket;var isMobile=p.isMobile;var allTimeSessions=p.allTimeSessions||[];
  var[search,setSearch]=useState("");var[filterUser,setFilterUser]=useState("");var[dateFrom,setDateFrom]=useState("");var[dateTo,setDateTo]=useState("");var[activeTab,setActiveTab]=useState("it_time");
  var scope=useMemo(function(){var base=tickets.filter(function(t){return !t.deleted;});if(!isAdmin)return base.filter(function(t){return t.submittedBy===curUser.id||t.assignedTo===curUser.id;});if(filterUser)return base.filter(function(t){return t.assignedTo===filterUser||t.submittedBy===filterUser;});return base;},[tickets,curUser,isAdmin,filterUser]);
  var filtered=useMemo(function(){var q=search.toLowerCase();return scope.filter(function(t){if(q&&!t.title.toLowerCase().includes(q)&&!t.id.includes(q))return false;if(dateFrom){var from=new Date(dateFrom);from.setHours(0,0,0,0);if(new Date(t.createdAt)<from)return false;}if(dateTo){var to=new Date(dateTo);to.setHours(23,59,59,999);if(new Date(t.createdAt)>to)return false;}return true;});},[scope,search,dateFrom,dateTo]);
  function fu(id){return users.find(function(x){return x.id===id;});}
  function ticketMins(ticketId){return allTimeSessions.filter(function(s){return s.ticket_id===ticketId&&s.ended_at;}).reduce(function(sum,s){return sum+(s.duration_minutes||0);},0);}
  var totalITMins=filtered.reduce(function(a,t){return a+ticketMins(t.id);},0);
  var totalCreateMins=filtered.reduce(function(a,t){return a+(t.timeToCreateMins||0);},0);
  var ticketsWithITTime=filtered.filter(function(t){return ticketMins(t.id)>0;}).length;
  var avgCreateMins=filtered.length?totalCreateMins/filtered.length:0;
  var selStyle={padding:"8px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none",background:"#fff",boxSizing:"border-box"};
  return<div>
    <div style={{fontWeight:800,fontSize:16,color:"#1e293b",marginBottom:14}}>⏱️ Time Tracking</div>
    <div style={{display:"flex",gap:6,marginBottom:14}}>{[{id:"it_time",label:"🕐 IT Work Time"},{id:"create_time",label:"📝 Ticket Creation Time"}].map(function(tab){return<button key={tab.id} onClick={function(){setActiveTab(tab.id);}} style={{padding:"8px 16px",borderRadius:8,border:"none",background:activeTab===tab.id?"#6366f1":"#f1f5f9",color:activeTab===tab.id?"#fff":"#475569",fontSize:12,fontWeight:700,cursor:"pointer"}}>{tab.label}</button>;})}</div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
      {activeTab==="it_time"?<><Stat label="Total IT Hours" value={fmtDuration(totalITMins)} icon="🕐" color="#8b5cf6" sub="actual time worked"/><Stat label="Tickets Timed" value={ticketsWithITTime+"/"+filtered.length} icon="⏱" color="#0ea5e9"/></>:<><Stat label="Total Create Time" value={fmtMs(totalCreateMins)} icon="📝" color="#f59e0b" sub={filtered.length+" tickets"}/><Stat label="Avg Create Time" value={fmtMs(avgCreateMins)} icon="⏱" color="#0ea5e9"/></>}
    </div>
    <Card style={{marginBottom:14,padding:"12px 14px"}}>
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:8,marginBottom:8}}>
        <input value={search} onChange={function(e){setSearch(e.target.value);}} placeholder="🔍 Search tickets…" style={Object.assign({},selStyle,{width:"100%"})}/>
        {isAdmin&&<select value={filterUser} onChange={function(e){setFilterUser(e.target.value);}} style={Object.assign({},selStyle,{width:"100%"})}>
          <option value="">All Users</option>
          <optgroup label="── IT Staff ──">{users.filter(function(u){return IT_ROLES.includes(u.role)&&u.active;}).map(function(u){return<option key={u.id} value={u.id}>{u.name} ({ROLE_META[u.role]?.label||u.role})</option>;})}</optgroup>
          <optgroup label="── End Users ──">{users.filter(function(u){return !IT_ROLES.includes(u.role)&&u.active;}).map(function(u){return<option key={u.id} value={u.id}>{u.name}</option>;})}</optgroup>
        </select>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,alignItems:"center"}}>
        <div><label style={{display:"block",fontSize:11,fontWeight:600,color:"#475569",marginBottom:3}}>From</label><input type="date" value={dateFrom} onChange={function(e){setDateFrom(e.target.value);}} style={Object.assign({},selStyle,{width:"100%"})}/></div>
        <div><label style={{display:"block",fontSize:11,fontWeight:600,color:"#475569",marginBottom:3}}>To</label><input type="date" value={dateTo} onChange={function(e){setDateTo(e.target.value);}} style={Object.assign({},selStyle,{width:"100%"})}/></div>
      </div>
      {(dateFrom||dateTo)&&<button onClick={function(){setDateFrom("");setDateTo("");}} style={{marginTop:8,padding:"5px 12px",border:"1px solid #c7d2fe",borderRadius:6,fontSize:11,fontWeight:700,color:"#4338ca",background:"#eef2ff",cursor:"pointer"}}>✕ Clear dates</button>}
    </Card>
    <div style={{fontSize:11,color:"#94a3b8",marginBottom:10}}>Showing <strong style={{color:"#334155"}}>{filtered.length}</strong> ticket{filtered.length!==1?"s":""}{(dateFrom||dateTo)&&<span style={{color:"#6366f1",fontWeight:600}}> · Date filtered</span>}</div>
    {activeTab==="it_time"&&<div>
      <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#0369a1"}}>⏱ Hours shown are <strong>actual logged time</strong> from the Start/Stop timer inside each ticket.</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {filtered.length===0&&<Card><div style={{textAlign:"center",padding:32,color:"#94a3b8"}}>No tickets found.</div></Card>}
        {filtered.map(function(t){var asgn=fu(t.assignedTo);var sm=STATUS_META[t.status]||STATUS_META.Open;var mins=ticketMins(t.id);var sessions=allTimeSessions.filter(function(s){return s.ticket_id===t.id&&s.ended_at;});var cc=mins===0?"#94a3b8":mins<=60?"#10b981":mins<=240?"#f59e0b":"#ef4444";
          return<div key={t.id} style={{background:"#fff",borderRadius:10,border:"1px solid #e2e8f0",padding:14,cursor:"pointer"}} onClick={function(){setSelTicket(t.id);}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}><div style={{flex:1,overflow:"hidden"}}><div style={{fontWeight:600,color:"#1e293b",fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div><div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>Created: {fdt(t.createdAt)}</div></div><Badge label={t.status} color={sm.color} bg={sm.bg}/></div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>{asgn&&<Avatar name={asgn.name} id={asgn.id} size={18}/>}<span style={{fontSize:11,color:"#64748b"}}>{asgn?asgn.name:"Unassigned"}</span>{sessions.length>0&&<span style={{fontSize:10,color:"#94a3b8"}}>· {sessions.length} session{sessions.length!==1?"s":""}</span>}</div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>{mins>0&&<div style={{width:40,height:5,background:"#e2e8f0",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:Math.min(100,mins/240*100)+"%",background:cc,borderRadius:3}}/></div>}<span style={{fontSize:13,fontWeight:700,color:cc}}>{mins>0?fmtDuration(mins):"No time logged"}</span></div>
            </div>
          </div>;})}
      </div>
    </div>}
    {activeTab==="create_time"&&<div>
      <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#92400e"}}>📝 This tracks how long each user took to <strong>fill in and submit</strong> the ticket form — from when they opened it to when they clicked Submit.</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {filtered.length===0&&<Card><div style={{textAlign:"center",padding:32,color:"#94a3b8"}}>No tickets found.</div></Card>}
        {filtered.map(function(t){var sub=fu(t.submittedBy);var sm=STATUS_META[t.status]||STATUS_META.Open;var cm=t.timeToCreateMins||0;var cc=cm<=2?"#10b981":cm<=10?"#f59e0b":"#ef4444";var pct=Math.min(100,cm/15*100);
          return<div key={t.id} style={{background:"#fff",borderRadius:10,border:"1px solid #e2e8f0",padding:14,cursor:"pointer"}} onClick={function(){setSelTicket(t.id);}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}><div style={{flex:1,overflow:"hidden"}}><div style={{fontWeight:600,color:"#1e293b",fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div><div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>Submitted: {fdt(t.submittedAt||t.createdAt)}</div></div><Badge label={t.status} color={sm.color} bg={sm.bg}/></div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>{sub&&<Avatar name={sub.name} id={sub.id} size={18}/>}<span style={{fontSize:11,color:"#64748b"}}>{sub?sub.name:"Unknown"}</span></div>
              <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:40,height:5,background:"#e2e8f0",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:pct+"%",background:cc,borderRadius:3}}/></div><span style={{fontSize:13,fontWeight:700,color:cc}}>{cm>0?fmtMs(cm):"—"}</span></div>
            </div>
          </div>;})}
      </div>
    </div>}
  </div>;
}

// ── Tickets ───────────────────────────────────────────────────────────────────
function PageTickets(p){
  var tickets=p.tickets;var users=p.users;var clients=p.clients;var ticketTypes=p.ticketTypes;var curUser=p.curUser;
  var setTickets=p.setTickets;var addLog=p.addLog;var showToast=p.showToast;var setSelTicket=p.setSelTicket;var setPage=p.setPage;var isAdmin=p.isAdmin;var statusSla=p.statusSla;var schedules=p.schedules||{};var isMobile=p.isMobile;
  var[search,setSearch]=useState("");var[fStat,setFStat]=useState("");var[fPri,setFPri]=useState("");var[fType,setFType]=useState("");
  var[fAssignee,setFAssignee]=useState(function(){return(p.curUser&&IT_ROLES.includes(p.curUser.role)&&p.curUser.role!=="admin"&&p.curUser.role!=="it_manager")?p.curUser.id:"";});
  var techUsers=useMemo(function(){return users.filter(function(u){return IT_ROLES.includes(u.role)&&u.active;});},[users]);
  var filtered=tickets.filter(function(t){var q=search.toLowerCase();return(!q||t.title.toLowerCase().includes(q)||t.id.includes(q)||t.description.toLowerCase().includes(q))&&(!fStat||t.status===fStat)&&(!fPri||t.priority===fPri)&&(!fType||t.typeId===fType)&&(!fAssignee||(fAssignee==="unassigned"?!t.assignedTo:t.assignedTo===fAssignee));});
  function delTicket(id){setTickets(function(prev){return prev.map(function(t){return t.id===id?Object.assign({},t,{deleted:true}):t;});});addLog("TICKET_DELETED",id,"Ticket #"+id+" deleted");showToast("Ticket deleted");}
  function fu(id){return users.find(function(x){return x.id===id;});}function ftt(id){return ticketTypes.find(function(x){return x.id===id;});}function fcl(id){return clients.find(function(x){return x.id===id;});}
  var selStyle={padding:"7px 8px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none",flexShrink:0};
  return<div>
    <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}><input value={search} onChange={function(e){setSearch(e.target.value);}} placeholder="🔍 Search tickets..." style={{flex:1,minWidth:140,padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none"}}/><Btn onClick={function(){setPage("new_ticket");}}>➕ New</Btn></div>
    <div style={{display:"flex",gap:6,marginBottom:8,overflowX:"auto",paddingBottom:4,flexWrap:isMobile?"wrap":"nowrap"}}>
      <select value={fStat} onChange={function(e){setFStat(e.target.value);}} style={selStyle}><option value="">All Status</option>{ALL_STATUSES.map(function(s){return<option key={s} value={s}>{s}</option>;})}</select>
      <select value={fPri} onChange={function(e){setFPri(e.target.value);}} style={selStyle}><option value="">All Priority</option>{Object.keys(PRI_META).map(function(k){return<option key={k} value={k}>{PRI_META[k].label}</option>;})}</select>
      <select value={fType} onChange={function(e){setFType(e.target.value);}} style={selStyle}><option value="">All Types</option>{ticketTypes.map(function(t){return<option key={t.id} value={t.id}>{t.name}</option>;})}</select>
      <select value={fAssignee} onChange={function(e){setFAssignee(e.target.value);}} style={Object.assign({},selStyle,{background:fAssignee?"#eef2ff":"",color:fAssignee?"#4338ca":"",fontWeight:fAssignee?700:400})}><option value="">All Assignees</option><option value="unassigned">— Unassigned —</option>{techUsers.map(function(u){return<option key={u.id} value={u.id}>{u.name}</option>;})}</select>
      {fAssignee&&<button onClick={function(){setFAssignee("");}} style={{padding:"7px 10px",border:"1px solid #c7d2fe",borderRadius:8,fontSize:11,fontWeight:700,color:"#4338ca",background:"#eef2ff",cursor:"pointer",flexShrink:0}}>✕ Clear</button>}
    </div>
    <div style={{fontSize:11,color:"#94a3b8",marginBottom:10}}>Showing <strong style={{color:"#334155"}}>{filtered.length}</strong> ticket{filtered.length!==1?"s":""}{fAssignee&&fAssignee!=="unassigned"&&<span> assigned to <strong style={{color:"#6366f1"}}>{fu(fAssignee)?.name||"?"}</strong></span>}{fAssignee==="unassigned"&&<span> that are <strong style={{color:"#ef4444"}}>unassigned</strong></span>}</div>
    {isMobile?(<div style={{display:"flex",flexDirection:"column",gap:10}}>
      {filtered.length===0&&<Card><div style={{textAlign:"center",padding:32,color:"#94a3b8"}}>No tickets found</div></Card>}
      {filtered.map(function(t){var asgn=fu(t.assignedTo);var type=ftt(t.typeId);var client=fcl(t.clientId);var pri=PRI_META[t.priority]||PRI_META.medium;var sm=STATUS_META[t.status]||STATUS_META.Open;var sSla=getStatusSla(t,statusSla,schedules);
        return<div key={t.id} style={{background:"#fff",borderRadius:12,border:"1px solid #e2e8f0",padding:14,boxShadow:"0 1px 4px rgba(0,0,0,.05)"}} onClick={function(){setSelTicket(t.id);}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8,gap:8}}><div style={{flex:1}}><div style={{fontWeight:700,color:"#1e293b",fontSize:14,marginBottom:2}}>{t.title}</div><div style={{fontSize:11,color:"#94a3b8"}}>{ago(t.createdAt)}</div></div>{t.hasUnreadReply&&<span style={{background:"#10b981",color:"#fff",borderRadius:10,padding:"2px 8px",fontSize:10,fontWeight:700,flexShrink:0}}>📬 New</span>}</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}><Badge label={t.status} color={sm.color} bg={sm.bg}/><Badge label={pri.label} color={pri.color} bg={pri.bg}/>{type&&<Badge label={type.name} color={type.color||"#94a3b8"}/>}</div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{fontSize:11,color:"#64748b"}}>{asgn?<span>👤 {asgn.name}</span>:<span style={{color:"#ef4444"}}>Unassigned</span>}{client&&<span> · 🤝 {client.name}</span>}</div>{sSla&&<div style={{fontSize:10,color:sSla.breached?"#ef4444":"#64748b",fontWeight:600}}>{sSla.breached?"⚠️ Breached":"⏱ "+sSla.remaining.toFixed(1)+"h"}</div>}</div>
          {isAdmin&&<div style={{marginTop:8,display:"flex",justifyContent:"flex-end"}} onClick={function(e){e.stopPropagation();delTicket(t.id);}}><Btn size="sm" variant="danger">🗑 Delete</Btn></div>}
        </div>;})}
    </div>):(<div style={{background:"#fff",borderRadius:12,border:"1px solid #e2e8f0",overflow:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",minWidth:800}}>
        <thead><tr style={{background:"#f8fafc"}}>{["#","Title","Type","Priority","Status","Client","Assigned To","SLA",""].map(function(h){return<th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>{h}</th>;})}</tr></thead>
        <tbody>
          {filtered.length===0&&<tr><td colSpan={9} style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No tickets found</td></tr>}
          {filtered.map(function(t,i){var asgn=fu(t.assignedTo);var type=ftt(t.typeId);var client=fcl(t.clientId);var pri=PRI_META[t.priority]||PRI_META.medium;var sm=STATUS_META[t.status]||STATUS_META.Open;var sSla=getStatusSla(t,statusSla,schedules);
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
            </tr>;})}
        </tbody>
      </table>
    </div>)}
  </div>;
}

// ══════════════════════════════════════════════════════════════════════════════
// NOTE: The following pages are UNCHANGED from the previous version.
// Copy them verbatim from your existing App.jsx:
//   - PageReports
//   - PageUsers
//   - PageCompanies
//   - PageClients
//   - PageTicketTypes
//   - PageActivityLog
//   - PageIntegrations
// ══════════════════════════════════════════════════════════════════════════════
