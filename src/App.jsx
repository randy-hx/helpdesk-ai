import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import React from "react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area, LineChart, Line } from "recharts";
import { supabase } from './supabase.js';
import { dbGetUsers, dbSaveUser, dbDeleteUser, dbGetPassword, dbSetPassword, dbGetCompanies, dbSaveCompany, dbDeleteCompany, dbGetClients, dbSaveClient, dbDeleteClient, dbGetTicketTypes, dbSaveTicketType, dbDeleteTicketType, dbGetTickets, dbSaveTicket, dbGetLogs, dbAddLog, dbGetSchedules, dbSaveSchedule, dbGetEmailTemplates, dbSaveEmailTemplate, dbDeleteEmailTemplate } from './db.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const PAL = ["#6366f1","#8b5cf6","#0ea5e9","#10b981","#f59e0b","#ef4444","#ec4899","#f97316"];
const STATUS_META = { "Open":{color:"#f59e0b",bg:"#fef3c7"}, "In Progress":{color:"#6366f1",bg:"#eef2ff"}, "Pending":{color:"#0ea5e9",bg:"#e0f2fe"}, "Escalated":{color:"#ef4444",bg:"#fee2e2"}, "Closed":{color:"#94a3b8",bg:"#f1f5f9"} };
const ALL_STATUSES = ["Open","In Progress","Pending","Escalated","Closed"];
const PRI_META = { critical:{color:"#dc2626",bg:"#fee2e2",label:"Critical"}, high:{color:"#ef4444",bg:"#fef2f2",label:"High"}, medium:{color:"#f59e0b",bg:"#fffbeb",label:"Medium"}, low:{color:"#10b981",bg:"#f0fdf4",label:"Low"} };
const IT_ROLES = ["admin","it_manager","it_technician"];
const DEFAULT_STATUS_SLA = { "Open":2, "In Progress":8, "Pending":24, "Escalated":1, "Closed":null };
const DOW_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// ── Role Management ───────────────────────────────────────────────────────────
const DEFAULT_ROLES = { admin:{label:"Administrator",color:"#dc2626",system:true}, it_manager:{label:"IT Manager",color:"#7c3aed",system:true}, it_technician:{label:"IT Technician",color:"#2563eb",system:true}, end_user:{label:"End User",color:"#059669",system:true} };
function loadRoles(){ try{ var s=localStorage.getItem("hd_roles"); return s?Object.assign({},DEFAULT_ROLES,JSON.parse(s)):Object.assign({},DEFAULT_ROLES); }catch(e){ return Object.assign({},DEFAULT_ROLES); } }
function saveRoles(v){ try{ localStorage.setItem("hd_roles",JSON.stringify(v)); }catch(e){} }
var ROLE_META = loadRoles();

