import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import React from "react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area, LineChart, Line } from "recharts";
import { supabase } from './supabase.js';
import { dbGetUsers, dbSaveUser, dbDeleteUser, dbGetPassword, dbSetPassword, dbGetCompanies, dbSaveCompany, dbDeleteCompany, dbGetClients, dbSaveClient, dbDeleteClient, dbGetTicketTypes, dbSaveTicketType, dbDeleteTicketType, dbGetTickets, dbSaveTicket, dbGetLogs, dbAddLog, dbGetSchedules, dbSaveSchedule } from './db.js';

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

// ── Chat DB helpers ───────────────────────────────────────────────────────────
async function dbGetComments(ticketId){
  try{
    var{data,error}=await supabase.from("ticket_comments").select("*").eq("ticket_id",ticketId).order("created_at",{ascending:true});
    if(error)throw error;
    return data||[];
  }catch(e){console.error("dbGetComments",e);return[];}
}
async function dbSaveComment(comment){
  try{
    var{error}=await supabase.from("ticket_comments").upsert([comment]);
    if(error)throw error;
  }catch(e){console.error("dbSaveComment",e);}
}

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

// ── Ticket Chat Component ─────────────────────────────────────────────────────
function TicketChat({ ticketId, curUser, users }) {
  var [comments, setComments] = useState([]);
  var [msg, setMsg] = useState("");
  var [sending, setSending] = useState(false);
  var [loading, setLoading] = useState(true);
  var bottomRef = useRef(null);

  // Load comments on mount
  useEffect(function () {
    setLoading(true);
    dbGetComments(ticketId).then(function (data) {
      setComments(data);
      setLoading(false);
    });
  }, [ticketId]);

  // Real-time subscription
  useEffect(function () {
    var ch = supabase
      .channel("chat-" + ticketId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ticket_comments", filter: "ticket_id=eq." + ticketId },
        function (payload) {
          setComments(function (prev) {
            if (prev.some(function (c) { return c.id === payload.new.id; })) return prev;
            return prev.concat([payload.new]);
          });
        }
      )
      .subscribe();
    return function () { supabase.removeChannel(ch); };
  }, [ticketId]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(function () {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [comments]);

  async function sendMsg() {
    var text = msg.trim();
    if (!text || sending) return;
    setSending(true);
    var comment = {
      id: uid(),
      ticket_id: ticketId,
      user_id: curUser.id,
      message: text,
      created_at: new Date().toISOString()
    };
    // Optimistic update
    setComments(function (prev) { return prev.concat([comment]); });
    setMsg("");
    await dbSaveComment(comment);
    setSending(false);
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMsg();
    }
  }

  function fu(id) { return users.find(function (u) { return u.id === id; }); }

  // Group consecutive messages from the same user
  function getGroups() {
    var groups = [];
    comments.forEach(function (c, i) {
      var prev = comments[i - 1];
      var isSameUser = prev && prev.user_id === c.user_id &&
        (new Date(c.created_at) - new Date(prev.created_at)) < 5 * 60 * 1000;
      if (isSameUser) {
        groups[groups.length - 1].msgs.push(c);
      } else {
        groups.push({ user_id: c.user_id, msgs: [c] });
      }
    });
    return groups;
  }

  var groups = getGroups();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: 480 }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#6366f1,#4338ca)", borderRadius: 10, padding: "10px 16px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>💬 Ticket Chat</div>
        <div style={{ background: "rgba(255,255,255,.2)", color: "#fff", borderRadius: 12, padding: "2px 10px", fontSize: 11, fontWeight: 600 }}>{comments.length} messages</div>
      </div>

      {/* Messages area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 4px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
        {loading && (
          <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 13 }}>
            <div style={{ width: 28, height: 28, border: "3px solid #e2e8f0", borderTop: "3px solid #6366f1", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 10px" }} />
            Loading chat…
          </div>
        )}
        {!loading && comments.length === 0 && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "#94a3b8" }}>
            <div style={{ fontSize: 36 }}>💬</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>No messages yet</div>
            <div style={{ fontSize: 11 }}>Start the conversation below</div>
          </div>
        )}
        {!loading && groups.map(function (g, gi) {
          var user = fu(g.user_id);
          var isMe = g.user_id === curUser.id;
          return (
            <div key={gi} style={{ display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start", marginBottom: 6 }}>
              {/* Sender info (shown once per group) */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexDirection: isMe ? "row-reverse" : "row" }}>
                <Avatar name={user ? user.name : "?"} id={g.user_id} size={22} />
                <span style={{ fontSize: 11, fontWeight: 600, color: "#475569" }}>{user ? user.name : "Unknown"}</span>
                {user && <Badge label={ROLE_META[user.role]?.label || user.role} color={ROLE_META[user.role]?.color || "#6366f1"} />}
              </div>
              {/* Bubbles */}
              {g.msgs.map(function (c, ci) {
                var isLast = ci === g.msgs.length - 1;
                return (
                  <div key={c.id} style={{
                    maxWidth: "75%",
                    marginBottom: isLast ? 0 : 2,
                    alignSelf: isMe ? "flex-end" : "flex-start"
                  }}>
                    <div style={{
                      background: isMe ? "linear-gradient(135deg,#6366f1,#4338ca)" : "#f1f5f9",
                      color: isMe ? "#fff" : "#1e293b",
                      borderRadius: isMe
                        ? (ci === 0 ? "18px 18px 4px 18px" : ci === g.msgs.length - 1 ? "4px 18px 18px 18px" : "4px 18px 18px 4px")
                        : (ci === 0 ? "18px 18px 18px 4px
