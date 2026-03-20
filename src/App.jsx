import { useState, useEffect, useMemo, useCallback } from "react";
import React from "react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area, LineChart, Line } from "recharts";

const PAL = ["#6366f1","#8b5cf6","#0ea5e9","#10b981","#f59e0b","#ef4444","#ec4899","#f97316"];
const RESEND_URL = "https://api.resend.com/emails";

function loadIntegrations(){ try{ return JSON.parse(localStorage.getItem("hd_integrations")||"{}"); }catch{ return {}; } }
function saveIntegrations(v){ try{ localStorage.setItem("hd_integrations",JSON.stringify(v)); }catch{} }
const STATUS_META = { "Open":{color:"#f59e0b",bg:"#fef3c7"}, "In Progress":{color:"#6366f1",bg:"#eef2ff"}, "Pending":{color:"#0ea5e9",bg:"#e0f2fe"}, "Escalated":{color:"#ef4444",bg:"#fee2e2"}, "Closed":{color:"#94a3b8",bg:"#f1f5f9"} };
const ALL_STATUSES = ["Open","In Progress","Pending","Escalated","Closed"];
const PRI_META = { critical:{color:"#dc2626",bg:"#fee2e2",label:"Critical"}, high:{color:"#ef4444",bg:"#fef2f2",label:"High"}, medium:{color:"#f59e0b",bg:"#fffbeb",label:"Medium"}, low:{color:"#10b981",bg:"#f0fdf4",label:"Low"} };
const ROLE_META = { admin:{label:"Administrator",color:"#dc2626"}, it_manager:{label:"IT Manager",color:"#7c3aed"}, it_technician:{label:"IT Technician",color:"#2563eb"}, end_user:{label:"End User",color:"#059669"} };
const DEFAULT_STATUS_SLA = { "Open":2, "In Progress":8, "Pending":24, "Escalated":1, "Closed":null };
const DOW_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const IT_ROLES = ["admin","it_manager","it_technician"];

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
const fmtMs = function(mins){
  if(!mins&&mins!==0) return "—";
  var totalSecs=mins*60;
  if(totalSecs<60) return totalSecs.toFixed(2)+"s";
  if(totalSecs<3600){ var m=Math.floor(mins); var s=parseFloat(((mins-m)*60).toFixed(2)); return m+"m "+s+"s"; }
  var h=Math.floor(mins/60); var remMins=mins-h*60; var m2=Math.floor(remMins); var s2=parseFloat(((remMins-m2)*60).toFixed(2)); return h+"h "+m2+"m "+s2+"s";
};
const pieLabel = function(p){ return p.value>0?p.name+": "+p.value:""; };
const fmtHour = function(h){ if(h===0)return"12:00 AM"; if(h<12)return h+":00 AM"; if(h===12)return"12:00 PM"; return (h-12)+":00 PM"; };

// ── Schedule helpers ──────────────────────────────────────────────────────────
function loadSchedules(){ try{var s=localStorage.getItem("hd_schedules");return s?JSON.parse(s):{};} catch{return{};}}
function saveSchedules(v){ try{localStorage.setItem("hd_schedules",JSON.stringify(v));}catch{}}

// Calculates hours elapsed counting only time within the assignee's schedule
function calcBusinessHoursElapsed(startMs, endMs, schedule){
  if(!schedule||!schedule.days||!schedule.days.length) return (endMs-startMs)/3600000;
  var total=0; var cur=startMs;
  while(cur<endMs){
    var d=new Date(cur); var dow=d.getDay();
    var dayStart=new Date(d.getFullYear(),d.getMonth(),d.getDate(),schedule.startHour,0,0,0).getTime();
    var dayEnd  =new Date(d.getFullYear(),d.getMonth(),d.getDate(),schedule.endHour,0,0,0).getTime();
    if(schedule.days.includes(dow)){
      var os=Math.max(cur,dayStart); var oe=Math.min(endMs,dayEnd);
      if(oe>os) total+=(oe-os)/3600000;
    }
    cur=new Date(d.getFullYear(),d.getMonth(),d.getDate()+1,0,0,0,0).getTime();
  }
  return total;
}

function isCurrentlyOnShift(schedule){
  if(!schedule||!schedule.days||!schedule.days.length) return true;
  var now=new Date(); var dow=now.getDay(); var h=now.getHours()+(now.getMinutes()/60);
  return schedule.days.includes(dow)&&h>=schedule.startHour&&h<schedule.endHour;
}

function fmtSchedule(sch){
  if(!sch||!sch.days||!sch.days.length) return "No schedule set (24/7)";
  var dayNames=sch.days.slice().sort(function(a,b){return a-b;}).map(function(d){return DOW_LABELS[d];}).join(", ");
  return dayNames+" · "+fmtHour(sch.startHour)+" – "+fmtHour(sch.endHour);
}

// ── Shared helpers ────────────────────────────────────────────────────────────
function calcSlaRate(arr){ return arr.length?Math.round((1-arr.filter(function(t){return t.slaBreached;}).length/arr.length)*100):100; }
function calcAvgClose(arr){ return arr.length?Math.round(arr.reduce(function(a,t){return a+(new Date(t.closedAt||t.updatedAt)-new Date(t.createdAt))/3600000;},0)/arr.length):0; }
function calcClosed(arr){ return arr.filter(function(t){return t.status==="Closed";}); }

function loadStatusSla(){ try{ var s=localStorage.getItem("hd_statusSla"); return s?JSON.parse(s):DEFAULT_STATUS_SLA; }catch{ return DEFAULT_STATUS_SLA; } }
function saveStatusSlaStore(v){ try{ localStorage.setItem("hd_statusSla",JSON.stringify(v)); }catch{} }

function getStatusSla(ticket, slaConfig, schedules){
  var cfg=slaConfig||loadStatusSla();
  var allowed=cfg[ticket.status];
  if(allowed===null||allowed===undefined) return null;
  var hist=(ticket.statusHistory||[]);
  var entry=null;
  // Find the most recent history entry that actually SET this status (ignore _noSlaReset updates)
  for(var i=hist.length-1;i>=0;i--){
    if(hist[i].status===ticket.status && !hist[i]._noSlaReset){entry=hist[i].timestamp;break;}
  }
  if(!entry) entry=ticket.updatedAt||ticket.createdAt;
  var schedule=(schedules&&ticket.assignedTo)?schedules[ticket.assignedTo]:null;
  var spent=schedule
    ? calcBusinessHoursElapsed(new Date(entry).getTime(), Date.now(), schedule)
    : (Date.now()-new Date(entry).getTime())/3600000;
  var pct=Math.min(100,Math.round(spent/allowed*100));
  var breached=spent>allowed;
  var remaining=Math.max(0,allowed-spent);
  var onShift=isCurrentlyOnShift(schedule);
  return {hoursAllowed:allowed,hoursSpent:parseFloat(spent.toFixed(2)),pct,breached,remaining:parseFloat(remaining.toFixed(2)),enteredAt:entry,onShift,hasSchedule:!!schedule,schedule};
}

async function callSendEmail(opts) {
  var cfg=loadIntegrations(); var apiKey=(cfg.resend||{}).apiKey;
  if(apiKey){
    try{
      var toArr=Array.isArray(opts.to)?opts.to:[opts.to];
      var fromAddr=(cfg.resend||{}).from||"Hoptix IT <onboarding@resend.dev>";
      var body={from:fromAddr,to:toArr,subject:opts.subject||"(no subject)",text:opts.body||opts.message||""};
      if(opts.cc&&opts.cc.length) body.cc=Array.isArray(opts.cc)?opts.cc:[opts.cc];
      var res=await fetch(RESEND_URL,{method:"POST",headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify(body)});
      var data=await res.json();
      if(res.ok&&data.id) return {success:true,provider:"Resend",id:data.id};
      throw new Error(data.message||data.name||("Status "+res.status));
    }catch(e){ return {success:false,error:e.message,provider:"Resend"}; }
  }
  return {success:false,error:"No email provider configured. Add your Resend API key in Integrations.",provider:"None"};
}
function aiAssign(title,desc,typeId,users,types) {
  var tt=types.find(function(t){return t.id===typeId;});
  if(tt&&tt.defaultAssignee){var u=users.find(function(u){return u.id===tt.defaultAssignee&&u.active;});if(u)return{id:u.id,reason:"Type \""+tt.name+"\" → "+u.name};}
  var text=(title+" "+desc).toLowerCase();
  for(var i=0;i<types.length;i++){var t=types[i];if(!t.defaultAssignee)continue;var kws=t.keywords||[];for(var j=0;j<kws.length;j++){if(text.includes(kws[j].toLowerCase())){var u2=users.find(function(u){return u.id===t.defaultAssignee&&u.active;});if(u2)return{id:u2.id,reason:"Keyword \""+kws[j]+"\" → "+u2.name};}}}
  var techs=users.filter(function(u){return u.role==="it_technician"&&u.active;});
  if(techs.length)return{id:techs[0].id,reason:"Load-balanced → "+techs[0].name};
  return{id:null,reason:"No technician available"};
}

function getPasswords(){ try{return JSON.parse(localStorage.getItem("hd_passwords")||"{}");}catch{return{};} }
function getPassword(uid){ return getPasswords()[uid]||"password123"; }
function setPassword(uid,pw){ try{var p=getPasswords();p[uid]=pw;localStorage.setItem("hd_passwords",JSON.stringify(p));}catch{} }
function loadState(key,fb){ try{var s=localStorage.getItem(key);return s?JSON.parse(s):fb;}catch{return fb;} }
function saveState(key,v){ try{localStorage.setItem(key,JSON.stringify(v));}catch{} }
function clearAuth(){ try{localStorage.removeItem("hd_curUser");}catch{} }

const SEED_COMPANIES = [];
const SEED_CLIENTS   = [];
const SEED_USERS     = [
  {id:"u1",name:"Randy Admin",email:"randy@omnisecurityinc.com",role:"admin",companyId:"",phone:"",dept:"IT Administration",active:true,createdAt:new Date().toISOString(),lastLogin:null},
];
const SEED_TYPES   = [];
const SEED_TICKETS = [];
const SEED_LOGS    = []; 


function mkOpt(v,l){ return {value:v,label:l}; }
const OPT_ROLES    = Object.keys(ROLE_META).map(function(k){ return mkOpt(k,ROLE_META[k].label); });
const OPT_PRIORITY = Object.keys(PRI_META).map(function(k){ return mkOpt(k,PRI_META[k].label); });
const OPT_STATUSES = ALL_STATUSES.map(function(s){ return mkOpt(s,s); });
function optCompanies(c){ return c.map(function(x){ return mkOpt(x.id,x.name); }); }
function optCompaniesNone(c){ return [mkOpt("","— None —")].concat(c.map(function(x){ return mkOpt(x.id,x.name); })); }
function optClients(c){ return [mkOpt("","— No Client —")].concat(c.map(function(x){ return mkOpt(x.id,x.name); })); }
function optLocs(l){ return [mkOpt("","— Select Location —")].concat(l.map(function(x){ return mkOpt(x.id,x.name); })); }
function optTypes(t){ return t.map(function(x){ return mkOpt(x.id,x.name+" — "+(PRI_META[x.priority]?.label||x.priority)+", SLA "+x.slaHours+"h"); }); }
function optTechs(u){ return [mkOpt("","— Unassigned —")].concat(u.filter(function(x){ return IT_ROLES.includes(x.role)&&x.active; }).map(function(x){ return mkOpt(x.id,x.name+" ("+(ROLE_META[x.role]?.label||x.role)+")"); })); }
function optAssignees(u){ return [mkOpt("","— Auto-assign —")].concat(u.filter(function(x){ return IT_ROLES.includes(x.role)&&x.active; }).map(function(x){ return mkOpt(x.id,x.name+" ("+(ROLE_META[x.role]?.label||x.role)+")"); })); }
function optTickets(t){ return t.map(function(x){ return mkOpt(x.id,"#"+x.id+" — "+x.title.slice(0,28)); }); }

class ErrorBoundary extends React.Component {
  constructor(props){super(props);this.state={error:null};}
  static getDerivedStateFromError(e){return{error:e.message};}
  render(){
    if(this.state.error) return (
      <div style={{padding:40,fontFamily:"system-ui,sans-serif",background:"#fef2f2",minHeight:"100vh"}}>
        <div style={{fontSize:20,fontWeight:700,color:"#dc2626",marginBottom:16}}>⚠️ Something went wrong</div>
        <pre style={{background:"#fff",padding:20,borderRadius:8,border:"1px solid #fecaca",fontSize:13,whiteSpace:"pre-wrap",color:"#7f1d1d",marginBottom:16}}>{this.state.error}</pre>
        <button onClick={function(){ try{localStorage.removeItem("hd_page");}catch(e){} window.location.href="/"; }} style={{padding:"10px 20px",background:"#dc2626",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700,marginRight:8}}>🏠 Go to Dashboard</button>
        <button onClick={function(){ try{localStorage.clear();}catch(e){} window.location.href="/"; }} style={{padding:"10px 20px",background:"#7f1d1d",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700}}>🗑 Clear Data &amp; Restart</button>
      </div>
    );
    return this.props.children;
  }
}