// ── Helpers ───────────────────────────────────────────────────────────────────
const uid   = function(){ return "id_"+Date.now()+"_"+Math.random().toString(36).slice(2,6); };
const hAgo  = function(h){ return new Date(Date.now()-h*3600000).toISOString(); };
const dAgo  = function(d){ return new Date(Date.now()-d*86400000).toISOString(); };
const fdt   = function(iso){ return iso?new Date(iso).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit"}):"—"; };
const fdtFull = function(iso){ return iso?new Date(iso).toLocaleString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"}):"—"; };
const ago   = function(iso){ if(!iso)return"—"; var m=Math.floor((Date.now()-new Date(iso))/60000); if(m<1)return"just now"; if(m<60)return m+"m ago"; var h=Math.floor(m/60); if(h<24)return h+"h ago"; return Math.floor(h/24)+"d ago"; };
const inits = function(n){ if(!n)return"??"; var p=n.trim().split(" ").filter(Boolean); return p.length>=2?(p[0][0]+p[1][0]).toUpperCase():n.slice(0,2).toUpperCase(); };
const avCol = function(id){ return PAL[Math.abs((id||"").split("").reduce(function(a,c){return a+c.charCodeAt(0);},0))%PAL.length]; };
const rnd   = function(a,b){ return Math.floor(Math.random()*(b-a+1))+a; };
const slaColor = function(r){ return r>=90?"#10b981":r>=75?"#f59e0b":"#ef4444"; };
const fmtMs = function(mins){ if(!mins&&mins!==0)return"—"; var s=mins*60; if(s<60)return s.toFixed(2)+"s"; if(s<3600){var m=Math.floor(mins);var sc=parseFloat(((mins-m)*60).toFixed(2));return m+"m "+sc+"s";} var h=Math.floor(mins/60);var rm=mins-h*60;var m2=Math.floor(rm);var s2=parseFloat(((rm-m2)*60).toFixed(2));return h+"h "+m2+"m "+s2+"s"; };
const pieLabel = function(p){ return p.value>0?p.name+": "+p.value:""; };
const fmtHour = function(h){ if(h===0)return"12:00 AM"; if(h<12)return h+":00 AM"; if(h===12)return"12:00 PM"; return (h-12)+":00 PM"; };
const fmtSchedule = function(sch){ if(!sch||!sch.days||!sch.days.length)return"No schedule (24/7)"; var d=sch.days.slice().sort(function(a,b){return a-b;}).map(function(d){return DOW_LABELS[d];}).join(", "); return d+" · "+fmtHour(sch.startHour)+" – "+fmtHour(sch.endHour); };

// ── Schedule helpers ──────────────────────────────────────────────────────────
function calcBusinessHoursElapsed(startMs,endMs,schedule){
  if(!schedule||!schedule.days||!schedule.days.length)return(endMs-startMs)/3600000;
  var total=0,cur=startMs;
  while(cur<endMs){var d=new Date(cur);var dow=d.getDay();var ds=new Date(d.getFullYear(),d.getMonth(),d.getDate(),schedule.startHour,0,0,0).getTime();var de=new Date(d.getFullYear(),d.getMonth(),d.getDate(),schedule.endHour,0,0,0).getTime();if(schedule.days.includes(dow)){var os=Math.max(cur,ds);var oe=Math.min(endMs,de);if(oe>os)total+=(oe-os)/3600000;}cur=new Date(d.getFullYear(),d.getMonth(),d.getDate()+1,0,0,0,0).getTime();}
  return total;
}
function isCurrentlyOnShift(schedule){ if(!schedule||!schedule.days||!schedule.days.length)return true; var now=new Date();var dow=now.getDay();var h=now.getHours()+(now.getMinutes()/60);return schedule.days.includes(dow)&&h>=schedule.startHour&&h<schedule.endHour; }

// ── SLA helpers ───────────────────────────────────────────────────────────────
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

// ── Email ─────────────────────────────────────────────────────────────────────
async function callSendEmail(opts){
  try{
    var res=await fetch("/api/send-email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to:opts.to,subject:opts.subject||"(no subject)",text:opts.body||opts.message||""})});
    var data=await res.json();
    if(res.ok&&data.id)return{success:true,provider:"Gmail",id:data.id};
    throw new Error(data.error||("Status "+res.status));
  }catch(e){return{success:false,error:e.message,provider:"Gmail"};}
}

// ── Chat DB helpers ───────────────────────────────────────────────────────────
async function dbGetChats(ticketId){
  try{
    var{data,error}=await supabase.from("ticket_chats").select("*").eq("ticket_id",ticketId).order("created_at",{ascending:true});
    if(error)throw error;
    return data||[];
  }catch(e){console.error("dbGetChats",e);return[];}
}
async function dbSaveChat(msg){
  try{
    var{error}=await supabase.from("ticket_chats").upsert([msg]);
    if(error)throw error;
  }catch(e){console.error("dbSaveChat",e);}
}

// ── Auth helpers ──────────────────────────────────────────────────────────────
function getPassword(id){try{var p=JSON.parse(localStorage.getItem("hd_pw_cache")||"{}");return p[id]||null;}catch(e){return null;}}
function cachePassword(id,pw){try{var p=JSON.parse(localStorage.getItem("hd_pw_cache")||"{}");p[id]=pw;localStorage.setItem("hd_pw_cache",JSON.stringify(p));}catch(e){}}
function loadState(key,fb){try{var s=localStorage.getItem(key);return s?JSON.parse(s):fb;}catch(e){return fb;}}
function saveState(key,v){try{localStorage.setItem(key,JSON.stringify(v));}catch(e){}}
function clearAuth(){try{localStorage.removeItem("hd_curUser");}catch(e){}}

// ── Option builders ───────────────────────────────────────────────────────────
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
function optTickets(t){return t.map(function(x){return mkOpt(x.id,"#"+x.id+" — "+x.title.slice(0,28));});}
function aiAssign(title,desc,typeId,users,types){
  var tt=types.find(function(t){return t.id===typeId;});
  if(tt&&tt.defaultAssignee){var u=users.find(function(u){return u.id===tt.defaultAssignee&&u.active;});if(u)return{id:u.id,reason:"Type \""+tt.name+"\" → "+u.name};}
  var text=(title+" "+desc).toLowerCase();
  for(var i=0;i<types.length;i++){var t=types[i];if(!t.defaultAssignee)continue;var kws=t.keywords||[];for(var j=0;j<kws.length;j++){if(text.includes(kws[j].toLowerCase())){var u2=users.find(function(u){return u.id===t.defaultAssignee&&u.active;});if(u2)return{id:u2.id,reason:"Keyword \""+kws[j]+"\" → "+u2.name};}}}
  var techs=users.filter(function(u){return u.role==="it_technician"&&u.active;});
  if(techs.length)return{id:techs[0].id,reason:"Load-balanced → "+techs[0].name};
  return{id:null,reason:"No technician available"};
}

// ── UI primitives ─────────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component{constructor(p){super(p);this.state={error:null};}static getDerivedStateFromError(e){return{error:e.message};}render(){if(this.state.error)return<div style={{padding:40,background:"#fef2f2",minHeight:"100vh"}}><div style={{fontSize:20,fontWeight:700,color:"#dc2626",marginBottom:16}}>⚠️ Something went wrong</div><pre style={{background:"#fff",padding:20,borderRadius:8,border:"1px solid #fecaca",fontSize:13,whiteSpace:"pre-wrap",color:"#7f1d1d",marginBottom:16}}>{this.state.error}</pre><button onClick={function(){try{localStorage.removeItem("hd_page");}catch(e){}window.location.href="/";}} style={{padding:"10px 20px",background:"#dc2626",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700,marginRight:8}}>🏠 Go to Dashboard</button><button onClick={function(){try{localStorage.clear();}catch(e){}window.location.href="/";}} style={{padding:"10px 20px",background:"#7f1d1d",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700}}>🗑 Clear &amp; Restart</button></div>;return this.props.children;}}

function Badge(p){return<span style={{background:p.bg||p.color+"22",color:p.color,border:"1px solid "+p.color+"44",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700,whiteSpace:"nowrap",display:"inline-block"}}>{p.label}</span>;}
function Avatar(p){var s=p.size||32;return<div style={{width:s,height:s,borderRadius:"50%",background:avCol(p.id||p.name),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:s*0.35,fontWeight:700,flexShrink:0}}>{inits(p.name)}</div>;}
function Card(p){return<div style={{background:"#fff",borderRadius:12,border:"1px solid #e2e8f0",boxShadow:"0 1px 4px rgba(0,0,0,.06)",padding:20,...p.style}}>{p.children}</div>;}
function Stat(p){return<Card style={{flex:1,minWidth:150}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}><div><div style={{color:"#64748b",fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5}}>{p.label}</div><div style={{fontSize:28,fontWeight:800,color:p.color||"#6366f1",margin:"4px 0 2px"}}>{p.value}</div>{p.sub&&<div style={{fontSize:11,color:"#94a3b8"}}>{p.sub}</div>}</div><span style={{fontSize:22}}>{p.icon}</span></div></Card>;}
function Modal(p){return<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}><div style={{background:"#fff",borderRadius:16,width:"100%",maxWidth:p.wide?820:560,maxHeight:"90vh",display:"flex",flexDirection:"column",boxShadow:"0 20px 60px rgba(0,0,0,.25)"}}><div style={{padding:"16px 24px",borderBottom:"1px solid #e2e8f0",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}><div style={{fontSize:15,fontWeight:700,color:"#1e293b"}}>{p.title}</div><button onClick={p.onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:"#94a3b8",lineHeight:1,padding:4}}>✕</button></div><div style={{padding:24,overflowY:"auto",flex:1}}>{p.children}</div></div></div>;}
function FInput(p){var label=p.label;var rest=Object.assign({},p);delete rest.label;return<div style={{marginBottom:14}}>{label&&<label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>{label}</label>}<input style={{width:"100%",padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#f8fafc",boxSizing:"border-box"}} {...rest}/></div>;}
function FSelect(p){var label=p.label;var options=p.options||[];var rest=Object.assign({},p);delete rest.label;delete rest.options;return<div style={{marginBottom:14}}>{label&&<label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>{label}</label>}<select style={{width:"100%",padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#f8fafc",boxSizing:"border-box"}} {...rest}>{options.map(function(o){return<option key={o.value} value={o.value}>{o.label}</option>;})}</select></div>;}
function FTextarea(p){var label=p.label;var rest=Object.assign({},p);delete rest.label;return<div style={{marginBottom:14}}>{label&&<label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>{label}</label>}<textarea rows={4} style={{width:"100%",padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#f8fafc",resize:"vertical",boxSizing:"border-box"}} {...rest}/></div>;}
function Btn(p){var v=p.variant||"primary";var sm=p.size==="sm";var base={border:"none",cursor:"pointer",borderRadius:8,fontWeight:600,fontSize:sm?11:13,display:"inline-flex",alignItems:"center",gap:4,padding:sm?"5px 10px":"8px 18px"};var cols={primary:{background:"#6366f1",color:"#fff"},danger:{background:"#ef4444",color:"#fff"},success:{background:"#10b981",color:"#fff"},warning:{background:"#f59e0b",color:"#fff"},ghost:{background:"#f1f5f9",color:"#475569"}};var rest=Object.assign({},p);delete rest.variant;delete rest.size;return<button style={Object.assign({},base,cols[v]||cols.primary,p.style||{})} {...rest}>{p.children}</button>;}
function FocusInput(p){var[focused,setFocused]=useState(false);var extraPad=p.extraPad;var rest=Object.assign({},p);delete rest.extraPad;return<input {...rest} onFocus={function(){setFocused(true);}} onBlur={function(){setFocused(false);}} style={{width:"100%",padding:extraPad?"11px 44px 11px 14px":"11px 14px",border:"1.5px solid "+(focused?"#0ea5e9":"#e2e8f0"),borderRadius:10,fontSize:14,outline:"none",boxSizing:"border-box",background:"#f8fafc",transition:"border-color .2s"}}/>;}

// ── Schedule Editor ───────────────────────────────────────────────────────────
function ScheduleEditor(p){
  var userId=p.userId;var schedules=p.schedules;var onChange=p.onChange;
  var existing=schedules[userId]||null;
  var[enabled,setEnabled]=useState(!!existing);
  var[days,setDays]=useState(existing?existing.days:[1,2,3,4,5]);
  var[startHour,setStartHour]=useState(existing?existing.startHour:9);
  var[endHour,setEndHour]=useState(existing?existing.endHour:17);
  function toggleDay(d){var nd=days.includes(d)?days.filter(function(x){return x!==d;}):days.concat([d]);setDays(nd);emit(enabled,nd,startHour,endHour);}
  function emit(en,ds,sh,eh){onChange(userId,en?{days:ds,startHour:sh,endHour:eh}:null);}
  function handleEnable(v){setEnabled(v);emit(v,days,startHour,endHour);}
  function handleStart(v){var n=parseInt(v);setStartHour(n);emit(enabled,days,n,endHour);}
  function handleEnd(v){var n=parseInt(v);setEndHour(n);emit(enabled,days,startHour,n);}
  var hours=Array.from({length:24},function(_,i){return mkOpt(i,fmtHour(i));});
  return<div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:14,marginBottom:14}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
      <div style={{fontWeight:700,color:"#0369a1",fontSize:13}}>🗓 Work Schedule</div>
      <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,fontWeight:600,color:enabled?"#0369a1":"#64748b"}}>
        <input type="checkbox" checked={enabled} onChange={function(e){handleEnable(e.target.checked);}} style={{width:15,height:15,accentColor:"#0369a1"}}/>
        {enabled?"Schedule enabled":"No schedule (24/7)"}
      </label>
    </div>
    {enabled&&<>
      <div style={{marginBottom:10}}><div style={{fontSize:11,fontWeight:700,color:"#475569",marginBottom:6,textTransform:"uppercase"}}>Working Days</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{DOW_LABELS.map(function(label,i){var active=days.includes(i);return<button key={i} type="button" onClick={function(){toggleDay(i);}} style={{padding:"5px 10px",borderRadius:6,border:"1.5px solid "+(active?"#0369a1":"#e2e8f0"),background:active?"#0369a1":"#fff",color:active?"#fff":"#64748b",fontSize:11,fontWeight:700,cursor:"pointer"}}>{label}</button>;})}</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div><label style={{display:"block",fontSize:11,fontWeight:700,color:"#475569",marginBottom:4,textTransform:"uppercase"}}>Shift Start</label><select value={startHour} onChange={function(e){handleStart(e.target.value);}} style={{width:"100%",padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none",background:"#fff",boxSizing:"border-box"}}>{hours.map(function(o){return<option key={o.value} value={o.value}>{o.label}</option>;})}</select></div>
        <div><label style={{display:"block",fontSize:11,fontWeight:700,color:"#475569",marginBottom:4,textTransform:"uppercase"}}>Shift End</label><select value={endHour} onChange={function(e){handleEnd(e.target.value);}} style={{width:"100%",padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none",background:"#fff",boxSizing:"border-box"}}>{hours.filter(function(o){return o.value>startHour;}).map(function(o){return<option key={o.value} value={o.value}>{o.label}</option>;})}</select></div>
      </div>
      <div style={{marginTop:8,fontSize:11,color:"#0369a1",background:"#e0f2fe",borderRadius:6,padding:"6px 10px"}}>⏱ SLA timer only runs {days.slice().sort(function(a,b){return a-b;}).map(function(d){return DOW_LABELS[d];}).join(", ")} · {fmtHour(startHour)} – {fmtHour(endHour)}</div>
    </>}
  </div>;
}

// ── Ticket Chat ───────────────────────────────────────────────────────────────
function TicketChat(p){
  var ticketId=p.ticketId;var curUser=p.curUser;var users=p.users;
  var[msgs,setMsgs]=useState([]);
  var[text,setText]=useState("");
  var[sending,setSending]=useState(false);
  var bottomRef=useRef(null);

  useEffect(function(){
    dbGetChats(ticketId).then(function(data){setMsgs(data);});
    var sub=supabase.channel("chat-"+ticketId)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"ticket_chats",filter:"ticket_id=eq."+ticketId},function(payload){
        setMsgs(function(prev){
          if(prev.find(function(m){return m.id===payload.new.id;}))return prev;
          return prev.concat([payload.new]);
        });
      })
      .subscribe();
    return function(){supabase.removeChannel(sub);};
  },[ticketId]);

  useEffect(function(){
    if(bottomRef.current)bottomRef.current.scrollIntoView({behavior:"smooth"});
  },[msgs]);

  async function send(){
    var trimmed=text.trim();
    if(!trimmed||sending)return;
    setSending(true);
    var msg={id:uid(),ticket_id:ticketId,user_id:curUser.id,message:trimmed,created_at:new Date().toISOString()};
    await dbSaveChat(msg);
    setText("");
    setSending(false);
  }

  function fu(id){return users.find(function(u){return u.id===id;});}

  return(
    <div style={{display:"flex",flexDirection:"column",height:420}}>
      <div style={{flex:1,overflowY:"auto",padding:"4px 0",marginBottom:12}}>
        {msgs.length===0&&(
          <div style={{textAlign:"center",padding:"40px 0",color:"#94a3b8"}}>
            <div style={{fontSize:32,marginBottom:8}}>💬</div>
            <div style={{fontSize:13,fontWeight:600}}>No messages yet</div>
            <div style={{fontSize:12,marginTop:4}}>Be the first to post a message on this ticket</div>
          </div>
        )}
        {msgs.map(function(msg,i){
          var sender=fu(msg.user_id);
          var isMe=msg.user_id===curUser.id;
          var showAvatar=i===0||msgs[i-1].user_id!==msg.user_id;
          return(
            <div key={msg.id} style={{display:"flex",flexDirection:isMe?"row-reverse":"row",gap:8,marginBottom:showAvatar?10:3,alignItems:"flex-end"}}>
              <div style={{width:28,flexShrink:0}}>
                {showAvatar&&<Avatar name={sender?sender.name:"?"} id={msg.user_id} size={28}/>}
              </div>
              <div style={{maxWidth:"70%"}}>
                {showAvatar&&(
                  <div style={{fontSize:10,fontWeight:700,color:"#64748b",marginBottom:3,textAlign:isMe?"right":"left"}}>
                    {isMe?"You":sender?sender.name:"Unknown"} · {ago(msg.created_at)}
                  </div>
                )}
                <div style={{
                  background:isMe?"#6366f1":"#f1f5f9",
                  color:isMe?"#fff":"#1e293b",
                  borderRadius:isMe?"16px 16px 4px 16px":"16px 16px 16px 4px",
                  padding:"8px 12px",
                  fontSize:13,
                  lineHeight:1.5,
                  wordBreak:"break-word"
                }}>
                  {msg.message}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef}/>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"flex-end",borderTop:"1px solid #e2e8f0",paddingTop:12}}>
        <textarea
          value={text}
          onChange={function(e){setText(e.target.value);}}
          onKeyDown={function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
          placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
          rows={2}
          style={{flex:1,padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:10,fontSize:13,outline:"none",resize:"none",background:"#f8fafc",boxSizing:"border-box"}}
        />
        <button
          onClick={send}
          disabled={sending||!text.trim()}
          style={{padding:"10px 16px",background:sending||!text.trim()?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:10,fontWeight:700,fontSize:13,cursor:sending||!text.trim()?"not-allowed":"pointer",flexShrink:0,height:42}}>
          {sending?"⏳":"Send"}
        </button>
      </div>
    </div>
  );
}

// ── Login ─────────────────────────────────────────────────────────────────────
function LoginPage(p){
  var users=p.users;var setUsers=p.setUsers;var companies=p.companies;var onLogin=p.onLogin;
  var[view,setView]=useState("login");
  var[loginEmail,setLoginEmail]=useState("");var[loginPass,setLoginPass]=useState("");
  var[showP1,setShowP1]=useState(false);var[showP2,setShowP2]=useState(false);var[showP3,setShowP3]=useState(false);
  var[loginErr,setLoginErr]=useState("");var[resetEmail,setResetEmail]=useState("");var[resetErr,setResetErr]=useState("");
  var[sigName,setSigName]=useState("");var[sigEmail,setSigEmail]=useState("");var[sigPass,setSigPass]=useState("");
  var[sigConf,setSigConf]=useState("");var[sigPhone,setSigPhone]=useState("");var[sigDept,setSigDept]=useState("");var[sigErr,setSigErr]=useState("");
  var[loading,setLoading]=useState(false);
  var[rememberMe,setRememberMe]=useState(function(){try{return localStorage.getItem("hd_rememberMe")==="true";}catch(e){return false;}});

  useEffect(function(){
    try{var saved=localStorage.getItem("hd_savedCreds");if(saved){var creds=JSON.parse(saved);if(creds.email)setLoginEmail(creds.email);if(creds.pass)setLoginPass(creds.pass);setRememberMe(true);}}catch(e){}
  },[]);

  function pwStr(pw){if(!pw||pw.length<8)return 1;if(pw.length>=12&&/[A-Z]/.test(pw)&&/[0-9]/.test(pw)&&/[^A-Za-z0-9]/.test(pw))return 4;if(pw.length>=10&&/[A-Z]/.test(pw)&&/[0-9]/.test(pw))return 3;return 2;}
  var strLabel=["","Too short","Weak","Good","Strong ✅"];var strColor=["","#ef4444","#f59e0b","#3b82f6","#10b981"];var str=pwStr(sigPass);

  async function doLogin(e){
    if(e&&e.preventDefault)e.preventDefault();setLoginErr("");
    if(!loginEmail.trim()||!loginPass.trim()){setLoginErr("Please enter your email and password.");return;}
    setLoading(true);
    var user=users.find(function(u){return u.email.toLowerCase()===loginEmail.toLowerCase().trim();});
    if(!user){setLoginErr("No account found with that email.");setLoading(false);return;}
    if(!user.active){setLoginErr("Your account is pending admin approval.");setLoading(false);return;}
    var pw=await dbGetPassword(user.id);
    if(loginPass!==pw){setLoginErr("Incorrect password.");setLoading(false);return;}
    try{if(rememberMe){localStorage.setItem("hd_savedCreds",JSON.stringify({email:loginEmail.trim(),pass:loginPass}));localStorage.setItem("hd_rememberMe","true");}else{localStorage.removeItem("hd_savedCreds");localStorage.setItem("hd_rememberMe","false");}}catch(ex){}
    setLoading(false);onLogin(user);
  }
  async function doForgot(e){e.preventDefault();setResetErr("");if(!resetEmail.trim()){setResetErr("Please enter your email.");return;}setLoading(true);await new Promise(function(r){setTimeout(r,900);});setLoading(false);setView("sent");}
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
    await dbSaveUser(nu);
    await dbSetPassword(nu.id,sigPass);
    setUsers(function(prev){return prev.concat([nu]);});
    setLoading(false);setView("pending");
  }

  function PBtn(bp){return<button type={bp.type||"button"} onClick={bp.onClick} disabled={bp.disabled} style={{width:"100%",padding:"12px",background:bp.disabled?"#7dd3fc":"linear-gradient(135deg,#0369a1,#0ea5e9)",color:"#fff",border:"none",borderRadius:10,fontSize:15,fontWeight:700,cursor:bp.disabled?"not-allowed":"pointer",marginTop:4}}>{bp.children}</button>;}
  function BackBtn(bp){return<button type="button" onClick={bp.onClick} style={{background:"none",border:"none",color:"#0369a1",fontSize:13,fontWeight:600,cursor:"pointer",padding:"0 0 16px 0",display:"flex",alignItems:"center",gap:4}}>← Back to Sign In</button>;}
  function ErrBox(ep){return ep.msg?<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:14,color:"#dc2626",fontSize:13}}>⚠️ {ep.msg}</div>:null;}

  return<div style={{minHeight:"100vh",background:"linear-gradient(135deg,#020e1f 0%,#041833 30%,#062d6b 65%,#0a3d8f 100%)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,fontFamily:"'Inter',system-ui,sans-serif",position:"relative"}}>
    <div style={{position:"absolute",inset:0,background:"rgba(2,14,31,0.62)"}}/>
    <div style={{width:"100%",maxWidth:440,position:"relative",zIndex:1}}>
      <div style={{textAlign:"center",marginBottom:28}}>
        <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:14,marginBottom:10}}>
          <div style={{width:54,height:54,borderRadius:"50%",background:"linear-gradient(135deg,#fff 60%,#b3d9ff)",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:34,height:34,borderRadius:"50%",background:"linear-gradient(135deg,#0369a1,#0ea5e9)",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:14,height:14,borderRadius:"50%",background:"#020e1f"}}/></div></div>
          <div style={{textAlign:"left"}}><div style={{color:"#fff",fontSize:32,fontWeight:800,letterSpacing:-1,lineHeight:1}}>hoptix</div><div style={{fontSize:12,letterSpacing:1}}><span style={{color:"#7dd3fc"}}>A.</span><span style={{color:"#38bdf8",fontStyle:"italic"}}>eye</span><span style={{color:"#94a3b8"}}> technology</span></div></div>
        </div>
        <p style={{color:"#94a3b8",fontSize:13,margin:0}}>IT Helpdesk · Sign in to your workspace</p>
      </div>
      <div style={{background:"rgba(255,255,255,0.97)",borderRadius:20,padding:36,boxShadow:"0 25px 60px rgba(0,0,0,.5)"}}>
        {view==="login"&&<>
          <h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 4px"}}>Welcome back 👋</h2>
          <p style={{fontSize:13,color:"#94a3b8",margin:"0 0 22px"}}>Sign in to access your dashboard</p>
          <form onSubmit={doLogin} autoComplete="on">
            <div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:5}}>Email Address</label><FocusInput type="email" name="email" autoComplete="email" value={loginEmail} onChange={function(e){setLoginEmail(e.target.value);}} placeholder="you@company.com" autoFocus/></div>
            <div style={{marginBottom:6}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:5}}>Password</label><div style={{position:"relative"}}><FocusInput type={showP1?"text":"password"} name="password" autoComplete="current-password" value={loginPass} onChange={function(e){setLoginPass(e.target.value);}} placeholder="••••••••" extraPad/><button type="button" onClick={function(){setShowP1(!showP1);}} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:16,color:"#94a3b8",padding:0}}>{showP1?"🙈":"👁️"}</button></div></div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,color:"#475569",fontWeight:600,userSelect:"none"}}><input type="checkbox" checked={rememberMe} onChange={function(e){setRememberMe(e.target.checked);}} style={{width:15,height:15,accentColor:"#6366f1",cursor:"pointer"}}/>Remember me</label>
              <button type="button" onClick={function(){setView("forgot");setResetEmail(loginEmail);setResetErr("");}} style={{background:"none",border:"none",color:"#0369a1",fontSize:12,fontWeight:600,cursor:"pointer",padding:0,textDecoration:"underline"}}>Forgot your password?</button>
            </div>
            <ErrBox msg={loginErr}/><PBtn type="submit" disabled={loading}>{loading?"⏳ Signing in…":"Sign In →"}</PBtn>
          </form>
          <div style={{marginTop:18,textAlign:"center"}}><span style={{fontSize:12,color:"#94a3b8"}}>Don't have an account? </span><button type="button" onClick={function(){setView("signup");setSigErr("");}} style={{background:"none",border:"none",color:"#0369a1",fontSize:12,fontWeight:700,cursor:"pointer",textDecoration:"underline"}}>Sign Up</button></div>
        </>}
        {view==="signup"&&<><BackBtn onClick={function(){setView("login");setSigErr("");}} /><h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 18px"}}>Create an Account 🚀</h2><div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><div style={{marginBottom:10}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Full Name *</label><FocusInput type="text" value={sigName} onChange={function(e){setSigName(e.target.value);}} placeholder="Jane Smith" autoFocus/></div><div style={{marginBottom:10}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Phone</label><FocusInput type="tel" value={sigPhone} onChange={function(e){setSigPhone(e.target.value);}} placeholder="+1-555-0100"/></div></div><div style={{marginBottom:10}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Work Email *</label><FocusInput type="email" value={sigEmail} onChange={function(e){setSigEmail(e.target.value);}} placeholder="you@company.com"/></div><div style={{marginBottom:10}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Department</label><FocusInput type="text" value={sigDept} onChange={function(e){setSigDept(e.target.value);}} placeholder="Sales"/></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:4}}><div><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Password *</label><div style={{position:"relative"}}><FocusInput type={showP2?"text":"password"} value={sigPass} onChange={function(e){setSigPass(e.target.value);}} placeholder="Min 8 chars" extraPad/><button type="button" onClick={function(){setShowP2(!showP2);}} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#94a3b8",padding:0}}>{showP2?"🙈":"👁️"}</button></div></div><div><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Confirm *</label><div style={{position:"relative"}}><FocusInput type={showP3?"text":"password"} value={sigConf} onChange={function(e){setSigConf(e.target.value);}} placeholder="Repeat" extraPad/><button type="button" onClick={function(){setShowP3(!showP3);}} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#94a3b8",padding:0}}>{showP3?"🙈":"👁️"}</button></div></div></div>{sigPass.length>0&&<div style={{marginBottom:12}}><div style={{display:"flex",gap:4,marginBottom:3}}>{[1,2,3,4].map(function(i){return<div key={i} style={{flex:1,height:4,borderRadius:2,background:i<=str?strColor[str]:"#e2e8f0"}}/>;})}</div><div style={{fontSize:10,color:strColor[str]}}>{strLabel[str]}</div></div>}<div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#92400e"}}>⚠️ New accounts require <strong>admin approval</strong>.</div><ErrBox msg={sigErr}/><PBtn onClick={doSignup} disabled={loading}>{loading?"⏳ Creating…":"Create Account →"}</PBtn></div></>}
        {view==="pending"&&<div style={{textAlign:"center",padding:"10px 0"}}><div style={{fontSize:56,marginBottom:14}}>⏳</div><h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 10px"}}>Account Pending Approval</h2><p style={{fontSize:13,color:"#64748b",lineHeight:1.7,margin:"0 0 18px"}}>Your account for <strong>{sigEmail}</strong> has been submitted.</p><PBtn onClick={function(){setView("login");setLoginErr("");}}>← Back to Sign In</PBtn></div>}
        {view==="forgot"&&<><BackBtn onClick={function(){setView("login");setResetErr("");}} /><div style={{textAlign:"center",marginBottom:22}}><div style={{fontSize:44,marginBottom:8}}>🔑</div><h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 6px"}}>Forgot Password?</h2></div><div><div style={{marginBottom:16}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:5}}>Email Address</label><FocusInput type="email" value={resetEmail} onChange={function(e){setResetEmail(e.target.value);}} placeholder="you@company.com" autoFocus/></div><ErrBox msg={resetErr}/><PBtn onClick={doForgot} disabled={loading}>{loading?"⏳ Sending…":"Send Reset Link →"}</PBtn></div></>}
        {view==="sent"&&<div style={{textAlign:"center",padding:"10px 0"}}><div style={{fontSize:56,marginBottom:14}}>📧</div><h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 10px"}}>Check your inbox!</h2><p style={{fontSize:13,color:"#64748b",lineHeight:1.7,margin:"0 0 22px"}}>If an account exists for <strong>{resetEmail}</strong>, a reset link was sent.</p><PBtn onClick={function(){setView("login");setLoginErr("");}}>← Back to Sign In</PBtn></div>}
      </div>
      <p style={{textAlign:"center",color:"rgba(255,255,255,.4)",fontSize:11,marginTop:20}}>© 2025 Hoptix · A.eye Technology</p>
    </div>
  </div>;
}

// ── Profile Modal ─────────────────────────────────────────────────────────────
function ProfileModal(p){
  var curUser=p.curUser;var setUsers=p.setUsers;var setCurUser=p.setCurUser;var showToast=p.showToast;var addLog=p.addLog;var onClose=p.onClose;
  var[tab,setTab]=useState("profile");var[name,setName]=useState(curUser.name);var[phone,setPhone]=useState(curUser.phone||"");var[dept,setDept]=useState(curUser.dept||"");
  var[curPw,setCurPw]=useState("");var[newPw,setNewPw]=useState("");var[confPw,setConfPw]=useState("");
  var[showC,setShowC]=useState(false);var[showN,setShowN]=useState(false);var[showK,setShowK]=useState(false);
  var[pwErr,setPwErr]=useState("");var[pwOk,setPwOk]=useState("");var[saving,setSaving]=useState(false);
  function pwStr(pw){if(!pw||pw.length<8)return 1;if(pw.length>=12&&/[A-Z]/.test(pw)&&/[0-9]/.test(pw)&&/[^A-Za-z0-9]/.test(pw))return 4;if(pw.length>=10&&/[A-Z]/.test(pw)&&/[0-9]/.test(pw))return 3;return 2;}
  var strC=["","#ef4444","#f59e0b","#3b82f6","#10b981"];var strL=["","Too short","Weak","Good","Strong ✅"];var str=pwStr(newPw);
  var inp={width:"100%",padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#f8fafc",boxSizing:"border-box"};
  async function saveProfile(){if(!name.trim()){showToast("Name cannot be empty","error");return;}setSaving(true);var updated=Object.assign({},curUser,{name:name.trim(),phone:phone.trim(),dept:dept.trim()});await dbSaveUser(updated);setUsers(function(prev){return prev.map(function(u){return u.id===curUser.id?updated:u;});});setCurUser(updated);addLog("PROFILE_UPDATED",curUser.id,curUser.name+" updated profile");showToast("✅ Profile updated!");setSaving(false);onClose();}
  async function changePw(){setPwErr("");setPwOk("");if(!curPw){setPwErr("Enter your current password.");return;}var existingPw=await dbGetPassword(curUser.id);if(curPw!==existingPw){setPwErr("Current password is incorrect.");return;}if(newPw.length<8){setPwErr("New password must be at least 8 characters.");return;}if(newPw!==confPw){setPwErr("Passwords do not match.");return;}if(newPw===curPw){setPwErr("New password must differ from current.");return;}setSaving(true);await dbSetPassword(curUser.id,newPw);addLog("PASSWORD_CHANGED",curUser.id,curUser.name+" changed password");setSaving(false);setCurPw("");setNewPw("");setConfPw("");setPwOk("✅ Password changed!");showToast("Password updated!");onClose();}
  return<Modal title="My Profile" onClose={onClose}>
    <div style={{display:"flex",alignItems:"center",gap:16,padding:"0 0 20px",borderBottom:"1px solid #e2e8f0",marginBottom:20}}><div style={{width:64,height:64,borderRadius:"50%",background:avCol(curUser.id),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:24,fontWeight:800}}>{inits(curUser.name)}</div><div><div style={{fontWeight:700,fontSize:16}}>{curUser.name}</div><div style={{fontSize:12,color:"#64748b"}}>{curUser.email}</div><div style={{marginTop:4}}><Badge label={ROLE_META[curUser.role]?.label||curUser.role} color={ROLE_META[curUser.role]?.color||"#6366f1"}/></div></div></div>
    <div style={{display:"flex",gap:6,marginBottom:20}}>{["profile","password"].map(function(t){return<button key={t} onClick={function(){setTab(t);}} style={{background:tab===t?"#6366f1":"#f1f5f9",color:tab===t?"#fff":"#475569",border:"none",borderRadius:8,padding:"6px 18px",cursor:"pointer",fontSize:12,fontWeight:700}}>{t==="profile"?"👤 Profile":"🔑 Change Password"}</button>;})}</div>
    {tab==="profile"&&<div><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Full Name</label><input value={name} onChange={function(e){setName(e.target.value);}} style={inp}/></div><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Email Address</label><input value={curUser.email} disabled style={Object.assign({},inp,{background:"#f1f5f9",color:"#94a3b8",cursor:"not-allowed"})}/></div><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Phone</label><input value={phone} onChange={function(e){setPhone(e.target.value);}} style={inp}/></div><div style={{marginBottom:20}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Department</label><input value={dept} onChange={function(e){setDept(e.target.value);}} style={inp}/></div><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button onClick={onClose} style={{padding:"8px 18px",background:"#f1f5f9",color:"#475569",border:"none",borderRadius:8,fontWeight:600,fontSize:13,cursor:"pointer"}}>Cancel</button><button onClick={saveProfile} disabled={saving} style={{padding:"8px 18px",background:saving?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:8,fontWeight:600,fontSize:13,cursor:saving?"not-allowed":"pointer"}}>{saving?"⏳ Saving…":"💾 Save Changes"}</button></div></div>}
    {tab==="password"&&<div><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Current Password</label><div style={{position:"relative"}}><input type={showC?"text":"password"} value={curPw} onChange={function(e){setCurPw(e.target.value);}} placeholder="••••••••" style={Object.assign({},inp,{paddingRight:40})}/><button type="button" onClick={function(){setShowC(!showC);}} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:14,color:"#94a3b8"}}>{showC?"🙈":"👁️"}</button></div></div><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>New Password</label><div style={{position:"relative"}}><input type={showN?"text":"password"} value={newPw} onChange={function(e){setNewPw(e.target.value);}} placeholder="Min 8 characters" style={Object.assign({},inp,{paddingRight:40})}/><button type="button" onClick={function(){setShowN(!showN);}} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:14,color:"#94a3b8"}}>{showN?"🙈":"👁️"}</button></div>{newPw.length>0&&<div style={{marginTop:6}}><div style={{display:"flex",gap:4,marginBottom:3}}>{[1,2,3,4].map(function(i){return<div key={i} style={{flex:1,height:4,borderRadius:2,background:i<=str?strC[str]:"#e2e8f0"}}/>;})}</div><div style={{fontSize:10,color:strC[str]}}>{strL[str]}</div></div>}</div><div style={{marginBottom:16}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Confirm New Password</label><div style={{position:"relative"}}><input type={showK?"text":"password"} value={confPw} onChange={function(e){setConfPw(e.target.value);}} placeholder="Repeat" style={Object.assign({},inp,{paddingRight:40})}/><button type="button" onClick={function(){setShowK(!showK);}} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:14,color:"#94a3b8"}}>{showK?"🙈":"👁️"}</button></div></div>{pwErr&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:14,color:"#dc2626",fontSize:13}}>⚠️ {pwErr}</div>}{pwOk&&<div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"10px 14px",marginBottom:14,color:"#166534",fontSize:13}}>{pwOk}</div>}<div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button onClick={onClose} style={{padding:"8px 18px",background:"#f1f5f9",color:"#475569",border:"none",borderRadius:8,fontWeight:600,fontSize:13,cursor:"pointer"}}>Cancel</button><button onClick={changePw} disabled={saving} style={{padding:"8px 18px",background:saving?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:8,fontWeight:600,fontSize:13,cursor:saving?"not-allowed":"pointer"}}>{saving?"⏳ Saving…":"🔑 Change Password"}</button></div></div>}
  </Modal>;
}

// ── Root App ──────────────────────────────────────────────────────────────────
export default function App(){
  var[users,setUsers]         =useState([]);
  var[companies,setCompanies] =useState([]);
  var[clients,setClients]     =useState([]);
  var[tickets,setTicketsR]    =useState([]);
  var[ticketTypes,setTTR]     =useState([]);
  var[statusSla,setStatusSlaR]=useState(DEFAULT_STATUS_SLA);
  var[schedules,setSchedulesR]=useState({});
  var[logs,setLogsR]          =useState([]);
  var[emailTemplates,setEmailTemplates]=useState([]);
  var[curUser,setCurUserR]    =useState(function(){return loadState("hd_curUser",null);});
  var[page,setPageR]          =useState(function(){try{var s=localStorage.getItem("hd_page");var safe=["dashboard","tickets","new_ticket","time_tracking","reports","users","companies","clients","ticket_types","activity_log","integrations"];return(s&&safe.includes(s))?s:"dashboard";}catch(e){return"dashboard";}});
  var[selTicket,setSelTicket] =useState(null);
  var[toast,setToast]         =useState(null);
  var[breaches,setBreaches]   =useState([]);
  var[inboxAlerts,setInboxAlerts]=useState([]);
  var[showProfile,setShowProfile]=useState(false);
  var[loading,setLoading]     =useState(true);

  useEffect(function(){
    async function loadAll(){
      setLoading(true);
      var[u,co,cl,tt,tkt,lg,sch,et]=await Promise.all([
        dbGetUsers(),dbGetCompanies(),dbGetClients(),dbGetTicketTypes(),
        dbGetTickets(),dbGetLogs(),dbGetSchedules(),dbGetEmailTemplates()
      ]);
      setUsers(u);setCompanies(co);setClients(cl);setTTR(tt);
      setTicketsR(tkt);setLogsR(lg);setSchedulesR(sch);setEmailTemplates(et);
      setLoading(false);
    }
    loadAll();
  },[]);

  useEffect(function(){
    var sub=supabase.channel('tickets-changes')
      .on('postgres_changes',{event:'*',schema:'public',table:'tickets'},function(){
        dbGetTickets().then(function(t){setTicketsR(t);});
      })
      .on('postgres_changes',{event:'*',schema:'public',table:'users'},function(){
        dbGetUsers().then(function(u){setUsers(u);});
      })
      .subscribe();
    return function(){supabase.removeChannel(sub);};
  },[]);

  async function setTickets(updater){
    var prev=tickets;
    var next=typeof updater==="function"?updater(prev):updater;
    setTicketsR(next);
    var changed=next.filter(function(t){
      var old=prev.find(function(p){return p.id===t.id;});
      return !old||JSON.stringify(old)!==JSON.stringify(t);
    });
    for(var i=0;i<changed.length;i++){await dbSaveTicket(changed[i]);}
  }

  function setCurUser(u){if(u)saveState("hd_curUser",u);else clearAuth();setCurUserR(u);}
  function setPage(v){if(v!=="integrations")saveState("hd_page",v);setPageR(v);}

  var addLog=useCallback(function(action,target,detail,uId){
    var entry={id:uid(),action,userId:uId||curUser?.id,target,detail,timestamp:new Date().toISOString()};
    setLogsR(function(p){return[entry].concat(p).slice(0,500);});
    dbAddLog(entry);
  },[curUser]);

  var showToast=useCallback(function(msg,type){setToast({msg,type:type||"ok"});setTimeout(function(){setToast(null);},3500);},[]);

  useEffect(function(){
    function check(){setBreaches(tickets.filter(function(t){if(t.deleted||t.status==="Closed")return false;var s=getStatusSla(t,statusSla,schedules);return s&&s.breached;}));}
    check();var iv=setInterval(check,30000);return function(){clearInterval(iv);};
  },[tickets,statusSla,schedules]);

  useEffect(function(){
    if(!curUser)return;
    async function fetchReplies(){
      try{var res=await fetch("/api/fetch-replies");if(!res.ok)return;var data=await res.json();if(!data.replies||!data.replies.length)return;
        var updated=tickets.slice();
        data.replies.forEach(function(reply){var idx=updated.findIndex(function(t){return t.id===reply.ticketId;});if(idx<0)return;var ticket=updated[idx];var dupId="reply_"+reply.uid;if((ticket.conversations||[]).some(function(c){return c.id===dupId;}))return;var msg={id:dupId,from:null,fromEmail:reply.fromEmail,fromName:reply.fromName,to:[],toEmails:[],cc:[],subject:reply.subject,body:reply.body.trim(),timestamp:reply.timestamp,isExternal:true,status:"received"};updated[idx]=Object.assign({},ticket,{conversations:(ticket.conversations||[]).concat([msg]),hasUnreadReply:true});});
        setTickets(function(){return updated;});
        setInboxAlerts(function(prev){return prev.concat(data.replies);});
        showToast("📬 "+data.replies.length+" new email repl"+(data.replies.length>1?"ies":"y")+" received!");
      }catch(e){}
    }
    fetchReplies();var iv=setInterval(fetchReplies,60000);return function(){clearInterval(iv);};
  },[curUser]);

  var isAdmin=["admin","it_manager"].includes(curUser?.role);
  var isTech=IT_ROLES.includes(curUser?.role);
  var pendingUsers=useMemo(function(){return isAdmin?users.filter(function(u){return !u.active;}):[]},[users,isAdmin]);
  var visible=useMemo(function(){return tickets.filter(function(t){return !t.deleted&&(isTech||t.submittedBy===curUser?.id||t.assignedTo===curUser?.id);});},[tickets,curUser,isTech]);
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

  var curNav=NAV.find(function(n){return n.id===page;})||{icon:"",label:"—"};

  return<ErrorBoundary>
    <div style={{display:"flex",height:"100vh",fontFamily:"'Inter',system-ui,sans-serif",background:"#f8fafc",fontSize:13,overflow:"hidden"}}>
      <style>{`*{box-sizing:border-box}::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:#f1f5f9}::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:4px}button:hover{opacity:.88}.nv:hover{background:rgba(14,165,233,.15)!important;color:#7dd3fc!important}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{width:220,background:"linear-gradient(180deg,#020e1f,#041833,#062d6b)",display:"flex",flexDirection:"column",flexShrink:0}}>
        <div style={{padding:"20px 16px 14px",borderBottom:"1px solid rgba(56,189,248,.15)"}}><div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:32,height:32,borderRadius:"50%",background:"linear-gradient(135deg,#fff 60%,#b3d9ff)",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:20,height:20,borderRadius:"50%",background:"linear-gradient(135deg,#0369a1,#0ea5e9)",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:8,height:8,borderRadius:"50%",background:"#020e1f"}}/></div></div><div><div style={{color:"#fff",fontWeight:800,fontSize:15}}>hoptix</div><div style={{color:"#38bdf8",fontSize:9}}>A.eye technology</div></div></div></div>
        <div style={{padding:"8px",flex:1,overflowY:"auto"}}>{NAV.map(function(n){return<div key={n.id} className="nv" onClick={function(){setPage(n.id);}} style={{padding:"9px 12px",borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",gap:8,marginBottom:2,background:page===n.id?"rgba(14,165,233,.25)":"transparent",color:page===n.id?"#fff":"#93c5fd",fontWeight:page===n.id?700:500,fontSize:12,borderLeft:page===n.id?"3px solid #0ea5e9":"3px solid transparent"}}><span style={{fontSize:14}}>{n.icon}</span>{n.label}{n.id==="tickets"&&breaches.length>0&&<span style={{marginLeft:"auto",background:"#ef4444",color:"#fff",borderRadius:10,padding:"1px 6px",fontSize:10}}>{breaches.length}</span>}</div>;})}</div>
        <div style={{padding:"12px 10px",borderTop:"1px solid rgba(56,189,248,.15)"}}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}><Avatar name={curUser.name} id={curUser.id} size={32}/><div style={{flex:1,overflow:"hidden"}}><div style={{color:"#fff",fontSize:12,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{curUser.name}</div><div style={{color:"#7dd3fc",fontSize:10}}>{ROLE_META[curUser.role]?.label||curUser.role}</div></div></div><button onClick={function(){try{if(localStorage.getItem("hd_rememberMe")!=="true")localStorage.removeItem("hd_savedCreds");}catch(e){}setCurUser(null);setPage("dashboard");setSelTicket(null);}} style={{width:"100%",padding:"7px",background:"rgba(239,68,68,.2)",color:"#fca5a5",border:"1px solid rgba(239,68,68,.3)",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>🚪 Sign Out</button></div>
      </div>
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",padding:"10px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div style={{fontWeight:700,fontSize:14,color:"#1e293b"}}>{curNav.icon} {curNav.label}</div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            {pendingUsers.length>0&&isAdmin&&<div onClick={function(){setPage("users");}} style={{cursor:"pointer",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:20,padding:"4px 12px",color:"#92400e",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",gap:6}}>⏳ {pendingUsers.length} Pending Approval{pendingUsers.length>1?"s":""}</div>}
            {breaches.length>0&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:20,padding:"4px 12px",color:"#dc2626",fontSize:11,fontWeight:700}}>⚠️ {breaches.length} SLA Breach{breaches.length>1?"es":""}</div>}
            {inboxAlerts.length>0&&<div style={{position:"relative",cursor:"pointer"}} onClick={function(){setPage("tickets");}}>
              <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:20,padding:"4px 12px",color:"#0369a1",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",gap:6}}>
                📬 {inboxAlerts.length} new repl{inboxAlerts.length>1?"ies":"y"}
                <button onClick={function(e){e.stopPropagation();setInboxAlerts([]);}} style={{background:"none",border:"none",cursor:"pointer",color:"#64748b",fontSize:12,padding:0,lineHeight:1}}>✕</button>
              </div>
            </div>}
            <button onClick={function(){setShowProfile(true);}} style={{display:"flex",alignItems:"center",gap:8,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"5px 12px 5px 6px",cursor:"pointer"}}><Avatar name={curUser.name} id={curUser.id} size={28}/><div style={{textAlign:"left"}}><div style={{fontWeight:700,fontSize:12}}>{curUser.name}</div><div style={{fontSize:10,color:"#94a3b8"}}>{ROLE_META[curUser.role]?.label||curUser.role}</div></div><span style={{fontSize:10,color:"#94a3b8",marginLeft:4}}>▼</span></button>
          </div>
        </div>
        {toast&&<div style={{position:"fixed",top:20,right:20,zIndex:10000,background:toast.type==="error"?"#ef4444":"#10b981",color:"#fff",padding:"10px 20px",borderRadius:10,fontWeight:600,fontSize:13,boxShadow:"0 4px 20px rgba(0,0,0,.2)"}}>{toast.msg}</div>}
        <div style={{flex:1,overflowY:"auto",padding:24}}>
          {page==="dashboard"    &&<PageDashboard   tickets={visible} allTickets={allNonDeleted} users={users} ticketTypes={ticketTypes} companies={companies} clients={clients} setPage={setPage} setSelTicket={setSelTicket} breaches={breaches}/>}
          {page==="tickets"      &&<PageTickets     tickets={visible} users={users} companies={companies} clients={clients} ticketTypes={ticketTypes} curUser={curUser} setTickets={setTickets} addLog={addLog} showToast={showToast} setSelTicket={setSelTicket} setPage={setPage} isAdmin={isAdmin} statusSla={statusSla} schedules={schedules}/>}
          {page==="new_ticket"   &&<PageNewTicket   users={users} companies={companies} clients={clients} ticketTypes={ticketTypes} curUser={curUser} setTickets={setTickets} addLog={addLog} showToast={showToast} setPage={setPage}/>}
          {page==="time_tracking"&&<PageTimeTracking tickets={visible} users={users} ticketTypes={ticketTypes} curUser={curUser} isAdmin={isAdmin} isTech={isTech} setSelTicket={setSelTicket}/>}
          {page==="reports"      &&<PageReports     tickets={visible} users={users} ticketTypes={ticketTypes} companies={companies} clients={clients} statusSla={statusSla} schedules={schedules}/>}
          {page==="users"        &&<PageUsers       users={users} companies={companies} setUsers={setUsers} curUser={curUser} addLog={addLog} showToast={showToast} schedules={schedules} setSchedules={setSchedulesR} dbSaveUser={dbSaveUser} dbDeleteUser={dbDeleteUser} dbSetPassword={dbSetPassword} dbSaveSchedule={dbSaveSchedule}/>}
          {page==="companies"    &&<PageCompanies   companies={companies} users={users} setCompanies={setCompanies} addLog={addLog} showToast={showToast} dbSaveCompany={dbSaveCompany} dbDeleteCompany={dbDeleteCompany}/>}
          {page==="clients"      &&<PageClients     clients={clients} setClients={setClients} companies={companies} addLog={addLog} showToast={showToast} dbSaveClient={dbSaveClient} dbDeleteClient={dbDeleteClient}/>}
          {page==="ticket_types" &&<PageTicketTypes ticketTypes={ticketTypes} users={users} setTicketTypes={setTTR} statusSla={statusSla} setStatusSla={setStatusSlaR} addLog={addLog} showToast={showToast} dbSaveTicketType={dbSaveTicketType} dbDeleteTicketType={dbDeleteTicketType}/>}
          {page==="activity_log" &&<PageActivityLog logs={logs} users={users}/>}
          {page==="integrations" &&<PageIntegrations showToast={showToast} addLog={addLog} emailTemplates={emailTemplates} setEmailTemplates={setEmailTemplates} curUser={curUser} isAdmin={isAdmin}/>}
        </div>
      </div>
      {selTicket&&<TicketDetail ticket={tickets.find(function(t){return t.id===selTicket;})} setTickets={setTickets} users={users} ticketTypes={ticketTypes} companies={companies} clients={clients} curUser={curUser} isAdmin={isAdmin} isTech={isTech} addLog={addLog} showToast={showToast} statusSla={statusSla} schedules={schedules} emailTemplates={emailTemplates} onClose={function(){setSelTicket(null);}}/>}
      {showProfile&&<ProfileModal curUser={curUser} setUsers={setUsers} setCurUser={setCurUser} showToast={showToast} addLog={addLog} onClose={function(){setShowProfile(false);}}/>}
    </div>
  </ErrorBoundary>;
}

// ── Ticket History ───────────────────────────────────────────────────────────
function TicketHistory(p){
  var ticket=p.ticket;var users=p.users;var curUser=p.curUser;
  var[chats,setChats]=useState([]);
  useEffect(function(){
    dbGetChats(ticket.id).then(function(data){setChats(data);});
  },[ticket.id]);
  function fu(id){return users.find(function(u){return u.id===id;});}
  var events=[];
  (ticket.statusHistory||[]).filter(function(h){return !h._noSlaReset||h.note;}).forEach(function(h){
    events.push({type:"status",time:h.timestamp,data:h});
  });
  (ticket.conversations||[]).forEach(function(m){
    events.push({type:"email",time:m.timestamp,data:m});
  });
  chats.forEach(function(m){
    events.push({type:"chat",time:m.created_at,data:m});
  });
  events.sort(function(a,b){return new Date(b.time)-new Date(a.time);});
  if(events.length===0)return<div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No history yet.</div>;
  return<div>
    <div style={{fontWeight:700,color:"#1e293b",marginBottom:16}}>📜 Ticket Timeline</div>
    {events.map(function(ev,i){
      if(ev.type==="status"){
        var h=ev.data;
        return<div key={i} style={{display:"flex",gap:12,marginBottom:12}}>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0}}>
            <div style={{width:32,height:32,borderRadius:8,background:(STATUS_META[h.status]?.color||"#6366f1")+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>🔄</div>
            {i<events.length-1&&<div style={{width:2,flex:1,background:"#e2e8f0",marginTop:4,minHeight:16}}/>}
          </div>
          <div style={{flex:1,background:"#f8fafc",borderRadius:8,padding:10,marginBottom:4}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <Badge label={h.status} color={STATUS_META[h.status]?.color||"#6366f1"}/>
              <span style={{fontSize:10,color:"#94a3b8"}}>{fdt(h.timestamp)}</span>
            </div>
            <div style={{fontSize:11,color:"#64748b"}}>Assigned: <strong>{fu(h.assignedTo)?.name||"Unassigned"}</strong></div>
            <div style={{fontSize:11,color:"#475569"}}>By: {fu(h.changedBy)?.name||"System"}</div>
            {h.note&&<div style={{fontSize:11,color:"#334155",marginTop:4,fontStyle:"italic"}}>{h.note}</div>}
          </div>
        </div>;
      }
      if(ev.type==="email"){
        var m=ev.data;var isReply=m.isExternal||m.status==="received";
        var sender=isReply?(m.fromName||m.fromEmail):(fu(m.from)?.name||curUser.name);
        return<div key={i} style={{display:"flex",gap:12,marginBottom:12}}>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0}}>
            <div style={{width:32,height:32,borderRadius:8,background:"#e0f2fe",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>{isReply?"📬":"📧"}</div>
            {i<events.length-1&&<div style={{width:2,flex:1,background:"#e2e8f0",marginTop:4,minHeight:16}}/>}
          </div>
          <div style={{flex:1,background:isReply?"#f0fdf4":"#f0f9ff",borderRadius:8,padding:10,marginBottom:4,border:"1px solid "+(isReply?"#bbf7d0":"#bae6fd")}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{fontSize:12,fontWeight:700,color:isReply?"#166534":"#0369a1"}}>{isReply?"📬 Reply received":"📧 Email sent"}</span>
              <span style={{fontSize:10,color:"#94a3b8"}}>{fdt(m.timestamp)}</span>
            </div>
            <div style={{fontSize:11,color:"#64748b",marginBottom:4}}>From: <strong>{sender}</strong>{!isReply&&m.toEmails&&m.toEmails.length>0&&<span> → {m.toEmails.join(", ")}</span>}</div>
            <div style={{fontSize:11,color:"#64748b",marginBottom:4}}>Subject: {m.subject}</div>
            <div style={{fontSize:12,color:"#334155",background:"rgba(255,255,255,.6)",borderRadius:6,padding:"6px 8px",maxHeight:60,overflow:"hidden",whiteSpace:"pre-wrap"}}>{m.body?.slice(0,120)}{m.body?.length>120?"…":""}</div>
          </div>
        </div>;
      }
      if(ev.type==="chat"){
        var cm=ev.data;var csender=fu(cm.user_id);var isMe=cm.user_id===curUser.id;
        return<div key={i} style={{display:"flex",gap:12,marginBottom:12}}>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0}}>
            <div style={{width:32,height:32,borderRadius:8,background:"#eef2ff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>💬</div>
            {i<events.length-1&&<div style={{width:2,flex:1,background:"#e2e8f0",marginTop:4,minHeight:16}}/>}
          </div>
          <div style={{flex:1,background:isMe?"#eef2ff":"#f8fafc",borderRadius:8,padding:10,marginBottom:4,border:"1px solid "+(isMe?"#c7d2fe":"#e2e8f0")}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{fontSize:12,fontWeight:700,color:isMe?"#4338ca":"#334155"}}>💬 {isMe?"You":csender?.name||"Unknown"}</span>
              <span style={{fontSize:10,color:"#94a3b8"}}>{fdt(cm.created_at)}</span>
            </div>
            <div style={{fontSize:12,color:"#334155"}}>{cm.message}</div>
          </div>
        </div>;
      }
      return null;
    })}
  </div>;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function PageDashboard(p){
  var tickets=p.tickets;var allTickets=p.allTickets||p.tickets;var users=p.users;var ticketTypes=p.ticketTypes;var clients=p.clients;var setPage=p.setPage;var setSelTicket=p.setSelTicket;var breaches=p.breaches;
  var byStatus=ALL_STATUSES.map(function(s){return{name:s,value:tickets.filter(function(t){return t.status===s;}).length,color:STATUS_META[s].color};});
  var byPri=Object.keys(PRI_META).map(function(k){return{name:PRI_META[k].label,value:tickets.filter(function(t){return t.priority===k;}).length,color:PRI_META[k].color};});
  var daily=Array.from({length:7},function(_,i){var d=new Date(Date.now()-(6-i)*86400000);return{lbl:d.toLocaleDateString("en",{weekday:"short"}),created:tickets.filter(function(t){return new Date(t.createdAt).toDateString()===d.toDateString();}).length,closed:tickets.filter(function(t){return t.closedAt&&new Date(t.closedAt).toDateString()===d.toDateString();}).length};});
  var techs=users.filter(function(u){return["it_technician","it_manager"].includes(u.role);});
  var byType=ticketTypes.map(function(tt,i){return{name:tt.name,value:tickets.filter(function(t){return t.typeId===tt.id;}).length,fill:PAL[i%PAL.length]};}).filter(function(x){return x.value>0;});
  return<div>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
      <Stat label="Total Tickets" value={tickets.length} icon="🎫" color="#6366f1"/>
      <Stat label="Open" value={tickets.filter(function(t){return t.status==="Open";}).length} icon="📬" color="#f59e0b"/>
      <Stat label="In Progress" value={tickets.filter(function(t){return t.status==="In Progress";}).length} icon="⚙️" color="#6366f1"/>
      <Stat label="Escalated" value={tickets.filter(function(t){return t.status==="Escalated";}).length} icon="🔺" color="#7c3aed" sub="need senior review"/>
      <Stat label="Closed" value={allTickets.filter(function(t){return t.status==="Closed";}).length} icon="✅" color="#10b981"/>
      <Stat label="SLA Breaches" value={breaches.length} icon="🚨" color="#ef4444" sub="need attention"/>
      <Stat label="Active Clients" value={clients.length} icon="🤝" color="#8b5cf6" sub={clients.reduce(function(a,c){return a+c.locations.length;},0)+" locations"}/>
    </div>
    {breaches.length>0&&<Card style={{marginBottom:20,borderLeft:"4px solid #ef4444",background:"#fef2f2"}}><div style={{fontWeight:700,color:"#dc2626",marginBottom:10}}>🚨 SLA Breach Alerts</div>{breaches.slice(0,5).map(function(t){return<div key={t.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#fff",padding:"8px 12px",borderRadius:8,border:"1px solid #fecaca",marginBottom:6}}><span style={{fontWeight:600,fontSize:12}}>#{t.id} — {t.title}</span><div style={{display:"flex",gap:8,alignItems:"center"}}><Badge label={t.status} color={STATUS_META[t.status]?.color||"#6366f1"}/><Btn size="sm" variant="ghost" onClick={function(){setSelTicket(t.id);}}>View</Btn></div></div>;})} </Card>}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginBottom:16}}>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>Tickets by Status</div><ResponsiveContainer width="100%" height={200}><PieChart><Pie data={byStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={pieLabel} fontSize={9}>{byStatus.map(function(e,i){return<Cell key={i} fill={e.color}/>;})}</Pie><Tooltip/></PieChart></ResponsiveContainer></Card>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>7-Day Trend</div><ResponsiveContainer width="100%" height={200}><AreaChart data={daily}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="lbl" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Legend wrapperStyle={{fontSize:10}}/><Area type="monotone" dataKey="created" stroke="#6366f1" fill="#eef2ff" name="Created"/><Area type="monotone" dataKey="closed" stroke="#10b981" fill="#d1fae5" name="Closed"/></AreaChart></ResponsiveContainer></Card>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>By Priority</div><ResponsiveContainer width="100%" height={200}><BarChart data={byPri}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="value" radius={[4,4,0,0]}>{byPri.map(function(e,i){return<Cell key={i} fill={e.color}/>;})}</Bar></BarChart></ResponsiveContainer></Card>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>Technician Workload</div>{techs.map(function(t){var open=tickets.filter(function(tk){return tk.assignedTo===t.id&&tk.status!=="Closed";}).length;var total=tickets.filter(function(tk){return tk.assignedTo===t.id;}).length;return<div key={t.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}><Avatar name={t.name} id={t.id} size={26}/><div style={{flex:1}}><div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontWeight:600}}><span>{t.name}</span><span style={{color:"#6366f1"}}>{open} open / {total} total</span></div><div style={{background:"#e2e8f0",borderRadius:4,height:6,marginTop:4}}><div style={{background:"#6366f1",height:6,borderRadius:4,width:(total?Math.min(100,Math.round(open/total*100)):0)+"%"}}/></div></div></div>;})}</Card>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>Tickets by Type</div>{byType.slice(0,7).map(function(t,i){return<div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid #f1f5f9"}}><span style={{fontSize:12,color:"#475569"}}>{t.name}</span><Badge label={t.value} color={PAL[i%PAL.length]}/></div>;})}</Card>
    </div>
  </div>;
}

// ── Tickets ───────────────────────────────────────────────────────────────────
function PageTickets(p){
  var tickets=p.tickets;var users=p.users;var clients=p.clients;var ticketTypes=p.ticketTypes;var curUser=p.curUser;
  var setTickets=p.setTickets;var addLog=p.addLog;var showToast=p.showToast;var setSelTicket=p.setSelTicket;var setPage=p.setPage;var isAdmin=p.isAdmin;var statusSla=p.statusSla;var schedules=p.schedules||{};
  var[search,setSearch]=useState("");var[fStat,setFStat]=useState("");var[fPri,setFPri]=useState("");var[fType,setFType]=useState("");
  var filtered=tickets.filter(function(t){var q=search.toLowerCase();return(!q||t.title.toLowerCase().includes(q)||t.id.includes(q)||t.description.toLowerCase().includes(q))&&(!fStat||t.status===fStat)&&(!fPri||t.priority===fPri)&&(!fType||t.typeId===fType);});
  function delTicket(id){setTickets(function(prev){return prev.map(function(t){return t.id===id?Object.assign({},t,{deleted:true}):t;});});addLog("TICKET_DELETED",id,"Ticket #"+id+" deleted");showToast("Ticket deleted");}
  function fu(id){return users.find(function(x){return x.id===id;});}
  function ftt(id){return ticketTypes.find(function(x){return x.id===id;});}
  function fcl(id){return clients.find(function(x){return x.id===id;});}
  function getLoc(cid,lid){var c=fcl(cid);return c?c.locations.find(function(l){return l.id===lid;}):null;}
  return<div>
    <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
      <input value={search} onChange={function(e){setSearch(e.target.value);}} placeholder="Search..." style={{flex:1,minWidth:160,padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}/>
      <select value={fStat} onChange={function(e){setFStat(e.target.value);}} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}><option value="">All Statuses</option>{ALL_STATUSES.map(function(s){return<option key={s} value={s}>{s}</option>;})}</select>
      <select value={fPri} onChange={function(e){setFPri(e.target.value);}} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}><option value="">All Priorities</option>{Object.keys(PRI_META).map(function(k){return<option key={k} value={k}>{PRI_META[k].label}</option>;})}</select>
      <select value={fType} onChange={function(e){setFType(e.target.value);}} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}><option value="">All Types</option>{ticketTypes.map(function(t){return<option key={t.id} value={t.id}>{t.name}</option>;})}</select>
      <Btn onClick={function(){setPage("new_ticket");}}>➕ New Ticket</Btn>
    </div>
    <div style={{background:"#fff",borderRadius:12,border:"1px solid #e2e8f0",overflow:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",minWidth:900}}>
        <thead><tr style={{background:"#f8fafc"}}>{["#","Title","Type","Priority","Status","Client","Location","Assigned To","Status SLA",""].map(function(h){return<th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.5,borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>{h}</th>;})}</tr></thead>
        <tbody>
          {filtered.length===0&&<tr><td colSpan={10} style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No tickets found</td></tr>}
          {filtered.map(function(t,i){
            var asgn=fu(t.assignedTo);var type=ftt(t.typeId);var client=fcl(t.clientId);var loc=getLoc(t.clientId,t.locationId);
            var pri=PRI_META[t.priority]||PRI_META.medium;var sm=STATUS_META[t.status]||STATUS_META.Open;
            var sSla=getStatusSla(t,statusSla,schedules);
            return<tr key={t.id} style={{borderBottom:"1px solid #f1f5f9",background:i%2===0?"#fff":"#fafafa"}}>
              <td style={{padding:"9px 12px",fontSize:11,color:"#94a3b8",fontWeight:600}}>#{t.id}</td>
              <td style={{padding:"9px 12px",maxWidth:180}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <div><div style={{fontWeight:600,color:"#1e293b",fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.title}</div><div style={{fontSize:10,color:"#94a3b8"}}>{ago(t.createdAt)}</div></div>
                  {t.hasUnreadReply&&<span style={{background:"#10b981",color:"#fff",borderRadius:10,padding:"1px 7px",fontSize:10,fontWeight:700,flexShrink:0}}>📬 New Reply</span>}
                </div>
              </td>
              <td style={{padding:"9px 12px"}}><Badge label={type?.name||"—"} color={type?.color||"#94a3b8"}/></td>
              <td style={{padding:"9px 12px"}}><Badge label={pri.label} color={pri.color} bg={pri.bg}/></td>
              <td style={{padding:"9px 12px"}}><Badge label={t.status} color={sm.color} bg={sm.bg}/></td>
              <td style={{padding:"9px 12px",fontSize:11,color:"#334155"}}>{client?<span>🤝 {client.name}</span>:<span style={{color:"#94a3b8"}}>—</span>}</td>
              <td style={{padding:"9px 12px",fontSize:11,color:"#334155"}}>{loc?<span>📍 {loc.name}</span>:<span style={{color:"#94a3b8"}}>—</span>}</td>
              <td style={{padding:"9px 12px"}}>{asgn?<div style={{display:"flex",alignItems:"center",gap:6}}><Avatar name={asgn.name} id={asgn.id} size={22}/><span style={{fontSize:11}}>{asgn.name}</span></div>:<span style={{fontSize:11,color:"#ef4444"}}>Unassigned</span>}</td>
              <td style={{padding:"9px 12px",minWidth:140}}>
                {sSla?<div><div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:3}}><span style={{color:sSla.breached?"#ef4444":sSla.hasSchedule&&!sSla.onShift?"#94a3b8":"#64748b",fontWeight:600}}>{sSla.breached?"⚠️ Breached":sSla.hasSchedule&&!sSla.onShift?"⏸ Off shift":"⏱ "+sSla.remaining.toFixed(1)+"h left"}</span><span style={{color:"#94a3b8"}}>{sSla.pct}%</span></div><div style={{height:5,background:"#e2e8f0",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:sSla.pct+"%",background:sSla.hasSchedule&&!sSla.onShift?"#94a3b8":sSla.pct>=100?"#ef4444":sSla.pct>=75?"#f59e0b":"#10b981",borderRadius:3}}/></div><div style={{fontSize:9,color:"#94a3b8",marginTop:2}}>{sSla.hoursSpent}h / {sSla.hoursAllowed}h{sSla.hasSchedule?" (shift hrs)":""}</div></div>:<span style={{fontSize:10,color:"#94a3b8"}}>— closed</span>}
              </td>
              <td style={{padding:"9px 12px"}}><div style={{display:"flex",gap:4}}>
                <Btn size="sm" variant="ghost" onClick={function(){if(t.hasUnreadReply)setTickets(function(prev){return prev.map(function(tk){return tk.id===t.id?Object.assign({},tk,{hasUnreadReply:false}):tk;});});setSelTicket(t.id);}}>View</Btn>
                {isAdmin&&<Btn size="sm" variant="danger" onClick={function(){delTicket(t.id);}}>🗑</Btn>}
              </div></td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </div>;
}

// ── New Ticket ────────────────────────────────────────────────────────────────
function PageNewTicket(p){
  var users=p.users;var companies=p.companies;var clients=p.clients;var ticketTypes=p.ticketTypes;var curUser=p.curUser;
  var setTickets=p.setTickets;var addLog=p.addLog;var showToast=p.showToast;var setPage=p.setPage;
  var[form,setForm]=useState({title:"",description:"",typeId:ticketTypes[0]?.id||"",companyId:curUser.companyId||companies[0]?.id||"",clientId:"",locationId:"",externalEmail:"",customTypeName:""});
  var[start]=useState(Date.now());var[preview,setPreview]=useState(null);var[attachments,setAttachments]=useState([]);var[dragOver,setDragOver]=useState(false);
  function fld(k,v){setForm(function(prev){return Object.assign({},prev,{[k]:v});});}
  var selType=ticketTypes.find(function(t){return t.id===form.typeId;});var isOthers=selType&&selType.name==="Others";
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
    var mins=Math.max(0.017,(Date.now()-start)/60000);var formOpenedAt=new Date(start).toISOString();
    var draft=Object.assign({},form,{id:"t"+Date.now(),status:"Open",priority:tt?tt.priority:"medium",submittedBy:curUser.id,assignedTo:assign.id,createdAt:now,updatedAt:now,submittedAt:now,formOpenedAt:formOpenedAt,slaDeadline:sla,slaBreached:false,timeToCreateMins:mins,statusHistory:[{status:"Open",assignedTo:assign.id,timestamp:now,changedBy:curUser.id,note:"Ticket created — "+assign.reason}],conversations:[],closedAt:null,deleted:false,aiReason:assign.reason,attachments:attachments});
    setPreview({draft:draft,assign:assign});
  }
  function handleSubmit(){setTickets(function(prev){return prev.concat([preview.draft]);});addLog("TICKET_CREATED",preview.draft.id,"Ticket \""+preview.draft.title+"\" created. "+preview.assign.reason);showToast("✅ Ticket submitted!");setPage("tickets");}
  var previewData=preview?[["Title",preview.draft.title],["Priority",PRI_META[preview.draft.priority]?.label],["SLA",fdt(preview.draft.slaDeadline)],["Submitted At",fdt(preview.draft.submittedAt)],["Create Time",fmtMs(preview.draft.timeToCreateMins)],["Assigned To",(users.find(function(u){return u.id===preview.draft.assignedTo;})||{name:"Unassigned"}).name],["Attachments",preview.draft.attachments.length+" files"]]:[];
  return<div style={{maxWidth:680,margin:"0 auto"}}>
    <Card>
      <div style={{fontWeight:700,fontSize:15,color:"#1e293b",marginBottom:18}}>📋 Submit New Ticket</div>
      {ticketTypes.length===0&&<div style={{background:"#fef3c7",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#92400e"}}>⚠️ No ticket types configured. Ask your admin to add ticket types first.</div>}
      <FInput label="Title *" value={form.title} onChange={function(e){fld("title",e.target.value);}} placeholder="Brief description"/>
      {ticketTypes.length>0&&<FSelect label="Ticket Type *" value={form.typeId} onChange={function(e){fld("typeId",e.target.value);}} options={optTypes(ticketTypes)}/>}
      {isOthers&&<FInput label="Describe Type *" value={form.customTypeName} onChange={function(e){fld("customTypeName",e.target.value);}} placeholder="Describe this type"/>}
      {companies.length>0&&<FSelect label="Company *" value={form.companyId} onChange={function(e){fld("companyId",e.target.value);}} options={optCompanies(companies)}/>}
      <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:14,marginBottom:14}}>
        <div style={{fontWeight:700,color:"#1e293b",fontSize:12,marginBottom:12}}>🤝 Client &amp; Location</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Client</label><select value={form.clientId} onChange={function(e){fld("clientId",e.target.value);fld("locationId","");}} style={{width:"100%",padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#fff",boxSizing:"border-box"}}>{optClients(clients).map(function(o){return<option key={o.value} value={o.value}>{o.label}</option>;})}</select></div>
          <div><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Location</label><select value={form.locationId} onChange={function(e){fld("locationId",e.target.value);}} disabled={!form.clientId} style={{width:"100%",padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:form.clientId?"#fff":"#f1f5f9",boxSizing:"border-box"}}>{optLocs(availLocs).map(function(o){return<option key={o.value} value={o.value}>{o.label}</option>;})}</select></div>
        </div>
        {selClient&&<div style={{marginTop:8,fontSize:11,color:"#475569",display:"flex",gap:16,flexWrap:"wrap"}}><span>📧 {selClient.email}</span><span>📞 {selClient.phone}</span></div>}
      </div>
      <FTextarea label="Description *" value={form.description} onChange={function(e){fld("description",e.target.value);}} placeholder="Detailed description..." rows={5}/>
      <FInput label="External Email (optional)" value={form.externalEmail} onChange={function(e){fld("externalEmail",e.target.value);}} placeholder="external@client.com" type="email"/>
      <div style={{marginBottom:14}}>
        <label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:6}}>📎 Attachments <span style={{fontWeight:400,color:"#94a3b8"}}>(images &amp; videos, max 10 · 20MB)</span></label>
        <div onDragOver={function(e){e.preventDefault();setDragOver(true);}} onDragLeave={function(){setDragOver(false);}} onDrop={function(e){e.preventDefault();setDragOver(false);processFiles(e.dataTransfer.files);}} onClick={function(){document.getElementById("tfi").click();}} style={{border:"2px dashed "+(dragOver?"#6366f1":"#cbd5e1"),borderRadius:10,padding:"20px 16px",textAlign:"center",cursor:"pointer",background:dragOver?"#eef2ff":"#f8fafc",marginBottom:10}}>
          <div style={{fontSize:24,marginBottom:6}}>🖼️</div><div style={{fontSize:13,fontWeight:600,color:dragOver?"#4338ca":"#475569"}}>Drop images or videos here</div><div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>or click to browse</div>
        </div>
        <input id="tfi" type="file" multiple accept="image/*,video/*" style={{display:"none"}} onChange={function(e){processFiles(e.target.files);e.target.value="";}}/>
        {attachments.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(100px,1fr))",gap:8}}>{attachments.map(function(a){return<div key={a.id} style={{position:"relative",borderRadius:8,overflow:"hidden",border:"1px solid #e2e8f0"}}>{a.type.startsWith("image/")?<img src={a.dataUrl} alt={a.name} style={{width:"100%",height:80,objectFit:"cover",display:"block"}}/>:<div style={{height:80,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,background:"#1e1b4b"}}><span style={{fontSize:28}}>🎬</span></div>}<div style={{padding:"3px 6px",fontSize:9,color:"#64748b",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{a.name} · {fmtSize(a.size)}</div><button onClick={function(e){e.stopPropagation();removeAtt(a.id);}} style={{position:"absolute",top:3,right:3,background:"rgba(0,0,0,.55)",color:"#fff",border:"none",borderRadius:"50%",width:18,height:18,cursor:"pointer",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button></div>;})}</div>}
      </div>
      {selType&&<div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:8,padding:12,marginBottom:14,fontSize:12}}><div style={{fontWeight:700,color:"#0369a1",marginBottom:4}}>Auto-settings for "{selType.name}"</div><div style={{display:"flex",gap:16,color:"#0c4a6e",flexWrap:"wrap"}}><span>⚡ Priority: <strong>{PRI_META[selType.priority]?.label}</strong></span><span>⏱ SLA: <strong>{selType.slaHours}h</strong></span><span>🤖 AI auto-assign</span></div></div>}
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setPage("tickets");}}>Cancel</Btn><Btn onClick={handlePreview}>🔍 Preview &amp; Submit</Btn></div>
    </Card>
    {preview&&<Modal title="Confirm Submission" onClose={function(){setPreview(null);}}>
      <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:12,marginBottom:14}}><div style={{fontWeight:700,color:"#166534",marginBottom:4}}>🤖 AI Assignment</div><div style={{fontSize:12,color:"#14532d"}}>{preview.assign.reason}</div></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>{previewData.map(function(pair){var l=pair[0];var v=pair[1];return<div key={l} style={{background:"#f8fafc",padding:10,borderRadius:8}}><div style={{color:"#64748b",fontSize:10,fontWeight:700,textTransform:"uppercase"}}>{l}</div><div style={{fontWeight:600,color:"#1e293b",marginTop:2,fontSize:12}}>{v||"—"}</div></div>;})}</div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setPreview(null);}}>Edit</Btn><Btn variant="success" onClick={handleSubmit}>✅ Confirm &amp; Submit</Btn></div>
    </Modal>}
  </div>;
}

// ── Ticket Detail ─────────────────────────────────────────────────────────────
function TicketDetail(p){
  var ticket=p.ticket;var setTickets=p.setTickets;var users=p.users;var ticketTypes=p.ticketTypes;
  var companies=p.companies;var clients=p.clients;var curUser=p.curUser;var isAdmin=p.isAdmin;var isTech=p.isTech;
  var addLog=p.addLog;var showToast=p.showToast;var onClose=p.onClose;var statusSla=p.statusSla;var schedules=p.schedules||{};
  var[tab,setTab]=useState("details");var[status,setStatus]=useState(ticket.status);var[asgn,setAsgn]=useState(ticket.assignedTo||"");var[note,setNote]=useState("");var[typeId,setTypeId]=useState(ticket.typeId||"");
  var[msgTo,setMsgTo]=useState("");var[msgCC,setMsgCC]=useState("");var[msgSubj,setMsgSubj]=useState("Re: [#"+ticket.id+"] "+ticket.title);var[msgBody,setMsgBody]=useState("");var emailTemplates=p.emailTemplates||[];var clients2=p.clients||[];var assignedUser=users.find(function(u){return u.id===ticket.assignedTo;});function applyTemplate(tid){var tmpl=emailTemplates.find(function(t){return t.id===tid;});if(!tmpl)return;var cl=clients2.find(function(c){return c.id===ticket.clientId;});var body=tmpl.body.replace(/{{client_name}}/g,cl?cl.name:"[Client]").replace(/{{agent_name}}/g,assignedUser?assignedUser.name:"[Agent]");var subj=tmpl.subject.replace(/{{client_name}}/g,cl?cl.name:"[Client]").replace(/{{agent_name}}/g,assignedUser?assignedUser.name:"[Agent]");setMsgSubj(subj);setMsgBody(body);}
  var[emailSending,setEmailSending]=useState(false);
  function fu(id){return users.find(function(x){return x.id===id;});}
  var tt=ticketTypes.find(function(t){return t.id===ticket.typeId;});var co=companies.find(function(c){return c.id===ticket.companyId;});var client=clients.find(function(c){return c.id===ticket.clientId;});var loc=client?client.locations.find(function(l){return l.id===ticket.locationId;}):null;
  if(!ticket)return null;
  var sSla=getStatusSla(ticket,statusSla,schedules);
  var submitter=fu(ticket.submittedBy);var submittedAt=ticket.submittedAt||ticket.createdAt;var formOpenedAt=ticket.formOpenedAt||ticket.createdAt;var createMins=ticket.timeToCreateMins||0;var createColor=createMins<=5?"#10b981":createMins<=15?"#f59e0b":"#ef4444";

  function saveStatus(){
    var statusChanged=status!==ticket.status;
    var hist={status,assignedTo:asgn||null,timestamp:new Date().toISOString(),changedBy:curUser.id,note:note||(statusChanged?"Status changed to "+status:"Details updated (status unchanged)")};
    if(!statusChanged)hist._noSlaReset=true;
    var newTT=ticketTypes.find(function(t){return t.id===typeId;});var typeChanged=typeId&&typeId!==ticket.typeId;
    var newSlaDeadline=typeChanged&&newTT?new Date(new Date(ticket.createdAt).getTime()+newTT.slaHours*3600000).toISOString():ticket.slaDeadline;
    var newPriority=typeChanged&&newTT?newTT.priority:ticket.priority;
    if(typeChanged)hist.note=(note||"")+(note?" | ":"")+"Type changed to: "+newTT.name;
    setTickets(function(prev){return prev.map(function(t){if(t.id!==ticket.id)return t;var newHist=statusChanged?(t.statusHistory||[]).concat([hist]):(t.statusHistory||[]).concat([Object.assign({},hist,{_noSlaReset:true})]);return Object.assign({},t,{status,assignedTo:asgn||null,typeId:typeId||t.typeId,priority:newPriority,slaDeadline:newSlaDeadline,updatedAt:new Date().toISOString(),slaBreached:new Date()>new Date(newSlaDeadline)&&status!=="Closed",closedAt:status==="Closed"&&!t.closedAt?new Date().toISOString():t.closedAt,statusHistory:newHist});});});
    if(typeChanged)addLog("TICKET_TYPE_CHANGE",ticket.id,"Type changed to: "+newTT.name);
    addLog("TICKET_STATUS",ticket.id,(statusChanged?"Status → "+status:"Details updated, status: "+status)+". Assigned: "+(fu(asgn)?.name||"nobody"));
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
    setTickets(function(prev){return prev.map(function(t){if(t.id!==ticket.id)return t;return Object.assign({},t,{conversations:(t.conversations||[]).map(function(c){return c.id===msgId?Object.assign({},c,{status:allOk?"sent":"failed",failReason:failMsg}):c;})});});});
    var updatedConvs=(ticket.conversations||[]).concat([msg]).map(function(c){return c.id===msgId?Object.assign({},c,{status:allOk?"sent":"failed",failReason:failMsg}):c;});await dbSaveTicket(Object.assign({},ticket,{conversations:updatedConvs}));
    addLog("EMAIL_SENT",ticket.id,"Email to "+msgTo+(allOk?"":" [FAILED: "+failMsg+"]"));
    showToast(allOk?"📧 Email sent!":"⚠️ Failed: "+failMsg,allOk?"ok":"error");
    setEmailSending(false);
    if(allOk){setMsgTo("");setMsgCC("");setMsgBody("");}
  }

  var TABS=["details","time","status","email","chat","history"].filter(function(t){if(t==="status")return isTech;return true;});
  var tabLabels={details:"📋 Details",time:"⏱ Time",status:"🔄 Status",email:"📧 Email",chat:"💬 Chat",history:"📜 History"};
  var detailRows=[["Title",ticket.title],["Type",tt?.name||(ticket.customTypeName||"—")],["Priority",<Badge key="p" label={PRI_META[ticket.priority]?.label||ticket.priority} color={PRI_META[ticket.priority]?.color||"#6366f1"}/>],["Status",<Badge key="s" label={ticket.status} color={STATUS_META[ticket.status]?.color||"#6366f1"}/>],["Company",co?.name||"—"],["Submitted By",fu(ticket.submittedBy)?.name||"—"],["Assigned To",fu(ticket.assignedTo)?.name||"Unassigned"],["AI Reason",ticket.aiReason||"—"],["Created",fdt(ticket.createdAt)],["SLA Deadline",fdt(ticket.slaDeadline)],["Create Time",fmtMs(ticket.timeToCreateMins)],["Overall SLA",ticket.slaBreached?<Badge key="sl" label="BREACHED" color="#ef4444"/>:<Badge key="sl2" label="✓ OK" color="#10b981"/>]];

  return<Modal title={"Ticket #"+ticket.id+" — "+ticket.title} onClose={onClose} wide>
    <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
      {TABS.map(function(t){return<button key={t} onClick={function(){if(t==="email"&&ticket.hasUnreadReply)setTickets(function(prev){return prev.map(function(tk){return tk.id===ticket.id?Object.assign({},tk,{hasUnreadReply:false}):tk;});});setTab(t);}} style={{background:tab===t?"#6366f1":"#f1f5f9",color:tab===t?"#fff":"#475569",border:"none",borderRadius:8,padding:"5px 14px",cursor:"pointer",fontSize:12,fontWeight:700,position:"relative"}}>
        {tabLabels[t]}{t==="email"&&ticket.hasUnreadReply&&<span style={{position:"absolute",top:-4,right:-4,background:"#10b981",color:"#fff",borderRadius:"50%",width:16,height:16,fontSize:9,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>!</span>}
      </button>;})}
    </div>
    {ticket.hasUnreadReply&&<div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
      <span style={{fontSize:18}}>📬</span><div><div style={{fontWeight:700,color:"#166534",fontSize:13}}>New reply received</div><div style={{fontSize:12,color:"#15803d"}}>A response has been received — open the Email tab to view it.</div></div>
      <button onClick={function(){setTab("email");setTickets(function(prev){return prev.map(function(tk){return tk.id===ticket.id?Object.assign({},tk,{hasUnreadReply:false}):tk;});});}} style={{marginLeft:"auto",padding:"6px 14px",background:"#10b981",color:"#fff",border:"none",borderRadius:8,fontWeight:700,fontSize:12,cursor:"pointer",flexShrink:0}}>View Reply</button>
    </div>}

    {tab==="details"&&<div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>{detailRows.map(function(pair){var l=pair[0];var v=pair[1];return<div key={l} style={{background:"#f8fafc",padding:10,borderRadius:8}}><div style={{color:"#64748b",fontSize:10,fontWeight:700,textTransform:"uppercase",marginBottom:3}}>{l}</div><div style={{fontWeight:600,color:"#1e293b",fontSize:12}}>{v}</div></div>;})}</div>
      <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:14,marginBottom:14}}>
        <div style={{fontWeight:700,color:"#0369a1",fontSize:12,marginBottom:10}}>🤝 Client &amp; Location</div>
        {client?<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><div><div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",marginBottom:4}}>Client</div><div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>{client.name}</div><div style={{fontSize:11,color:"#64748b"}}>📧 {client.email}</div><div style={{fontSize:11,color:"#64748b"}}>📞 {client.phone}</div></div><div><div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",marginBottom:4}}>Location</div>{loc?<><div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>📍 {loc.name}</div><div style={{fontSize:11,color:"#64748b"}}>{loc.address}</div>{loc.floor&&<div style={{fontSize:11,color:"#64748b"}}>🏢 {loc.floor}</div>}{loc.contact&&<div style={{fontSize:11,color:"#64748b"}}>👤 {loc.contact}</div>}</>:<div style={{fontSize:12,color:"#94a3b8"}}>No location</div>}</div></div>:<div style={{fontSize:12,color:"#94a3b8"}}>No client associated.</div>}
      </div>
      <div style={{background:"#f8fafc",padding:12,borderRadius:8,fontSize:12,lineHeight:1.6,whiteSpace:"pre-wrap",color:"#334155"}}>{ticket.description}</div>
      {sSla&&<div style={{marginTop:14,background:sSla.breached?"#fef2f2":sSla.hasSchedule&&!sSla.onShift?"#f8fafc":"#f0fdf4",border:"1px solid "+(sSla.breached?"#fecaca":sSla.hasSchedule&&!sSla.onShift?"#e2e8f0":"#bbf7d0"),borderRadius:10,padding:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{fontWeight:700,color:sSla.breached?"#dc2626":sSla.hasSchedule&&!sSla.onShift?"#64748b":"#166534",fontSize:13}}>⏱ Status SLA — "{ticket.status}"</div>
          <div style={{display:"flex",gap:6}}>{sSla.hasSchedule&&<Badge label={sSla.onShift?"🟢 On shift":"⏸ Off shift — timer paused"} color={sSla.onShift?"#10b981":"#94a3b8"}/>}<Badge label={sSla.breached?"BREACHED":"✓ Within SLA"} color={sSla.breached?"#ef4444":"#10b981"}/></div>
        </div>
        {sSla.hasSchedule&&<div style={{background:"#e0f2fe",borderRadius:6,padding:"6px 10px",marginBottom:10,fontSize:11,color:"#0369a1"}}>🗓 Schedule: {fmtSchedule(sSla.schedule)} — SLA only counts during shift hours</div>}
        <div style={{height:8,background:"#e2e8f0",borderRadius:4,overflow:"hidden",marginBottom:8}}><div style={{height:"100%",width:sSla.pct+"%",background:sSla.hasSchedule&&!sSla.onShift?"#94a3b8":sSla.pct>=100?"#ef4444":sSla.pct>=75?"#f59e0b":"#10b981",borderRadius:4}}/></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8}}>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#64748b",fontWeight:600,textTransform:"uppercase"}}>Allowed</div><div style={{fontWeight:800,fontSize:16,color:"#1e293b"}}>{sSla.hoursAllowed}h</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#64748b",fontWeight:600,textTransform:"uppercase"}}>{sSla.hasSchedule?"Shift hrs":"Spent"}</div><div style={{fontWeight:800,fontSize:16,color:"#1e293b"}}>{sSla.hoursSpent}h</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#64748b",fontWeight:600,textTransform:"uppercase"}}>Remaining</div><div style={{fontWeight:800,fontSize:16,color:sSla.breached?"#ef4444":"#10b981"}}>{sSla.breached?"0h":sSla.remaining+"h"}</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#64748b",fontWeight:600,textTransform:"uppercase"}}>Used</div><div style={{fontWeight:800,fontSize:16,color:sSla.pct>=100?"#ef4444":sSla.pct>=75?"#f59e0b":"#10b981"}}>{sSla.pct}%</div></div>
        </div>
      </div>}
      {ticket.attachments&&ticket.attachments.length>0&&<div style={{marginTop:14}}><div style={{fontWeight:700,color:"#1e293b",fontSize:12,marginBottom:10}}>📎 Attachments ({ticket.attachments.length})</div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10}}>{ticket.attachments.map(function(a){var isImg=a.type.startsWith("image/");return<div key={a.id} style={{borderRadius:10,overflow:"hidden",border:"1px solid #e2e8f0",cursor:"pointer"}} onClick={function(){var w=window.open();w.document.write(isImg?'<img src="'+a.dataUrl+'" style="max-width:100%;"/>':'<video src="'+a.dataUrl+'" controls style="max-width:100%;"></video>');}}>{isImg?<img src={a.dataUrl} alt={a.name} style={{width:"100%",height:90,objectFit:"cover",display:"block"}}/>:<div style={{height:90,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#1e1b4b"}}><span style={{fontSize:32}}>▶️</span></div>}<div style={{padding:"6px 8px"}}><div style={{fontSize:10,fontWeight:600,color:"#334155",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{a.name}</div></div></div>;})}</div></div>}
    </div>}

    {tab==="time"&&<div>
      <div style={{background:"linear-gradient(135deg,#eef2ff,#f0f9ff)",border:"1px solid #c7d2fe",borderRadius:12,padding:20,marginBottom:16}}><div style={{fontWeight:800,color:"#3730a3",fontSize:15,marginBottom:4}}>⏱️ Ticket Time Tracking</div></div>
      <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:16,marginBottom:14}}>
        <div style={{fontWeight:700,color:"#1e293b",fontSize:13,marginBottom:12}}>👤 Submitted By</div>
        {submitter?<div style={{display:"flex",gap:12,alignItems:"center"}}><Avatar name={submitter.name} id={submitter.id} size={42}/><div><div style={{fontWeight:700,fontSize:14,color:"#1e293b"}}>{submitter.name}</div><div style={{fontSize:12,color:"#64748b"}}>{submitter.email}</div><div style={{marginTop:4}}><Badge label={ROLE_META[submitter.role]?.label||submitter.role} color={ROLE_META[submitter.role]?.color||"#6366f1"}/></div></div></div>:<div style={{color:"#94a3b8",fontSize:12}}>Unknown user</div>}
      </div>
      <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:16}}>
        <div style={{fontWeight:700,color:"#1e293b",fontSize:13,marginBottom:12}}>🗂 Timestamps</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {[["Form Opened",formOpenedAt],["Submitted At",submittedAt],["Last Updated",ticket.updatedAt],["SLA Deadline",ticket.slaDeadline],["Closed At",ticket.closedAt||null]].map(function(pair){var l=pair[0];var v=pair[1];return<div key={l} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:8,padding:"10px 12px"}}><div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",marginBottom:3}}>{l}</div><div style={{fontSize:11,fontWeight:600,color:v?"#1e293b":"#94a3b8"}}>{v?fdtFull(v):"—"}</div>{v&&<div style={{fontSize:10,color:"#94a3b8",marginTop:2}}>{ago(v)}</div>}</div>;})}</div>
        <div style={{marginTop:10,padding:10,background:"#fff",border:"1px solid #e2e8f0",borderRadius:8}}>
          <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",marginBottom:4}}>Form Fill Time</div>
          <div style={{display:"flex",alignItems:"center",gap:10}}><div style={{flex:1,height:8,background:"#e2e8f0",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",width:Math.min(100,createMins/30*100)+"%",background:createColor,borderRadius:4}}/></div><span style={{fontWeight:700,color:createColor}}>{fmtMs(createMins)}</span></div>
        </div>
      </div>
    </div>}

    {tab==="status"&&isTech&&<div>
      <FSelect label="Update Status" value={status} onChange={function(e){setStatus(e.target.value);}} options={OPT_STATUSES}/>
      <FSelect label="Assign To" value={asgn} onChange={function(e){setAsgn(e.target.value);}} options={optTechs(users)}/>
      <div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Ticket Type</label>
        <select value={typeId} onChange={function(e){setTypeId(e.target.value);}} style={{width:"100%",padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#f8fafc",boxSizing:"border-box"}}>
          {ticketTypes.map(function(t){return<option key={t.id} value={t.id}>{t.name} — {PRI_META[t.priority]?.label||t.priority}, SLA {t.slaHours}h</option>;})}
        </select>
        {typeId!==ticket.typeId&&<div style={{fontSize:11,color:"#f59e0b",marginTop:4}}>⚠️ Changing type will update priority and SLA deadline.</div>}
      </div>
      <FTextarea label="Note" value={note} onChange={function(e){setNote(e.target.value);}} placeholder="What was done or why?" rows={3}/>
      <Btn onClick={saveStatus}>💾 Save Changes</Btn>
    </div>}

    {tab==="email"&&<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div style={{fontWeight:700,color:"#1e293b"}}>📧 Send Email</div>{emailTemplates.length>0&&<div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:11,color:"#64748b",fontWeight:600}}>Use template:</span><select onChange={function(e){if(e.target.value)applyTemplate(e.target.value);e.target.value="";}} style={{padding:"5px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none",background:"#f8fafc"}}><option value="">— Select —</option>{emailTemplates.map(function(t){return<option key={t.id} value={t.id}>{t.name}</option>;})}</select></div>}</div>
      <FInput label="To (comma-separated)" value={msgTo} onChange={function(e){setMsgTo(e.target.value);}} placeholder="john@client.com"/>
      <FInput label="CC" value={msgCC} onChange={function(e){setMsgCC(e.target.value);}} placeholder="manager@company.com"/>
      <FInput label="Subject" value={msgSubj} onChange={function(e){setMsgSubj(e.target.value);}}/>
      <FTextarea label="Message" value={msgBody} onChange={function(e){setMsgBody(e.target.value);}} rows={4} placeholder="Type your message…"/>
      <button onClick={sendEmail} disabled={emailSending} style={{background:emailSending?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:8,padding:"8px 18px",fontWeight:600,fontSize:13,cursor:emailSending?"not-allowed":"pointer"}}>{emailSending?"⏳ Sending…":"📤 Send Email"}</button>
      <hr style={{margin:"14px 0",border:"none",borderTop:"1px solid #e2e8f0"}}/>
      <div style={{fontWeight:700,color:"#1e293b",marginBottom:10}}>📬 Conversation Trail ({(ticket.conversations||[]).length})</div>
      {(ticket.conversations||[]).length===0&&<div style={{color:"#94a3b8",fontSize:12}}>No messages yet.</div>}
      {(ticket.conversations||[]).map(function(m){
        var isReply=m.isExternal||m.status==="received";
        return<div key={m.id} style={{background:isReply?"#f0fdf4":"#f8fafc",border:"1px solid "+(isReply?"#bbf7d0":"#e2e8f0"),borderRadius:10,padding:12,marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <div style={{fontWeight:700,fontSize:12,color:isReply?"#166534":"#1e293b"}}>{isReply?"📬 REPLY":"📧"} {isReply?(m.fromName?m.fromName+" <"+m.fromEmail+">":m.fromEmail):m.fromEmail}{!isReply&&m.toEmails&&m.toEmails.length>0&&<span style={{color:"#64748b",fontWeight:400}}> → {m.toEmails.join(", ")}</span>}</div>
            <div style={{display:"flex",gap:4,alignItems:"center"}}>
              {m.status==="sending"&&<span style={{fontSize:10,color:"#f59e0b"}}>⏳</span>}
              {m.status==="sent"&&<span style={{fontSize:10,color:"#10b981"}}>✅</span>}
              {m.status==="received"&&<span style={{fontSize:10,color:"#10b981"}}>📩</span>}
              {m.status==="failed"&&<span style={{fontSize:10,color:"#ef4444"}} title={m.failReason||"Failed"}>❌</span>}
              <span style={{fontSize:10,color:"#94a3b8"}}>{fdt(m.timestamp)}</span>
            </div>
          </div>
          {m.cc&&m.cc.length>0&&<div style={{fontSize:11,color:"#94a3b8",marginBottom:4}}>CC: {m.cc.join(", ")}</div>}
          <div style={{fontSize:11,color:"#64748b",marginBottom:4}}>Subj: {m.subject}</div>
          <div style={{fontSize:12,color:"#334155",whiteSpace:"pre-wrap",lineHeight:1.6}}>{m.body}</div>
          {m.status==="failed"&&m.failReason&&<div style={{marginTop:6,fontSize:11,color:"#dc2626",background:"#fef2f2",borderRadius:6,padding:"4px 8px"}}>⚠️ {m.failReason}</div>}
        </div>;
      })}
    </div>}

    {tab==="chat"&&<TicketChat ticketId={ticket.id} curUser={curUser} users={users}/>}

    {tab==="history"&&<TicketHistory ticket={ticket} users={users} curUser={curUser}/>}
  </Modal>;
}

// ── Time Tracking ─────────────────────────────────────────────────────────────
function PageTimeTracking(p){
  var tickets=p.tickets;var users=p.users;var ticketTypes=p.ticketTypes;var curUser=p.curUser;var isAdmin=p.isAdmin;var setSelTicket=p.setSelTicket;
  var[search,setSearch]=useState("");var[filterUser,setFilterUser]=useState("");var[filterType,setFilterType]=useState("");var[sortBy,setSortBy]=useState("submittedAt");var[sortDir,setSortDir]=useState("desc");
  var scope=useMemo(function(){var base=tickets.filter(function(t){return !t.deleted;});if(!isAdmin)return base.filter(function(t){return t.submittedBy===curUser.id;});if(filterUser)return base.filter(function(t){return t.submittedBy===filterUser;});return base;},[tickets,curUser,isAdmin,filterUser]);
  var filtered=useMemo(function(){var q=search.toLowerCase();return scope.filter(function(t){return(!q||(t.title.toLowerCase().includes(q)||t.id.includes(q)))&&(!filterType||t.typeId===filterType);}).sort(function(a,b){var av,bv;if(sortBy==="submittedAt"){av=new Date(a.submittedAt||a.createdAt);bv=new Date(b.submittedAt||b.createdAt);}else if(sortBy==="timeToCreate"){av=a.timeToCreateMins||0;bv=b.timeToCreateMins||0;}else{av=a.title.toLowerCase();bv=b.title.toLowerCase();}if(av<bv)return sortDir==="asc"?-1:1;if(av>bv)return sortDir==="asc"?1:-1;return 0;});},[scope,search,filterType,sortBy,sortDir]);
  function fu(id){return users.find(function(x){return x.id===id;});}function ftt(id){return ticketTypes.find(function(x){return x.id===id;});}
  var totalMins=filtered.reduce(function(a,t){return a+(t.timeToCreateMins||0);},0);var avg=filtered.length?totalMins/filtered.length:0;
  function toggleSort(col){if(sortBy===col){setSortDir(function(d){return d==="asc"?"desc":"asc";});}else{setSortBy(col);setSortDir("desc");}}
  function Arrow(sp){if(sortBy!==sp.col)return<span style={{color:"#cbd5e1",marginLeft:3}}>⇅</span>;return<span style={{marginLeft:3}}>{sortDir==="asc"?"↑":"↓"}</span>;}
  return<div>
    <div style={{fontWeight:800,fontSize:18,color:"#1e293b",marginBottom:16}}>⏱️ Time Tracking</div>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
      <Stat label="Total Create Time" value={fmtMs(totalMins)} icon="🕐" color="#8b5cf6" sub={filtered.length+" tickets"}/>
      <Stat label="Avg Create Time" value={fmtMs(avg)} icon="⏱" color="#0ea5e9"/>
    </div>
    <Card style={{marginBottom:16,padding:"14px 16px"}}><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      <input value={search} onChange={function(e){setSearch(e.target.value);}} placeholder="🔍 Search…" style={{flex:1,minWidth:160,padding:"7px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}/>
      <select value={filterType} onChange={function(e){setFilterType(e.target.value);}} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}><option value="">All Types</option>{ticketTypes.map(function(t){return<option key={t.id} value={t.id}>{t.name}</option>;})}</select>
      {isAdmin&&<select value={filterUser} onChange={function(e){setFilterUser(e.target.value);}} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}><option value="">All Users</option>{users.filter(function(u){return u.active;}).map(function(u){return<option key={u.id} value={u.id}>{u.name}</option>;})}</select>}
    </div></Card>
    <Card style={{padding:0,overflow:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",minWidth:700}}>
        <thead><tr style={{background:"#f8fafc"}}>
          <th style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0"}}>#</th>
          <th onClick={function(){toggleSort("title");}} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0",cursor:"pointer"}}>Title <Arrow col="title"/></th>
          <th style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0"}}>By</th>
          <th style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0"}}>Type</th>
          <th onClick={function(){toggleSort("submittedAt");}} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0",cursor:"pointer"}}>Submitted <Arrow col="submittedAt"/></th>
          <th onClick={function(){toggleSort("timeToCreate");}} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0",cursor:"pointer"}}>Create Time <Arrow col="timeToCreate"/></th>
          <th style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0"}}>Status</th>
          <th style={{padding:"10px 12px",borderBottom:"1px solid #e2e8f0"}}></th>
        </tr></thead>
        <tbody>
          {filtered.length===0&&<tr><td colSpan={8} style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No tickets found.</td></tr>}
          {filtered.map(function(t,i){var sub=fu(t.submittedBy);var tt2=ftt(t.typeId);var sm=STATUS_META[t.status]||STATUS_META.Open;var cm=t.timeToCreateMins||0;var cc=cm<=5?"#10b981":cm<=15?"#f59e0b":"#ef4444";return<tr key={t.id} style={{borderBottom:"1px solid #f1f5f9",background:i%2===0?"#fff":"#fafafa"}}>
            <td style={{padding:"9px 12px",fontSize:11,color:"#94a3b8",fontWeight:600}}>#{t.id}</td>
            <td style={{padding:"9px 12px",maxWidth:180}}><div style={{fontWeight:600,color:"#1e293b",fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.title}</div></td>
            <td style={{padding:"9px 12px"}}>{sub?<div style={{display:"flex",alignItems:"center",gap:6}}><Avatar name={sub.name} id={sub.id} size={20}/><span style={{fontSize:11}}>{sub.name}</span></div>:<span style={{fontSize:11,color:"#94a3b8"}}>—</span>}</td>
            <td style={{padding:"9px 12px"}}>{tt2?<Badge label={tt2.name} color={tt2.color}/>:<span style={{color:"#94a3b8",fontSize:11}}>—</span>}</td>
            <td style={{padding:"9px 12px"}}><div style={{fontSize:11,color:"#334155"}}>{fdt(t.submittedAt||t.createdAt)}</div><div style={{fontSize:10,color:"#94a3b8"}}>{ago(t.submittedAt||t.createdAt)}</div></td>
            <td style={{padding:"9px 12px"}}><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:40,height:6,background:"#e2e8f0",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:Math.min(100,cm/30*100)+"%",background:cc,borderRadius:3}}/></div><span style={{fontSize:12,fontWeight:700,color:cc}}>{fmtMs(cm)}</span></div></td>
            <td style={{padding:"9px 12px"}}><Badge label={t.status} color={sm.color} bg={sm.bg}/></td>
            <td style={{padding:"9px 12px"}}><Btn size="sm" variant="ghost" onClick={function(){setSelTicket(t.id);}}>View</Btn></td>
          </tr>;})}
        </tbody>
      </table>
    </Card>
  </div>;
}

// ── Reports ───────────────────────────────────────────────────────────────────
function PageReports(p){
  var tickets=p.tickets;var users=p.users;var ticketTypes=p.ticketTypes;var clients=p.clients;var statusSla=p.statusSla||DEFAULT_STATUS_SLA;var schedules=p.schedules||{};
  var[view,setView]=useState("summary");var[range,setRange]=useState("month");var[aiInsight,setAiInsight]=useState("");var[aiLoading,setAiLoading]=useState(false);
  var rangeStart=useMemo(function(){var now=new Date();if(range==="day")return new Date(now.getFullYear(),now.getMonth(),now.getDate()).toISOString();if(range==="week")return new Date(now.getTime()-7*86400000).toISOString();if(range==="month")return new Date(now.getTime()-30*86400000).toISOString();if(range==="year")return new Date(now.getTime()-365*86400000).toISOString();return new Date(0).toISOString();},[range]);
  var rangeLabel={day:"Today",week:"Last 7 Days",month:"Last 30 Days",year:"Last 12 Months",all:"All Time"};
  var techs=users.filter(function(u){return IT_ROLES.includes(u.role);});
  var active=tickets.filter(function(t){return !t.deleted&&new Date(t.createdAt)>=new Date(rangeStart);});
  var allActive=tickets.filter(function(t){return !t.deleted;});
  var byType=ticketTypes.map(function(tt,i){var mine=active.filter(function(t){return t.typeId===tt.id;});var res=calcClosed(mine);return{id:tt.id,name:tt.name,color:tt.color,priority:tt.priority,slaH:tt.slaHours,total:mine.length,open:mine.filter(function(t){return t.status==="Open";}).length,inProg:mine.filter(function(t){return t.status==="In Progress";}).length,resolved:res.length,breached:mine.filter(function(t){return t.slaBreached;}).length,slaRate:calcSlaRate(mine),avgClose:calcAvgClose(res),fill:PAL[i%PAL.length]};}).filter(function(x){return x.total>0;});
  var byUser=techs.map(function(t){var mine=active.filter(function(tk){return tk.assignedTo===t.id;});var res=calcClosed(mine);return{id:t.id,name:t.name,role:t.role,total:mine.length,open:mine.filter(function(t){return t.status==="Open";}).length,inProg:mine.filter(function(t){return t.status==="In Progress";}).length,escalated:mine.filter(function(t){return t.status==="Escalated";}).length,resolved:res.length,breached:mine.filter(function(t){return t.slaBreached;}).length,slaRate:calcSlaRate(mine),avgClose:calcAvgClose(res)};});
  var byClient=clients.map(function(cl){var mine=active.filter(function(t){return t.clientId===cl.id;});var res=calcClosed(mine);return{id:cl.id,name:cl.name,total:mine.length,open:mine.filter(function(t){return t.status==="Open";}).length,resolved:res.length,slaRate:calcSlaRate(mine),avgClose:calcAvgClose(res)};}).filter(function(x){return x.total>0;});
  var totalBreached=active.filter(function(t){return t.slaBreached;}).length;
  var totalSlaRate=calcSlaRate(active);var avgCloseAll=calcAvgClose(calcClosed(active));
  var statusPieData=ALL_STATUSES.map(function(s){return{name:s,value:active.filter(function(t){return t.status===s;}).length,color:STATUS_META[s].color};});
  var byPriChart=Object.keys(PRI_META).map(function(k){return{name:PRI_META[k].label,value:active.filter(function(t){return t.priority===k;}).length,color:PRI_META[k].color};});
  var weeklyTrend=useMemo(function(){return Array.from({length:12},function(_,i){var wEnd=new Date(Date.now()-(11-i)*7*86400000);var wStart=new Date(wEnd.getTime()-7*86400000);var wT=allActive.filter(function(t){var d=new Date(t.createdAt);return d>=wStart&&d<wEnd;});var row={label:"W"+(i+1)+" "+wEnd.toLocaleDateString("en",{month:"short",day:"numeric"}),total:wT.length,closed:calcClosed(wT).length,breached:wT.filter(function(t){return t.slaBreached;}).length};ticketTypes.forEach(function(tt){row[tt.name]=wT.filter(function(t){return t.typeId===tt.id;}).length;});return row;});},[allActive,ticketTypes]);
  var top3=useMemo(function(){return ticketTypes.map(function(tt){return{name:tt.name,color:tt.color,total:allActive.filter(function(t){return t.typeId===tt.id;}).length};}).sort(function(a,b){return b.total-a.total;}).slice(0,3);},[allActive,ticketTypes]);

  async function generateInsight(){setAiLoading(true);setAiInsight("");var summary={totalTickets:allActive.length,slaRate:calcSlaRate(allActive),breached:allActive.filter(function(t){return t.slaBreached;}).length,topTypes:top3.map(function(t){return t.name+" ("+t.total+")";}),openCount:allActive.filter(function(t){return t.status==="Open";}).length};try{var res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:800,messages:[{role:"user",content:"IT helpdesk analyst. Analyze and give: top issues, SLA performance, 3 recommendations. Be concise, use bullets.\n\nData:\n"+JSON.stringify(summary,null,2)}]})});var data=await res.json();setAiInsight(data.content&&data.content[0]?data.content[0].text:"Unable to generate.");}catch(e){setAiInsight("Error: "+e.message);}setAiLoading(false);}

  var VIEWS=[{id:"summary",label:"📊 Summary"},{id:"trend",label:"📈 Trend"},{id:"by_type",label:"🏷️ By Type"},{id:"per_user",label:"👤 Per User"},{id:"per_client",label:"🤝 Per Client"}];
  function TH(hp){return<th style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>{hp.children}</th>;}
  function TD(dp){return<td style={{padding:"9px 12px",fontSize:12,fontWeight:dp.bold?700:400,color:"#1e293b"}}>{dp.children}</td>;}

  return<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{VIEWS.map(function(v){return<Btn key={v.id} variant={view===v.id?"primary":"ghost"} onClick={function(){setView(v.id);}} size="sm">{v.label}</Btn>;})}</div>
      <div style={{display:"flex",gap:6,alignItems:"center"}}><span style={{fontSize:12,color:"#64748b",fontWeight:600}}>Period:</span>{["day","week","month","year","all"].map(function(r){return<button key={r} onClick={function(){setRange(r);}} style={{padding:"5px 12px",borderRadius:8,border:"1px solid "+(range===r?"#6366f1":"#e2e8f0"),background:range===r?"#6366f1":"#fff",color:range===r?"#fff":"#475569",fontSize:11,fontWeight:600,cursor:"pointer"}}>{rangeLabel[r]}</button>;})}</div>
    </div>
    <div style={{background:"#eef2ff",border:"1px solid #c7d2fe",borderRadius:8,padding:"8px 14px",marginBottom:16,fontSize:12,color:"#4338ca",fontWeight:600}}>📅 Showing: <strong>{rangeLabel[range]}</strong> — {active.length} tickets</div>

    {view==="summary"&&<div>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
        <Stat label="Total Tickets" value={active.length} icon="🎫" color="#6366f1"/>
        <Stat label="SLA Rate" value={totalSlaRate+"%"} icon="🎯" color={slaColor(totalSlaRate)} sub={totalBreached+" breached"}/>
        <Stat label="Avg Close Time" value={avgCloseAll+"h"} icon="⏱" color="#0ea5e9"/>
        <Stat label="Closed" value={calcClosed(active).length} icon="✅" color="#10b981"/>
        <Stat label="Escalated" value={active.filter(function(t){return t.status==="Escalated";}).length} icon="🚨" color="#ef4444"/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <Card><div style={{fontWeight:700,marginBottom:12}}>Tickets by Status</div><ResponsiveContainer width="100%" height={200}><PieChart><Pie data={statusPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={pieLabel} fontSize={9}>{statusPieData.map(function(e,i){return<Cell key={i} fill={e.color}/>;})}</Pie><Tooltip/></PieChart></ResponsiveContainer></Card>
        <Card><div style={{fontWeight:700,marginBottom:12}}>By Priority</div><ResponsiveContainer width="100%" height={200}><BarChart data={byPriChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="value" radius={[4,4,0,0]}>{byPriChart.map(function(e,i){return<Cell key={i} fill={e.color}/>;})}</Bar></BarChart></ResponsiveContainer></Card>
      </div>
    </div>}

    {view==="trend"&&<div>
      <Card style={{marginBottom:16}}><div style={{fontWeight:700,marginBottom:12}}>Weekly Volume</div><ResponsiveContainer width="100%" height={260}><AreaChart data={weeklyTrend}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="label" tick={{fontSize:9}} angle={-25} textAnchor="end" height={50}/><YAxis tick={{fontSize:10}}/><Tooltip/><Legend wrapperStyle={{fontSize:11}}/><Area type="monotone" dataKey="total" stroke="#6366f1" fill="#eef2ff" name="Total" strokeWidth={2}/><Area type="monotone" dataKey="closed" stroke="#10b981" fill="#d1fae5" name="Closed" strokeWidth={2}/><Area type="monotone" dataKey="breached" stroke="#ef4444" fill="#fee2e2" name="Breached" strokeWidth={2}/></AreaChart></ResponsiveContainer></Card>
      <Card style={{borderLeft:"4px solid #6366f1"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><div><div style={{fontWeight:700,fontSize:14,color:"#1e293b"}}>🤖 AI Insights</div></div><button onClick={generateInsight} disabled={aiLoading} style={{padding:"9px 18px",background:aiLoading?"#a5b4fc":"linear-gradient(135deg,#6366f1,#4338ca)",color:"#fff",border:"none",borderRadius:10,fontWeight:700,fontSize:13,cursor:aiLoading?"not-allowed":"pointer"}}>{aiLoading?"⏳ Analyzing…":"✨ Generate"}</button></div>
        {!aiInsight&&!aiLoading&&<div style={{background:"#f8fafc",borderRadius:10,padding:20,textAlign:"center",color:"#94a3b8"}}><div style={{fontSize:32,marginBottom:8}}>🧠</div><div style={{fontSize:13,fontWeight:600,color:"#475569"}}>Ready to analyze your data</div></div>}
        {aiInsight&&<div style={{background:"#f8fafc",borderRadius:10,padding:20,fontSize:12,color:"#334155",lineHeight:1.9,whiteSpace:"pre-wrap"}}>{aiInsight}</div>}
      </Card>
    </div>}

    {view==="by_type"&&<div>
      {byType.length===0&&<Card><div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No ticket type data yet.</div></Card>}
      {byType.length>0&&<Card style={{padding:0,overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:650}}><thead><tr style={{background:"#f8fafc"}}><TH>Type</TH><TH>Total</TH><TH>Open</TH><TH>Closed</TH><TH>Breached</TH><TH>SLA Rate</TH><TH>Avg Close</TH></tr></thead><tbody>{byType.map(function(t){return<tr key={t.id} style={{borderBottom:"1px solid #f1f5f9"}}><TD><Badge label={t.name} color={t.color}/></TD><TD bold>{t.total}</TD><TD><Badge label={t.open} color="#f59e0b"/></TD><TD><Badge label={t.resolved} color="#10b981"/></TD><TD><Badge label={t.breached} color={t.breached>0?"#ef4444":"#10b981"}/></TD><TD><Badge label={t.slaRate+"%"} color={slaColor(t.slaRate)}/></TD><TD>{t.avgClose}h</TD></tr>;})}</tbody></table></Card>}
    </div>}

    {view==="per_user"&&<div>
      {byUser.length===0&&<Card><div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No technician data yet.</div></Card>}
      {byUser.length>0&&<Card style={{padding:0,overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:700}}><thead><tr style={{background:"#f8fafc"}}><TH>Technician</TH><TH>Total</TH><TH>Open</TH><TH>Closed</TH><TH>Breached</TH><TH>SLA Rate</TH><TH>Avg Close</TH></tr></thead><tbody>{byUser.map(function(t){return<tr key={t.id} style={{borderBottom:"1px solid #f1f5f9"}}><TD><div style={{display:"flex",gap:8,alignItems:"center"}}><Avatar name={t.name} id={t.id} size={26}/><div><div style={{fontWeight:600,fontSize:12}}>{t.name}</div><div style={{fontSize:10,color:"#94a3b8"}}>{ROLE_META[t.role]?.label||t.role}</div></div></div></TD><TD bold>{t.total}</TD><TD><Badge label={t.open} color="#f59e0b"/></TD><TD><Badge label={t.resolved} color="#10b981"/></TD><TD><Badge label={t.breached} color={t.breached>0?"#ef4444":"#10b981"}/></TD><TD><Badge label={t.slaRate+"%"} color={slaColor(t.slaRate)}/></TD><TD>{t.avgClose}h</TD></tr>;})}</tbody></table></Card>}
    </div>}

    {view==="per_client"&&<div>
      {byClient.length===0&&<Card><div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No client ticket data yet.</div></Card>}
      {byClient.length>0&&<Card style={{padding:0,overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:600}}><thead><tr style={{background:"#f8fafc"}}><TH>Client</TH><TH>Total</TH><TH>Open</TH><TH>Closed</TH><TH>SLA Rate</TH><TH>Avg Close</TH></tr></thead><tbody>{byClient.map(function(c,i){return<tr key={c.id} style={{borderBottom:"1px solid #f1f5f9"}}><TD><div style={{display:"flex",gap:8,alignItems:"center"}}><div style={{width:28,height:28,borderRadius:6,background:PAL[i%PAL.length],display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:12}}>{c.name[0]}</div><span style={{fontWeight:600}}>{c.name}</span></div></TD><TD bold>{c.total}</TD><TD><Badge label={c.open} color="#f59e0b"/></TD><TD><Badge label={c.resolved} color="#10b981"/></TD><TD><Badge label={c.slaRate+"%"} color={slaColor(c.slaRate)}/></TD><TD>{c.avgClose}h</TD></tr>;})}</tbody></table></Card>}
    </div>}
  </div>;
}

// ── Users ─────────────────────────────────────────────────────────────────────
function PageUsers(p){
  var users=p.users;var companies=p.companies;var setUsers=p.setUsers;var curUser=p.curUser;var addLog=p.addLog;var showToast=p.showToast;var schedules=p.schedules||{};var setSchedules=p.setSchedules;
  var dbSaveUser=p.dbSaveUser;var dbDeleteUser=p.dbDeleteUser;var dbSetPassword=p.dbSetPassword;var dbSaveSchedule=p.dbSaveSchedule;
  var[modal,setModal]=useState(null);var[form,setForm]=useState({});
  var[emailStatus,setEmailStatus]=useState(null);
  var[pwModal,setPwModal]=useState(null);var[newPw,setNewPw]=useState("");var[pwErr,setPwErr]=useState("");
  var[rolesModal,setRolesModal]=useState(false);
  var[roles,setRolesState]=useState(function(){return loadRoles();});
  var[roleForm,setRoleForm]=useState({key:"",label:"",color:"#6366f1"});var[roleEdit,setRoleEdit]=useState(null);

  function fld(k,v){setForm(function(prev){return Object.assign({},prev,{[k]:v});});}

  function syncRoles(next){saveRoles(next);setRolesState(next);Object.keys(ROLE_META).forEach(function(k){delete ROLE_META[k];});Object.assign(ROLE_META,next);}

  function addRole(){
    if(!roleForm.key.trim()||!roleForm.label.trim()){showToast("Key and label required","error");return;}
    var key=roleForm.key.trim().toLowerCase().replace(/\s+/g,"_");
    if(roles[key]){showToast("Role key already exists","error");return;}
    var next=Object.assign({},roles);next[key]={label:roleForm.label.trim(),color:roleForm.color,system:false};
    syncRoles(next);addLog("ROLE_CREATED",key,"Role \""+roleForm.label+"\" created");showToast("Role added!");setRoleForm({key:"",label:"",color:"#6366f1"});
  }
  function saveRoleEdit(){
    if(!roleForm.label.trim()){showToast("Label required","error");return;}
    var next=Object.assign({},roles);next[roleEdit]=Object.assign({},next[roleEdit],{label:roleForm.label.trim(),color:roleForm.color});
    syncRoles(next);addLog("ROLE_UPDATED",roleEdit,"Role updated");showToast("Role updated!");setRoleEdit(null);setRoleForm({key:"",label:"",color:"#6366f1"});
  }
  function deleteRole(key){
    if(roles[key]?.system){showToast("Cannot delete system roles","error");return;}
    if(users.some(function(u){return u.role===key;})){showToast("Cannot delete — users are assigned to this role","error");return;}
    var next=Object.assign({},roles);delete next[key];
    syncRoles(next);addLog("ROLE_DELETED",key,"Role \""+key+"\" deleted");showToast("Role deleted!");
  }

  async function resetPassword(){
    if(!newPw||newPw.length<6){setPwErr("Minimum 6 characters");return;}
    await dbSetPassword(pwModal.id,newPw);
    addLog("PASSWORD_RESET",pwModal.id,"Password reset for "+pwModal.name+" by admin");
    showToast("✅ Password reset for "+pwModal.name);
    setPwModal(null);setNewPw("");setPwErr("");
  }

  async function approveUser(u){
    var updated=Object.assign({},u,{active:true});
    await dbSaveUser(updated);
    setUsers(function(prev){return prev.map(function(x){return x.id===u.id?updated:x;});});
    addLog("USER_APPROVED",u.id,u.name+" approved");showToast("✅ Account approved!");
  }

  function handleScheduleChange(userId,sch){
    setSchedules(function(prev){var n=Object.assign({},prev);if(sch===null){delete n[userId];}else{n[userId]=sch;}return n;});
    dbSaveSchedule(userId,sch);
  }

  var allRoleOpts=Object.keys(roles).map(function(k){return mkOpt(k,roles[k].label);});
  var pendingUsers=users.filter(function(u){return !u.active;});
  var inp={width:"100%",padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#f8fafc",boxSizing:"border-box"};

  async function save(){
    if(!form.name||!form.email){showToast("Name and email required","error");return;}
    if(modal==="new"){
      var nu=Object.assign({},form,{id:uid(),createdAt:new Date().toISOString(),lastLogin:null});
      await dbSaveUser(nu);
      await dbSetPassword(nu.id,"password123");
      setUsers(function(prev){return prev.concat([nu]);});
      addLog("USER_CREATED",nu.id,"New user "+nu.name+" created");showToast("User created");
      setEmailStatus("sending");
      var emailBody=["Hi "+nu.name+",","","An account has been created for you on the Hoptix IT Helpdesk portal.","","📧 Email: "+nu.email,"🔑 Temporary Password: password123","","⚠️ Please sign in and change your password immediately.","","— The Hoptix IT Team"].join("\n");
      var result=await callSendEmail({to:nu.email,subject:"🎉 Your Hoptix IT Helpdesk account is ready",body:emailBody});
      setEmailStatus(result.success?"sent":"failed");
      if(result.success)addLog("EMAIL_SENT",nu.id,"Welcome email sent to "+nu.email);
      else showToast("⚠️ Welcome email failed","error");
    }else{
      var old=users.find(function(u){return u.id===form.id;});
      await dbSaveUser(form);
      setUsers(function(prev){return prev.map(function(u){return u.id===form.id?Object.assign({},form):u;});});
      if(old&&old.role!==form.role)addLog("USER_ROLE_CHANGE",form.id,"Role: "+(roles[old.role]?.label||old.role)+" → "+(roles[form.role]?.label||form.role));
      showToast("User updated");
    }
    setModal(null);
  }

  return<div>
    {pendingUsers.length>0&&<div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:12,padding:16,marginBottom:20}}>
      <div style={{fontWeight:700,color:"#92400e",marginBottom:10,fontSize:13}}>⏳ {pendingUsers.length} Account{pendingUsers.length>1?"s":""} Awaiting Approval</div>
      {pendingUsers.map(function(u){return<div key={u.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#fff",padding:"10px 14px",borderRadius:8,border:"1px solid #fde68a",marginBottom:6}}>
        <div style={{display:"flex",gap:10,alignItems:"center"}}><Avatar name={u.name} id={u.id} size={32}/><div><div style={{fontWeight:600,fontSize:13}}>{u.name}</div><div style={{fontSize:11,color:"#64748b"}}>{u.email}</div></div></div>
        <div style={{display:"flex",gap:6}}><Btn size="sm" variant="success" onClick={function(){approveUser(u);}}>✅ Approve</Btn><Btn size="sm" variant="danger" onClick={async function(){await dbDeleteUser(u.id);setUsers(function(prev){return prev.filter(function(x){return x.id!==u.id;});});showToast("Account rejected");}}>✕ Reject</Btn></div>
      </div>;})}
    </div>}

    <div style={{display:"flex",justifyContent:"space-between",marginBottom:16,gap:8,flexWrap:"wrap"}}>
      <div style={{fontWeight:700,fontSize:14}}>User Management ({users.length})</div>
      <div style={{display:"flex",gap:8}}><Btn variant="ghost" onClick={function(){setRolesModal(true);}}>🏷️ Manage Roles</Btn><Btn onClick={function(){setEmailStatus(null);setForm({name:"",email:"",role:"end_user",companyId:companies[0]?.id||"",phone:"",dept:"",active:true});setModal("new");}}>➕ Add User</Btn></div>
    </div>

    <Card style={{padding:0,overflow:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",minWidth:780}}>
        <thead><tr style={{background:"#f8fafc"}}>{["User","Email","Role","Company","Schedule","Status","Actions"].map(function(h){return<th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0"}}>{h}</th>;})}</tr></thead>
        <tbody>{users.map(function(u){
          var co=companies.find(function(c){return c.id===u.companyId;});var rm=roles[u.role]||{label:u.role,color:"#6366f1"};var sch=schedules[u.id]||null;var isIT=IT_ROLES.includes(u.role);
          return<tr key={u.id} style={{borderBottom:"1px solid #f1f5f9"}}>
            <td style={{padding:"10px 12px"}}><div style={{display:"flex",gap:8,alignItems:"center"}}><Avatar name={u.name} id={u.id} size={30}/><div><div style={{fontWeight:600,fontSize:12}}>{u.name}</div><div style={{fontSize:10,color:"#94a3b8"}}>Last: {ago(u.lastLogin)}</div></div></div></td>
            <td style={{padding:"10px 12px",fontSize:12}}>{u.email}</td>
            <td style={{padding:"10px 12px"}}><Badge label={rm.label} color={rm.color}/></td>
            <td style={{padding:"10px 12px",fontSize:12}}>{co?.name||"—"}</td>
            <td style={{padding:"10px 12px",fontSize:11,color:isIT?sch?"#0369a1":"#94a3b8":"#e2e8f0"}}>{isIT?(sch?<span>🗓 {sch.days.map(function(d){return DOW_LABELS[d];}).join(", ")} {fmtHour(sch.startHour)}–{fmtHour(sch.endHour)}</span>:"No schedule"):"—"}</td>
            <td style={{padding:"10px 12px"}}><Badge label={u.active?"Active":"Pending"} color={u.active?"#10b981":"#f59e0b"}/></td>
            <td style={{padding:"10px 12px"}}><div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              <Btn size="sm" variant="ghost" onClick={function(){setEmailStatus(null);setForm(Object.assign({},u));setModal("edit");}}>✏️</Btn>
              <Btn size="sm" variant="ghost" onClick={function(){setPwModal(u);setNewPw("");setPwErr("");}}>🔑</Btn>
              <Btn size="sm" variant={u.active?"warning":"success"} onClick={async function(){var updated=Object.assign({},u,{active:!u.active});await dbSaveUser(updated);setUsers(function(prev){return prev.map(function(x){return x.id===u.id?updated:x;});});showToast(u.active?"Deactivated":"Activated");}}>{u.active?"Disable":"Enable"}</Btn>
              {u.id!==curUser.id&&<Btn size="sm" variant="danger" onClick={async function(){await dbDeleteUser(u.id);setUsers(function(prev){return prev.filter(function(x){return x.id!==u.id;});});addLog("USER_DELETED",u.id,"User "+u.name+" deleted");showToast("Deleted");}}>🗑</Btn>}
            </div></td>
          </tr>;
        })}</tbody>
      </table>
    </Card>

    {modal&&<Modal title={modal==="new"?"Add User":"Edit User"} onClose={function(){setModal(null);}}>
      <FInput label="Full Name *" value={form.name||""} onChange={function(e){fld("name",e.target.value);}}/>
      <FInput label="Email *" value={form.email||""} onChange={function(e){fld("email",e.target.value);}} type="email"/>
      <FInput label="Phone" value={form.phone||""} onChange={function(e){fld("phone",e.target.value);}}/>
      <FInput label="Department" value={form.dept||""} onChange={function(e){fld("dept",e.target.value);}}/>
      <FSelect label="Role" value={form.role||"end_user"} onChange={function(e){fld("role",e.target.value);}} options={allRoleOpts}/>
      <FSelect label="Company" value={form.companyId||""} onChange={function(e){fld("companyId",e.target.value);}} options={optCompanies(companies)}/>
      {IT_ROLES.includes(form.role)&&<ScheduleEditor userId={form.id||"__new__"} schedules={schedules} onChange={handleScheduleChange}/>}
      {modal==="new"&&<div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#0369a1"}}>📧 A welcome email will be sent upon creation.</div>}
      {emailStatus==="sending"&&<div style={{background:"#fef3c7",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#92400e",display:"flex",alignItems:"center",gap:8}}><span style={{display:"inline-block",width:12,height:12,border:"2px solid #92400e",borderTop:"2px solid transparent",borderRadius:"50%",animation:"spin .7s linear infinite"}}/> Sending welcome email…</div>}
      {emailStatus==="sent"&&<div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#166534"}}>✅ Welcome email sent!</div>}
      {emailStatus==="failed"&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#dc2626"}}>⚠️ Welcome email failed. Account was still created.</div>}
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setModal(null);}}>Cancel</Btn><Btn onClick={save}>{modal==="new"?"Create & Send Welcome Email":"Save"}</Btn></div>
    </Modal>}

    {pwModal&&<Modal title={"🔑 Reset Password — "+pwModal.name} onClose={function(){setPwModal(null);setNewPw("");setPwErr("");}}>
      <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#92400e"}}>⚠️ Resetting password for <strong>{pwModal.name}</strong> ({pwModal.email})</div>
      <div style={{marginBottom:6}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>New Password (min 6 chars)</label><input type="password" value={newPw} onChange={function(e){setNewPw(e.target.value);setPwErr("");}} placeholder="••••••••" style={inp}/></div>
      {pwErr&&<div style={{fontSize:12,color:"#dc2626",marginBottom:10}}>⚠️ {pwErr}</div>}
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}><Btn variant="ghost" onClick={function(){setPwModal(null);setNewPw("");setPwErr("");}}>Cancel</Btn><Btn variant="danger" onClick={resetPassword}>🔑 Reset Password</Btn></div>
    </Modal>}

    {rolesModal&&<Modal title="🏷️ Manage User Roles" onClose={function(){setRolesModal(false);setRoleEdit(null);setRoleForm({key:"",label:"",color:"#6366f1"});}}>
      <div style={{marginBottom:16}}>
        {Object.keys(roles).map(function(key){var r=roles[key];var isEditing=roleEdit===key;return<div key={key} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:"#f8fafc",borderRadius:8,marginBottom:6,border:"1px solid #e2e8f0"}}>
          {isEditing?<>
            <input value={roleForm.label} onChange={function(e){setRoleForm(function(prev){return Object.assign({},prev,{label:e.target.value});});}} style={{flex:1,padding:"5px 8px",border:"1px solid #e2e8f0",borderRadius:6,fontSize:12,outline:"none"}} placeholder="Label"/>
            <input type="color" value={roleForm.color} onChange={function(e){setRoleForm(function(prev){return Object.assign({},prev,{color:e.target.value});});}} style={{width:32,height:28,border:"none",borderRadius:4,cursor:"pointer",padding:0}}/>
            <Btn size="sm" variant="success" onClick={saveRoleEdit}>✓</Btn>
            <Btn size="sm" variant="ghost" onClick={function(){setRoleEdit(null);setRoleForm({key:"",label:"",color:"#6366f1"});}}>✕</Btn>
          </>:<>
            <div style={{width:10,height:10,borderRadius:"50%",background:r.color,flexShrink:0}}/>
            <span style={{flex:1,fontSize:13,fontWeight:600,color:"#1e293b"}}>{r.label}</span>
            <span style={{fontSize:10,color:"#94a3b8",background:"#e2e8f0",borderRadius:4,padding:"2px 6px"}}>{key}</span>
            {r.system&&<span style={{fontSize:10,color:"#6366f1",fontWeight:600}}>system</span>}
            <Btn size="sm" variant="ghost" onClick={function(){setRoleEdit(key);setRoleForm({key:key,label:r.label,color:r.color});}}>✏️</Btn>
            {!r.system&&<Btn size="sm" variant="danger" onClick={function(){deleteRole(key);}}>🗑</Btn>}
          </>}
        </div>;})}
      </div>
      <div style={{borderTop:"1px solid #e2e8f0",paddingTop:16}}>
        <div style={{fontWeight:700,fontSize:13,color:"#1e293b",marginBottom:10}}>➕ Add New Role</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,alignItems:"end"}}>
          <div><label style={{display:"block",fontSize:11,fontWeight:600,color:"#475569",marginBottom:3}}>Key (e.g. supervisor)</label><input value={roleForm.key} onChange={function(e){setRoleForm(function(prev){return Object.assign({},prev,{key:e.target.value});});}} placeholder="supervisor" style={{width:"100%",padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none",background:"#f8fafc",boxSizing:"border-box"}}/></div>
          <div><label style={{display:"block",fontSize:11,fontWeight:600,color:"#475569",marginBottom:3}}>Label</label><input value={roleForm.label} onChange={function(e){setRoleForm(function(prev){return Object.assign({},prev,{label:e.target.value});});}} placeholder="Supervisor" style={{width:"100%",padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none",background:"#f8fafc",boxSizing:"border-box"}}/></div>
          <div><label style={{display:"block",fontSize:11,fontWeight:600,color:"#475569",marginBottom:3}}>Color</label><input type="color" value={roleForm.color} onChange={function(e){setRoleForm(function(prev){return Object.assign({},prev,{color:e.target.value});});}} style={{width:40,height:34,border:"1px solid #e2e8f0",borderRadius:8,cursor:"pointer",padding:2}}/></div>
        </div>
        <div style={{marginTop:10}}><Btn onClick={addRole}>➕ Add Role</Btn></div>
      </div>
    </Modal>}
  </div>;
}

// ── Companies ─────────────────────────────────────────────────────────────────
function PageCompanies(p){
  var companies=p.companies;var users=p.users;var setCompanies=p.setCompanies;var addLog=p.addLog;var showToast=p.showToast;
  var dbSaveCompany=p.dbSaveCompany;var dbDeleteCompany=p.dbDeleteCompany;
  var[modal,setModal]=useState(null);var[form,setForm]=useState({});
  function fld(k,v){setForm(function(prev){return Object.assign({},prev,{[k]:v});});}
  async function save(){if(!form.name){showToast("Name required","error");return;}if(modal==="new"){var nc=Object.assign({},form,{id:uid(),createdAt:new Date().toISOString()});await dbSaveCompany(nc);setCompanies(function(prev){return prev.concat([nc]);});addLog("COMPANY_CREATED",nc.id,'"'+nc.name+'" created');showToast("Created");}else{await dbSaveCompany(form);setCompanies(function(prev){return prev.map(function(c){return c.id===form.id?Object.assign({},form):c;});});showToast("Updated");}setModal(null);}
  return<div>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}><div style={{fontWeight:700,fontSize:14}}>Company Profiles ({companies.length})</div><Btn onClick={function(){setForm({name:"",domain:"",address:"",phone:"",industry:"",size:""});setModal("new");}}>➕ Add Company</Btn></div>
    {companies.length===0&&<Card><div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No companies yet.</div></Card>}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
      {companies.map(function(c){var members=users.filter(function(u){return u.companyId===c.id;});return<Card key={c.id}><div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}><div style={{width:44,height:44,borderRadius:10,background:avCol(c.id),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:16}}>{c.name[0]}</div><div style={{display:"flex",gap:6}}><Btn size="sm" variant="ghost" onClick={function(){setForm(Object.assign({},c));setModal("edit");}}>✏️</Btn><Btn size="sm" variant="danger" onClick={async function(){await dbDeleteCompany(c.id);setCompanies(function(prev){return prev.filter(function(x){return x.id!==c.id;});});addLog("COMPANY_DELETED",c.id,'"'+c.name+'" deleted');showToast("Deleted");}}>🗑</Btn></div></div><div style={{fontWeight:700,color:"#1e293b",marginBottom:4}}>{c.name}</div><div style={{fontSize:11,color:"#64748b"}}>🌐 {c.domain||"—"}</div><div style={{fontSize:11,color:"#64748b"}}>📍 {c.address||"—"}</div><div style={{fontSize:11,color:"#64748b"}}>📞 {c.phone||"—"}</div><div style={{fontSize:11,color:"#64748b",marginBottom:10}}>🏭 {c.industry||"—"} · {c.size||"—"}</div><div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{members.slice(0,5).map(function(m){return<Avatar key={m.id} name={m.name} id={m.id} size={24}/>;})}{members.length>5&&<div style={{fontSize:10,color:"#94a3b8",alignSelf:"center"}}>+{members.length-5}</div>}</div></Card>;})}
    </div>
    {modal&&<Modal title={modal==="new"?"Add Company":"Edit Company"} onClose={function(){setModal(null);}}>
      <FInput label="Name *" value={form.name||""} onChange={function(e){fld("name",e.target.value);}}/><FInput label="Domain" value={form.domain||""} onChange={function(e){fld("domain",e.target.value);}}/><FInput label="Address" value={form.address||""} onChange={function(e){fld("address",e.target.value);}}/><FInput label="Phone" value={form.phone||""} onChange={function(e){fld("phone",e.target.value);}}/><FInput label="Industry" value={form.industry||""} onChange={function(e){fld("industry",e.target.value);}}/><FInput label="Size" value={form.size||""} onChange={function(e){fld("size",e.target.value);}}/>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setModal(null);}}>Cancel</Btn><Btn onClick={save}>{modal==="new"?"Create":"Save"}</Btn></div>
    </Modal>}
  </div>;
}

// ── Clients ───────────────────────────────────────────────────────────────────
function PageClients(p){
  var clients=p.clients;var setClients=p.setClients;var companies=p.companies;var addLog=p.addLog;var showToast=p.showToast;
  var dbSaveClient=p.dbSaveClient;var dbDeleteClient=p.dbDeleteClient;
  var[modal,setModal]=useState(null);var[selCl,setSelCl]=useState(null);var[form,setForm]=useState({});var[lForm,setLForm]=useState({});
  function fld(k,v){setForm(function(prev){return Object.assign({},prev,{[k]:v});});}function lfld(k,v){setLForm(function(prev){return Object.assign({},prev,{[k]:v});});}
  async function saveCl(){if(!form.name){showToast("Name required","error");return;}if(modal==="newCl"){var nc=Object.assign({},form,{id:uid(),locations:[]});await dbSaveClient(nc);setClients(function(prev){return prev.concat([nc]);});addLog("CLIENT_CREATED",nc.id,"Client \""+nc.name+"\" added");showToast("Client added");}else{var updated=Object.assign({},form,{locations:clients.find(function(c){return c.id===form.id;})?.locations||[]});await dbSaveClient(updated);setClients(function(prev){return prev.map(function(c){return c.id===form.id?updated:c;});});showToast("Updated");}setModal(null);}
  async function saveLoc(){if(!lForm.name||!lForm.address){showToast("Name and address required","error");return;}var cl=clients.find(function(c){return c.id===selCl;});if(!cl)return;var newLocs;if(modal==="newLoc"){var nl=Object.assign({},lForm,{id:uid()});newLocs=cl.locations.concat([nl]);}else{newLocs=cl.locations.map(function(l){return l.id===lForm.id?Object.assign({},lForm):l;});}var updated=Object.assign({},cl,{locations:newLocs});await dbSaveClient(updated);setClients(function(prev){return prev.map(function(c){return c.id===selCl?updated:c;});});showToast(modal==="newLoc"?"Location added":"Updated");setModal(null);}
  return<div>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}><div style={{fontWeight:700,fontSize:14}}>Clients &amp; Locations</div><Btn onClick={function(){setForm({name:"",email:"",phone:"",industry:"",companyId:companies[0]?.id||""});setModal("newCl");}}>➕ Add Client</Btn></div>
    {clients.length===0&&<Card><div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No clients yet.</div></Card>}
    <div style={{display:"flex",flexDirection:"column",gap:16}}>{clients.map(function(cl){var co=companies.find(function(c){return c.id===cl.companyId;});return<Card key={cl.id}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}><div style={{display:"flex",gap:14,alignItems:"center"}}><div style={{width:48,height:48,borderRadius:12,background:avCol(cl.id),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:18}}>{cl.name[0]}</div><div><div style={{fontWeight:700,color:"#1e293b",fontSize:14}}>{cl.name}</div><div style={{fontSize:11,color:"#64748b"}}>📧 {cl.email} · 📞 {cl.phone}</div><div style={{fontSize:11,color:"#64748b"}}>🏭 {cl.industry}{co?" · "+co.name:""}</div></div></div><div style={{display:"flex",gap:6}}><Btn size="sm" variant="ghost" onClick={function(){setForm(Object.assign({},cl));setModal("editCl");}}>✏️ Edit</Btn><Btn size="sm" variant="danger" onClick={async function(){await dbDeleteClient(cl.id);setClients(function(prev){return prev.filter(function(x){return x.id!==cl.id;});});addLog("CLIENT_DELETED",cl.id,"\""+cl.name+"\" removed");showToast("Removed");}}>🗑 Remove</Btn></div></div>
      <div style={{background:"#f8fafc",borderRadius:10,padding:14}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><div style={{fontWeight:700,fontSize:12,color:"#475569"}}>📍 Locations ({cl.locations.length})</div><Btn size="sm" variant="primary" onClick={function(){setSelCl(cl.id);setLForm({name:"",address:"",floor:"",contact:""});setModal("newLoc");}}>➕ Add Location</Btn></div>
      {cl.locations.length===0&&<div style={{fontSize:12,color:"#94a3b8",textAlign:"center",padding:"12px 0"}}>No locations added yet.</div>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10}}>{cl.locations.map(function(loc){return<div key={loc.id} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:8,padding:12}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}><div style={{fontWeight:700,fontSize:12,color:"#1e293b"}}>📍 {loc.name}</div><div style={{display:"flex",gap:4}}><Btn size="sm" variant="ghost" onClick={function(){setSelCl(cl.id);setLForm(Object.assign({},loc));setModal("editLoc");}}>✏️</Btn><Btn size="sm" variant="danger" onClick={async function(){var newLocs=cl.locations.filter(function(l){return l.id!==loc.id;});var updated=Object.assign({},cl,{locations:newLocs});await dbSaveClient(updated);setClients(function(prev){return prev.map(function(c){return c.id===cl.id?updated:c;});});addLog("LOCATION_REMOVED",cl.id,"\""+loc.name+"\" removed");showToast("Removed");}}>🗑</Btn></div></div><div style={{fontSize:11,color:"#64748b"}}>📮 {loc.address}</div>{loc.floor&&<div style={{fontSize:11,color:"#64748b"}}>🏢 {loc.floor}</div>}{loc.contact&&<div style={{fontSize:11,color:"#64748b"}}>👤 {loc.contact}</div>}</div>;})}</div>
      </div>
    </Card>;})}
    </div>
    {(modal==="newCl"||modal==="editCl")&&<Modal title={modal==="newCl"?"Add Client":"Edit Client"} onClose={function(){setModal(null);}}><FInput label="Client Name *" value={form.name||""} onChange={function(e){fld("name",e.target.value);}}/><FInput label="Email" value={form.email||""} onChange={function(e){fld("email",e.target.value);}} type="email"/><FInput label="Phone" value={form.phone||""} onChange={function(e){fld("phone",e.target.value);}}/><FInput label="Industry" value={form.industry||""} onChange={function(e){fld("industry",e.target.value);}}/><FSelect label="Associated Company" value={form.companyId||""} onChange={function(e){fld("companyId",e.target.value);}} options={optCompaniesNone(companies)}/><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setModal(null);}}>Cancel</Btn><Btn onClick={saveCl}>{modal==="newCl"?"Add Client":"Save"}</Btn></div></Modal>}
    {(modal==="newLoc"||modal==="editLoc")&&<Modal title={modal==="newLoc"?"Add Location":"Edit Location"} onClose={function(){setModal(null);}}><FInput label="Location Name *" value={lForm.name||""} onChange={function(e){lfld("name",e.target.value);}} placeholder="e.g. HQ — New York"/><FInput label="Address *" value={lForm.address||""} onChange={function(e){lfld("address",e.target.value);}}/><FInput label="Floor / Area" value={lForm.floor||""} onChange={function(e){lfld("floor",e.target.value);}}/><FInput label="On-site Contact" value={lForm.contact||""} onChange={function(e){lfld("contact",e.target.value);}}/><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setModal(null);}}>Cancel</Btn><Btn onClick={saveLoc}>{modal==="newLoc"?"Add Location":"Save"}</Btn></div></Modal>}
  </div>;
}

// ── Ticket Types ──────────────────────────────────────────────────────────────
function PageTicketTypes(p){
  var ticketTypes=p.ticketTypes;var users=p.users;var setTicketTypes=p.setTicketTypes;var statusSla=p.statusSla;var setStatusSla=p.setStatusSla;var addLog=p.addLog;var showToast=p.showToast;
  var dbSaveTicketType=p.dbSaveTicketType;var dbDeleteTicketType=p.dbDeleteTicketType;
  var[modal,setModal]=useState(null);var[form,setForm]=useState({});var[kwInput,setKwInput]=useState("");
  var[slaEdit,setSlaEdit]=useState(function(){return Object.assign({},statusSla);});var[slaChanged,setSlaChanged]=useState(false);
  function fld(k,v){setForm(function(prev){return Object.assign({},prev,{[k]:v});});}
  async function save(){if(!form.name){showToast("Name required","error");return;}if(modal==="new"){var nt=Object.assign({},form,{id:uid(),keywords:form.keywords||[]});await dbSaveTicketType(nt);setTicketTypes(function(prev){return prev.concat([nt]);});addLog("TICKET_TYPE_CREATED",nt.id,"Type \""+nt.name+"\" created");showToast("Created");}else{await dbSaveTicketType(form);setTicketTypes(function(prev){return prev.map(function(t){return t.id===form.id?Object.assign({},form):t;});});showToast("Updated");}setModal(null);}
  function addKw(){if(kwInput.trim()){fld("keywords",(form.keywords||[]).concat([kwInput.trim()]));setKwInput("");}}
  function updateSlaField(status,val){var n=Object.assign({},slaEdit);n[status]=val===""||val===null?null:parseFloat(val);setSlaEdit(n);setSlaChanged(true);}
  function saveSla(){setStatusSla(slaEdit);saveStatusSlaStore(slaEdit);addLog("SLA_UPDATED","system","SLA thresholds updated");showToast("✅ SLA settings saved!");setSlaChanged(false);}
  var SLA_DESC={"Open":"Time before a ticket must be acknowledged","In Progress":"Time to resolve once work begins","Pending":"Time while waiting for requester","Escalated":"Time for senior staff after escalation","Closed":"No SLA"};
  return<div>
    <Card style={{marginBottom:24,borderTop:"3px solid #6366f1"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div><div style={{fontWeight:800,fontSize:15,color:"#1e293b"}}>⏱ Status SLA Thresholds</div><div style={{fontSize:12,color:"#64748b",marginTop:2}}>Hours allowed per status.</div></div>
        <div style={{display:"flex",gap:8}}><Btn size="sm" variant="ghost" onClick={function(){setSlaEdit(Object.assign({},DEFAULT_STATUS_SLA));setSlaChanged(true);}}>↺ Reset</Btn><Btn size="sm" variant={slaChanged?"primary":"ghost"} onClick={saveSla} style={{opacity:slaChanged?1:0.5}}>💾 Save SLA</Btn></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
        {ALL_STATUSES.map(function(status){var sm=STATUS_META[status];var isClosed=status==="Closed";var val=slaEdit[status];return<div key={status} style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:14}}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}><div style={{width:10,height:10,borderRadius:"50%",background:sm.color,flexShrink:0}}/><div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>{status}</div>{!isClosed&&val!==null&&<Badge label={val+"h"} color={sm.color}/>}{isClosed&&<Badge label="No SLA" color="#94a3b8"/>}</div><div style={{fontSize:11,color:"#64748b",marginBottom:10,lineHeight:1.5}}>{SLA_DESC[status]}</div>{isClosed?<div style={{fontSize:11,color:"#94a3b8",fontStyle:"italic"}}>Closed tickets have no SLA timer.</div>:<div style={{display:"flex",alignItems:"center",gap:8}}><input type="number" min="0.5" step="0.5" value={val===null||val===undefined?"":val} onChange={function(e){updateSlaField(status,e.target.value);}} style={{width:80,padding:"6px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#fff",boxSizing:"border-box"}}/><span style={{fontSize:12,color:"#64748b",fontWeight:600}}>hours</span></div>}</div>;})}
      </div>
      {slaChanged&&<div style={{marginTop:14,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#92400e"}}>⚠️ Unsaved changes. Click <strong>Save SLA</strong> to apply.</div>}
    </Card>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}><div style={{fontWeight:700,fontSize:14}}>Ticket Types ({ticketTypes.length})</div><Btn onClick={function(){setForm({name:"",priority:"medium",slaHours:24,color:"#6366f1",keywords:[],defaultAssignee:""});setModal("new");}}>➕ Add Type</Btn></div>
    {ticketTypes.length===0&&<Card><div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No ticket types yet.</div></Card>}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:14}}>
      {ticketTypes.map(function(tt){var asgn=users.find(function(u){return u.id===tt.defaultAssignee;});return<Card key={tt.id}><div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><div style={{display:"flex",gap:8,alignItems:"center"}}><div style={{width:10,height:10,borderRadius:"50%",background:tt.color}}/><span style={{fontWeight:700,color:"#1e293b"}}>{tt.name}</span></div><div style={{display:"flex",gap:4}}><Btn size="sm" variant="ghost" onClick={function(){setForm(Object.assign({},tt,{keywords:(tt.keywords||[]).slice()}));setModal("edit");}}>✏️</Btn><Btn size="sm" variant="danger" onClick={async function(){await dbDeleteTicketType(tt.id);setTicketTypes(function(prev){return prev.filter(function(t){return t.id!==tt.id;});});addLog("TICKET_TYPE_DELETED",tt.id,"Type \""+tt.name+"\" deleted");showToast("Deleted");}}>🗑</Btn></div></div><div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}><Badge label={PRI_META[tt.priority]?.label||tt.priority} color={PRI_META[tt.priority]?.color||"#6366f1"}/><Badge label={"SLA "+tt.slaHours+"h"} color="#0ea5e9"/></div>{asgn&&<div style={{fontSize:11,color:"#64748b",marginBottom:6}}>👤 {asgn.name}</div>}<div style={{display:"flex",flexWrap:"wrap",gap:4}}>{(tt.keywords||[]).slice(0,5).map(function(k){return<span key={k} style={{background:"#f1f5f9",color:"#475569",fontSize:10,padding:"2px 6px",borderRadius:4}}>{k}</span>;})}{(tt.keywords||[]).length>5&&<span style={{fontSize:10,color:"#94a3b8"}}>+{(tt.keywords||[]).length-5}</span>}</div></Card>;})}
    </div>
    {modal&&<Modal title={modal==="new"?"Add Ticket Type":"Edit Ticket Type"} onClose={function(){setModal(null);}}><FInput label="Type Name *" value={form.name||""} onChange={function(e){fld("name",e.target.value);}}/><FSelect label="Priority" value={form.priority||"medium"} onChange={function(e){fld("priority",e.target.value);}} options={OPT_PRIORITY}/><FInput label="SLA Hours" value={form.slaHours||24} onChange={function(e){fld("slaHours",Number(e.target.value));}} type="number" min={1}/><FInput label="Color" value={form.color||"#6366f1"} onChange={function(e){fld("color",e.target.value);}} type="color"/><FSelect label="Default Assignee" value={form.defaultAssignee||""} onChange={function(e){fld("defaultAssignee",e.target.value);}} options={optAssignees(users)}/><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Keywords</label><div style={{display:"flex",gap:6,marginBottom:6}}><input value={kwInput} onChange={function(e){setKwInput(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")addKw();}} placeholder="e.g. printer" style={{flex:1,padding:"6px 10px",border:"1px solid #e2e8f0",borderRadius:6,fontSize:12,outline:"none"}}/><Btn size="sm" onClick={addKw}>Add</Btn></div><div style={{display:"flex",flexWrap:"wrap",gap:4}}>{(form.keywords||[]).map(function(k,i){return<span key={i} onClick={function(){fld("keywords",(form.keywords||[]).filter(function(_,j){return j!==i;}));}} style={{background:"#eef2ff",color:"#4338ca",fontSize:11,padding:"2px 8px",borderRadius:4,cursor:"pointer"}}>{k} ×</span>;})}</div></div><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setModal(null);}}>Cancel</Btn><Btn onClick={save}>{modal==="new"?"Create":"Save"}</Btn></div></Modal>}
  </div>;
}

// ── Activity Log ──────────────────────────────────────────────────────────────
const ACTION_META={INTEGRATIONS_UPDATED:{icon:"🔌",color:"#6366f1",label:"Integrations Updated"},USER_ROLE_CHANGE:{icon:"🔑",color:"#7c3aed",label:"Role Changed"},USER_CREATED:{icon:"👤",color:"#2563eb",label:"User Created"},USER_APPROVED:{icon:"✅",color:"#10b981",label:"User Approved"},USER_DELETED:{icon:"🗑",color:"#ef4444",label:"User Deleted"},PROFILE_UPDATED:{icon:"✏️",color:"#0ea5e9",label:"Profile Updated"},PASSWORD_CHANGED:{icon:"🔑",color:"#7c3aed",label:"Password Changed"},PASSWORD_RESET:{icon:"🔑",color:"#ef4444",label:"Password Reset"},ROLE_CREATED:{icon:"🏷️",color:"#10b981",label:"Role Created"},ROLE_UPDATED:{icon:"🏷️",color:"#0ea5e9",label:"Role Updated"},ROLE_DELETED:{icon:"🏷️",color:"#ef4444",label:"Role Deleted"},COMPANY_CREATED:{icon:"🏢",color:"#10b981",label:"Company Created"},COMPANY_DELETED:{icon:"🗑",color:"#ef4444",label:"Company Deleted"},TICKET_CREATED:{icon:"🎫",color:"#6366f1",label:"Ticket Created"},TICKET_STATUS:{icon:"🔄",color:"#f59e0b",label:"Status Updated"},TICKET_DELETED:{icon:"🗑",color:"#dc2626",label:"Ticket Deleted"},TICKET_TYPE_CHANGE:{icon:"🏷️",color:"#0ea5e9",label:"Type Changed"},EMAIL_SENT:{icon:"📧",color:"#0ea5e9",label:"Email Sent"},CLIENT_CREATED:{icon:"🤝",color:"#10b981",label:"Client Added"},CLIENT_DELETED:{icon:"🗑",color:"#ef4444",label:"Client Removed"},LOCATION_ADDED:{icon:"📍",color:"#10b981",label:"Location Added"},LOCATION_REMOVED:{icon:"📍",color:"#ef4444",label:"Location Removed"},TICKET_TYPE_CREATED:{icon:"🏷️",color:"#10b981",label:"Type Created"},TICKET_TYPE_DELETED:{icon:"🏷️",color:"#ef4444",label:"Type Deleted"},SLA_UPDATED:{icon:"⏱",color:"#6366f1",label:"SLA Updated"}};

function PageActivityLog(p){
  var logs=p.logs;var users=p.users;var[filter,setFilter]=useState("");
  function fu(id){return users.find(function(x){return x.id===id;});}
  var filtered=filter?logs.filter(function(l){return l.action===filter;}):logs;
  return<div><div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center"}}><div style={{fontWeight:700,fontSize:14,flex:1}}>Activity Log ({filtered.length})</div><select value={filter} onChange={function(e){setFilter(e.target.value);}} style={{padding:"7px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}><option value="">All Actions</option>{Object.keys(ACTION_META).map(function(k){return<option key={k} value={k}>{ACTION_META[k].label}</option>;})}</select></div><Card style={{padding:0}}>{filtered.length===0&&<div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No activity found</div>}{filtered.map(function(log,i){var am=ACTION_META[log.action]||{icon:"📝",color:"#6366f1",label:log.action};var actor=fu(log.userId);return<div key={log.id} style={{display:"flex",gap:12,padding:"12px 16px",borderBottom:i<filtered.length-1?"1px solid #f1f5f9":"none",alignItems:"flex-start"}}><div style={{width:32,height:32,borderRadius:8,background:am.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{am.icon}</div><div style={{flex:1}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><Badge label={am.label} color={am.color}/><span style={{fontSize:10,color:"#94a3b8"}}>{fdt(log.timestamp)}</span></div><div style={{fontSize:12,color:"#334155",marginTop:4}}>{log.detail}</div>{actor&&<div style={{fontSize:11,color:"#94a3b8",marginTop:4,display:"flex",alignItems:"center",gap:4}}><Avatar name={actor.name} id={actor.id} size={14}/>By {actor.name}</div>}</div></div>;})} </Card></div>;
}

// ── Integrations ──────────────────────────────────────────────────────────────
function PageIntegrations(p){
  var emailTemplates=p.emailTemplates||[];var setEmailTemplates=p.setEmailTemplates||function(){};var isAdmin=p.isAdmin;var showToast=p.showToast;
  var[testTo,setTestTo]=useState("");
  var[sending,setSending]=useState(false);
  var[status,setStatus]=useState("");
  var[tmplModal,setTmplModal]=useState(false);
  var[tmplForm,setTmplForm]=useState({name:"",subject:"",body:""});
  var[tmplEdit,setTmplEdit]=useState(null);
  function openNew(){setTmplForm({name:"",subject:"",body:""});setTmplEdit(null);setTmplModal(true);}
  function openEdit(t){setTmplForm({name:t.name,subject:t.subject,body:t.body});setTmplEdit(t.id);setTmplModal(true);}
  async function saveTmpl(){
    if(!tmplForm.name.trim()||!tmplForm.subject.trim()||!tmplForm.body.trim()){showToast("All fields required","error");return;}
    var t={id:tmplEdit||uid(),name:tmplForm.name.trim(),subject:tmplForm.subject.trim(),body:tmplForm.body.trim(),createdAt:new Date().toISOString()};
    await dbSaveEmailTemplate(t);
    setEmailTemplates(function(prev){return tmplEdit?prev.map(function(x){return x.id===tmplEdit?t:x;}):prev.concat([t]);});
    showToast(tmplEdit?"Template updated!":"Template created!");setTmplModal(false);
  }
  async function deleteTmpl(id){
    await dbDeleteEmailTemplate(id);
    setEmailTemplates(function(prev){return prev.filter(function(x){return x.id!==id;});});
    showToast("Template deleted");
  }

  async function runTest(){
    if(!testTo.trim()){if(p.showToast)p.showToast("Enter a recipient email","error");return;}
    setSending(true);setStatus("");
    try{
      var r=await callSendEmail({to:testTo.trim(),subject:"Hoptix Test",body:"Your email integration is working!"});
      if(r.success){setStatus("ok");if(p.showToast)p.showToast("📧 Test sent!");}
      else{setStatus("fail");if(p.showToast)p.showToast("Failed: "+r.error,"error");}
    }catch(e){setStatus("fail");if(p.showToast)p.showToast("Error: "+e.message,"error");}
    setSending(false);
  }

  return(
    <div style={{maxWidth:600}}>
      <div style={{fontWeight:800,fontSize:18,color:"#1e293b",marginBottom:4}}>🔌 Integrations</div>
      <div style={{fontSize:12,color:"#64748b",marginBottom:24}}>Configure your email provider.</div>
      <Card style={{borderTop:"3px solid #6366f1"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:20}}>📧</span>
            <span style={{fontWeight:700,fontSize:15,color:"#1e293b"}}>Gmail (App Password)</span>
            <span style={{background:"#d1fae5",color:"#065f46",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700}}>Active</span>
          </div>
          <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:"#6366f1",fontWeight:700,textDecoration:"none"}}>Google App Passwords ↗</a>
        </div>
        <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#0369a1",lineHeight:1.9}}>
          Email is sent via Gmail SMTP using Vercel environment variables.<br/>
          Set these in <strong>Vercel Dashboard → Settings → Environment Variables</strong>:<br/>
          <code style={{background:"#e0f2fe",padding:"1px 5px",borderRadius:3}}>GMAIL_USER</code> — your Gmail address<br/>
          <code style={{background:"#e0f2fe",padding:"1px 5px",borderRadius:3}}>GMAIL_APP_PASSWORD</code> — 16-char app password from Google Account Security
        </div>
        <div style={{marginBottom:16}}>
          <label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:6}}>Send Test Email</label>
          <div style={{display:"flex",gap:8}}>
            <input type="email" value={testTo} onChange={function(e){setTestTo(e.target.value);}} placeholder="recipient@example.com" style={{flex:1,padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#f8fafc",boxSizing:"border-box"}}/>
            <button onClick={runTest} disabled={sending} style={{padding:"9px 18px",background:sending?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:8,fontWeight:700,fontSize:13,cursor:sending?"not-allowed":"pointer",flexShrink:0}}>
              {sending?"Sending...":"📤 Test"}
            </button>
          </div>
          {status==="ok"&&<div style={{marginTop:8,padding:"8px 14px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,fontSize:12,color:"#166534"}}>✅ Test email delivered!</div>}
          {status==="fail"&&<div style={{marginTop:8,padding:"8px 14px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,fontSize:12,color:"#dc2626"}}>❌ Send failed — check Vercel env variables.</div>}
        </div>
        <div style={{padding:"10px 14px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,fontSize:12,color:"#92400e"}}>
          🔒 Credentials live in Vercel environment variables — never exposed to the browser.
        </div>
      </Card>
      {isAdmin&&<Card style={{marginTop:24,borderTop:"3px solid #6366f1"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div><div style={{fontWeight:800,fontSize:15,color:"#1e293b"}}>📝 Email Templates</div><div style={{fontSize:12,color:"#64748b",marginTop:2}}>Reusable templates for ticket emails. Supports <code style={{background:"#f1f5f9",padding:"1px 4px",borderRadius:3}}>{"{{client_name}}"}</code> and <code style={{background:"#f1f5f9",padding:"1px 4px",borderRadius:3}}>{"{{agent_name}}"}</code>.</div></div>
          <Btn onClick={openNew}>➕ Add Template</Btn>
        </div>
        {emailTemplates.length===0&&<div style={{textAlign:"center",padding:"24px 0",color:"#94a3b8",fontSize:13}}>No templates yet. Add one to get started.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {emailTemplates.map(function(t){return<div key={t.id} style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"12px 16px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,color:"#1e293b",fontSize:13,marginBottom:4}}>{t.name}</div>
                <div style={{fontSize:11,color:"#64748b",marginBottom:4}}>Subject: {t.subject}</div>
                <div style={{fontSize:11,color:"#94a3b8",background:"#fff",borderRadius:6,padding:"6px 10px",border:"1px solid #e2e8f0",whiteSpace:"pre-wrap",maxHeight:60,overflow:"hidden"}}>{t.body.slice(0,150)}{t.body.length>150?"…":""}</div>
              </div>
              <div style={{display:"flex",gap:6,marginLeft:12,flexShrink:0}}>
                <Btn size="sm" variant="ghost" onClick={function(){openEdit(t);}}>✏️ Edit</Btn>
                <Btn size="sm" variant="danger" onClick={function(){deleteTmpl(t.id);}}>🗑</Btn>
              </div>
            </div>
          </div>;})}
        </div>
      </Card>}
      {tmplModal&&<Modal title={tmplEdit?"Edit Template":"New Email Template"} onClose={function(){setTmplModal(false);}}>
        <FInput label="Template Name *" value={tmplForm.name} onChange={function(e){setTmplForm(function(prev){return Object.assign({},prev,{name:e.target.value});});}} placeholder="e.g. Initial Response"/>
        <FInput label="Subject *" value={tmplForm.subject} onChange={function(e){setTmplForm(function(prev){return Object.assign({},prev,{subject:e.target.value});});}} placeholder="e.g. Re: Your IT Request"/>
        <FTextarea label="Body *" value={tmplForm.body} onChange={function(e){setTmplForm(function(prev){return Object.assign({},prev,{body:e.target.value});});}} rows={8} placeholder={"Hi {{client_name}},\n\nThank you for reaching out...\n\nBest regards,\n{{agent_name}}"}/>
        <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:8,padding:"8px 12px",marginBottom:14,fontSize:11,color:"#0369a1"}}>
          💡 Use <strong>{"{{client_name}}"}</strong> and <strong>{"{{agent_name}}"}</strong> — they will be auto-filled when the template is selected on a ticket.
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setTmplModal(false);}}>Cancel</Btn><Btn onClick={saveTmpl}>{tmplEdit?"Save Changes":"Create Template"}</Btn></div>
      </Modal>}
    </div>
  );
}