function Badge(p){ return <span style={{background:p.bg||p.color+"22",color:p.color,border:"1px solid "+p.color+"44",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700,whiteSpace:"nowrap",display:"inline-block"}}>{p.label}</span>; }
function Avatar(p){ var s=p.size||32; return <div style={{width:s,height:s,borderRadius:"50%",background:avCol(p.id||p.name),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:s*0.35,fontWeight:700,flexShrink:0}}>{inits(p.name)}</div>; }
function Card(p){ return <div style={{background:"#fff",borderRadius:12,border:"1px solid #e2e8f0",boxShadow:"0 1px 4px rgba(0,0,0,.06)",padding:20,...p.style}}>{p.children}</div>; }
function Stat(p){ return <Card style={{flex:1,minWidth:150}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}><div><div style={{color:"#64748b",fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5}}>{p.label}</div><div style={{fontSize:28,fontWeight:800,color:p.color||"#6366f1",margin:"4px 0 2px"}}>{p.value}</div>{p.sub&&<div style={{fontSize:11,color:"#94a3b8"}}>{p.sub}</div>}</div><span style={{fontSize:22}}>{p.icon}</span></div></Card>; }
function Modal(p){
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div style={{background:"#fff",borderRadius:16,width:"100%",maxWidth:p.wide?820:560,maxHeight:"90vh",display:"flex",flexDirection:"column",boxShadow:"0 20px 60px rgba(0,0,0,.25)"}}>
      <div style={{padding:"16px 24px",borderBottom:"1px solid #e2e8f0",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
        <div style={{fontSize:15,fontWeight:700,color:"#1e293b"}}>{p.title}</div>
        <button onClick={p.onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:"#94a3b8",lineHeight:1,padding:4}}>✕</button>
      </div>
      <div style={{padding:24,overflowY:"auto",flex:1}}>{p.children}</div>
    </div>
  </div>;
}
function FInput(p){ var label=p.label; var rest=Object.assign({},p); delete rest.label; return <div style={{marginBottom:14}}>{label&&<label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>{label}</label>}<input style={{width:"100%",padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#f8fafc",boxSizing:"border-box"}} {...rest}/></div>; }
function FSelect(p){ var label=p.label; var options=p.options||[]; var rest=Object.assign({},p); delete rest.label; delete rest.options; return <div style={{marginBottom:14}}>{label&&<label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>{label}</label>}<select style={{width:"100%",padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#f8fafc",boxSizing:"border-box"}} {...rest}>{options.map(function(o){ return <option key={o.value} value={o.value}>{o.label}</option>; })}</select></div>; }
function FTextarea(p){ var label=p.label; var rest=Object.assign({},p); delete rest.label; return <div style={{marginBottom:14}}>{label&&<label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>{label}</label>}<textarea rows={4} style={{width:"100%",padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#f8fafc",resize:"vertical",boxSizing:"border-box"}} {...rest}/></div>; }
function Btn(p){
  var v=p.variant||"primary"; var sm=p.size==="sm";
  var base={border:"none",cursor:"pointer",borderRadius:8,fontWeight:600,fontSize:sm?11:13,display:"inline-flex",alignItems:"center",gap:4,padding:sm?"5px 10px":"8px 18px"};
  var cols={primary:{background:"#6366f1",color:"#fff"},danger:{background:"#ef4444",color:"#fff"},success:{background:"#10b981",color:"#fff"},warning:{background:"#f59e0b",color:"#fff"},ghost:{background:"#f1f5f9",color:"#475569"}};
  var rest=Object.assign({},p); delete rest.variant; delete rest.size;
  return <button style={Object.assign({},base,cols[v]||cols.primary,p.style||{})} {...rest}>{p.children}</button>;
}
function FocusInput(p){
  var [focused,setFocused]=useState(false);
  var extraPad=p.extraPad; var rest=Object.assign({},p); delete rest.extraPad;
  return <input {...rest} onFocus={function(){setFocused(true);}} onBlur={function(){setFocused(false);}} style={{width:"100%",padding:extraPad?"11px 44px 11px 14px":"11px 14px",border:"1.5px solid "+(focused?"#0ea5e9":"#e2e8f0"),borderRadius:10,fontSize:14,outline:"none",boxSizing:"border-box",background:"#f8fafc",transition:"border-color .2s"}}/>;
}

// ── Schedule Editor Component ─────────────────────────────────────────────────
function ScheduleEditor(p){
  var userId=p.userId; var schedules=p.schedules; var onChange=p.onChange;
  var existing=schedules[userId]||null;
  var [enabled,setEnabled]=useState(!!existing);
  var [days,setDays]=useState(existing?existing.days:[1,2,3,4,5]);
  var [startHour,setStartHour]=useState(existing?existing.startHour:9);
  var [endHour,setEndHour]=useState(existing?existing.endHour:17);

  function toggleDay(d){
    var nd=days.includes(d)?days.filter(function(x){return x!==d;}):days.concat([d]);
    setDays(nd); emit(enabled,nd,startHour,endHour);
  }
  function emit(en,ds,sh,eh){
    onChange(userId, en?{days:ds,startHour:sh,endHour:eh}:null);
  }
  function handleEnable(v){ setEnabled(v); emit(v,days,startHour,endHour); }
  function handleStart(v){ var n=parseInt(v); setStartHour(n); emit(enabled,days,n,endHour); }
  function handleEnd(v){ var n=parseInt(v); setEndHour(n); emit(enabled,days,startHour,n); }

  var hours=Array.from({length:24},function(_,i){return mkOpt(i,fmtHour(i));});

  return <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:14,marginBottom:14}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
      <div style={{fontWeight:700,color:"#0369a1",fontSize:13}}>🗓 Work Schedule <span style={{fontSize:11,fontWeight:400,color:"#64748b"}}>(SLA only counts during shift)</span></div>
      <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,fontWeight:600,color:enabled?"#0369a1":"#64748b"}}>
        <input type="checkbox" checked={enabled} onChange={function(e){handleEnable(e.target.checked);}} style={{width:15,height:15,accentColor:"#0369a1"}}/>
        {enabled?"Schedule enabled":"No schedule (24/7)"}
      </label>
    </div>
    {enabled&&<>
      <div style={{marginBottom:10}}>
        <div style={{fontSize:11,fontWeight:700,color:"#475569",marginBottom:6,textTransform:"uppercase"}}>Working Days</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {DOW_LABELS.map(function(label,i){
            var active=days.includes(i);
            return <button key={i} type="button" onClick={function(){toggleDay(i);}} style={{padding:"5px 10px",borderRadius:6,border:"1.5px solid "+(active?"#0369a1":"#e2e8f0"),background:active?"#0369a1":"#fff",color:active?"#fff":"#64748b",fontSize:11,fontWeight:700,cursor:"pointer"}}>{label}</button>;
          })}
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div><label style={{display:"block",fontSize:11,fontWeight:700,color:"#475569",marginBottom:4,textTransform:"uppercase"}}>Shift Start</label>
          <select value={startHour} onChange={function(e){handleStart(e.target.value);}} style={{width:"100%",padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none",background:"#fff",boxSizing:"border-box"}}>
            {hours.map(function(o){return <option key={o.value} value={o.value}>{o.label}</option>;})}
          </select>
        </div>
        <div><label style={{display:"block",fontSize:11,fontWeight:700,color:"#475569",marginBottom:4,textTransform:"uppercase"}}>Shift End</label>
          <select value={endHour} onChange={function(e){handleEnd(e.target.value);}} style={{width:"100%",padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none",background:"#fff",boxSizing:"border-box"}}>
            {hours.filter(function(o){return o.value>startHour;}).map(function(o){return <option key={o.value} value={o.value}>{o.label}</option>;})}
          </select>
        </div>
      </div>
      <div style={{marginTop:8,fontSize:11,color:"#0369a1",background:"#e0f2fe",borderRadius:6,padding:"6px 10px"}}>
        ⏱ SLA timer only runs {days.slice().sort(function(a,b){return a-b;}).map(function(d){return DOW_LABELS[d];}).join(", ")} · {fmtHour(startHour)} – {fmtHour(endHour)} ({endHour-startHour}h/day)
      </div>
    </>}
  </div>;
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
function LoginPage(p){ var users=p.users; var setUsers=p.setUsers; var companies=p.companies; var onLogin=p.onLogin;
  var [view,setView]=useState("login"); var [loginEmail,setLoginEmail]=useState(""); var [loginPass,setLoginPass]=useState("");
  var [showP1,setShowP1]=useState(false); var [showP2,setShowP2]=useState(false); var [showP3,setShowP3]=useState(false);
  var [loginErr,setLoginErr]=useState(""); var [resetEmail,setResetEmail]=useState(""); var [resetErr,setResetErr]=useState("");
  var [sigName,setSigName]=useState(""); var [sigEmail,setSigEmail]=useState(""); var [sigPass,setSigPass]=useState("");
  var [sigConf,setSigConf]=useState(""); var [sigPhone,setSigPhone]=useState(""); var [sigDept,setSigDept]=useState(""); var [sigErr,setSigErr]=useState("");
  var [loading,setLoading]=useState(false);
  function pwStr(pw){ if(!pw||pw.length<8)return 1; if(pw.length>=12&&/[A-Z]/.test(pw)&&/[0-9]/.test(pw)&&/[^A-Za-z0-9]/.test(pw))return 4; if(pw.length>=10&&/[A-Z]/.test(pw)&&/[0-9]/.test(pw))return 3; return 2; }
  var strLabel=["","Too short","Weak","Good","Strong ✅"]; var strColor=["","#ef4444","#f59e0b","#3b82f6","#10b981"]; var str=pwStr(sigPass);
  async function doLogin(e){ e.preventDefault(); setLoginErr(""); if(!loginEmail.trim()||!loginPass.trim()){setLoginErr("Please enter your email and password.");return;} setLoading(true); await new Promise(function(r){setTimeout(r,700);}); var user=users.find(function(u){return u.email.toLowerCase()===loginEmail.toLowerCase().trim();}); if(!user){setLoginErr("No account found with that email.");setLoading(false);return;} if(!user.active){setLoginErr("Your account is pending admin approval.");setLoading(false);return;} if(loginPass!==getPassword(user.id)){setLoginErr("Incorrect password.");setLoading(false);return;} setLoading(false); onLogin(user); }
  async function doForgot(e){ e.preventDefault(); setResetErr(""); if(!resetEmail.trim()){setResetErr("Please enter your email.");return;} setLoading(true); await new Promise(function(r){setTimeout(r,900);}); setLoading(false); setView("sent"); }
  async function doSignup(e){ e.preventDefault(); setSigErr(""); if(!sigName.trim()){setSigErr("Full name is required.");return;} if(!sigEmail.trim()){setSigErr("Email is required.");return;} if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sigEmail.trim())){setSigErr("Enter a valid email.");return;} if(users.find(function(u){return u.email.toLowerCase()===sigEmail.toLowerCase().trim();})){setSigErr("An account with this email already exists.");return;} if(sigPass.length<8){setSigErr("Password must be at least 8 characters.");return;} if(sigPass!==sigConf){setSigErr("Passwords do not match.");return;} setLoading(true); await new Promise(function(r){setTimeout(r,900);}); var nu={id:uid(),name:sigName.trim(),email:sigEmail.trim().toLowerCase(),role:"end_user",companyId:companies&&companies[0]?companies[0].id:"",phone:sigPhone.trim(),dept:sigDept.trim(),active:false,createdAt:new Date().toISOString(),lastLogin:null}; setUsers(function(prev){return prev.concat([nu]);}); setLoading(false); setView("pending"); }
  function PBtn(bp){ return <button type={bp.type||"button"} onClick={bp.onClick} disabled={bp.disabled} style={{width:"100%",padding:"12px",background:bp.disabled?"#7dd3fc":"linear-gradient(135deg,#0369a1,#0ea5e9)",color:"#fff",border:"none",borderRadius:10,fontSize:15,fontWeight:700,cursor:bp.disabled?"not-allowed":"pointer",marginTop:4}}>{bp.children}</button>; }
  function BackBtn(bp){ return <button type="button" onClick={bp.onClick} style={{background:"none",border:"none",color:"#0369a1",fontSize:13,fontWeight:600,cursor:"pointer",padding:"0 0 16px 0",display:"flex",alignItems:"center",gap:4}}>← Back to Sign In</button>; }
  function ErrBox(ep){ return ep.msg?<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:14,color:"#dc2626",fontSize:13}}>⚠️ {ep.msg}</div>:null; }
  return <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#020e1f 0%,#041833 30%,#062d6b 65%,#0a3d8f 100%)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,fontFamily:"'Inter',system-ui,sans-serif",position:"relative"}}>
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
        {view==="login"&&<><h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 4px"}}>Welcome back 👋</h2><p style={{fontSize:13,color:"#94a3b8",margin:"0 0 22px"}}>Sign in to access your dashboard</p><div><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:5}}>Email Address</label><FocusInput type="email" value={loginEmail} onChange={function(e){setLoginEmail(e.target.value);}} placeholder="you@company.com" autoFocus/></div><div style={{marginBottom:6}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:5}}>Password</label><div style={{position:"relative"}}><FocusInput type={showP1?"text":"password"} value={loginPass} onChange={function(e){setLoginPass(e.target.value);}} placeholder="••••••••" extraPad/><button type="button" onClick={function(){setShowP1(!showP1);}} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:16,color:"#94a3b8",padding:0}}>{showP1?"🙈":"👁️"}</button></div></div><div style={{textAlign:"right",marginBottom:18}}><button type="button" onClick={function(){setView("forgot");setResetEmail(loginEmail);setResetErr("");}} style={{background:"none",border:"none",color:"#0369a1",fontSize:12,fontWeight:600,cursor:"pointer",padding:0,textDecoration:"underline"}}>Forgot your password?</button></div><ErrBox msg={loginErr}/><PBtn onClick={doLogin} disabled={loading}>{loading?"⏳ Signing in…":"Sign In →"}</PBtn></div><div style={{marginTop:18,textAlign:"center"}}><span style={{fontSize:12,color:"#94a3b8"}}>Don't have an account? </span><button type="button" onClick={function(){setView("signup");setSigErr("");}} style={{background:"none",border:"none",color:"#0369a1",fontSize:12,fontWeight:700,cursor:"pointer",textDecoration:"underline"}}>Sign Up</button></div></>}
        {view==="signup"&&<><BackBtn onClick={function(){setView("login");setSigErr("");}} /><h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 18px"}}>Create an Account 🚀</h2><div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><div style={{marginBottom:10}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Full Name *</label><FocusInput type="text" value={sigName} onChange={function(e){setSigName(e.target.value);}} placeholder="Jane Smith" autoFocus/></div><div style={{marginBottom:10}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Phone</label><FocusInput type="tel" value={sigPhone} onChange={function(e){setSigPhone(e.target.value);}} placeholder="+1-555-0100"/></div></div><div style={{marginBottom:10}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Work Email *</label><FocusInput type="email" value={sigEmail} onChange={function(e){setSigEmail(e.target.value);}} placeholder="you@company.com"/></div><div style={{marginBottom:10}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Department</label><FocusInput type="text" value={sigDept} onChange={function(e){setSigDept(e.target.value);}} placeholder="Sales"/></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:4}}><div><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Password *</label><div style={{position:"relative"}}><FocusInput type={showP2?"text":"password"} value={sigPass} onChange={function(e){setSigPass(e.target.value);}} placeholder="Min 8 chars" extraPad/><button type="button" onClick={function(){setShowP2(!showP2);}} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#94a3b8",padding:0}}>{showP2?"🙈":"👁️"}</button></div></div><div><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Confirm *</label><div style={{position:"relative"}}><FocusInput type={showP3?"text":"password"} value={sigConf} onChange={function(e){setSigConf(e.target.value);}} placeholder="Repeat" extraPad/><button type="button" onClick={function(){setShowP3(!showP3);}} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#94a3b8",padding:0}}>{showP3?"🙈":"👁️"}</button></div></div></div>{sigPass.length>0&&<div style={{marginBottom:12}}><div style={{display:"flex",gap:4,marginBottom:3}}>{[1,2,3,4].map(function(i){ return <div key={i} style={{flex:1,height:4,borderRadius:2,background:i<=str?strColor[str]:"#e2e8f0"}}/>; })}</div><div style={{fontSize:10,color:strColor[str]}}>{strLabel[str]}</div></div>}<div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#92400e"}}>⚠️ New accounts require <strong>admin approval</strong>.</div><ErrBox msg={sigErr}/><PBtn onClick={doSignup} disabled={loading}>{loading?"⏳ Creating…":"Create Account →"}</PBtn></div></>}
        {view==="pending"&&<div style={{textAlign:"center",padding:"10px 0"}}><div style={{fontSize:56,marginBottom:14}}>⏳</div><h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 10px"}}>Account Pending Approval</h2><p style={{fontSize:13,color:"#64748b",lineHeight:1.7,margin:"0 0 18px"}}>Your account for <strong>{sigEmail}</strong> has been submitted.</p><PBtn onClick={function(){setView("login");setLoginErr("");}}>← Back to Sign In</PBtn></div>}
        {view==="forgot"&&<><BackBtn onClick={function(){setView("login");setResetErr("");}} /><div style={{textAlign:"center",marginBottom:22}}><div style={{fontSize:44,marginBottom:8}}>🔑</div><h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 6px"}}>Forgot Password?</h2></div><div><div style={{marginBottom:16}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:5}}>Email Address</label><FocusInput type="email" value={resetEmail} onChange={function(e){setResetEmail(e.target.value);}} placeholder="you@company.com" autoFocus/></div><ErrBox msg={resetErr}/><PBtn onClick={doForgot} disabled={loading}>{loading?"⏳ Sending…":"Send Reset Link →"}</PBtn></div></>}
        {view==="sent"&&<div style={{textAlign:"center",padding:"10px 0"}}><div style={{fontSize:56,marginBottom:14}}>📧</div><h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 10px"}}>Check your inbox!</h2><p style={{fontSize:13,color:"#64748b",lineHeight:1.7,margin:"0 0 22px"}}>If an account exists for <strong>{resetEmail}</strong>, a reset link was sent.</p><PBtn onClick={function(){setView("login");setLoginErr("");}}>← Back to Sign In</PBtn></div>}
      </div>
      <p style={{textAlign:"center",color:"rgba(255,255,255,.4)",fontSize:11,marginTop:20}}>© 2025 Hoptix · A.eye Technology</p>
    </div>
  </div>;
}

// ── PROFILE MODAL ─────────────────────────────────────────────────────────────
function ProfileModal(p){ var curUser=p.curUser; var setUsers=p.setUsers; var showToast=p.showToast; var addLog=p.addLog; var onClose=p.onClose;
  var [tab,setTab]=useState("profile"); var [name,setName]=useState(curUser.name); var [phone,setPhone]=useState(curUser.phone||""); var [dept,setDept]=useState(curUser.dept||"");
  var [curPw,setCurPw]=useState(""); var [newPw,setNewPw]=useState(""); var [confPw,setConfPw]=useState("");
  var [showC,setShowC]=useState(false); var [showN,setShowN]=useState(false); var [showK,setShowK]=useState(false);
  var [pwErr,setPwErr]=useState(""); var [pwOk,setPwOk]=useState(""); var [saving,setSaving]=useState(false);
  function pwStr(pw){ if(!pw||pw.length<8)return 1; if(pw.length>=12&&/[A-Z]/.test(pw)&&/[0-9]/.test(pw)&&/[^A-Za-z0-9]/.test(pw))return 4; if(pw.length>=10&&/[A-Z]/.test(pw)&&/[0-9]/.test(pw))return 3; return 2; }
  var strC=["","#ef4444","#f59e0b","#3b82f6","#10b981"]; var strL=["","Too short","Weak","Good","Strong ✅"]; var str=pwStr(newPw);
  var inp={width:"100%",padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#f8fafc",boxSizing:"border-box"};
  async function saveProfile(){ if(!name.trim()){showToast("Name cannot be empty","error");return;} setSaving(true); await new Promise(function(r){setTimeout(r,400);}); setUsers(function(prev){return prev.map(function(u){return u.id===curUser.id?Object.assign({},u,{name:name.trim(),phone:phone.trim(),dept:dept.trim()}):u;});}); addLog("PROFILE_UPDATED",curUser.id,curUser.name+" updated profile"); showToast("✅ Profile updated!"); setSaving(false); onClose(); }
  async function changePw(){ setPwErr(""); setPwOk(""); if(!curPw){setPwErr("Enter your current password.");return;} if(curPw!==getPassword(curUser.id)){setPwErr("Current password is incorrect.");return;} if(newPw.length<8){setPwErr("New password must be at least 8 characters.");return;} if(newPw!==confPw){setPwErr("Passwords do not match.");return;} if(newPw===curPw){setPwErr("New password must differ from current.");return;} setSaving(true); await new Promise(function(r){setTimeout(r,500);}); setPassword(curUser.id,newPw); addLog("PASSWORD_CHANGED",curUser.id,curUser.name+" changed password"); setSaving(false); setCurPw(""); setNewPw(""); setConfPw(""); setPwOk("✅ Password changed!"); showToast("Password updated!"); onClose(); }
  return <Modal title="My Profile" onClose={onClose}>
    <div style={{display:"flex",alignItems:"center",gap:16,padding:"0 0 20px",borderBottom:"1px solid #e2e8f0",marginBottom:20}}><div style={{width:64,height:64,borderRadius:"50%",background:avCol(curUser.id),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:24,fontWeight:800}}>{inits(curUser.name)}</div><div><div style={{fontWeight:700,fontSize:16}}>{curUser.name}</div><div style={{fontSize:12,color:"#64748b"}}>{curUser.email}</div><div style={{marginTop:4}}><Badge label={ROLE_META[curUser.role]?.label||curUser.role} color={ROLE_META[curUser.role]?.color||"#6366f1"}/></div></div></div>
    <div style={{display:"flex",gap:6,marginBottom:20}}>{["profile","password"].map(function(t){ return <button key={t} onClick={function(){setTab(t);}} style={{background:tab===t?"#6366f1":"#f1f5f9",color:tab===t?"#fff":"#475569",border:"none",borderRadius:8,padding:"6px 18px",cursor:"pointer",fontSize:12,fontWeight:700}}>{t==="profile"?"👤 Profile":"🔑 Change Password"}</button>; })}</div>
    {tab==="profile"&&<div><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Full Name</label><input value={name} onChange={function(e){setName(e.target.value);}} style={inp}/></div><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Email Address</label><input value={curUser.email} disabled style={Object.assign({},inp,{background:"#f1f5f9",color:"#94a3b8",cursor:"not-allowed"})}/></div><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Phone</label><input value={phone} onChange={function(e){setPhone(e.target.value);}} style={inp}/></div><div style={{marginBottom:20}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Department</label><input value={dept} onChange={function(e){setDept(e.target.value);}} style={inp}/></div><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button onClick={onClose} style={{padding:"8px 18px",background:"#f1f5f9",color:"#475569",border:"none",borderRadius:8,fontWeight:600,fontSize:13,cursor:"pointer"}}>Cancel</button><button onClick={saveProfile} disabled={saving} style={{padding:"8px 18px",background:saving?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:8,fontWeight:600,fontSize:13,cursor:saving?"not-allowed":"pointer"}}>{saving?"⏳ Saving…":"💾 Save Changes"}</button></div></div>}
    {tab==="password"&&<div><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Current Password</label><div style={{position:"relative"}}><input type={showC?"text":"password"} value={curPw} onChange={function(e){setCurPw(e.target.value);}} placeholder="••••••••" style={Object.assign({},inp,{paddingRight:40})}/><button type="button" onClick={function(){setShowC(!showC);}} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:14,color:"#94a3b8"}}>{showC?"🙈":"👁️"}</button></div></div><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>New Password</label><div style={{position:"relative"}}><input type={showN?"text":"password"} value={newPw} onChange={function(e){setNewPw(e.target.value);}} placeholder="Min 8 characters" style={Object.assign({},inp,{paddingRight:40})}/><button type="button" onClick={function(){setShowN(!showN);}} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:14,color:"#94a3b8"}}>{showN?"🙈":"👁️"}</button></div>{newPw.length>0&&<div style={{marginTop:6}}><div style={{display:"flex",gap:4,marginBottom:3}}>{[1,2,3,4].map(function(i){ return <div key={i} style={{flex:1,height:4,borderRadius:2,background:i<=str?strC[str]:"#e2e8f0"}}/>; })}</div><div style={{fontSize:10,color:strC[str]}}>{strL[str]}</div></div>}</div><div style={{marginBottom:16}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Confirm New Password</label><div style={{position:"relative"}}><input type={showK?"text":"password"} value={confPw} onChange={function(e){setConfPw(e.target.value);}} placeholder="Repeat" style={Object.assign({},inp,{paddingRight:40})}/><button type="button" onClick={function(){setShowK(!showK);}} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:14,color:"#94a3b8"}}>{showK?"🙈":"👁️"}</button></div></div>{pwErr&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:14,color:"#dc2626",fontSize:13}}>⚠️ {pwErr}</div>}{pwOk&&<div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"10px 14px",marginBottom:14,color:"#166534",fontSize:13}}>{pwOk}</div>}<div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button onClick={onClose} style={{padding:"8px 18px",background:"#f1f5f9",color:"#475569",border:"none",borderRadius:8,fontWeight:600,fontSize:13,cursor:"pointer"}}>Cancel</button><button onClick={changePw} disabled={saving} style={{padding:"8px 18px",background:saving?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:8,fontWeight:600,fontSize:13,cursor:saving?"not-allowed":"pointer"}}>{saving?"⏳ Saving…":"🔑 Change Password"}</button></div></div>}
  </Modal>;
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function App(){
  var [users,setUsersR]         = useState(function(){ return loadState("hd_users",SEED_USERS); });
  var [companies,setCompR]      = useState(function(){ return loadState("hd_companies",SEED_COMPANIES); });
  var [clients,setClientsR]     = useState(function(){ return loadState("hd_clients",SEED_CLIENTS); });
  var [tickets,setTicketsR]     = useState(function(){ return loadState("hd_tickets",SEED_TICKETS); });
  var [ticketTypes,setTTR]      = useState(function(){ return loadState("hd_ticketTypes",SEED_TYPES); });
  var [statusSla,setStatusSlaR] = useState(function(){ return loadStatusSla(); });
  var [schedules,setSchedulesR] = useState(function(){ return loadSchedules(); });
  var [logs,setLogsR]           = useState(function(){ return loadState("hd_logs",SEED_LOGS); });
  var [curUser,setCurUserR]     = useState(function(){ return loadState("hd_curUser",null); });
  var [page,setPageR] = useState(function(){
    try{
      var saved = localStorage.getItem("hd_page");
      // safe pages — if a crash left an invalid page in storage, fall back to dashboard
      var safe = ["dashboard","tickets","new_ticket","time_tracking","reports","users","companies","clients","ticket_types","activity_log","integrations"];
      return (saved && safe.includes(saved)) ? saved : "dashboard";
    }catch(e){ return "dashboard"; }
  });
  var [selTicket,setSelTicket]  = useState(null);
  var [toast,setToast]          = useState(null);
  var [breaches,setBreaches]    = useState([]);
  var [showProfile,setShowProfile] = useState(false);

  function setUsers(v){       var n=typeof v==="function"?v(users):v;       saveState("hd_users",n);       setUsersR(n); }
  function setCompanies(v){   var n=typeof v==="function"?v(companies):v;   saveState("hd_companies",n);   setCompR(n); }
  function setClients(v){     var n=typeof v==="function"?v(clients):v;     saveState("hd_clients",n);     setClientsR(n); }
  function setTickets(v){     var n=typeof v==="function"?v(tickets):v;     saveState("hd_tickets",n);     setTicketsR(n); }
  function setTicketTypes(v){ var n=typeof v==="function"?v(ticketTypes):v; saveState("hd_ticketTypes",n); setTTR(n); }
  function setStatusSla(v){   var n=typeof v==="function"?v(statusSla):v;   saveStatusSlaStore(n);          setStatusSlaR(n); }
  function setSchedules(v){   var n=typeof v==="function"?v(schedules):v;   saveSchedules(n);               setSchedulesR(n); }
  function setLogs(v){        var n=typeof v==="function"?v(logs):v;        saveState("hd_logs",n);        setLogsR(n); }
  function setCurUser(u){     if(u)saveState("hd_curUser",u); else clearAuth(); setCurUserR(u); }
  function setPage(v){
    // Never persist integrations as the last page — if it crashes on load the whole app goes blank
    if(v!=="integrations") saveState("hd_page",v);
    setPageR(v);
  }

  var addLog = useCallback(function(action,target,detail,uId){
    var entry={id:uid(),action,userId:uId||curUser?.id,target,detail,timestamp:new Date().toISOString()};
    setLogsR(function(p){ var n=[entry].concat(p).slice(0,500); saveState("hd_logs",n); return n; });
  },[curUser]);

  var showToast = useCallback(function(msg,type){
    setToast({msg,type:type||"ok"});
    setTimeout(function(){setToast(null);},3000);
  },[]);

  useEffect(function(){
    function check(){ setBreaches(tickets.filter(function(t){ return !t.deleted&&t.status!=="Closed"&&t.slaDeadline&&Date.now()>new Date(t.slaDeadline).getTime(); })); }
    check(); var iv=setInterval(check,30000); return function(){clearInterval(iv);};
  },[tickets]);

  var isAdmin=["admin","it_manager"].includes(curUser?.role);
  var isTech =IT_ROLES.includes(curUser?.role);
  var visible=useMemo(function(){ return tickets.filter(function(t){ return !t.deleted&&(isTech||t.submittedBy===curUser?.id||t.assignedTo===curUser?.id); }); },[tickets,curUser,isTech]);
  var allNonDeleted=useMemo(function(){ return tickets.filter(function(t){return !t.deleted;}); },[tickets]);

  if(!curUser) return <LoginPage users={users} setUsers={setUsers} companies={companies} onLogin={function(u){setCurUser(u);}}/>;

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
    {id:"integrations",icon:"🔌",label:"Integrations",superAdmin:true},
    {id:"activity_log",icon:"📋",label:"Activity Log",superAdmin:true},
  ].filter(function(n){ if(n.superAdmin)return curUser.role==="admin"; if(n.admin)return isAdmin; return true; });

  var curNav=NAV.find(function(n){return n.id===page;})||{icon:"",label:"—"};

  return <ErrorBoundary>
    <div style={{display:"flex",height:"100vh",fontFamily:"'Inter',system-ui,sans-serif",background:"#f8fafc",fontSize:13,overflow:"hidden"}}>
      <style>{`*{box-sizing:border-box}::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:#f1f5f9}::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:4px}button:hover{opacity:.88}.nv:hover{background:rgba(14,165,233,.15)!important;color:#7dd3fc!important}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{width:220,background:"linear-gradient(180deg,#020e1f,#041833,#062d6b)",display:"flex",flexDirection:"column",flexShrink:0}}>
        <div style={{padding:"20px 16px 14px",borderBottom:"1px solid rgba(56,189,248,.15)"}}><div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:32,height:32,borderRadius:"50%",background:"linear-gradient(135deg,#fff 60%,#b3d9ff)",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:20,height:20,borderRadius:"50%",background:"linear-gradient(135deg,#0369a1,#0ea5e9)",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:8,height:8,borderRadius:"50%",background:"#020e1f"}}/></div></div><div><div style={{color:"#fff",fontWeight:800,fontSize:15}}>hoptix</div><div style={{color:"#38bdf8",fontSize:9}}>A.eye technology</div></div></div></div>
        <div style={{padding:"8px",flex:1,overflowY:"auto"}}>
          {NAV.map(function(n){ return <div key={n.id} className="nv" onClick={function(){setPage(n.id);}} style={{padding:"9px 12px",borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",gap:8,marginBottom:2,background:page===n.id?"rgba(14,165,233,.25)":"transparent",color:page===n.id?"#fff":"#93c5fd",fontWeight:page===n.id?700:500,fontSize:12,borderLeft:page===n.id?"3px solid #0ea5e9":"3px solid transparent"}}>
            <span style={{fontSize:14}}>{n.icon}</span>{n.label}
            {n.id==="tickets"&&breaches.length>0&&<span style={{marginLeft:"auto",background:"#ef4444",color:"#fff",borderRadius:10,padding:"1px 6px",fontSize:10}}>{breaches.length}</span>}
          </div>; })}
        </div>
        <div style={{padding:"12px 10px",borderTop:"1px solid rgba(56,189,248,.15)"}}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}><Avatar name={curUser.name} id={curUser.id} size={32}/><div style={{flex:1,overflow:"hidden"}}><div style={{color:"#fff",fontSize:12,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{curUser.name}</div><div style={{color:"#7dd3fc",fontSize:10}}>{ROLE_META[curUser.role]?.label}</div></div></div><button onClick={function(){setCurUser(null);setPage("dashboard");setSelTicket(null);}} style={{width:"100%",padding:"7px",background:"rgba(239,68,68,.2)",color:"#fca5a5",border:"1px solid rgba(239,68,68,.3)",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>🚪 Sign Out</button></div>
      </div>
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",padding:"10px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div style={{fontWeight:700,fontSize:14,color:"#1e293b"}}>{curNav.icon} {curNav.label}</div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            {breaches.length>0&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:20,padding:"4px 12px",color:"#dc2626",fontSize:11,fontWeight:700}}>⚠️ {breaches.length} SLA Breach{breaches.length>1?"es":""}</div>}
            <button onClick={function(){setShowProfile(true);}} style={{display:"flex",alignItems:"center",gap:8,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"5px 12px 5px 6px",cursor:"pointer"}}><Avatar name={curUser.name} id={curUser.id} size={28}/><div style={{textAlign:"left"}}><div style={{fontWeight:700,fontSize:12}}>{curUser.name}</div><div style={{fontSize:10,color:"#94a3b8"}}>{ROLE_META[curUser.role]?.label}</div></div><span style={{fontSize:10,color:"#94a3b8",marginLeft:4}}>▼</span></button>
          </div>
        </div>
        {toast&&<div style={{position:"fixed",top:20,right:20,zIndex:10000,background:toast.type==="error"?"#ef4444":"#10b981",color:"#fff",padding:"10px 20px",borderRadius:10,fontWeight:600,fontSize:13,boxShadow:"0 4px 20px rgba(0,0,0,.2)"}}>{toast.msg}</div>}
        <div style={{flex:1,overflowY:"auto",padding:24}}>
          {page==="dashboard"    &&<PageDashboard   tickets={visible} allTickets={allNonDeleted} users={users} ticketTypes={ticketTypes} companies={companies} clients={clients} setPage={setPage} setSelTicket={setSelTicket} breaches={breaches}/>}
          {page==="tickets"      &&<PageTickets     tickets={visible} users={users} companies={companies} clients={clients} ticketTypes={ticketTypes} curUser={curUser} setTickets={setTickets} addLog={addLog} showToast={showToast} setSelTicket={setSelTicket} setPage={setPage} isAdmin={isAdmin} statusSla={statusSla} schedules={schedules}/>}
          {page==="new_ticket"   &&<PageNewTicket   users={users} companies={companies} clients={clients} ticketTypes={ticketTypes} curUser={curUser} setTickets={setTickets} addLog={addLog} showToast={showToast} setPage={setPage}/>}
          {page==="time_tracking"&&<PageTimeTracking tickets={visible} users={users} ticketTypes={ticketTypes} curUser={curUser} isAdmin={isAdmin} isTech={isTech} setSelTicket={setSelTicket} setPage={setPage}/>}
          {page==="reports"      &&<PageReports     tickets={visible} users={users} ticketTypes={ticketTypes} companies={companies} clients={clients} statusSla={statusSla} schedules={schedules}/>}
          {page==="users"        &&<PageUsers       users={users} companies={companies} setUsers={setUsers} curUser={curUser} addLog={addLog} showToast={showToast} schedules={schedules} setSchedules={setSchedules}/>}
          {page==="companies"    &&<PageCompanies   companies={companies} users={users} setCompanies={setCompanies} addLog={addLog} showToast={showToast}/>}
          {page==="clients"      &&<PageClients     clients={clients} setClients={setClients} companies={companies} addLog={addLog} showToast={showToast}/>}
          {page==="ticket_types" &&<PageTicketTypes ticketTypes={ticketTypes} users={users} setTicketTypes={setTicketTypes} statusSla={statusSla} setStatusSla={setStatusSla} addLog={addLog} showToast={showToast}/>}
          {page==="integrations"  &&<PageIntegrations showToast={showToast} addLog={addLog}/>}
          {page==="activity_log" &&<PageActivityLog logs={logs} users={users}/>}
        </div>
      </div>
      {selTicket&&<TicketDetail ticket={tickets.find(function(t){return t.id===selTicket;})} setTickets={setTickets} users={users} ticketTypes={ticketTypes} companies={companies} clients={clients} curUser={curUser} isAdmin={isAdmin} isTech={isTech} addLog={addLog} showToast={showToast} statusSla={statusSla} schedules={schedules} onClose={function(){setSelTicket(null);}}/>}
      {showProfile&&<ProfileModal curUser={curUser} setUsers={setUsers} showToast={showToast} addLog={addLog} onClose={function(){setShowProfile(false);}}/>}
    </div>
  </ErrorBoundary>;
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function PageDashboard(p){
  var tickets=p.tickets; var allTickets=p.allTickets||p.tickets; var users=p.users; var ticketTypes=p.ticketTypes; var clients=p.clients; var setPage=p.setPage; var setSelTicket=p.setSelTicket; var breaches=p.breaches;
  var byStatus=ALL_STATUSES.map(function(s){ return {name:s,value:tickets.filter(function(t){return t.status===s;}).length,color:STATUS_META[s].color}; });
  var byPri=Object.keys(PRI_META).map(function(k){ return {name:PRI_META[k].label,value:tickets.filter(function(t){return t.priority===k;}).length,color:PRI_META[k].color}; });
  var daily=Array.from({length:7},function(_,i){ var d=new Date(Date.now()-(6-i)*86400000); return {lbl:d.toLocaleDateString("en",{weekday:"short"}),created:tickets.filter(function(t){return new Date(t.createdAt).toDateString()===d.toDateString();}).length,closed:tickets.filter(function(t){return t.closedAt&&new Date(t.closedAt).toDateString()===d.toDateString();}).length}; });
  var techs=users.filter(function(u){return ["it_technician","it_manager"].includes(u.role);});
  var byType=ticketTypes.map(function(tt,i){ return {name:tt.name,value:tickets.filter(function(t){return t.typeId===tt.id;}).length,fill:PAL[i%PAL.length]}; }).filter(function(x){return x.value>0;});
  return <div>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
      <Stat label="Total Tickets"  value={tickets.length} icon="🎫" color="#6366f1"/>
      <Stat label="Open"           value={tickets.filter(function(t){return t.status==="Open";}).length} icon="📬" color="#f59e0b"/>
      <Stat label="In Progress"    value={tickets.filter(function(t){return t.status==="In Progress";}).length} icon="⚙️" color="#6366f1"/>
      <Stat label="Escalated"      value={tickets.filter(function(t){return t.status==="Escalated";}).length} icon="🔺" color="#7c3aed" sub="need senior review"/>
      <Stat label="Closed"         value={allTickets.filter(function(t){return t.status==="Closed";}).length} icon="✅" color="#10b981"/>
      <Stat label="SLA Breaches"   value={breaches.length} icon="🚨" color="#ef4444" sub="need attention"/>
      <Stat label="Active Clients" value={clients.length} icon="🤝" color="#8b5cf6" sub={clients.reduce(function(a,c){return a+c.locations.length;},0)+" locations"}/>
    </div>
    {breaches.length>0&&<Card style={{marginBottom:20,borderLeft:"4px solid #ef4444",background:"#fef2f2"}}>
      <div style={{fontWeight:700,color:"#dc2626",marginBottom:10}}>🚨 SLA Breach Alerts</div>
      {breaches.slice(0,5).map(function(t){ return <div key={t.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#fff",padding:"8px 12px",borderRadius:8,border:"1px solid #fecaca",marginBottom:6}}><span style={{fontWeight:600,fontSize:12}}>#{t.id} — {t.title}</span><div style={{display:"flex",gap:8,alignItems:"center"}}><Badge label={t.status} color={STATUS_META[t.status]?.color||"#6366f1"}/><Btn size="sm" variant="ghost" onClick={function(){setSelTicket(t.id);}}>View</Btn></div></div>; })}
    </Card>}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginBottom:16}}>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>Tickets by Status</div><ResponsiveContainer width="100%" height={200}><PieChart><Pie data={byStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={pieLabel} fontSize={9}>{byStatus.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Pie><Tooltip/></PieChart></ResponsiveContainer></Card>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>7-Day Trend</div><ResponsiveContainer width="100%" height={200}><AreaChart data={daily}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="lbl" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Legend wrapperStyle={{fontSize:10}}/><Area type="monotone" dataKey="created" stroke="#6366f1" fill="#eef2ff" name="Created"/><Area type="monotone" dataKey="closed" stroke="#10b981" fill="#d1fae5" name="Closed"/></AreaChart></ResponsiveContainer></Card>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>By Priority</div><ResponsiveContainer width="100%" height={200}><BarChart data={byPri}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="value" radius={[4,4,0,0]}>{byPri.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Bar></BarChart></ResponsiveContainer></Card>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>Technician Workload</div>
        {techs.map(function(t){ var open=tickets.filter(function(tk){return tk.assignedTo===t.id&&tk.status!=="Closed";}).length; var total=tickets.filter(function(tk){return tk.assignedTo===t.id;}).length; return <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}><Avatar name={t.name} id={t.id} size={26}/><div style={{flex:1}}><div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontWeight:600}}><span>{t.name}</span><span style={{color:"#6366f1"}}>{open} open / {total} total</span></div><div style={{background:"#e2e8f0",borderRadius:4,height:6,marginTop:4}}><div style={{background:"#6366f1",height:6,borderRadius:4,width:(total?Math.min(100,Math.round(open/total*100)):0)+"%"}}/></div></div></div>; })}
      </Card>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>Tickets by Type</div>
        {byType.slice(0,7).map(function(t,i){ return <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid #f1f5f9"}}><span style={{fontSize:12,color:"#475569"}}>{t.name}</span><Badge label={t.value} color={PAL[i%PAL.length]}/></div>; })}
      </Card>
    </div>
  </div>;
}

// ── TICKET LIST ───────────────────────────────────────────────────────────────
function PageTickets(p){
  var tickets=p.tickets; var users=p.users; var clients=p.clients; var ticketTypes=p.ticketTypes; var curUser=p.curUser;
  var setTickets=p.setTickets; var addLog=p.addLog; var showToast=p.showToast; var setSelTicket=p.setSelTicket; var setPage=p.setPage; var isAdmin=p.isAdmin; var statusSla=p.statusSla; var schedules=p.schedules||{};
  var [search,setSearch]=useState(""); var [fStat,setFStat]=useState(""); var [fPri,setFPri]=useState(""); var [fType,setFType]=useState("");
  var filtered=tickets.filter(function(t){ var q=search.toLowerCase(); return(!q||t.title.toLowerCase().includes(q)||t.id.includes(q)||t.description.toLowerCase().includes(q))&&(!fStat||t.status===fStat)&&(!fPri||t.priority===fPri)&&(!fType||t.typeId===fType); });
  function delTicket(id){ setTickets(function(prev){return prev.map(function(t){return t.id===id?Object.assign({},t,{deleted:true}):t;});}); addLog("TICKET_DELETED",id,"Ticket #"+id+" deleted"); showToast("Ticket deleted"); }
  function fu(id){return users.find(function(x){return x.id===id;});}
  function ftt(id){return ticketTypes.find(function(x){return x.id===id;});}
  function fcl(id){return clients.find(function(x){return x.id===id;});}
  function getLoc(cid,lid){ var c=fcl(cid); return c?c.locations.find(function(l){return l.id===lid;}):null; }
  return <div>
    <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
      <input value={search} onChange={function(e){setSearch(e.target.value);}} placeholder="🔍 Search..." style={{flex:1,minWidth:160,padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}/>
      <select value={fStat} onChange={function(e){setFStat(e.target.value);}} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}><option value="">All Statuses</option>{ALL_STATUSES.map(function(s){return <option key={s} value={s}>{s}</option>;})}</select>
      <select value={fPri} onChange={function(e){setFPri(e.target.value);}} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}><option value="">All Priorities</option>{Object.keys(PRI_META).map(function(k){return <option key={k} value={k}>{PRI_META[k].label}</option>;})}</select>
      <select value={fType} onChange={function(e){setFType(e.target.value);}} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}><option value="">All Types</option>{ticketTypes.map(function(t){return <option key={t.id} value={t.id}>{t.name}</option>;})}</select>
      <Btn onClick={function(){setPage("new_ticket");}}>➕ New Ticket</Btn>
    </div>
    <div style={{background:"#fff",borderRadius:12,border:"1px solid #e2e8f0",overflow:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",minWidth:900}}>
        <thead><tr style={{background:"#f8fafc"}}>{["#","Title","Type","Priority","Status","Client","Location","Assigned To","Status SLA",""].map(function(h){return <th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.5,borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>{h}</th>;})}</tr></thead>
        <tbody>
          {filtered.length===0&&<tr><td colSpan={10} style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No tickets found</td></tr>}
          {filtered.map(function(t,i){
            var asgn=fu(t.assignedTo); var type=ftt(t.typeId); var client=fcl(t.clientId); var loc=getLoc(t.clientId,t.locationId);
            var pri=PRI_META[t.priority]||PRI_META.medium; var sm=STATUS_META[t.status]||STATUS_META.Open;
            var sSla=getStatusSla(t,statusSla,schedules);
            return <tr key={t.id} style={{borderBottom:"1px solid #f1f5f9",background:i%2===0?"#fff":"#fafafa"}}>
              <td style={{padding:"9px 12px",fontSize:11,color:"#94a3b8",fontWeight:600}}>#{t.id}</td>
              <td style={{padding:"9px 12px",maxWidth:180}}><div style={{fontWeight:600,color:"#1e293b",fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.title}</div><div style={{fontSize:10,color:"#94a3b8"}}>{ago(t.createdAt)}</div></td>
              <td style={{padding:"9px 12px"}}><Badge label={type?.name||"—"} color={type?.color||"#94a3b8"}/></td>
              <td style={{padding:"9px 12px"}}><Badge label={pri.label} color={pri.color} bg={pri.bg}/></td>
              <td style={{padding:"9px 12px"}}><Badge label={t.status} color={sm.color} bg={sm.bg}/></td>
              <td style={{padding:"9px 12px",fontSize:11,color:"#334155"}}>{client?<span>🤝 {client.name}</span>:<span style={{color:"#94a3b8"}}>—</span>}</td>
              <td style={{padding:"9px 12px",fontSize:11,color:"#334155"}}>{loc?<span>📍 {loc.name}</span>:<span style={{color:"#94a3b8"}}>—</span>}</td>
              <td style={{padding:"9px 12px"}}>{asgn?<div style={{display:"flex",alignItems:"center",gap:6}}><Avatar name={asgn.name} id={asgn.id} size={22}/><span style={{fontSize:11}}>{asgn.name}</span></div>:<span style={{fontSize:11,color:"#ef4444"}}>Unassigned</span>}</td>
              <td style={{padding:"9px 12px",minWidth:140}}>
                {sSla?<div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:3}}>
                    <span style={{color:sSla.breached?"#ef4444":sSla.hasSchedule&&!sSla.onShift?"#94a3b8":"#64748b",fontWeight:600}}>
                      {sSla.breached?"⚠️ Breached":sSla.hasSchedule&&!sSla.onShift?"⏸ Off shift":"⏱ "+sSla.remaining.toFixed(1)+"h left"}
                    </span>
                    <span style={{color:"#94a3b8"}}>{sSla.pct}%</span>
                  </div>
                  <div style={{height:5,background:"#e2e8f0",borderRadius:3,overflow:"hidden"}}>
                    <div style={{height:"100%",width:sSla.pct+"%",background:sSla.hasSchedule&&!sSla.onShift?"#94a3b8":sSla.pct>=100?"#ef4444":sSla.pct>=75?"#f59e0b":"#10b981",borderRadius:3}}/>
                  </div>
                  <div style={{fontSize:9,color:"#94a3b8",marginTop:2}}>{sSla.hoursSpent}h / {sSla.hoursAllowed}h {sSla.hasSchedule?"(shift hrs)":""}</div>
                </div>:<span style={{fontSize:10,color:"#94a3b8"}}>— closed</span>}
              </td>
              <td style={{padding:"9px 12px"}}><div style={{display:"flex",gap:4}}><Btn size="sm" variant="ghost" onClick={function(){setSelTicket(t.id);}}>View</Btn>{isAdmin&&<Btn size="sm" variant="danger" onClick={function(){delTicket(t.id);}}>🗑</Btn>}</div></td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </div>;
}

// ── NEW TICKET ────────────────────────────────────────────────────────────────
function PageNewTicket(p){
  var users=p.users; var companies=p.companies; var clients=p.clients; var ticketTypes=p.ticketTypes; var curUser=p.curUser;
  var setTickets=p.setTickets; var addLog=p.addLog; var showToast=p.showToast; var setPage=p.setPage;
  var [form,setForm]=useState({title:"",description:"",typeId:ticketTypes[0]?.id||"",companyId:curUser.companyId||companies[0]?.id||"",clientId:"",locationId:"",externalEmail:"",customTypeName:""});
  var [start]=useState(Date.now()); var [preview,setPreview]=useState(null); var [attachments,setAttachments]=useState([]); var [dragOver,setDragOver]=useState(false);
  function fld(k,v){setForm(function(prev){return Object.assign({},prev,{[k]:v});});}
  var selType=ticketTypes.find(function(t){return t.id===form.typeId;}); var isOthers=selType&&selType.name==="Others";
  var selClient=clients.find(function(c){return c.id===form.clientId;}); var availLocs=selClient?selClient.locations:[];
  var ACCEPTED=["image/jpeg","image/png","image/gif","image/webp","video/mp4","video/quicktime","video/webm"];
  function fmtSize(b){return b>1048576?(b/1048576).toFixed(1)+"MB":(b/1024).toFixed(0)+"KB";}
  function processFiles(files){ Array.from(files).forEach(function(file){ if(!ACCEPTED.includes(file.type)){showToast("Unsupported: "+file.name,"error");return;} if(file.size>20*1024*1024){showToast(file.name+" > 20MB","error");return;} var r=new FileReader(); r.onload=function(e){setAttachments(function(prev){if(prev.length>=10){showToast("Max 10 attachments","error");return prev;} return prev.concat([{id:uid(),name:file.name,type:file.type,size:file.size,dataUrl:e.target.result}]);}); }; r.readAsDataURL(file); }); }
  function removeAtt(id){setAttachments(function(prev){return prev.filter(function(a){return a.id!==id;});});}
  function handlePreview(){
    if(!form.title.trim()||!form.description.trim()){showToast("Fill in title and description","error");return;}
    var assign=aiAssign(form.title,form.description,form.typeId,users,ticketTypes);
    var tt=ticketTypes.find(function(t){return t.id===form.typeId;});
    var now=new Date().toISOString(); var sla=new Date(Date.now()+(tt?tt.slaHours:24)*3600000).toISOString();
    var mins=Math.max(0.017,(Date.now()-start)/60000); var formOpenedAt=new Date(start).toISOString();
    var draft=Object.assign({},form,{id:"t"+Date.now(),status:"Open",priority:tt?tt.priority:"medium",submittedBy:curUser.id,assignedTo:assign.id,createdAt:now,updatedAt:now,submittedAt:now,formOpenedAt:formOpenedAt,slaDeadline:sla,slaBreached:false,timeToCreateMins:mins,statusHistory:[{status:"Open",assignedTo:assign.id,timestamp:now,changedBy:curUser.id,note:"Ticket created — "+assign.reason}],conversations:[],closedAt:null,deleted:false,aiReason:assign.reason,attachments:attachments});
    setPreview({draft:draft,assign:assign});
  }
  function handleSubmit(){setTickets(function(prev){return prev.concat([preview.draft]);}); addLog("TICKET_CREATED",preview.draft.id,"Ticket \""+preview.draft.title+"\" created. "+preview.assign.reason); showToast("✅ Ticket submitted!"); setPage("tickets");}
  var previewData=preview?[["Title",preview.draft.title],["Priority",PRI_META[preview.draft.priority]?.label],["SLA",fdt(preview.draft.slaDeadline)],["Submitted At",fdt(preview.draft.submittedAt)],["Create Time",fmtMs(preview.draft.timeToCreateMins)],["Assigned To",(users.find(function(u){return u.id===preview.draft.assignedTo;})||{name:"Unassigned"}).name],["Attachments",preview.draft.attachments.length+" files"]]:[];
  return <div style={{maxWidth:680,margin:"0 auto"}}>
    <Card>
      <div style={{fontWeight:700,fontSize:15,color:"#1e293b",marginBottom:18}}>📋 Submit New Ticket</div>
      <FInput label="Title *" value={form.title} onChange={function(e){fld("title",e.target.value);}} placeholder="Brief description"/>
      <FSelect label="Ticket Type *" value={form.typeId} onChange={function(e){fld("typeId",e.target.value);}} options={optTypes(ticketTypes)}/>
      {isOthers&&<FInput label="Describe Type *" value={form.customTypeName} onChange={function(e){fld("customTypeName",e.target.value);}} placeholder="Describe this type"/>}
      <FSelect label="Company *" value={form.companyId} onChange={function(e){fld("companyId",e.target.value);}} options={optCompanies(companies)}/>
      <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:14,marginBottom:14}}>
        <div style={{fontWeight:700,color:"#1e293b",fontSize:12,marginBottom:12}}>🤝 Client &amp; Location</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Client</label><select value={form.clientId} onChange={function(e){fld("clientId",e.target.value);fld("locationId","");}} style={{width:"100%",padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#fff",boxSizing:"border-box"}}>{optClients(clients).map(function(o){return <option key={o.value} value={o.value}>{o.label}</option>;})}</select></div>
          <div><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Location</label><select value={form.locationId} onChange={function(e){fld("locationId",e.target.value);}} disabled={!form.clientId} style={{width:"100%",padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:form.clientId?"#fff":"#f1f5f9",boxSizing:"border-box"}}>{optLocs(availLocs).map(function(o){return <option key={o.value} value={o.value}>{o.label}</option>;})}</select></div>
        </div>
        {selClient&&<div style={{marginTop:8,fontSize:11,color:"#475569",display:"flex",gap:16,flexWrap:"wrap"}}><span>📧 {selClient.email}</span><span>📞 {selClient.phone}</span></div>}
      </div>
      <FTextarea label="Description *" value={form.description} onChange={function(e){fld("description",e.target.value);}} placeholder="Detailed description…" rows={5}/>
      <FInput label="External Email (optional)" value={form.externalEmail} onChange={function(e){fld("externalEmail",e.target.value);}} placeholder="external@client.com" type="email"/>
      <div style={{marginBottom:14}}>
        <label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:6}}>📎 Attachments <span style={{fontWeight:400,color:"#94a3b8"}}>(images &amp; videos, max 10 · 20MB)</span></label>
        <div onDragOver={function(e){e.preventDefault();setDragOver(true);}} onDragLeave={function(){setDragOver(false);}} onDrop={function(e){e.preventDefault();setDragOver(false);processFiles(e.dataTransfer.files);}} onClick={function(){document.getElementById("tfi").click();}} style={{border:"2px dashed "+(dragOver?"#6366f1":"#cbd5e1"),borderRadius:10,padding:"20px 16px",textAlign:"center",cursor:"pointer",background:dragOver?"#eef2ff":"#f8fafc",marginBottom:10}}>
          <div style={{fontSize:24,marginBottom:6}}>🖼️</div><div style={{fontSize:13,fontWeight:600,color:dragOver?"#4338ca":"#475569"}}>Drop images or videos here</div><div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>or click to browse</div>
        </div>
        <input id="tfi" type="file" multiple accept="image/*,video/*" style={{display:"none"}} onChange={function(e){processFiles(e.target.files);e.target.value="";}}/>
        {attachments.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(100px,1fr))",gap:8}}>{attachments.map(function(a){ return <div key={a.id} style={{position:"relative",borderRadius:8,overflow:"hidden",border:"1px solid #e2e8f0"}}>{a.type.startsWith("image/")?<img src={a.dataUrl} alt={a.name} style={{width:"100%",height:80,objectFit:"cover",display:"block"}}/>:<div style={{height:80,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,background:"#1e1b4b"}}><span style={{fontSize:28}}>🎬</span></div>}<div style={{padding:"3px 6px",fontSize:9,color:"#64748b",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{a.name} · {fmtSize(a.size)}</div><button onClick={function(e){e.stopPropagation();removeAtt(a.id);}} style={{position:"absolute",top:3,right:3,background:"rgba(0,0,0,.55)",color:"#fff",border:"none",borderRadius:"50%",width:18,height:18,cursor:"pointer",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button></div>; })}</div>}
      </div>
      {selType&&<div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:8,padding:12,marginBottom:14,fontSize:12}}><div style={{fontWeight:700,color:"#0369a1",marginBottom:4}}>Auto-settings for "{selType.name}"</div><div style={{display:"flex",gap:16,color:"#0c4a6e",flexWrap:"wrap"}}><span>⚡ Priority: <strong>{PRI_META[selType.priority]?.label}</strong></span><span>⏱ SLA: <strong>{selType.slaHours}h</strong></span><span>🤖 AI auto-assign</span></div></div>}
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setPage("tickets");}}>Cancel</Btn><Btn onClick={handlePreview}>🔍 Preview &amp; Submit</Btn></div>
    </Card>
    {preview&&<Modal title="Confirm Submission" onClose={function(){setPreview(null);}}>
      <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:12,marginBottom:14}}><div style={{fontWeight:700,color:"#166534",marginBottom:4}}>🤖 AI Assignment</div><div style={{fontSize:12,color:"#14532d"}}>{preview.assign.reason}</div></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>{previewData.map(function(pair){ var l=pair[0]; var v=pair[1]; return <div key={l} style={{background:"#f8fafc",padding:10,borderRadius:8}}><div style={{color:"#64748b",fontSize:10,fontWeight:700,textTransform:"uppercase"}}>{l}</div><div style={{fontWeight:600,color:"#1e293b",marginTop:2,fontSize:12}}>{v||"—"}</div></div>; })}</div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setPreview(null);}}>Edit</Btn><Btn variant="success" onClick={handleSubmit}>✅ Confirm &amp; Submit</Btn></div>
    </Modal>}
  </div>;
}

// ── TICKET DETAIL ─────────────────────────────────────────────────────────────
function TicketDetail(p){
  var ticket=p.ticket; var setTickets=p.setTickets; var users=p.users; var ticketTypes=p.ticketTypes;
  var companies=p.companies; var clients=p.clients; var curUser=p.curUser; var isAdmin=p.isAdmin; var isTech=p.isTech;
  var addLog=p.addLog; var showToast=p.showToast; var onClose=p.onClose; var statusSla=p.statusSla; var schedules=p.schedules||{};
  var [tab,setTab]=useState("details"); var [status,setStatus]=useState(ticket.status); var [asgn,setAsgn]=useState(ticket.assignedTo||""); var [note,setNote]=useState(""); var [typeId,setTypeId]=useState(ticket.typeId||"");
  var [msgTo,setMsgTo]=useState(""); var [msgCC,setMsgCC]=useState(""); var [msgSubj,setMsgSubj]=useState("Re: [#"+ticket.id+"] "+ticket.title); var [msgBody,setMsgBody]=useState("");
  var [smsTo,setSmsTo]=useState(""); var [smsBody,setSmsBody]=useState(""); var [smsLog,setSmsLog]=useState([]);
  var [emailSending,setEmailSending]=useState(false);
  function fu(id){return users.find(function(x){return x.id===id;});}
  var tt=ticketTypes.find(function(t){return t.id===ticket.typeId;}); var co=companies.find(function(c){return c.id===ticket.companyId;}); var client=clients.find(function(c){return c.id===ticket.clientId;}); var loc=client?client.locations.find(function(l){return l.id===ticket.locationId;}):null;

  function saveStatus(){
    var statusChanged = status !== ticket.status;
    var hist={status,assignedTo:asgn||null,timestamp:new Date().toISOString(),changedBy:curUser.id,note:note||"Status changed to "+status};
    var newTT=ticketTypes.find(function(t){return t.id===typeId;});
    var typeChanged=typeId&&typeId!==ticket.typeId;
    var newSlaDeadline=typeChanged&&newTT?new Date(new Date(ticket.createdAt).getTime()+newTT.slaHours*3600000).toISOString():ticket.slaDeadline;
    var newPriority=typeChanged&&newTT?newTT.priority:ticket.priority;
    if(typeChanged) hist.note=(note||"")+(note?" | ":"")+"Type changed to: "+newTT.name;
    if(!statusChanged) hist.note=(note||"")+(note?" | ":"")+"Details updated (status unchanged)";
    setTickets(function(prev){return prev.map(function(t){
      if(t.id!==ticket.id) return t;
      // Only append a history entry that would reset the SLA timer if the status actually changed
      var newHistory=statusChanged
        ? (t.statusHistory||[]).concat([hist])
        : (t.statusHistory||[]).concat([Object.assign({},hist,{_noSlaReset:true})]);
      return Object.assign({},t,{
        status,
        assignedTo:asgn||null,
        typeId:typeId||t.typeId,
        priority:newPriority,
        slaDeadline:newSlaDeadline,
        updatedAt:new Date().toISOString(),
        slaBreached:new Date()>new Date(newSlaDeadline)&&status!=="Closed",
        closedAt:status==="Closed"&&!t.closedAt?new Date().toISOString():t.closedAt,
        statusHistory:newHistory
      });
    });});
    if(typeChanged) addLog("TICKET_TYPE_CHANGE",ticket.id,"Type changed to: "+newTT.name);
    addLog("TICKET_STATUS",ticket.id,(statusChanged?"Status → "+status:("Details updated, status kept as "+status))+". Assigned: "+(fu(asgn)?.name||"nobody"));
    showToast("Ticket updated"); setNote(""); onClose();
  }

  async function sendEmail(){
    if(!msgTo.trim()||!msgBody.trim()){showToast("Recipient and body required","error");return;} setEmailSending(true);
    var toList=msgTo.split(",").map(function(e){return e.trim();}); var ccList=msgCC?msgCC.split(",").map(function(e){return e.trim();}):[]; 
    var msg={id:uid(),from:curUser.id,fromEmail:curUser.email,to:[],toEmails:toList,cc:ccList,subject:msgSubj,body:msgBody,timestamp:new Date().toISOString(),isExternal:false,status:"sending"};
    setTickets(function(prev){return prev.map(function(t){return t.id===ticket.id?Object.assign({},t,{conversations:(t.conversations||[]).concat([msg])}):t;});});
    var results=await Promise.all(toList.concat(ccList).map(function(email){return callSendEmail({to:email,cc:ccList,subject:msgSubj,body:msgBody,ticketId:ticket.id});}));
    var allOk=results.every(function(r){return r.success;});
    setTickets(function(prev){return prev.map(function(t){return t.id===ticket.id?Object.assign({},t,{conversations:(t.conversations||[]).map(function(c){return c.id===msg.id?Object.assign({},c,{status:allOk?"sent":"failed"}):c;})}):t;});});
    addLog("EMAIL_SENT",ticket.id,"Email sent to "+msgTo+(allOk?"":" [FAILED]")); showToast(allOk?"📧 Email sent!":"⚠️ Some emails failed",allOk?"ok":"error"); setEmailSending(false); if(allOk){setMsgTo("");setMsgCC("");setMsgBody("");}
  }

  async function sendSms(){
    if(!smsTo.trim()||!smsBody.trim()){showToast("Phone and message required","error");return;} setSmsSending(true);
    var entry={id:uid(),to:smsTo,body:smsBody,from:curUser.name,ts:new Date().toISOString(),status:"sending"};
    setSmsLog(function(prev){return prev.concat([entry]);});
    var result=await callSendSms({to:smsTo,message:smsBody,ticketId:ticket.id});
    setSmsLog(function(prev){return prev.map(function(s){return s.id===entry.id?Object.assign({},s,{status:result.success?"delivered":"failed"}):s;});});
    addLog("SMS_SENT",ticket.id,"SMS → "+smsTo+(result.success?"":" [FAILED]")); showToast(result.success?"📱 SMS sent!":"⚠️ SMS failed",result.success?"ok":"error"); setSmsSending(false); if(result.success){setSmsTo("");setSmsBody("");}
  }

  if(!ticket) return null;
  var sSla=getStatusSla(ticket,statusSla,schedules);
  var submitter=fu(ticket.submittedBy);
  var submittedAt=ticket.submittedAt||ticket.createdAt;
  var formOpenedAt=ticket.formOpenedAt||ticket.createdAt;
  var createMins=ticket.timeToCreateMins||0;
  var createColor=createMins<=5?"#10b981":createMins<=15?"#f59e0b":"#ef4444";
  var assigneeSchedule=ticket.assignedTo?schedules[ticket.assignedTo]:null;

  var detailRows=[["Title",ticket.title],["Type",tt?.name||(ticket.customTypeName||"—")],["Priority",<Badge key="p" label={PRI_META[ticket.priority]?.label||ticket.priority} color={PRI_META[ticket.priority]?.color||"#6366f1"}/>],["Status",<Badge key="s" label={ticket.status} color={STATUS_META[ticket.status]?.color||"#6366f1"}/>],["Company",co?.name||"—"],["Submitted By",fu(ticket.submittedBy)?.name||"—"],["Assigned To",fu(ticket.assignedTo)?.name||"Unassigned"],["AI Reason",ticket.aiReason||"—"],["Created",fdt(ticket.createdAt)],["SLA Deadline",fdt(ticket.slaDeadline)],["Create Time",fmtMs(ticket.timeToCreateMins)],["Overall SLA",ticket.slaBreached?<Badge key="sl" label="BREACHED" color="#ef4444"/>:<Badge key="sl2" label="✓ OK" color="#10b981"/>]];
  var TABS=["details","time","status","email","history"].filter(function(t){if(t==="status")return isTech;return true;});
  var tabLabels={details:"📋 Details",time:"⏱ Time",status:"🔄 Status",email:"📧 Email",history:"📜 History"};

  return <Modal title={"Ticket #"+ticket.id+" — "+ticket.title} onClose={onClose} wide>
    <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
      {TABS.map(function(t){ return <button key={t} onClick={function(){setTab(t);}} style={{background:tab===t?"#6366f1":"#f1f5f9",color:tab===t?"#fff":"#475569",border:"none",borderRadius:8,padding:"5px 14px",cursor:"pointer",fontSize:12,fontWeight:700}}>{tabLabels[t]}</button>; })}
    </div>

    {tab==="details"&&<div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>{detailRows.map(function(pair){ var l=pair[0]; var v=pair[1]; return <div key={l} style={{background:"#f8fafc",padding:10,borderRadius:8}}><div style={{color:"#64748b",fontSize:10,fontWeight:700,textTransform:"uppercase",marginBottom:3}}>{l}</div><div style={{fontWeight:600,color:"#1e293b",fontSize:12}}>{v}</div></div>; })}</div>
      <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:14,marginBottom:14}}>
        <div style={{fontWeight:700,color:"#0369a1",fontSize:12,marginBottom:10}}>🤝 Client &amp; Location</div>
        {client?<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><div><div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",marginBottom:4}}>Client</div><div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>{client.name}</div><div style={{fontSize:11,color:"#64748b"}}>📧 {client.email}</div><div style={{fontSize:11,color:"#64748b"}}>📞 {client.phone}</div></div><div><div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",marginBottom:4}}>Location</div>{loc?<><div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>📍 {loc.name}</div><div style={{fontSize:11,color:"#64748b"}}>{loc.address}</div>{loc.floor&&<div style={{fontSize:11,color:"#64748b"}}>🏢 {loc.floor}</div>}{loc.contact&&<div style={{fontSize:11,color:"#64748b"}}>👤 {loc.contact}</div>}</>:<div style={{fontSize:12,color:"#94a3b8"}}>No location</div>}</div></div>:<div style={{fontSize:12,color:"#94a3b8"}}>No client associated.</div>}
      </div>
      <div style={{background:"#f8fafc",padding:12,borderRadius:8,fontSize:12,lineHeight:1.6,whiteSpace:"pre-wrap",color:"#334155"}}>{ticket.description}</div>
      {sSla&&<div style={{marginTop:14,background:sSla.breached?"#fef2f2":sSla.hasSchedule&&!sSla.onShift?"#f8fafc":"#f0fdf4",border:"1px solid "+(sSla.breached?"#fecaca":sSla.hasSchedule&&!sSla.onShift?"#e2e8f0":"#bbf7d0"),borderRadius:10,padding:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{fontWeight:700,color:sSla.breached?"#dc2626":sSla.hasSchedule&&!sSla.onShift?"#64748b":"#166534",fontSize:13}}>⏱ Status SLA — "{ticket.status}"</div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            {sSla.hasSchedule&&<Badge label={sSla.onShift?"🟢 On shift":"⏸ Off shift — timer paused"} color={sSla.onShift?"#10b981":"#94a3b8"}/>}
            <Badge label={sSla.breached?"BREACHED":"✓ Within SLA"} color={sSla.breached?"#ef4444":"#10b981"}/>
          </div>
        </div>
        {sSla.hasSchedule&&<div style={{background:"#e0f2fe",borderRadius:6,padding:"6px 10px",marginBottom:10,fontSize:11,color:"#0369a1"}}>🗓 Assignee schedule: {fmtSchedule(sSla.schedule)} — SLA only counts during shift hours</div>}
        <div style={{height:8,background:"#e2e8f0",borderRadius:4,overflow:"hidden",marginBottom:8}}><div style={{height:"100%",width:sSla.pct+"%",background:sSla.hasSchedule&&!sSla.onShift?"#94a3b8":sSla.pct>=100?"#ef4444":sSla.pct>=75?"#f59e0b":"#10b981",borderRadius:4}}/></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8}}>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#64748b",fontWeight:600,textTransform:"uppercase"}}>Allowed</div><div style={{fontWeight:800,fontSize:16,color:"#1e293b"}}>{sSla.hoursAllowed}h</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#64748b",fontWeight:600,textTransform:"uppercase"}}>{sSla.hasSchedule?"Shift hrs used":"Spent"}</div><div style={{fontWeight:800,fontSize:16,color:"#1e293b"}}>{sSla.hoursSpent}h</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#64748b",fontWeight:600,textTransform:"uppercase"}}>Remaining</div><div style={{fontWeight:800,fontSize:16,color:sSla.breached?"#ef4444":"#10b981"}}>{sSla.breached?"0h":sSla.remaining+"h"}</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#64748b",fontWeight:600,textTransform:"uppercase"}}>Used</div><div style={{fontWeight:800,fontSize:16,color:sSla.pct>=100?"#ef4444":sSla.pct>=75?"#f59e0b":"#10b981"}}>{sSla.pct}%</div></div>
        </div>
        <div style={{fontSize:10,color:"#94a3b8",marginTop:8}}>Entered "{ticket.status}" at: {fdtFull(sSla.enteredAt)}</div>
      </div>}
      {ticket.attachments&&ticket.attachments.length>0&&<div style={{marginTop:14}}><div style={{fontWeight:700,color:"#1e293b",fontSize:12,marginBottom:10}}>📎 Attachments ({ticket.attachments.length})</div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10}}>{ticket.attachments.map(function(a){ var isImg=a.type.startsWith("image/"); return <div key={a.id} style={{borderRadius:10,overflow:"hidden",border:"1px solid #e2e8f0",cursor:"pointer"}} onClick={function(){var w=window.open();w.document.write(isImg?'<img src="'+a.dataUrl+'" style="max-width:100%;"/>':'<video src="'+a.dataUrl+'" controls style="max-width:100%;"></video>');}}>{isImg?<img src={a.dataUrl} alt={a.name} style={{width:"100%",height:90,objectFit:"cover",display:"block"}}/>:<div style={{height:90,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#1e1b4b"}}><span style={{fontSize:32}}>▶️</span></div>}<div style={{padding:"6px 8px"}}><div style={{fontSize:10,fontWeight:600,color:"#334155",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{a.name}</div></div></div>; })}</div></div>}
    </div>}

    {tab==="time"&&<div>
      <div style={{background:"linear-gradient(135deg,#eef2ff,#f0f9ff)",border:"1px solid #c7d2fe",borderRadius:12,padding:20,marginBottom:16}}><div style={{fontWeight:800,color:"#3730a3",fontSize:15,marginBottom:4}}>⏱️ Ticket Time Tracking</div><div style={{fontSize:12,color:"#4338ca"}}>Full timestamp and creation time data for this ticket.</div></div>
      <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:16,marginBottom:14}}>
        <div style={{fontWeight:700,color:"#1e293b",fontSize:13,marginBottom:12}}>👤 Submitted By</div>
        {submitter?<div style={{display:"flex",gap:12,alignItems:"center"}}><Avatar name={submitter.name} id={submitter.id} size={42}/><div><div style={{fontWeight:700,fontSize:14,color:"#1e293b"}}>{submitter.name}</div><div style={{fontSize:12,color:"#64748b"}}>{submitter.email}</div><div style={{marginTop:4}}><Badge label={ROLE_META[submitter.role]?.label||submitter.role} color={ROLE_META[submitter.role]?.color||"#6366f1"}/></div></div></div>:<div style={{color:"#94a3b8",fontSize:12}}>Unknown user</div>}
      </div>
      <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,padding:16,marginBottom:14}}>
        <div style={{fontWeight:700,color:"#1e293b",fontSize:13,marginBottom:16}}>📅 Submission Timeline</div>
        <div style={{display:"flex",flexDirection:"column",gap:0}}>
          <div style={{display:"flex",gap:14,alignItems:"flex-start"}}><div style={{display:"flex",flexDirection:"column",alignItems:"center"}}><div style={{width:36,height:36,borderRadius:"50%",background:"#eef2ff",border:"2px solid #6366f1",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>📝</div><div style={{width:2,height:40,background:"#e2e8f0",margin:"4px 0"}}/></div><div style={{flex:1,paddingTop:4}}><div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>Form Opened</div><div style={{fontSize:12,color:"#334155",marginTop:2}}>{fdtFull(formOpenedAt)}</div><div style={{fontSize:11,color:"#94a3b8",marginTop:1}}>{ago(formOpenedAt)}</div></div></div>
          <div style={{display:"flex",gap:14,alignItems:"flex-start"}}><div style={{display:"flex",flexDirection:"column",alignItems:"center"}}><div style={{width:36,height:36,borderRadius:"50%",background:createColor+"22",border:"2px solid "+createColor,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>⏱</div><div style={{width:2,height:40,background:"#e2e8f0",margin:"4px 0"}}/></div><div style={{flex:1,paddingTop:4}}><div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>Time to Complete Form</div><div style={{display:"flex",alignItems:"center",gap:10,marginTop:4}}><div style={{flex:1,height:10,background:"#e2e8f0",borderRadius:5,overflow:"hidden"}}><div style={{height:"100%",width:Math.min(100,createMins/30*100)+"%",background:createColor,borderRadius:5}}/></div><span style={{fontSize:16,fontWeight:800,color:createColor,minWidth:60}}>{fmtMs(createMins)}</span></div><div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>{createMins<=5?"⚡ Very fast":createMins<=15?"✅ Normal pace":"🐢 Took a while"}</div></div></div>
          <div style={{display:"flex",gap:14,alignItems:"flex-start"}}><div style={{display:"flex",flexDirection:"column",alignItems:"center"}}><div style={{width:36,height:36,borderRadius:"50%",background:"#d1fae5",border:"2px solid #10b981",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>✅</div><div style={{width:2,height:40,background:"#e2e8f0",margin:"4px 0"}}/></div><div style={{flex:1,paddingTop:4}}><div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>Ticket Submitted</div><div style={{fontSize:12,color:"#334155",marginTop:2}}>{fdtFull(submittedAt)}</div><div style={{fontSize:11,color:"#94a3b8",marginTop:1}}>{ago(submittedAt)}</div></div></div>
          <div style={{display:"flex",gap:14,alignItems:"flex-start"}}><div style={{display:"flex",flexDirection:"column",alignItems:"center"}}><div style={{width:36,height:36,borderRadius:"50%",background:ticket.slaBreached?"#fee2e2":"#fef3c7",border:"2px solid "+(ticket.slaBreached?"#ef4444":"#f59e0b"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>{ticket.slaBreached?"🚨":"⏳"}</div>{ticket.closedAt&&<div style={{width:2,height:40,background:"#e2e8f0",margin:"4px 0"}}/>}</div><div style={{flex:1,paddingTop:4}}><div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>SLA Deadline</div><div style={{fontSize:12,color:"#334155",marginTop:2}}>{fdtFull(ticket.slaDeadline)}</div><div style={{marginTop:4}}>{ticket.slaBreached&&ticket.status!=="Closed"?<Badge label="⚠️ SLA BREACHED" color="#ef4444"/>:<Badge label="✓ Within SLA" color="#10b981"/>}</div></div></div>
          {ticket.closedAt&&<div style={{display:"flex",gap:14,alignItems:"flex-start"}}><div style={{display:"flex",flexDirection:"column",alignItems:"center"}}><div style={{width:36,height:36,borderRadius:"50%",background:"#d1fae5",border:"2px solid #10b981",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🎉</div></div><div style={{flex:1,paddingTop:4}}><div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>Closed</div><div style={{fontSize:12,color:"#334155",marginTop:2}}>{fdtFull(ticket.closedAt)}</div><div style={{fontSize:11,color:"#10b981",marginTop:1,fontWeight:600}}>Total resolution time: {Math.round((new Date(ticket.closedAt)-new Date(submittedAt))/3600000)}h</div></div></div>}
        </div>
      </div>
      <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:16}}>
        <div style={{fontWeight:700,color:"#1e293b",fontSize:13,marginBottom:12}}>🗂 Raw Timestamps</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {[["Form Opened",formOpenedAt],["Submitted At",submittedAt],["Last Updated",ticket.updatedAt],["SLA Deadline",ticket.slaDeadline],["Closed At",ticket.closedAt||null]].map(function(pair){
            var l=pair[0]; var v=pair[1];
            return <div key={l} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:8,padding:"10px 12px"}}><div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",marginBottom:3}}>{l}</div><div style={{fontSize:11,fontWeight:600,color:v?"#1e293b":"#94a3b8"}}>{v?fdtFull(v):"—"}</div>{v&&<div style={{fontSize:10,color:"#94a3b8",marginTop:2}}>{ago(v)}</div>}</div>;
          })}
        </div>
      </div>
    </div>}

    {tab==="status"&&isTech&&<div>
      <FSelect label="Update Status" value={status} onChange={function(e){setStatus(e.target.value);}} options={OPT_STATUSES}/>
      <FSelect label="Assign To" value={asgn} onChange={function(e){setAsgn(e.target.value);}} options={optTechs(users)}/>
      <div style={{marginBottom:14}}>
        <label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Ticket Type</label>
        <select value={typeId} onChange={function(e){setTypeId(e.target.value);}} style={{width:"100%",padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#f8fafc",boxSizing:"border-box"}}>
          {ticketTypes.map(function(t){ return <option key={t.id} value={t.id}>{t.name} — {PRI_META[t.priority]?.label||t.priority}, SLA {t.slaHours}h</option>; })}
        </select>
        {typeId!==ticket.typeId&&<div style={{fontSize:11,color:"#f59e0b",marginTop:4}}>⚠️ Changing type will update priority and SLA deadline.</div>}
      </div>
      <FTextarea label="Note" value={note} onChange={function(e){setNote(e.target.value);}} placeholder="What was done or why?" rows={3}/>
      <Btn onClick={saveStatus}>💾 Save Changes</Btn>
    </div>}

    {tab==="email"&&<div>
      <div style={{fontWeight:700,color:"#1e293b",marginBottom:10}}>📧 Send Email</div>
      <FInput label="To (comma-separated)" value={msgTo} onChange={function(e){setMsgTo(e.target.value);}} placeholder="john@client.com"/>
      <FInput label="CC" value={msgCC} onChange={function(e){setMsgCC(e.target.value);}} placeholder="manager@company.com"/>
      <FInput label="Subject" value={msgSubj} onChange={function(e){setMsgSubj(e.target.value);}}/>
      <FTextarea label="Message" value={msgBody} onChange={function(e){setMsgBody(e.target.value);}} rows={4} placeholder="Type your message…"/>
      <button onClick={sendEmail} disabled={emailSending} style={{background:emailSending?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:8,padding:"8px 18px",fontWeight:600,fontSize:13,cursor:emailSending?"not-allowed":"pointer"}}>{emailSending?"⏳ Sending…":"📤 Send Email"}</button>
      <hr style={{margin:"14px 0",border:"none",borderTop:"1px solid #e2e8f0"}}/>
      <div style={{fontWeight:700,color:"#1e293b",marginBottom:10}}>📬 Conversation Trail ({(ticket.conversations||[]).length})</div>
      {(ticket.conversations||[]).length===0&&<div style={{color:"#94a3b8",fontSize:12}}>No messages yet.</div>}
      {(ticket.conversations||[]).map(function(m){ return <div key={m.id} style={{background:m.isExternal?"#fff7ed":"#f8fafc",border:"1px solid "+(m.isExternal?"#fed7aa":"#e2e8f0"),borderRadius:10,padding:12,marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><div style={{fontWeight:700,fontSize:12,color:m.isExternal?"#ea580c":"#1e293b"}}>{m.isExternal?"📬 EXTERNAL":"📧"} {m.fromEmail}{m.toEmails&&m.toEmails.length>0&&<span style={{color:"#64748b",fontWeight:400}}> → {m.toEmails.join(", ")}</span>}</div><div style={{display:"flex",gap:4,alignItems:"center"}}>{m.status==="sending"&&<span style={{fontSize:10,color:"#f59e0b"}}>⏳</span>}{m.status==="sent"&&<span style={{fontSize:10,color:"#10b981"}}>✅</span>}{m.status==="failed"&&<span style={{fontSize:10,color:"#ef4444"}}>❌</span>}<span style={{fontSize:10,color:"#94a3b8"}}>{fdt(m.timestamp)}</span></div></div>{m.cc&&m.cc.length>0&&<div style={{fontSize:11,color:"#94a3b8",marginBottom:4}}>CC: {m.cc.join(", ")}</div>}<div style={{fontSize:11,color:"#64748b",marginBottom:4}}>Subj: {m.subject}</div><div style={{fontSize:12,color:"#334155",whiteSpace:"pre-wrap",lineHeight:1.6}}>{m.body}</div></div>; })}
    </div>}

    {tab==="history"&&<div>
      <div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>📜 Status History</div>
      {(ticket.statusHistory||[]).slice().reverse().map(function(h,i){ return <div key={i} style={{display:"flex",gap:12,marginBottom:12}}><div style={{width:10,height:10,borderRadius:"50%",background:STATUS_META[h.status]?.color||"#6366f1",marginTop:4,flexShrink:0}}/><div style={{flex:1,background:"#f8fafc",borderRadius:8,padding:10}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><Badge label={h.status} color={STATUS_META[h.status]?.color||"#6366f1"}/><span style={{fontSize:10,color:"#94a3b8"}}>{fdt(h.timestamp)}</span></div><div style={{fontSize:11,color:"#64748b",marginTop:4}}>Assigned: <strong>{fu(h.assignedTo)?.name||"Unassigned"}</strong></div><div style={{fontSize:11,color:"#475569"}}>By: {fu(h.changedBy)?.name||"System"}</div>{h.note&&<div style={{fontSize:11,color:"#334155",marginTop:4,fontStyle:"italic"}}>{h.note}</div>}</div></div>; })}
    </div>}
  </Modal>;
}

// ── TIME TRACKING ─────────────────────────────────────────────────────────────
function PageTimeTracking(p){
  var tickets=p.tickets; var users=p.users; var ticketTypes=p.ticketTypes; var curUser=p.curUser; var isAdmin=p.isAdmin; var isTech=p.isTech; var setSelTicket=p.setSelTicket;
  var [search,setSearch]=useState(""); var [filterUser,setFilterUser]=useState(""); var [filterType,setFilterType]=useState(""); var [sortBy,setSortBy]=useState("submittedAt"); var [sortDir,setSortDir]=useState("desc");
  var [view,setView]=useState("table");
  var scope=useMemo(function(){ var base=tickets.filter(function(t){return !t.deleted;}); if(!isAdmin) return base.filter(function(t){return t.submittedBy===curUser.id;}); if(filterUser) return base.filter(function(t){return t.submittedBy===filterUser;}); return base; },[tickets,curUser,isAdmin,filterUser]);
  var filtered=useMemo(function(){ var q=search.toLowerCase(); return scope.filter(function(t){ return(!q||(t.title.toLowerCase().includes(q)||t.id.includes(q)))&&(!filterType||t.typeId===filterType); }).sort(function(a,b){ var av,bv; if(sortBy==="submittedAt"){av=new Date(a.submittedAt||a.createdAt);bv=new Date(b.submittedAt||b.createdAt);} else if(sortBy==="formOpenedAt"){av=new Date(a.formOpenedAt||a.createdAt);bv=new Date(b.formOpenedAt||b.createdAt);} else if(sortBy==="timeToCreate"){av=a.timeToCreateMins||0;bv=b.timeToCreateMins||0;} else if(sortBy==="title"){av=a.title.toLowerCase();bv=b.title.toLowerCase();} else{av=new Date(a.createdAt);bv=new Date(b.createdAt);} if(av<bv)return sortDir==="asc"?-1:1; if(av>bv)return sortDir==="asc"?1:-1; return 0; }); },[scope,search,filterType,sortBy,sortDir]);
  function fu(id){return users.find(function(x){return x.id===id;});} function ftt(id){return ticketTypes.find(function(x){return x.id===id;});}
  var totalMinsAll=filtered.reduce(function(a,t){return a+(t.timeToCreateMins||0);},0);
  var avgCreate=filtered.length?totalMinsAll/filtered.length:0;
  var fastest=filtered.length?filtered.reduce(function(a,t){return (t.timeToCreateMins||999)<(a.timeToCreateMins||999)?t:a;},filtered[0]):null;
  var slowest=filtered.length?filtered.reduce(function(a,t){return (t.timeToCreateMins||0)>(a.timeToCreateMins||0)?t:a;},filtered[0]):null;
  var byTypeTime=ticketTypes.map(function(tt){ var mine=filtered.filter(function(t){return t.typeId===tt.id&&t.timeToCreateMins;}); return {name:tt.name,color:tt.color,avg:mine.length?mine.reduce(function(a,t){return a+t.timeToCreateMins;},0)/mine.length:0,count:mine.length}; }).filter(function(x){return x.count>0;});
  var hourBuckets=Array.from({length:24},function(_,h){ var cnt=filtered.filter(function(t){return new Date(t.submittedAt||t.createdAt).getHours()===h;}).length; return {hour:h,label:(h===0?"12am":h<12?h+"am":h===12?"12pm":(h-12)+"pm"),count:cnt}; });
  var maxHour=Math.max.apply(null,hourBuckets.map(function(h){return h.count;}));
  var DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  var dowBuckets=DOW.map(function(d,i){ return {day:d,count:filtered.filter(function(t){return new Date(t.submittedAt||t.createdAt).getDay()===i;}).length}; });
  var bySubmitter=isAdmin?users.filter(function(u){return u.active;}).map(function(u){ var mine=filtered.filter(function(t){return t.submittedBy===u.id;}); if(!mine.length)return null; return {user:u,count:mine.length,avg:mine.reduce(function(a,t){return a+(t.timeToCreateMins||0);},0)/mine.length,fastest:mine.reduce(function(a,t){return (t.timeToCreateMins||999)<(a.timeToCreateMins||999)?t:a;},mine[0]),slowest:mine.reduce(function(a,t){return (t.timeToCreateMins||0)>(a.timeToCreateMins||0)?t:a;},mine[0])}; }).filter(Boolean):[];
  var dailySummary=useMemo(function(){ var map={}; filtered.forEach(function(t){ var d=new Date(t.submittedAt||t.createdAt); var key=d.toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"}); if(!map[key]) map[key]={date:key,rawDate:d,count:0,totalMins:0,tickets:[]}; map[key].count+=1; map[key].totalMins+=(t.timeToCreateMins||0); map[key].tickets.push(t); }); return Object.values(map).sort(function(a,b){return new Date(b.rawDate)-new Date(a.rawDate);}); },[filtered]);
  function toggleSort(col){if(sortBy===col){setSortDir(function(d){return d==="asc"?"desc":"asc";});}else{setSortBy(col);setSortDir("desc");}}
  function SortArrow(sp){ if(sortBy!==sp.col)return <span style={{color:"#cbd5e1",marginLeft:3}}>⇅</span>; return <span style={{marginLeft:3}}>{sortDir==="asc"?"↑":"↓"}</span>; }
  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
      <div><div style={{fontWeight:800,fontSize:18,color:"#1e293b"}}>⏱️ Time Tracking</div><div style={{fontSize:12,color:"#64748b",marginTop:2}}>Track when each ticket was submitted and submission patterns.</div></div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {["table","heatmap","daily"].map(function(v){ var labels={table:"📋 Table",heatmap:"🔥 Heatmap",daily:"📅 Daily"}; return <button key={v} onClick={function(){setView(v);}} style={{padding:"6px 14px",borderRadius:8,border:"1px solid "+(view===v?"#6366f1":"#e2e8f0"),background:view===v?"#6366f1":"#fff",color:view===v?"#fff":"#475569",fontSize:12,fontWeight:600,cursor:"pointer"}}>{labels[v]}</button>; })}
        {isAdmin&&<button onClick={function(){setView("byuser");}} style={{padding:"6px 14px",borderRadius:8,border:"1px solid "+(view==="byuser"?"#6366f1":"#e2e8f0"),background:view==="byuser"?"#6366f1":"#fff",color:view==="byuser"?"#fff":"#475569",fontSize:12,fontWeight:600,cursor:"pointer"}}>👥 By User</button>}
      </div>
    </div>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
      <Stat label="Total Create Time" value={fmtMs(totalMinsAll)} icon="🕐" color="#8b5cf6" sub={filtered.length+" tickets"}/>
      <Stat label="Avg Create Time" value={fmtMs(avgCreate)} icon="⏱" color="#0ea5e9"/>
      <Stat label="Fastest Submit" value={fastest?fmtMs(fastest.timeToCreateMins):"—"} icon="⚡" color="#10b981" sub={fastest?fastest.title.slice(0,18)+"…":""}/>
      <Stat label="Slowest Submit" value={slowest?fmtMs(slowest.timeToCreateMins):"—"} icon="🐢" color="#f59e0b" sub={slowest?slowest.title.slice(0,18)+"…":""}/>
    </div>
    <Card style={{marginBottom:16,padding:"14px 16px"}}><div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}><input value={search} onChange={function(e){setSearch(e.target.value);}} placeholder="🔍 Search tickets…" style={{flex:1,minWidth:160,padding:"7px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}/><select value={filterType} onChange={function(e){setFilterType(e.target.value);}} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}><option value="">All Types</option>{ticketTypes.map(function(t){return <option key={t.id} value={t.id}>{t.name}</option>;})}</select>{isAdmin&&<select value={filterUser} onChange={function(e){setFilterUser(e.target.value);}} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}><option value="">All Users</option>{users.filter(function(u){return u.active;}).map(function(u){return <option key={u.id} value={u.id}>{u.name}</option>;})}</select>}</div></Card>
    {view==="table"&&<Card style={{padding:0,overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:860}}><thead><tr style={{background:"#f8fafc"}}><th style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0"}}>#</th><th onClick={function(){toggleSort("title");}} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0",cursor:"pointer"}}>Title <SortArrow col="title"/></th><th style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0"}}>Submitted By</th><th style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0"}}>Type</th><th onClick={function(){toggleSort("formOpenedAt");}} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0",cursor:"pointer"}}>Form Opened <SortArrow col="formOpenedAt"/></th><th onClick={function(){toggleSort("submittedAt");}} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0",cursor:"pointer"}}>Submitted <SortArrow col="submittedAt"/></th><th onClick={function(){toggleSort("timeToCreate");}} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0",cursor:"pointer"}}>Create Time <SortArrow col="timeToCreate"/></th><th style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0"}}>Status</th><th style={{padding:"10px 12px",borderBottom:"1px solid #e2e8f0"}}></th></tr></thead><tbody>{filtered.length===0&&<tr><td colSpan={9} style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No tickets found.</td></tr>}{filtered.map(function(t,i){ var submitter=fu(t.submittedBy); var tt2=ftt(t.typeId); var sm=STATUS_META[t.status]||STATUS_META.Open; var cm=t.timeToCreateMins||0; var cc=cm<=5?"#10b981":cm<=15?"#f59e0b":"#ef4444"; var sat=t.submittedAt||t.createdAt; var foa=t.formOpenedAt||t.createdAt; return <tr key={t.id} style={{borderBottom:"1px solid #f1f5f9",background:i%2===0?"#fff":"#fafafa"}}><td style={{padding:"9px 12px",fontSize:11,color:"#94a3b8",fontWeight:600}}>#{t.id}</td><td style={{padding:"9px 12px",maxWidth:180}}><div style={{fontWeight:600,color:"#1e293b",fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.title}</div></td><td style={{padding:"9px 12px"}}>{submitter?<div style={{display:"flex",alignItems:"center",gap:6}}><Avatar name={submitter.name} id={submitter.id} size={20}/><span style={{fontSize:11}}>{submitter.name}</span></div>:<span style={{fontSize:11,color:"#94a3b8"}}>—</span>}</td><td style={{padding:"9px 12px"}}>{tt2?<Badge label={tt2.name} color={tt2.color}/>:<span style={{color:"#94a3b8",fontSize:11}}>—</span>}</td><td style={{padding:"9px 12px"}}><div style={{fontSize:11,color:"#334155",fontWeight:600}}>{fdtFull(foa)}</div><div style={{fontSize:10,color:"#94a3b8"}}>{ago(foa)}</div></td><td style={{padding:"9px 12px"}}><div style={{fontSize:11,color:"#334155",fontWeight:600}}>{fdtFull(sat)}</div><div style={{fontSize:10,color:"#94a3b8"}}>{ago(sat)}</div></td><td style={{padding:"9px 12px"}}><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:40,height:6,background:"#e2e8f0",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:Math.min(100,cm/30*100)+"%",background:cc,borderRadius:3}}/></div><span style={{fontSize:12,fontWeight:700,color:cc}}>{fmtMs(cm)}</span></div></td><td style={{padding:"9px 12px"}}><Badge label={t.status} color={sm.color} bg={sm.bg}/></td><td style={{padding:"9px 12px"}}><Btn size="sm" variant="ghost" onClick={function(){setSelTicket(t.id);}}>View</Btn></td></tr>; })}</tbody></table></Card>}
    {view==="heatmap"&&<div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:14}}>🕐 By Hour of Day</div><div style={{display:"grid",gridTemplateColumns:"repeat(12,1fr)",gap:4,marginBottom:8}}>{hourBuckets.map(function(h){ var intensity=maxHour>0?h.count/maxHour:0; var bg=h.count===0?"#f1f5f9":"rgba(99,102,241,"+Math.max(0.1,intensity)+")"; return <div key={h.hour} title={h.label+": "+h.count} style={{height:36,borderRadius:6,background:bg,display:"flex",alignItems:"center",justifyContent:"center"}}>{h.count>0&&<span style={{fontSize:10,fontWeight:700,color:intensity>0.5?"#fff":"#4338ca"}}>{h.count}</span>}</div>; })}</div><div style={{display:"grid",gridTemplateColumns:"repeat(12,1fr)",gap:4}}>{hourBuckets.map(function(h){return <div key={h.hour} style={{fontSize:8,color:"#94a3b8",textAlign:"center"}}>{h.label}</div>;})}</div></Card>
        <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:14}}>📅 By Day of Week</div><ResponsiveContainer width="100%" height={180}><BarChart data={dowBuckets}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="day" tick={{fontSize:11}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="count" name="Tickets" radius={[4,4,0,0]}>{dowBuckets.map(function(e,i){return <Cell key={i} fill={PAL[i%PAL.length]}/>;})}</Bar></BarChart></ResponsiveContainer></Card>
      </div>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:14}}>⏱ Avg Create Time by Type</div>{byTypeTime.length===0&&<div style={{textAlign:"center",color:"#94a3b8",padding:20}}>No data.</div>}<div style={{display:"flex",flexDirection:"column",gap:10}}>{byTypeTime.sort(function(a,b){return b.avg-a.avg;}).map(function(t){ var maxAvg=Math.max.apply(null,byTypeTime.map(function(x){return x.avg;})); return <div key={t.name} style={{display:"flex",alignItems:"center",gap:12}}><div style={{width:130,fontSize:12,fontWeight:600,color:"#334155",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.name}</div><div style={{flex:1,height:22,background:"#f1f5f9",borderRadius:6,overflow:"hidden",position:"relative"}}><div style={{height:"100%",width:(maxAvg>0?t.avg/maxAvg*100:0)+"%",background:t.color,borderRadius:6}}/><span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",fontSize:10,fontWeight:700,color:t.avg/maxAvg>0.4?"#fff":"#334155"}}>{fmtMs(t.avg)} avg</span></div><div style={{fontSize:11,color:"#94a3b8",width:50,textAlign:"right"}}>{t.count} tickets</div></div>; })}</div></Card>
    </div>}
    {view==="daily"&&<div>
      {dailySummary.length===0&&<Card><div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No tickets match filters.</div></Card>}
      {dailySummary.length>0&&<Card style={{padding:0,overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:700}}><thead><tr style={{background:"#f8fafc"}}>{["Date","Tickets","Total Time","Avg","Fastest","Slowest"].map(function(h){return <th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>{h}</th>;})}</tr></thead><tbody>{dailySummary.map(function(row,i){ var avg=row.count?row.totalMins/row.count:0; var f2=row.tickets.reduce(function(a,t){return (t.timeToCreateMins||999)<(a.timeToCreateMins||999)?t:a;},row.tickets[0]); var s2=row.tickets.reduce(function(a,t){return (t.timeToCreateMins||0)>(a.timeToCreateMins||0)?t:a;},row.tickets[0]); var avgColor=avg<=5?"#10b981":avg<=15?"#f59e0b":"#ef4444"; return <tr key={row.date} style={{borderBottom:"1px solid #f1f5f9",background:i%2===0?"#fff":"#fafafa"}}><td style={{padding:"10px 12px"}}><div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>{row.date}</div><div style={{fontSize:10,color:"#94a3b8"}}>{new Date(row.rawDate).toLocaleDateString("en-US",{weekday:"long"})}</div></td><td style={{padding:"10px 12px",fontWeight:700,fontSize:13,color:"#6366f1"}}>{row.count}</td><td style={{padding:"10px 12px",fontWeight:800,fontSize:15,color:"#6366f1"}}>{fmtMs(row.totalMins)}</td><td style={{padding:"10px 12px"}}><span style={{fontWeight:700,color:avgColor,fontSize:13}}>{fmtMs(avg)}</span></td><td style={{padding:"10px 12px",fontSize:12,fontWeight:600,color:"#10b981"}}>{f2?fmtMs(f2.timeToCreateMins):"—"}</td><td style={{padding:"10px 12px",fontSize:12,fontWeight:600,color:"#f59e0b"}}>{s2?fmtMs(s2.timeToCreateMins):"—"}</td></tr>; })}</tbody><tfoot><tr style={{background:"#f0f9ff",borderTop:"2px solid #bae6fd"}}><td style={{padding:"10px 12px",fontWeight:800,color:"#0369a1",fontSize:13}}>TOTAL</td><td style={{padding:"10px 12px",fontWeight:800,color:"#0369a1"}}>{filtered.length}</td><td style={{padding:"10px 12px",fontWeight:800,color:"#0369a1",fontSize:15}}>{fmtMs(totalMinsAll)}</td><td style={{padding:"10px 12px",fontWeight:700,color:"#0369a1"}}>{filtered.length?fmtMs(totalMinsAll/filtered.length):"-"} avg</td><td colSpan={2}/></tr></tfoot></table></Card>}
    </div>}
    {view==="byuser"&&isAdmin&&<div>
      {bySubmitter.length===0&&<Card><div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No user data.</div></Card>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:14,marginBottom:16}}>{bySubmitter.map(function(row){ var rm=ROLE_META[row.user.role]; return <Card key={row.user.id} style={{borderTop:"3px solid "+avCol(row.user.id)}}><div style={{display:"flex",gap:10,alignItems:"center",marginBottom:14}}><Avatar name={row.user.name} id={row.user.id} size={40}/><div><div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>{row.user.name}</div><Badge label={rm?.label||row.user.role} color={rm?.color||"#6366f1"}/></div></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}><div style={{background:"#f8fafc",borderRadius:8,padding:"8px 10px",textAlign:"center"}}><div style={{fontSize:10,color:"#64748b",fontWeight:700,textTransform:"uppercase",marginBottom:2}}>Tickets</div><div style={{fontSize:20,fontWeight:800,color:"#6366f1"}}>{row.count}</div></div><div style={{background:"#f8fafc",borderRadius:8,padding:"8px 10px",textAlign:"center"}}><div style={{fontSize:10,color:"#64748b",fontWeight:700,textTransform:"uppercase",marginBottom:2}}>Avg Time</div><div style={{fontSize:14,fontWeight:800,color:"#0ea5e9"}}>{fmtMs(row.avg)}</div></div></div>{row.fastest&&<div style={{fontSize:11,color:"#64748b",marginBottom:4}}>⚡ Fastest: <strong>{fmtMs(row.fastest.timeToCreateMins)}</strong> — {row.fastest.title.slice(0,22)}</div>}{row.slowest&&<div style={{fontSize:11,color:"#64748b"}}>🐢 Slowest: <strong>{fmtMs(row.slowest.timeToCreateMins)}</strong> — {row.slowest.title.slice(0,22)}</div>}</Card>; })}</div>
    </div>}
  </div>;
}

// ── REPORTS ───────────────────────────────────────────────────────────────────
function PageReports(p){
  var tickets=p.tickets; var users=p.users; var ticketTypes=p.ticketTypes; var clients=p.clients; var statusSla=p.statusSla||DEFAULT_STATUS_SLA; var schedules=p.schedules||{};
  var [view,setView]=useState("summary"); var [range,setRange]=useState("month"); var [aiInsight,setAiInsight]=useState(""); var [aiLoading,setAiLoading]=useState(false);
  var rangeStart=useMemo(function(){ var now=new Date(); if(range==="day")return new Date(now.getFullYear(),now.getMonth(),now.getDate()).toISOString(); if(range==="week")return new Date(now.getTime()-7*86400000).toISOString(); if(range==="month")return new Date(now.getTime()-30*86400000).toISOString(); if(range==="year")return new Date(now.getTime()-365*86400000).toISOString(); return new Date(0).toISOString(); },[range]);
  var rangeLabel={day:"Today",week:"Last 7 Days",month:"Last 30 Days",year:"Last 12 Months",all:"All Time"};
  var techs=users.filter(function(u){return IT_ROLES.includes(u.role);});
  var active=tickets.filter(function(t){return !t.deleted&&new Date(t.createdAt)>=new Date(rangeStart);});
  var allActive=tickets.filter(function(t){return !t.deleted;});
  var byType=ticketTypes.map(function(tt,i){ var mine=active.filter(function(t){return t.typeId===tt.id;}); var res=calcClosed(mine); return {id:tt.id,name:tt.name,color:tt.color,priority:tt.priority,slaH:tt.slaHours,total:mine.length,open:mine.filter(function(t){return t.status==="Open";}).length,inProg:mine.filter(function(t){return t.status==="In Progress";}).length,resolved:res.length,breached:mine.filter(function(t){return t.slaBreached;}).length,slaRate:calcSlaRate(mine),avgClose:calcAvgClose(res),fill:PAL[i%PAL.length]}; }).filter(function(x){return x.total>0;});
  var byUser=techs.map(function(t){ var mine=active.filter(function(tk){return tk.assignedTo===t.id;}); var res=calcClosed(mine); var avgStatus=ALL_STATUSES.map(function(s){ var sm=mine.filter(function(tk){return tk.status===s;}); return {s:s,h:sm.length?Math.round(sm.reduce(function(a,tk){return a+(new Date(tk.updatedAt)-new Date(tk.createdAt))/3600000;},0)/sm.length):0}; }); return {id:t.id,name:t.name,role:t.role,total:mine.length,open:mine.filter(function(t){return t.status==="Open";}).length,inProg:mine.filter(function(t){return t.status==="In Progress";}).length,escalated:mine.filter(function(t){return t.status==="Escalated";}).length,resolved:res.length,breached:mine.filter(function(t){return t.slaBreached;}).length,slaRate:calcSlaRate(mine),avgClose:calcAvgClose(res),createMins:Math.round(mine.reduce(function(a,t){return a+(t.timeToCreateMins||0);},0)/Math.max(mine.length,1)),avgStatus:avgStatus}; });
  var byClient=clients.map(function(cl){ var mine=active.filter(function(t){return t.clientId===cl.id;}); var res=calcClosed(mine); return {id:cl.id,name:cl.name,industry:cl.industry,total:mine.length,open:mine.filter(function(t){return t.status==="Open";}).length,resolved:res.length,breached:mine.filter(function(t){return t.slaBreached;}).length,slaRate:calcSlaRate(mine),avgClose:calcAvgClose(res)}; }).filter(function(x){return x.total>0;});
  var byLocation=clients.flatMap(function(cl){ return cl.locations.map(function(loc){ var mine=active.filter(function(t){return t.locationId===loc.id;}); var res=calcClosed(mine); return {id:loc.id,locName:loc.name,clientName:cl.name,address:loc.address,total:mine.length,open:mine.filter(function(t){return t.status==="Open";}).length,resolved:res.length,breached:mine.filter(function(t){return t.slaBreached;}).length,slaRate:calcSlaRate(mine),avgClose:calcAvgClose(res)}; }); }).filter(function(x){return x.total>0;});
  var totalBreached=active.filter(function(t){return t.slaBreached;}).length;
  var totalSlaRate=calcSlaRate(active); var avgCloseAll=calcAvgClose(calcClosed(active)); var avgCreateAll=Math.round(active.reduce(function(a,t){return a+(t.timeToCreateMins||0);},0)/Math.max(active.length,1));
  var avgPerStatus=ALL_STATUSES.map(function(s){ var mine=active.filter(function(t){return t.status===s;}); return {status:s,count:mine.length,color:STATUS_META[s].color,avgH:mine.length?Math.round(mine.reduce(function(a,t){return a+(new Date(t.updatedAt)-new Date(t.createdAt))/3600000;},0)/mine.length):0}; });
  var weeklyTrend=useMemo(function(){ return Array.from({length:12},function(_,i){ var wEnd=new Date(Date.now()-(11-i)*7*86400000); var wStart=new Date(wEnd.getTime()-7*86400000); var wT=allActive.filter(function(t){var d=new Date(t.createdAt);return d>=wStart&&d<wEnd;}); var row={label:"W"+(i+1)+" "+wEnd.toLocaleDateString("en",{month:"short",day:"numeric"}),total:wT.length,closed:calcClosed(wT).length,breached:wT.filter(function(t){return t.slaBreached;}).length}; ticketTypes.forEach(function(tt){row[tt.name]=wT.filter(function(t){return t.typeId===tt.id;}).length;}); return row; }); },[allActive,ticketTypes]);
  var top3Types=useMemo(function(){ return ticketTypes.map(function(tt){return {name:tt.name,color:tt.color,total:allActive.filter(function(t){return t.typeId===tt.id;}).length};}).sort(function(a,b){return b.total-a.total;}).slice(0,3); },[allActive,ticketTypes]);
  var statusPieData=ALL_STATUSES.map(function(s){return {name:s,value:active.filter(function(t){return t.status===s;}).length,color:STATUS_META[s].color};});
  var byPriChart=Object.keys(PRI_META).map(function(k){return {name:PRI_META[k].label,value:active.filter(function(t){return t.priority===k;}).length,color:PRI_META[k].color};});
  var byTypeVolChart=byType.map(function(t){return {name:t.name,total:t.total,color:t.color};});
  var byTypeSlaChart=byType.map(function(t){return {name:t.name,slaRate:t.slaRate,color:slaColor(t.slaRate)};});
  var byUserStackChart=byUser.filter(function(u){return u.total>0;}).map(function(u){return {name:u.name.split(" ")[0],resolved:u.resolved,open:u.open,inProg:u.inProg};});
  var byUserSlaChart=byUser.filter(function(u){return u.total>0;}).map(function(u){return {name:u.name.split(" ")[0],slaRate:u.slaRate,color:slaColor(u.slaRate)};});
  var byUserCloseChart=byUser.filter(function(u){return u.total>0;}).map(function(u){return {name:u.name.split(" ")[0],avgClose:u.avgClose};});
  var byClientVolChart=byClient.map(function(c){return {name:c.name.split(" ")[0],total:c.total};});
  var byClientSlaChart=byClient.map(function(c){return {name:c.name.split(" ")[0],slaRate:c.slaRate,color:slaColor(c.slaRate)};});
  var byLocVolChart=byLocation.map(function(l){return {name:l.locName,total:l.total};});
  var byLocSlaChart=byLocation.map(function(l){return {name:l.locName,slaRate:l.slaRate,color:slaColor(l.slaRate)};});
  var trendLines=top3Types.map(function(tt){return <Line key={tt.name} type="monotone" dataKey={tt.name} stroke={tt.color} strokeWidth={2} dot={false} name={tt.name}/>;});

  async function generateInsight(){ setAiLoading(true); setAiInsight(""); var summary={totalTickets:allActive.length,slaRate:calcSlaRate(allActive),avgClose:calcAvgClose(calcClosed(allActive)),topTypes:top3Types.map(function(t){return t.name+" ("+t.total+")";}),breached:allActive.filter(function(t){return t.slaBreached;}).length,openCount:allActive.filter(function(t){return t.status==="Open";}).length,escalated:allActive.filter(function(t){return t.status==="Escalated";}).length,weeklyVolume:weeklyTrend.map(function(w){return w.label+": "+w.total;}),byType:byType.map(function(t){return t.name+": "+t.total+" tickets, SLA "+t.slaRate+"%";}),byUser:byUser.map(function(u){return u.name+": "+u.total+" tickets, SLA "+u.slaRate+"%, avg close "+u.avgClose+"h";})}; try{var res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,messages:[{role:"user",content:"You are an IT helpdesk analyst. Analyze this data and provide:\n1. Top 3 issues and business impact\n2. SLA performance analysis\n3. Workload distribution\n4. 3 actionable recommendations\n5. Trend analysis\n\nBe concise, use bullets.\n\nData:\n"+JSON.stringify(summary,null,2)}]})}); var data=await res.json(); setAiInsight(data.content&&data.content[0]?data.content[0].text:"Unable to generate insight.");}catch(e){setAiInsight("Error: "+e.message);} setAiLoading(false); }

  function TH(hp){return <th style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.4,borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>{hp.children}</th>;}
  function TD(dp){return <td style={{padding:"9px 12px",fontSize:12,fontWeight:dp.bold?700:400,color:"#1e293b"}}>{dp.children}</td>;}
  var VIEWS=[{id:"summary",label:"📊 Summary"},{id:"trend",label:"📈 Trend"},{id:"by_type",label:"🏷️ By Type"},{id:"per_user",label:"👤 Per User"},{id:"per_client",label:"🤝 Per Client"},{id:"per_location",label:"📍 Per Location"},{id:"sla",label:"⏱ SLA & Time"}];

  function statusSlaStats(status){
    var allowedH=statusSla[status];
    if(!allowedH) return {rate:100,met:0,breached:0,total:0};
    var allIn=active.filter(function(t){ return (t.statusHistory||[]).some(function(h){return h.status===status;}); });
    var br=allIn.filter(function(t){
      var hist=(t.statusHistory||[]); var idx=-1;
      for(var i=0;i<hist.length;i++){if(hist[i].status===status)idx=i;}
      if(idx<0)return false;
      var entryMs=new Date(hist[idx].timestamp).getTime();
      var exitMs=hist[idx+1]?new Date(hist[idx+1].timestamp).getTime():Date.now();
      var schedule=schedules[t.assignedTo]||null;
      var spent=schedule?calcBusinessHoursElapsed(entryMs,exitMs,schedule):(exitMs-entryMs)/3600000;
      return spent>allowedH;
    });
    var rate=allIn.length>0?Math.round((allIn.length-br.length)/allIn.length*100):100;
    return {rate:rate,met:allIn.length-br.length,breached:br.length,total:allIn.length};
  }

  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{VIEWS.map(function(v){return <Btn key={v.id} variant={view===v.id?"primary":"ghost"} onClick={function(){setView(v.id);}} size="sm">{v.label}</Btn>;})}</div><div style={{display:"flex",gap:6,alignItems:"center"}}><span style={{fontSize:12,color:"#64748b",fontWeight:600}}>Period:</span>{["day","week","month","year","all"].map(function(r){return <button key={r} onClick={function(){setRange(r);}} style={{padding:"5px 12px",borderRadius:8,border:"1px solid "+(range===r?"#6366f1":"#e2e8f0"),background:range===r?"#6366f1":"#fff",color:range===r?"#fff":"#475569",fontSize:11,fontWeight:600,cursor:"pointer"}}>{rangeLabel[r]}</button>;})}</div></div>
    <div style={{background:"#eef2ff",border:"1px solid #c7d2fe",borderRadius:8,padding:"8px 14px",marginBottom:16,fontSize:12,color:"#4338ca",fontWeight:600}}><span>📅 Showing: <strong>{rangeLabel[range]}</strong> — {active.length} tickets</span></div>

    {view==="summary"&&<div>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
        <Stat label="Total Tickets" value={active.length} icon="🎫" color="#6366f1"/>
        <Stat label="SLA Rate" value={totalSlaRate+"%"} icon="🎯" color={slaColor(totalSlaRate)} sub={totalBreached+" breached"}/>
        <Stat label="Avg Close Time" value={avgCloseAll+"h"} icon="⏱" color="#0ea5e9"/>
        <Stat label="Avg Create Time" value={avgCreateAll+"m"} icon="📝" color="#8b5cf6"/>
        <Stat label="Closed" value={calcClosed(active).length} icon="✅" color="#10b981" sub={Math.round(calcClosed(active).length/Math.max(active.length,1)*100)+"% rate"}/>
        <Stat label="Escalated" value={active.filter(function(t){return t.status==="Escalated";}).length} icon="🚨" color="#ef4444"/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        <Card><div style={{fontWeight:700,marginBottom:12}}>Tickets by Status</div><ResponsiveContainer width="100%" height={200}><PieChart><Pie data={statusPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={pieLabel} fontSize={9}>{statusPieData.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Pie><Tooltip/></PieChart></ResponsiveContainer></Card>
        <Card><div style={{fontWeight:700,marginBottom:12}}>Tickets by Priority</div><ResponsiveContainer width="100%" height={200}><BarChart data={byPriChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="value" radius={[4,4,0,0]}>{byPriChart.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Bar></BarChart></ResponsiveContainer></Card>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <Card><div style={{fontWeight:700,marginBottom:12}}>Avg Time per Status</div>{avgPerStatus.map(function(s){return <div key={s.status} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}><div style={{width:10,height:10,borderRadius:"50%",background:s.color,flexShrink:0}}/><div style={{flex:1,fontSize:12}}>{s.status}</div><Badge label={s.count+" tickets"} color={s.color}/><div style={{fontSize:12,fontWeight:700,color:"#1e293b",minWidth:40,textAlign:"right"}}>{s.avgH}h</div></div>;})}</Card>
        <Card><div style={{fontWeight:700,marginBottom:12}}>Top Ticket Types</div>{byType.slice(0,6).map(function(t){return <div key={t.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f1f5f9"}}><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:8,height:8,borderRadius:"50%",background:t.color}}/><span style={{fontSize:12}}>{t.name}</span></div><div style={{display:"flex",gap:6,alignItems:"center"}}><Badge label={t.total+" tickets"} color={t.color}/><Badge label={t.slaRate+"%"} color={slaColor(t.slaRate)}/></div></div>;})}</Card>
      </div>
    </div>}

    {view==="trend"&&<div>
      <Card style={{marginBottom:16}}><div style={{fontWeight:700,marginBottom:12}}>Weekly Volume</div><ResponsiveContainer width="100%" height={260}><AreaChart data={weeklyTrend}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="label" tick={{fontSize:9}} angle={-25} textAnchor="end" height={50}/><YAxis tick={{fontSize:10}}/><Tooltip/><Legend wrapperStyle={{fontSize:11}}/><Area type="monotone" dataKey="total" stroke="#6366f1" fill="#eef2ff" name="Total" strokeWidth={2}/><Area type="monotone" dataKey="closed" stroke="#10b981" fill="#d1fae5" name="Closed" strokeWidth={2}/><Area type="monotone" dataKey="breached" stroke="#ef4444" fill="#fee2e2" name="Breached" strokeWidth={2}/></AreaChart></ResponsiveContainer></Card>
      <Card style={{marginBottom:16}}><div style={{fontWeight:700,marginBottom:12}}>Issue Type Trend — Top 3</div><ResponsiveContainer width="100%" height={260}><LineChart data={weeklyTrend}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="label" tick={{fontSize:9}} angle={-25} textAnchor="end" height={50}/><YAxis tick={{fontSize:10}}/><Tooltip/><Legend wrapperStyle={{fontSize:11}}/>{trendLines}</LineChart></ResponsiveContainer></Card>
      <Card style={{borderLeft:"4px solid #6366f1"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><div><div style={{fontWeight:700,fontSize:14,color:"#1e293b"}}>🤖 AI-Generated Insights</div><div style={{fontSize:11,color:"#64748b",marginTop:2}}>Analyzes trends and generates recommendations</div></div><button onClick={generateInsight} disabled={aiLoading} style={{padding:"9px 18px",background:aiLoading?"#a5b4fc":"linear-gradient(135deg,#6366f1,#4338ca)",color:"#fff",border:"none",borderRadius:10,fontWeight:700,fontSize:13,cursor:aiLoading?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:6}}>{aiLoading?<><span style={{display:"inline-block",width:14,height:14,border:"2px solid #fff",borderTop:"2px solid transparent",borderRadius:"50%",animation:"spin .7s linear infinite"}}/> Analyzing…</>:"✨ Generate Insights"}</button></div>
        {!aiInsight&&!aiLoading&&<div style={{background:"#f8fafc",borderRadius:10,padding:20,textAlign:"center",color:"#94a3b8"}}><div style={{fontSize:32,marginBottom:8}}>🧠</div><div style={{fontSize:13,fontWeight:600,color:"#475569"}}>Ready to analyze your data</div></div>}
        {aiLoading&&<div style={{background:"#f8fafc",borderRadius:10,padding:24,textAlign:"center"}}><div style={{fontSize:13,color:"#6366f1",fontWeight:600}}>🤖 Analyzing…</div></div>}
        {aiInsight&&!aiLoading&&<div style={{background:"#f8fafc",borderRadius:10,padding:20}}><div style={{fontSize:12,color:"#334155",lineHeight:1.9,whiteSpace:"pre-wrap"}}>{aiInsight}</div><div style={{marginTop:12,paddingTop:10,borderTop:"1px solid #e2e8f0",display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:10,color:"#94a3b8"}}>Generated {new Date().toLocaleString()}</span><button onClick={generateInsight} style={{background:"none",border:"1px solid #e2e8f0",borderRadius:6,padding:"4px 10px",fontSize:11,color:"#6366f1",cursor:"pointer",fontWeight:600}}>↻ Refresh</button></div></div>}
      </Card>
    </div>}

    {view==="by_type"&&<div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginBottom:16}}>
        <Card><div style={{fontWeight:700,marginBottom:12}}>Volume by Type</div><ResponsiveContainer width="100%" height={220}><BarChart data={byTypeVolChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:9}} angle={-20} textAnchor="end" height={40}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="total" radius={[4,4,0,0]}>{byTypeVolChart.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Bar></BarChart></ResponsiveContainer></Card>
        <Card><div style={{fontWeight:700,marginBottom:12}}>SLA Rate by Type</div><ResponsiveContainer width="100%" height={220}><BarChart data={byTypeSlaChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:9}} angle={-20} textAnchor="end" height={40}/><YAxis tick={{fontSize:10}} domain={[0,100]}/><Tooltip/><Bar dataKey="slaRate" radius={[4,4,0,0]}>{byTypeSlaChart.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Bar></BarChart></ResponsiveContainer></Card>
      </div>
      <Card style={{padding:0,overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:750}}><thead><tr style={{background:"#f8fafc"}}><TH>Type</TH><TH>Priority</TH><TH>SLA</TH><TH>Total</TH><TH>Open</TH><TH>In Prog</TH><TH>Closed</TH><TH>Breached</TH><TH>SLA Rate</TH><TH>Avg Close</TH></tr></thead><tbody>{byType.map(function(t){return <tr key={t.id} style={{borderBottom:"1px solid #f1f5f9"}}><TD><Badge label={t.name} color={t.color}/></TD><TD><Badge label={PRI_META[t.priority]?.label} color={PRI_META[t.priority]?.color}/></TD><TD>{t.slaH}h</TD><TD bold>{t.total}</TD><TD><Badge label={t.open} color="#f59e0b"/></TD><TD><Badge label={t.inProg} color="#6366f1"/></TD><TD><Badge label={t.resolved} color="#10b981"/></TD><TD><Badge label={t.breached} color={t.breached>0?"#ef4444":"#10b981"}/></TD><TD><Badge label={t.slaRate+"%"} color={slaColor(t.slaRate)}/></TD><TD>{t.avgClose}h</TD></tr>;})}</tbody></table></Card>
    </div>}

    {view==="per_user"&&<div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginBottom:16}}>
        <Card><div style={{fontWeight:700,marginBottom:12}}>Tickets per Technician</div><ResponsiveContainer width="100%" height={220}><BarChart data={byUserStackChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Legend wrapperStyle={{fontSize:10}}/><Bar dataKey="resolved" fill="#10b981" name="Closed" stackId="a"/><Bar dataKey="open" fill="#f59e0b" name="Open" stackId="a"/><Bar dataKey="inProg" fill="#6366f1" name="In Prog" stackId="a"/></BarChart></ResponsiveContainer></Card>
        <Card><div style={{fontWeight:700,marginBottom:12}}>SLA Rate per Technician</div><ResponsiveContainer width="100%" height={220}><BarChart data={byUserSlaChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}} domain={[0,100]}/><Tooltip/><Bar dataKey="slaRate" radius={[4,4,0,0]}>{byUserSlaChart.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Bar></BarChart></ResponsiveContainer></Card>
      </div>
      <Card style={{padding:0,overflow:"auto",marginBottom:16}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:850}}><thead><tr style={{background:"#f8fafc"}}><TH>Technician</TH><TH>Total</TH><TH>Open</TH><TH>In Prog</TH><TH>Escalated</TH><TH>Closed</TH><TH>Breached</TH><TH>SLA Rate</TH><TH>Avg Close</TH><TH>Avg Create</TH></tr></thead><tbody>{byUser.map(function(t){return <tr key={t.id} style={{borderBottom:"1px solid #f1f5f9"}}><TD><div style={{display:"flex",gap:8,alignItems:"center"}}><Avatar name={t.name} id={t.id} size={26}/><div><div style={{fontWeight:600,fontSize:12}}>{t.name}</div><div style={{fontSize:10,color:"#94a3b8"}}>{ROLE_META[t.role]?.label}</div></div></div></TD><TD bold>{t.total}</TD><TD><Badge label={t.open} color="#f59e0b"/></TD><TD><Badge label={t.inProg} color="#6366f1"/></TD><TD><Badge label={t.escalated} color="#ef4444"/></TD><TD><Badge label={t.resolved} color="#10b981"/></TD><TD><Badge label={t.breached} color={t.breached>0?"#ef4444":"#10b981"}/></TD><TD><Badge label={t.slaRate+"%"} color={slaColor(t.slaRate)}/></TD><TD>{t.avgClose}h</TD><TD>{t.createMins}m</TD></tr>;})}</tbody></table></Card>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>{byUser.filter(function(u){return u.total>0;}).map(function(u){return <Card key={u.id}><div style={{display:"flex",gap:8,alignItems:"center",marginBottom:12}}><Avatar name={u.name} id={u.id} size={28}/><div><div style={{fontWeight:700,fontSize:13}}>{u.name}</div><div style={{fontSize:10,color:"#94a3b8"}}>Avg time per status</div></div></div>{u.avgStatus.map(function(s){return <div key={s.s} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:"1px solid #f8fafc"}}><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:7,height:7,borderRadius:"50%",background:STATUS_META[s.s].color}}/><span style={{fontSize:11,color:"#475569"}}>{s.s}</span></div><span style={{fontSize:11,fontWeight:600,color:"#1e293b"}}>{s.h}h</span></div>;})}</Card>;})}</div>
    </div>}

    {view==="per_client"&&<div>
      {byClient.length===0&&<Card><div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No client ticket data yet.</div></Card>}
      {byClient.length>0&&<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginBottom:16}}>
          <Card><div style={{fontWeight:700,marginBottom:12}}>Tickets per Client</div><ResponsiveContainer width="100%" height={220}><BarChart data={byClientVolChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="total" radius={[4,4,0,0]}>{byClientVolChart.map(function(_,i){return <Cell key={i} fill={PAL[i%PAL.length]}/>;})}</Bar></BarChart></ResponsiveContainer></Card>
          <Card><div style={{fontWeight:700,marginBottom:12}}>SLA Rate per Client</div><ResponsiveContainer width="100%" height={220}><BarChart data={byClientSlaChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}} domain={[0,100]}/><Tooltip/><Bar dataKey="slaRate" radius={[4,4,0,0]}>{byClientSlaChart.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Bar></BarChart></ResponsiveContainer></Card>
        </div>
        <Card style={{padding:0,overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:650}}><thead><tr style={{background:"#f8fafc"}}><TH>Client</TH><TH>Industry</TH><TH>Total</TH><TH>Open</TH><TH>Closed</TH><TH>Breached</TH><TH>SLA Rate</TH><TH>Avg Close</TH></tr></thead><tbody>{byClient.map(function(c,i){return <tr key={c.id} style={{borderBottom:"1px solid #f1f5f9"}}><TD><div style={{display:"flex",gap:8,alignItems:"center"}}><div style={{width:28,height:28,borderRadius:6,background:PAL[i%PAL.length],display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:12}}>{c.name[0]}</div><span style={{fontWeight:600}}>{c.name}</span></div></TD><TD>{c.industry||"—"}</TD><TD bold>{c.total}</TD><TD><Badge label={c.open} color="#f59e0b"/></TD><TD><Badge label={c.resolved} color="#10b981"/></TD><TD><Badge label={c.breached} color={c.breached>0?"#ef4444":"#10b981"}/></TD><TD><Badge label={c.slaRate+"%"} color={slaColor(c.slaRate)}/></TD><TD>{c.avgClose}h</TD></tr>;})}</tbody></table></Card>
      </>}
    </div>}

    {view==="per_location"&&<div>
      {byLocation.length===0&&<Card><div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No location ticket data yet.</div></Card>}
      {byLocation.length>0&&<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginBottom:16}}>
          <Card><div style={{fontWeight:700,marginBottom:12}}>Tickets per Location</div><ResponsiveContainer width="100%" height={220}><BarChart data={byLocVolChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:9}} angle={-15} textAnchor="end" height={45}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="total" radius={[4,4,0,0]}>{byLocVolChart.map(function(_,i){return <Cell key={i} fill={PAL[i%PAL.length]}/>;})}</Bar></BarChart></ResponsiveContainer></Card>
          <Card><div style={{fontWeight:700,marginBottom:12}}>SLA Rate per Location</div><ResponsiveContainer width="100%" height={220}><BarChart data={byLocSlaChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:9}} angle={-15} textAnchor="end" height={45}/><YAxis tick={{fontSize:10}} domain={[0,100]}/><Tooltip/><Bar dataKey="slaRate" radius={[4,4,0,0]}>{byLocSlaChart.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Bar></BarChart></ResponsiveContainer></Card>
        </div>
        <Card style={{padding:0,overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:700}}><thead><tr style={{background:"#f8fafc"}}><TH>Location</TH><TH>Client</TH><TH>Address</TH><TH>Total</TH><TH>Open</TH><TH>Closed</TH><TH>Breached</TH><TH>SLA Rate</TH><TH>Avg Close</TH></tr></thead><tbody>{byLocation.map(function(l){return <tr key={l.id} style={{borderBottom:"1px solid #f1f5f9"}}><TD><div style={{display:"flex",gap:6,alignItems:"center"}}><span style={{fontSize:14}}>📍</span><span style={{fontWeight:600}}>{l.locName}</span></div></TD><TD>{l.clientName}</TD><td style={{padding:"9px 12px",fontSize:11,color:"#64748b",maxWidth:180,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{l.address}</td><TD bold>{l.total}</TD><TD><Badge label={l.open} color="#f59e0b"/></TD><TD><Badge label={l.resolved} color="#10b981"/></TD><TD><Badge label={l.breached} color={l.breached>0?"#ef4444":"#10b981"}/></TD><TD><Badge label={l.slaRate+"%"} color={slaColor(l.slaRate)}/></TD><TD>{l.avgClose}h</TD></tr>;})}</tbody></table></Card>
      </>}
    </div>}

    {view==="sla"&&<div>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
        <Stat label="Overall SLA Rate" value={totalSlaRate+"%"} icon="🎯" color={slaColor(totalSlaRate)} sub={totalBreached+" breaches"}/>
        <Stat label="Avg Close Time" value={avgCloseAll+"h"} icon="⏱" color="#0ea5e9"/>
        <Stat label="Avg Create Time" value={avgCreateAll+"m"} icon="📝" color="#8b5cf6"/>
        <Stat label="SLA Met" value={active.length-totalBreached} icon="✅" color="#10b981" sub={"out of "+active.length}/>
        <Stat label="Critical Breaches" value={active.filter(function(t){return t.slaBreached&&t.priority==="critical";}).length} icon="🚨" color="#dc2626"/>
      </div>
      <Card style={{marginBottom:16}}>
        <div style={{fontWeight:800,fontSize:14,color:"#1e293b",marginBottom:4}}>📊 SLA Compliance by Status</div>
        <div style={{fontSize:12,color:"#64748b",marginBottom:16}}>Percentage of tickets within the configured SLA window per status, counting only assignee shift hours.</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12,marginBottom:20}}>
          {ALL_STATUSES.filter(function(s){return statusSla[s]!==null&&statusSla[s]!==undefined;}).map(function(status){
            var sm=STATUS_META[status]; var st=statusSlaStats(status); var c=slaColor(st.rate);
            return <div key={status} style={{background:sm.bg,border:"1px solid "+sm.color+"44",borderRadius:12,padding:16}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <div style={{width:10,height:10,borderRadius:"50%",background:sm.color,flexShrink:0}}/>
                <div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>{status}</div>
                <div style={{marginLeft:"auto",fontSize:10,color:"#64748b",fontWeight:600}}>≤{statusSla[status]}h</div>
              </div>
              <div style={{fontSize:32,fontWeight:800,color:c,lineHeight:1,marginBottom:6}}>{st.rate}<span style={{fontSize:16,fontWeight:600,color:"#94a3b8"}}>%</span></div>
              <div style={{height:7,background:"#e2e8f0",borderRadius:4,overflow:"hidden",marginBottom:8}}><div style={{height:"100%",width:st.rate+"%",background:c,borderRadius:4}}/></div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}>
                <span style={{color:"#10b981",fontWeight:600}}>✓ {st.met} met</span>
                <span style={{color:st.breached>0?"#ef4444":"#94a3b8",fontWeight:600}}>✗ {st.breached} breached</span>
                <span style={{color:"#94a3b8"}}>{st.total} total</span>
              </div>
            </div>;
          })}
        </div>
        <div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>SLA % Across Statuses</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={ALL_STATUSES.filter(function(s){return statusSla[s]!==null&&statusSla[s]!==undefined;}).map(function(status){ var st=statusSlaStats(status); return {status,rate:st.rate}; })}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
            <XAxis dataKey="status" tick={{fontSize:11}}/>
            <YAxis tick={{fontSize:10}} domain={[0,100]} unit="%"/>
            <Tooltip formatter={function(v){return [v+"%","SLA Compliance"];}}/>
            <Bar dataKey="rate" radius={[5,5,0,0]} label={{position:"top",fontSize:10,formatter:function(v){return v+"%";}}}>
              {ALL_STATUSES.filter(function(s){return statusSla[s]!==null&&statusSla[s]!==undefined;}).map(function(s,i){ var st=statusSlaStats(s); return <Cell key={i} fill={slaColor(st.rate)}/>; })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        <Card><div style={{fontWeight:700,marginBottom:12}}>SLA Rate by Type</div><ResponsiveContainer width="100%" height={220}><BarChart data={byTypeSlaChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:9}} angle={-15} textAnchor="end" height={45}/><YAxis tick={{fontSize:10}} domain={[0,100]}/><Tooltip/><Bar dataKey="slaRate" radius={[4,4,0,0]}>{byTypeSlaChart.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Bar></BarChart></ResponsiveContainer></Card>
        <Card><div style={{fontWeight:700,marginBottom:12}}>SLA Rate per Technician</div><ResponsiveContainer width="100%" height={220}><BarChart data={byUserSlaChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}} domain={[0,100]}/><Tooltip/><Bar dataKey="slaRate" radius={[4,4,0,0]}>{byUserSlaChart.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Bar></BarChart></ResponsiveContainer></Card>
      </div>
      <Card style={{marginBottom:16}}><div style={{fontWeight:700,marginBottom:12}}>Avg Close Time per Technician</div><ResponsiveContainer width="100%" height={200}><BarChart data={byUserCloseChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="avgClose" fill="#0ea5e9" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></Card>
      <Card><div style={{fontWeight:700,marginBottom:14}}>Average Time per Status</div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10}}>{avgPerStatus.map(function(s){return <div key={s.status} style={{background:STATUS_META[s.status].bg,border:"1px solid "+STATUS_META[s.status].color+"44",borderRadius:10,padding:14,textAlign:"center"}}><div style={{fontSize:11,fontWeight:700,color:STATUS_META[s.status].color,textTransform:"uppercase",marginBottom:4}}>{s.status}</div><div style={{fontSize:24,fontWeight:800,color:"#1e293b"}}>{s.avgH}<span style={{fontSize:12,fontWeight:400,color:"#64748b"}}>h</span></div><div style={{fontSize:11,color:"#64748b",marginTop:2}}>{s.count} tickets</div></div>;})}</div></Card>
    </div>}
  </div>;
}

// ── USERS ─────────────────────────────────────────────────────────────────────
function PageUsers(p){
  var users=p.users; var companies=p.companies; var setUsers=p.setUsers; var curUser=p.curUser; var addLog=p.addLog; var showToast=p.showToast; var schedules=p.schedules||{}; var setSchedules=p.setSchedules;
  var [modal,setModal]=useState(null); var [form,setForm]=useState({});
  var [emailStatus,setEmailStatus]=useState(null);
  function fld(k,v){setForm(function(prev){return Object.assign({},prev,{[k]:v});});}
  var pendingUsers=users.filter(function(u){return !u.active;});

  function approveUser(u){
    setUsers(function(prev){return prev.map(function(x){return x.id===u.id?Object.assign({},x,{active:true}):x;});});
    addLog("USER_APPROVED",u.id,u.name+" approved"); showToast("✅ Account approved!");
  }

  function handleScheduleChange(userId, sch){
    setSchedules(function(prev){ var n=Object.assign({},prev); if(sch===null){ delete n[userId]; }else{ n[userId]=sch; } return n; });
  }

  async function save(){
    if(!form.name||!form.email){showToast("Name and email required","error");return;}
    if(modal==="new"){
      var nu=Object.assign({},form,{id:uid(),createdAt:new Date().toISOString(),lastLogin:null});
      setUsers(function(prev){return prev.concat([nu]);});
      addLog("USER_CREATED",nu.id,"New user "+nu.name+" created");
      showToast("User created");
      setEmailStatus("sending");
      var defaultPw=getPassword(nu.id);
      var emailBody=["Hi "+nu.name+",","","An account has been created for you on the Hoptix IT Helpdesk portal.","","📧 Email:    "+nu.email,"🔑 Password: "+defaultPw,"","⚠️  For your security, please sign in and change your password immediately.","","— The Hoptix IT Team"].join("\n");
      var result=await callSendEmail({to:nu.email,subject:"🎉 Your Hoptix IT Helpdesk account is ready",body:emailBody});
      setEmailStatus(result.success?"sent":"failed");
      if(result.success){ addLog("EMAIL_SENT",nu.id,"Welcome email sent to "+nu.email); }
      else { showToast("⚠️ Welcome email failed to send","error"); }
    } else {
      var old=users.find(function(u){return u.id===form.id;});
      setUsers(function(prev){return prev.map(function(u){return u.id===form.id?Object.assign({},form):u;});});
      if(old&&old.role!==form.role) addLog("USER_ROLE_CHANGE",form.id,"Role: "+ROLE_META[old.role]?.label+" → "+ROLE_META[form.role]?.label);
      showToast("User updated");
    }
    setModal(null);
  }

  return <div>
    {pendingUsers.length>0&&<div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:12,padding:16,marginBottom:20}}><div style={{fontWeight:700,color:"#92400e",marginBottom:10,fontSize:13}}>⏳ {pendingUsers.length} Account{pendingUsers.length>1?"s":""} Awaiting Approval</div>{pendingUsers.map(function(u){return <div key={u.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#fff",padding:"10px 14px",borderRadius:8,border:"1px solid #fde68a",marginBottom:6}}><div style={{display:"flex",gap:10,alignItems:"center"}}><Avatar name={u.name} id={u.id} size={32}/><div><div style={{fontWeight:600,fontSize:13}}>{u.name}</div><div style={{fontSize:11,color:"#64748b"}}>{u.email}</div></div></div><div style={{display:"flex",gap:6}}><Btn size="sm" variant="success" onClick={function(){approveUser(u);}}>✅ Approve</Btn><Btn size="sm" variant="danger" onClick={function(){setUsers(function(prev){return prev.filter(function(x){return x.id!==u.id;});});showToast("Account rejected");}}>✕ Reject</Btn></div></div>;})}</div>}
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}><div style={{fontWeight:700,fontSize:14}}>User Management ({users.length})</div><Btn onClick={function(){setEmailStatus(null);setForm({name:"",email:"",role:"end_user",companyId:companies[0]?.id||"",phone:"",dept:"",active:true});setModal("new");}}>➕ Add User</Btn></div>
    <Card style={{padding:0,overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:700}}><thead><tr style={{background:"#f8fafc"}}>{["User","Email","Role","Company","Schedule","Status","Actions"].map(function(h){return <th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0"}}>{h}</th>;})}</tr></thead><tbody>{users.map(function(u){ var co=companies.find(function(c){return c.id===u.companyId;}); var rm=ROLE_META[u.role]; var sch=schedules[u.id]||null; var isIT=IT_ROLES.includes(u.role); return <tr key={u.id} style={{borderBottom:"1px solid #f1f5f9"}}><td style={{padding:"10px 12px"}}><div style={{display:"flex",gap:8,alignItems:"center"}}><Avatar name={u.name} id={u.id} size={30}/><div><div style={{fontWeight:600,fontSize:12}}>{u.name}</div><div style={{fontSize:10,color:"#94a3b8"}}>Last: {ago(u.lastLogin)}</div></div></div></td><td style={{padding:"10px 12px",fontSize:12}}>{u.email}</td><td style={{padding:"10px 12px"}}><Badge label={rm?.label||u.role} color={rm?.color||"#6366f1"}/></td><td style={{padding:"10px 12px",fontSize:12}}>{co?.name||"—"}</td><td style={{padding:"10px 12px",fontSize:11,color:isIT?sch?"#0369a1":"#94a3b8":"#e2e8f0"}}>{isIT?(sch?<span title={fmtSchedule(sch)}>🗓 {sch.days.map(function(d){return DOW_LABELS[d];}).join(", ")} {fmtHour(sch.startHour)}–{fmtHour(sch.endHour)}</span>:"No schedule"):"—"}</td><td style={{padding:"10px 12px"}}><Badge label={u.active?"Active":"Pending"} color={u.active?"#10b981":"#f59e0b"}/></td><td style={{padding:"10px 12px"}}><div style={{display:"flex",gap:4}}><Btn size="sm" variant="ghost" onClick={function(){setEmailStatus(null);setForm(Object.assign({},u));setModal("edit");}}>✏️</Btn><Btn size="sm" variant={u.active?"warning":"success"} onClick={function(){setUsers(function(prev){return prev.map(function(x){return x.id===u.id?Object.assign({},x,{active:!x.active}):x;});});showToast(u.active?"Deactivated":"Activated");}}>{u.active?"Disable":"Enable"}</Btn>{u.id!==curUser.id&&<Btn size="sm" variant="danger" onClick={function(){setUsers(function(prev){return prev.filter(function(x){return x.id!==u.id;});});addLog("USER_DELETED",u.id,"User "+u.name+" deleted");showToast("Deleted");}}>🗑</Btn>}</div></td></tr>; })}</tbody></table></Card>
    {modal&&<Modal title={modal==="new"?"Add User":"Edit User"} onClose={function(){setModal(null);}}>
      <FInput label="Full Name *" value={form.name||""} onChange={function(e){fld("name",e.target.value);}}/>
      <FInput label="Email *" value={form.email||""} onChange={function(e){fld("email",e.target.value);}} type="email"/>
      <FInput label="Phone" value={form.phone||""} onChange={function(e){fld("phone",e.target.value);}}/>
      <FInput label="Department" value={form.dept||""} onChange={function(e){fld("dept",e.target.value);}}/>
      <FSelect label="Role" value={form.role||"end_user"} onChange={function(e){fld("role",e.target.value);}} options={OPT_ROLES}/>
      <FSelect label="Company" value={form.companyId||""} onChange={function(e){fld("companyId",e.target.value);}} options={optCompanies(companies)}/>
      {IT_ROLES.includes(form.role)&&<ScheduleEditor userId={form.id||"__new__"} schedules={schedules} onChange={handleScheduleChange}/>}
      {modal==="new"&&<div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#0369a1"}}>📧 A welcome email with login credentials will be sent upon creation.</div>}
      {emailStatus==="sending"&&<div style={{background:"#fef3c7",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#92400e",display:"flex",alignItems:"center",gap:8}}><span style={{display:"inline-block",width:12,height:12,border:"2px solid #92400e",borderTop:"2px solid transparent",borderRadius:"50%",animation:"spin .7s linear infinite"}}/> Sending welcome email…</div>}
      {emailStatus==="sent"&&<div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#166534"}}>✅ Welcome email sent!</div>}
      {emailStatus==="failed"&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#dc2626"}}>⚠️ Welcome email failed. Account was still created.</div>}
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <Btn variant="ghost" onClick={function(){setModal(null);}}>Cancel</Btn>
        <Btn onClick={save}>{modal==="new"?"Create & Send Welcome Email":"Save"}</Btn>
      </div>
    </Modal>}
  </div>;
}

// ── COMPANIES ─────────────────────────────────────────────────────────────────
function PageCompanies(p){ var companies=p.companies; var users=p.users; var setCompanies=p.setCompanies; var addLog=p.addLog; var showToast=p.showToast;
  var [modal,setModal]=useState(null); var [form,setForm]=useState({});
  function fld(k,v){setForm(function(prev){return Object.assign({},prev,{[k]:v});});}
  function save(){if(!form.name){showToast("Name required","error");return;}if(modal==="new"){var nc=Object.assign({},form,{id:uid(),createdAt:new Date().toISOString()});setCompanies(function(prev){return prev.concat([nc]);});addLog("COMPANY_CREATED",nc.id,'"'+nc.name+'" created');showToast("Created");}else{setCompanies(function(prev){return prev.map(function(c){return c.id===form.id?Object.assign({},form):c;});});showToast("Updated");}setModal(null);}
  return <div><div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}><div style={{fontWeight:700,fontSize:14}}>Company Profiles ({companies.length})</div><Btn onClick={function(){setForm({name:"",domain:"",address:"",phone:"",industry:"",size:""});setModal("new");}}>➕ Add Company</Btn></div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>{companies.map(function(c){ var members=users.filter(function(u){return u.companyId===c.id;}); return <Card key={c.id}><div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}><div style={{width:44,height:44,borderRadius:10,background:avCol(c.id),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:16}}>{c.name[0]}</div><div style={{display:"flex",gap:6}}><Btn size="sm" variant="ghost" onClick={function(){setForm(Object.assign({},c));setModal("edit");}}>✏️</Btn><Btn size="sm" variant="danger" onClick={function(){setCompanies(function(prev){return prev.filter(function(x){return x.id!==c.id;});});addLog("COMPANY_DELETED",c.id,'"'+c.name+'" deleted');showToast("Deleted");}}>🗑</Btn></div></div><div style={{fontWeight:700,color:"#1e293b",marginBottom:4}}>{c.name}</div><div style={{fontSize:11,color:"#64748b"}}>🌐 {c.domain}</div><div style={{fontSize:11,color:"#64748b"}}>📍 {c.address}</div><div style={{fontSize:11,color:"#64748b"}}>📞 {c.phone}</div><div style={{fontSize:11,color:"#64748b",marginBottom:10}}>🏭 {c.industry} · {c.size}</div><div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{members.slice(0,5).map(function(m){return <Avatar key={m.id} name={m.name} id={m.id} size={24}/>;})}{members.length>5&&<div style={{fontSize:10,color:"#94a3b8",alignSelf:"center"}}>+{members.length-5}</div>}</div></Card>; })}</div>{modal&&<Modal title={modal==="new"?"Add Company":"Edit Company"} onClose={function(){setModal(null);}}><FInput label="Name *" value={form.name||""} onChange={function(e){fld("name",e.target.value);}}/><FInput label="Domain" value={form.domain||""} onChange={function(e){fld("domain",e.target.value);}}/><FInput label="Address" value={form.address||""} onChange={function(e){fld("address",e.target.value);}}/><FInput label="Phone" value={form.phone||""} onChange={function(e){fld("phone",e.target.value);}}/><FInput label="Industry" value={form.industry||""} onChange={function(e){fld("industry",e.target.value);}}/><FInput label="Size" value={form.size||""} onChange={function(e){fld("size",e.target.value);}}/><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setModal(null);}}>Cancel</Btn><Btn onClick={save}>{modal==="new"?"Create":"Save"}</Btn></div></Modal>}</div>;
}

// ── CLIENTS ───────────────────────────────────────────────────────────────────
function PageClients(p){ var clients=p.clients; var setClients=p.setClients; var companies=p.companies; var addLog=p.addLog; var showToast=p.showToast;
  var [modal,setModal]=useState(null); var [selCl,setSelCl]=useState(null); var [form,setForm]=useState({}); var [lForm,setLForm]=useState({});
  function fld(k,v){setForm(function(prev){return Object.assign({},prev,{[k]:v});});} function lfld(k,v){setLForm(function(prev){return Object.assign({},prev,{[k]:v});});}
  function saveCl(){if(!form.name){showToast("Name required","error");return;}if(modal==="newCl"){var nc=Object.assign({},form,{id:uid(),locations:[]});setClients(function(prev){return prev.concat([nc]);});addLog("CLIENT_CREATED",nc.id,"Client \""+nc.name+"\" added");showToast("Client added");}else{setClients(function(prev){return prev.map(function(c){return c.id===form.id?Object.assign({},form,{locations:c.locations}):c;});});showToast("Updated");}setModal(null);}
  function saveLoc(){if(!lForm.name||!lForm.address){showToast("Name and address required","error");return;}if(modal==="newLoc"){var nl=Object.assign({},lForm,{id:uid()});setClients(function(prev){return prev.map(function(c){return c.id===selCl?Object.assign({},c,{locations:c.locations.concat([nl])}):c;});});addLog("LOCATION_ADDED",selCl,"Location \""+nl.name+"\" added");showToast("Location added");}else{setClients(function(prev){return prev.map(function(c){return c.id===selCl?Object.assign({},c,{locations:c.locations.map(function(l){return l.id===lForm.id?Object.assign({},lForm):l;})}):c;});});showToast("Updated");}setModal(null);}
  return <div><div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}><div style={{fontWeight:700,fontSize:14}}>Clients &amp; Locations</div><Btn onClick={function(){setForm({name:"",email:"",phone:"",industry:"",companyId:companies[0]?.id||""});setModal("newCl");}}>➕ Add Client</Btn></div><div style={{display:"flex",flexDirection:"column",gap:16}}>{clients.map(function(cl){ var co=companies.find(function(c){return c.id===cl.companyId;}); return <Card key={cl.id}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}><div style={{display:"flex",gap:14,alignItems:"center"}}><div style={{width:48,height:48,borderRadius:12,background:avCol(cl.id),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:18}}>{cl.name[0]}</div><div><div style={{fontWeight:700,color:"#1e293b",fontSize:14}}>{cl.name}</div><div style={{fontSize:11,color:"#64748b"}}>📧 {cl.email} · 📞 {cl.phone}</div><div style={{fontSize:11,color:"#64748b"}}>🏭 {cl.industry}{co?" · "+co.name:""}</div></div></div><div style={{display:"flex",gap:6}}><Btn size="sm" variant="ghost" onClick={function(){setForm(Object.assign({},cl));setModal("editCl");}}>✏️ Edit</Btn><Btn size="sm" variant="danger" onClick={function(){setClients(function(prev){return prev.filter(function(x){return x.id!==cl.id;});});addLog("CLIENT_DELETED",cl.id,"\""+cl.name+"\" removed");showToast("Removed");}}>🗑 Remove</Btn></div></div><div style={{background:"#f8fafc",borderRadius:10,padding:14}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><div style={{fontWeight:700,fontSize:12,color:"#475569"}}>📍 Locations ({cl.locations.length})</div><Btn size="sm" variant="primary" onClick={function(){setSelCl(cl.id);setLForm({name:"",address:"",floor:"",contact:""});setModal("newLoc");}}>➕ Add Location</Btn></div>{cl.locations.length===0&&<div style={{fontSize:12,color:"#94a3b8",textAlign:"center",padding:"12px 0"}}>No locations added yet.</div>}<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10}}>{cl.locations.map(function(loc){ return <div key={loc.id} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:8,padding:12}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}><div style={{fontWeight:700,fontSize:12,color:"#1e293b"}}>📍 {loc.name}</div><div style={{display:"flex",gap:4}}><Btn size="sm" variant="ghost" onClick={function(){setSelCl(cl.id);setLForm(Object.assign({},loc));setModal("editLoc");}}>✏️</Btn><Btn size="sm" variant="danger" onClick={function(){setClients(function(prev){return prev.map(function(c){return c.id===cl.id?Object.assign({},c,{locations:c.locations.filter(function(l){return l.id!==loc.id;})}):c;});});addLog("LOCATION_REMOVED",cl.id,"\""+loc.name+"\" removed");showToast("Removed");}}>🗑</Btn></div></div><div style={{fontSize:11,color:"#64748b"}}>📮 {loc.address}</div>{loc.floor&&<div style={{fontSize:11,color:"#64748b"}}>🏢 {loc.floor}</div>}{loc.contact&&<div style={{fontSize:11,color:"#64748b"}}>👤 {loc.contact}</div>}</div>; })}</div></div></Card>; })}</div>{(modal==="newCl"||modal==="editCl")&&<Modal title={modal==="newCl"?"Add Client":"Edit Client"} onClose={function(){setModal(null);}}><FInput label="Client Name *" value={form.name||""} onChange={function(e){fld("name",e.target.value);}}/><FInput label="Email" value={form.email||""} onChange={function(e){fld("email",e.target.value);}} type="email"/><FInput label="Phone" value={form.phone||""} onChange={function(e){fld("phone",e.target.value);}}/><FInput label="Industry" value={form.industry||""} onChange={function(e){fld("industry",e.target.value);}}/><FSelect label="Associated Company" value={form.companyId||""} onChange={function(e){fld("companyId",e.target.value);}} options={optCompaniesNone(companies)}/><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setModal(null);}}>Cancel</Btn><Btn onClick={saveCl}>{modal==="newCl"?"Add Client":"Save"}</Btn></div></Modal>}{(modal==="newLoc"||modal==="editLoc")&&<Modal title={modal==="newLoc"?"Add Location":"Edit Location"} onClose={function(){setModal(null);}}><FInput label="Location Name *" value={lForm.name||""} onChange={function(e){lfld("name",e.target.value);}} placeholder="e.g. HQ — New York"/><FInput label="Address *" value={lForm.address||""} onChange={function(e){lfld("address",e.target.value);}}/><FInput label="Floor / Area" value={lForm.floor||""} onChange={function(e){lfld("floor",e.target.value);}}/><FInput label="On-site Contact" value={lForm.contact||""} onChange={function(e){lfld("contact",e.target.value);}}/><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setModal(null);}}>Cancel</Btn><Btn onClick={saveLoc}>{modal==="newLoc"?"Add Location":"Save"}</Btn></div></Modal>}</div>;
}

// ── TICKET TYPES ──────────────────────────────────────────────────────────────
function PageTicketTypes(p){
  var ticketTypes=p.ticketTypes; var users=p.users; var setTicketTypes=p.setTicketTypes; var statusSla=p.statusSla; var setStatusSla=p.setStatusSla; var addLog=p.addLog; var showToast=p.showToast;
  var [modal,setModal]=useState(null); var [form,setForm]=useState({}); var [kwInput,setKwInput]=useState("");
  var [slaEdit,setSlaEdit]=useState(function(){ return Object.assign({},statusSla); });
  var [slaChanged,setSlaChanged]=useState(false);
  function fld(k,v){setForm(function(prev){return Object.assign({},prev,{[k]:v});});}
  function save(){if(!form.name){showToast("Name required","error");return;}if(modal==="new"){var nt=Object.assign({},form,{id:uid(),keywords:form.keywords||[]});setTicketTypes(function(prev){return prev.concat([nt]);});addLog("TICKET_TYPE_CREATED",nt.id,"Type \""+nt.name+"\" created");showToast("Created");}else{setTicketTypes(function(prev){return prev.map(function(t){return t.id===form.id?Object.assign({},form):t;});});showToast("Updated");}setModal(null);}
  function addKw(){if(kwInput.trim()){fld("keywords",(form.keywords||[]).concat([kwInput.trim()]));setKwInput("");}}
  function updateSlaField(status,val){ var n=Object.assign({},slaEdit); n[status]=val===""||val===null?null:parseFloat(val); setSlaEdit(n); setSlaChanged(true); }
  function saveSla(){ setStatusSla(slaEdit); addLog("SLA_UPDATED","system","Status SLA thresholds updated"); showToast("✅ Status SLA settings saved!"); setSlaChanged(false); }
  function resetSla(){ setSlaEdit(Object.assign({},DEFAULT_STATUS_SLA)); setSlaChanged(true); }
  var SLA_DESC={"Open":"Time allowed before a new ticket must be acknowledged","In Progress":"Time allowed for an agent to resolve once work begins","Pending":"Time allowed while waiting for requester response","Escalated":"Time allowed for senior staff to take action after escalation","Closed":"No SLA — ticket is closed"};
  return <div>
    <Card style={{marginBottom:24,borderTop:"3px solid #6366f1"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div><div style={{fontWeight:800,fontSize:15,color:"#1e293b"}}>⏱ Status SLA Thresholds</div><div style={{fontSize:12,color:"#64748b",marginTop:2}}>Hours allowed per status. SLA only counts during the assignee's scheduled shift hours.</div></div>
        <div style={{display:"flex",gap:8}}><Btn size="sm" variant="ghost" onClick={resetSla}>↺ Reset</Btn><Btn size="sm" variant={slaChanged?"primary":"ghost"} onClick={saveSla} style={{opacity:slaChanged?1:0.5}}>💾 Save SLA</Btn></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
        {ALL_STATUSES.map(function(status){
          var sm=STATUS_META[status]; var isClosed=status==="Closed"; var val=slaEdit[status];
          return <div key={status} style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:14}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}><div style={{width:10,height:10,borderRadius:"50%",background:sm.color,flexShrink:0}}/><div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>{status}</div>{!isClosed&&val!==null&&<Badge label={val+"h"} color={sm.color}/>}{isClosed&&<Badge label="No SLA" color="#94a3b8"/>}</div>
            <div style={{fontSize:11,color:"#64748b",marginBottom:10,lineHeight:1.5}}>{SLA_DESC[status]}</div>
            {isClosed?<div style={{fontSize:11,color:"#94a3b8",fontStyle:"italic"}}>Closed tickets do not have an SLA timer.</div>
              :<div style={{display:"flex",alignItems:"center",gap:8}}><input type="number" min="0.5" step="0.5" value={val===null||val===undefined?"":val} onChange={function(e){updateSlaField(status,e.target.value);}} style={{width:80,padding:"6px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#fff",boxSizing:"border-box"}}/><span style={{fontSize:12,color:"#64748b",fontWeight:600}}>hours</span>{slaEdit[status]!==DEFAULT_STATUS_SLA[status]&&<span style={{fontSize:10,color:"#f59e0b",fontWeight:700}}>modified</span>}</div>}
          </div>;
        })}
      </div>
      {slaChanged&&<div style={{marginTop:14,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#92400e"}}>⚠️ Unsaved changes. Click <strong>Save SLA</strong> to apply.</div>}
    </Card>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}><div style={{fontWeight:700,fontSize:14}}>Ticket Types ({ticketTypes.length})</div><Btn onClick={function(){setForm({name:"",priority:"medium",slaHours:24,color:"#6366f1",keywords:[],defaultAssignee:""});setModal("new");}}>➕ Add Type</Btn></div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:14}}>
      {ticketTypes.map(function(tt){ var asgn=users.find(function(u){return u.id===tt.defaultAssignee;}); return <Card key={tt.id}><div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><div style={{display:"flex",gap:8,alignItems:"center"}}><div style={{width:10,height:10,borderRadius:"50%",background:tt.color}}/><span style={{fontWeight:700,color:"#1e293b"}}>{tt.name}</span></div><div style={{display:"flex",gap:4}}><Btn size="sm" variant="ghost" onClick={function(){setForm(Object.assign({},tt,{keywords:(tt.keywords||[]).slice()}));setModal("edit");}}>✏️</Btn>{tt.name!=="Others"&&<Btn size="sm" variant="danger" onClick={function(){setTicketTypes(function(prev){return prev.filter(function(t){return t.id!==tt.id;});});addLog("TICKET_TYPE_DELETED",tt.id,"Type \""+tt.name+"\" deleted");showToast("Deleted");}}>🗑</Btn>}</div></div><div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}><Badge label={PRI_META[tt.priority]?.label||tt.priority} color={PRI_META[tt.priority]?.color||"#6366f1"}/><Badge label={"SLA "+tt.slaHours+"h"} color="#0ea5e9"/></div>{asgn&&<div style={{fontSize:11,color:"#64748b",marginBottom:6}}>👤 {asgn.name}</div>}<div style={{display:"flex",flexWrap:"wrap",gap:4}}>{(tt.keywords||[]).slice(0,5).map(function(k){return <span key={k} style={{background:"#f1f5f9",color:"#475569",fontSize:10,padding:"2px 6px",borderRadius:4}}>{k}</span>;})}{(tt.keywords||[]).length>5&&<span style={{fontSize:10,color:"#94a3b8"}}>+{(tt.keywords||[]).length-5}</span>}</div></Card>; })}
    </div>
    {modal&&<Modal title={modal==="new"?"Add Ticket Type":"Edit Ticket Type"} onClose={function(){setModal(null);}}><FInput label="Type Name *" value={form.name||""} onChange={function(e){fld("name",e.target.value);}}/><FSelect label="Priority" value={form.priority||"medium"} onChange={function(e){fld("priority",e.target.value);}} options={OPT_PRIORITY}/><FInput label="SLA Hours" value={form.slaHours||24} onChange={function(e){fld("slaHours",Number(e.target.value));}} type="number" min={1}/><FInput label="Color" value={form.color||"#6366f1"} onChange={function(e){fld("color",e.target.value);}} type="color"/><FSelect label="Default Assignee" value={form.defaultAssignee||""} onChange={function(e){fld("defaultAssignee",e.target.value);}} options={optAssignees(users)}/><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Keywords</label><div style={{display:"flex",gap:6,marginBottom:6}}><input value={kwInput} onChange={function(e){setKwInput(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")addKw();}} placeholder="e.g. printer, monitor" style={{flex:1,padding:"6px 10px",border:"1px solid #e2e8f0",borderRadius:6,fontSize:12,outline:"none"}}/><Btn size="sm" onClick={addKw}>Add</Btn></div><div style={{display:"flex",flexWrap:"wrap",gap:4}}>{(form.keywords||[]).map(function(k,i){return <span key={i} onClick={function(){fld("keywords",(form.keywords||[]).filter(function(_,j){return j!==i;}));}} style={{background:"#eef2ff",color:"#4338ca",fontSize:11,padding:"2px 8px",borderRadius:4,cursor:"pointer"}}>{k} ×</span>;})}</div></div><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setModal(null);}}>Cancel</Btn><Btn onClick={save}>{modal==="new"?"Create":"Save"}</Btn></div></Modal>}
  </div>;
}

// ── INTEGRATIONS ──────────────────────────────────────────────────────────────
function PageIntegrations(p){
  var [apiKey,  setApiKey]  = useState("");
  var [fromAddr,setFromAddr]= useState("");
  var [testTo,  setTestTo]  = useState("");
  var [sending, setSending] = useState(false);
  var [status,  setStatus]  = useState("");

  useEffect(function(){
    try{
      var raw=localStorage.getItem("hd_integrations");
      if(raw){
        var obj=JSON.parse(raw);
        if(obj&&obj.resend){
          if(obj.resend.apiKey)  setApiKey(obj.resend.apiKey);
          if(obj.resend.from)    setFromAddr(obj.resend.from);
        }
      }
    }catch(e){}
  },[]);

  function save(){
    try{
      var cur={};
      try{cur=JSON.parse(localStorage.getItem("hd_integrations")||"{}");}catch(e){}
      cur.resend={apiKey:apiKey.trim(),from:fromAddr.trim()};
      localStorage.setItem("hd_integrations",JSON.stringify(cur));
      setStatus("saved");
      if(p.showToast) p.showToast("✅ Settings saved!");
      if(p.addLog) try{p.addLog("INTEGRATIONS_UPDATED","system","Resend settings saved");}catch(e){}
    }catch(e){
      setStatus("error");
      if(p.showToast) p.showToast("Save failed: "+e.message,"error");
    }
  }

  async function runTest(){
    if(!testTo.trim()){if(p.showToast)p.showToast("Enter a recipient email","error");return;}
    setSending(true);setStatus("");
    try{
      var cfg={};
      try{cfg=JSON.parse(localStorage.getItem("hd_integrations")||"{}");}catch(e){}
      var key=(cfg.resend||{}).apiKey||"";
      var from=(cfg.resend||{}).from||"Hoptix IT <onboarding@resend.dev>";
      if(!key){if(p.showToast)p.showToast("Save your API key first","error");setSending(false);return;}
      var res=await fetch("https://api.resend.com/emails",{
        method:"POST",
        headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
        body:JSON.stringify({from:from,to:[testTo.trim()],subject:"Hoptix Test",text:"Your Resend integration is working!"})
      });
      var data=await res.json();
      if(res.ok&&data.id){setStatus("ok");if(p.showToast)p.showToast("📧 Test sent!");}
      else{setStatus("fail");if(p.showToast)p.showToast("⚠️ "+(data.message||data.name||"Failed"),"error");}
    }catch(e){
      setStatus("fail");if(p.showToast)p.showToast("⚠️ "+e.message,"error");
    }
    setSending(false);
  }

  var inp={width:"100%",padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#f8fafc",boxSizing:"border-box"};
  var lbl={display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4};

  return (
    <div style={{maxWidth:600}}>
      <div style={{fontWeight:800,fontSize:18,color:"#1e293b",marginBottom:4}}>🔌 Integrations</div>
      <div style={{fontSize:12,color:"#64748b",marginBottom:24}}>Configure your email provider. Credentials are stored in your browser.</div>
      <div style={{background:"#fff",borderRadius:12,border:"1px solid #e2e8f0",padding:24,borderTop:"3px solid #6366f1",boxShadow:"0 1px 4px rgba(0,0,0,.06)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:20}}>📧</span>
            <span style={{fontWeight:700,fontSize:15,color:"#1e293b"}}>Resend Email</span>
            <span style={{background:apiKey?"#d1fae5":"#fef3c7",color:apiKey?"#065f46":"#92400e",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700}}>
              {apiKey?"✓ Configured":"⚠ Not set"}
            </span>
          </div>
          <a href="https://resend.com" target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:"#6366f1",fontWeight:700,textDecoration:"none"}}>resend.com ↗</a>
        </div>
        <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#0369a1",lineHeight:1.8}}>
          1. Sign up at resend.com → <strong>API Keys</strong> → create key with Sending access<br/>
          2. Use <strong>onboarding@resend.dev</strong> as From (free plan), or verify your own domain
        </div>
        <div style={{marginBottom:14}}><label style={lbl}>API Key</label><input type="password" value={apiKey} onChange={function(e){setApiKey(e.target.value);}} placeholder="re_xxxxxxxxxxxxxxxx" style={inp}/></div>
        <div style={{marginBottom:20}}><label style={lbl}>From Address</label><input type="text" value={fromAddr} onChange={function(e){setFromAddr(e.target.value);}} placeholder="Hoptix IT <onboarding@resend.dev>" style={inp}/></div>
        <button onClick={save} style={{padding:"9px 22px",background:"#6366f1",color:"#fff",border:"none",borderRadius:8,fontWeight:700,fontSize:13,cursor:"pointer",marginBottom:16}}>💾 Save Settings</button>
        {status==="saved"&&<div style={{marginBottom:16,padding:"8px 14px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,fontSize:12,color:"#166534"}}>✅ Settings saved.</div>}
        {status==="error"&&<div style={{marginBottom:16,padding:"8px 14px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,fontSize:12,color:"#dc2626"}}>❌ Failed to save.</div>}
        <div style={{borderTop:"1px solid #f1f5f9",paddingTop:16}}>
          <label style={lbl}>Send Test Email</label>
          <div style={{display:"flex",gap:8,marginBottom:8}}>
            <input type="email" value={testTo} onChange={function(e){setTestTo(e.target.value);}} placeholder="recipient@example.com" style={{flex:1,padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#f8fafc",boxSizing:"border-box"}}/>
            <button onClick={runTest} disabled={sending||!apiKey} style={{padding:"9px 18px",background:apiKey?"#6366f1":"#e2e8f0",color:apiKey?"#fff":"#94a3b8",border:"none",borderRadius:8,fontWeight:700,fontSize:13,cursor:apiKey?"pointer":"not-allowed",flexShrink:0}}>
              {sending?"⏳ Sending…":"📤 Test"}
            </button>
          </div>
          {status==="ok"  &&<div style={{padding:"8px 14px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,fontSize:12,color:"#166534"}}>✅ Test email delivered!</div>}
          {status==="fail"&&<div style={{padding:"8px 14px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,fontSize:12,color:"#dc2626"}}>❌ Send failed — check your API key and From address.</div>}
        </div>
        <div style={{marginTop:16,padding:"10px 14px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,fontSize:12,color:"#92400e"}}>
          🔒 API key stored in browser localStorage. Use server-side env variables for production.
        </div>
      </div>
    </div>
  );
}

// ── ACTIVITY LOG ──────────────────────────────────────────────────────────────
function PageActivityLog(p){ var logs=p.logs; var users=p.users;
  var [filter,setFilter]=useState("");
  function fu(id){return users.find(function(x){return x.id===id;});}
  var filtered=filter?logs.filter(function(l){return l.action===filter;}):logs;
  return <div><div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center"}}><div style={{fontWeight:700,fontSize:14,flex:1}}>Activity Log ({filtered.length})</div><select value={filter} onChange={function(e){setFilter(e.target.value);}} style={{padding:"7px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}><option value="">All Actions</option>{Object.keys(ACTION_META).map(function(k){return <option key={k} value={k}>{ACTION_META[k].label}</option>;})}</select></div><Card style={{padding:0}}>{filtered.map(function(log,i){ var am=ACTION_META[log.action]||{icon:"📝",color:"#6366f1",label:log.action}; var actor=fu(log.userId); return <div key={log.id} style={{display:"flex",gap:12,padding:"12px 16px",borderBottom:i<filtered.length-1?"1px solid #f1f5f9":"none",alignItems:"flex-start"}}><div style={{width:32,height:32,borderRadius:8,background:am.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{am.icon}</div><div style={{flex:1}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><Badge label={am.label} color={am.color}/><span style={{fontSize:10,color:"#94a3b8"}}>{fdt(log.timestamp)}</span></div><div style={{fontSize:12,color:"#334155",marginTop:4}}>{log.detail}</div>{actor&&<div style={{fontSize:11,color:"#94a3b8",marginTop:4,display:"flex",alignItems:"center",gap:4}}><Avatar name={actor.name} id={actor.id} size={14}/>By {actor.name}</div>}</div></div>; })}{filtered.length===0&&<div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No activity found</div>}</Card></div>;
}
