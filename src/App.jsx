import { useState, useEffect, useMemo, useCallback } from "react";
import React from "react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area, LineChart, Line } from "recharts";

const PAL = ["#6366f1","#8b5cf6","#0ea5e9","#10b981","#f59e0b","#ef4444","#ec4899","#f97316"];
const FUNCTIONS_URL = "https://byuvyyycweowdupyvjgy.supabase.co/functions/v1";

const STATUS_META = { "Open":{color:"#f59e0b",bg:"#fef3c7"}, "In Progress":{color:"#6366f1",bg:"#eef2ff"}, "Resolved":{color:"#10b981",bg:"#d1fae5"}, "Escalated":{color:"#ef4444",bg:"#fee2e2"}, "Closed":{color:"#94a3b8",bg:"#f1f5f9"} };
const ALL_STATUSES = ["Open","In Progress","Resolved","Escalated","Closed"];
const PRI_META = { critical:{color:"#dc2626",bg:"#fee2e2",label:"Critical",slaHours:1}, high:{color:"#ef4444",bg:"#fef2f2",label:"High",slaHours:4}, medium:{color:"#f59e0b",bg:"#fffbeb",label:"Medium",slaHours:24}, low:{color:"#10b981",bg:"#f0fdf4",label:"Low",slaHours:72} };
// SLA hours allowed per status stage
const STATUS_SLA = { "Open":2, "In Progress":8, "Pending":24, "Escalated":1, "Resolved":48, "Closed":null };
const ROLE_META = { admin:{label:"Administrator",color:"#dc2626"}, it_manager:{label:"IT Manager",color:"#7c3aed"}, it_technician:{label:"IT Technician",color:"#2563eb"}, end_user:{label:"End User",color:"#059669"} };

const uid   = function(){ return "id_"+Date.now()+"_"+Math.random().toString(36).slice(2,6); };
const hAgo  = function(h){ return new Date(Date.now()-h*3600000).toISOString(); };
const dAgo  = function(d){ return new Date(Date.now()-d*86400000).toISOString(); };
const fdt   = function(iso){ return iso?new Date(iso).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit"}):"—"; };
const fdtFull = function(iso){ return iso?new Date(iso).toLocaleString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"}):"—"; };
const ago   = function(iso){ if(!iso)return"—"; var m=Math.floor((Date.now()-new Date(iso))/60000); if(m<1)return"just now"; if(m<60)return m+"m ago"; var h=Math.floor(m/60); if(h<24)return h+"h ago"; return Math.floor(h/24)+"d ago"; };
const inits = function(n){ if(!n)return"??"; var p=n.trim().split(" ").filter(Boolean); return p.length>=2?(p[0][0]+p[1][0]).toUpperCase():n.slice(0,2).toUpperCase(); };
const avCol = function(id){ return PAL[Math.abs((id||"").split("").reduce(function(a,c){return a+c.charCodeAt(0);},0))%PAL.length]; };
const rnd   = function(a,b){ return Math.floor(Math.random()*(b-a+1))+a; };
const fmtMs = function(mins){ if(!mins&&mins!==0)return"—"; var m=Math.floor(mins); var s=Math.round((mins-m)*60); return m+"m "+s+"s"; };
// returns {hoursAllowed, hoursSpent, pct, breached, remaining} for the current status of a ticket
function getStatusSla(ticket){
  var allowed=STATUS_SLA[ticket.status];
  if(allowed===null||allowed===undefined) return null;
  // find when the ticket entered current status
  var hist=(ticket.statusHistory||[]);
  var entry=null;
  for(var i=hist.length-1;i>=0;i--){ if(hist[i].status===ticket.status){entry=hist[i].timestamp;break;} }
  if(!entry) entry=ticket.updatedAt||ticket.createdAt;
  var spent=(Date.now()-new Date(entry).getTime())/3600000;
  var pct=Math.min(100,Math.round(spent/allowed*100));
  var breached=spent>allowed;
  var remaining=Math.max(0,allowed-spent);
  return {hoursAllowed:allowed,hoursSpent:parseFloat(spent.toFixed(1)),pct,breached,remaining:parseFloat(remaining.toFixed(1)),enteredAt:entry};
}

async function callSendEmail(opts) {
  try {
    var res = await fetch(FUNCTIONS_URL+"/send-email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(opts)});
    var data = await res.json();
    if(!res.ok) throw new Error(data.error||"Failed");
    return {success:true};
  } catch(e){ return {success:false,error:e.message}; }
}
async function callSendSms(opts) {
  try {
    var res = await fetch(FUNCTIONS_URL+"/send-sms",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(opts)});
    var data = await res.json();
    if(!res.ok) throw new Error(data.error||"Failed");
    return {success:true};
  } catch(e){ return {success:false,error:e.message}; }
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

const SEED_COMPANIES = [
  {id:"c1",name:"IT Solutions Corp",domain:"itsolutions.com",address:"123 Tech Ave, San Francisco, CA",phone:"+1-555-0100",industry:"Technology",size:"50-100",createdAt:dAgo(100)},
  {id:"c2",name:"Acme Corp",domain:"acmecorp.com",address:"456 Business Blvd, New York, NY",phone:"+1-555-0200",industry:"Manufacturing",size:"500-1000",createdAt:dAgo(90)},
  {id:"c3",name:"TechStart Inc",domain:"techstart.com",address:"789 Startup Lane, Austin, TX",phone:"+1-555-0300",industry:"Software",size:"10-50",createdAt:dAgo(85)},
];
const SEED_CLIENTS = [
  {id:"cl1",name:"Globex Corporation",companyId:"c2",email:"contact@globex.com",phone:"+1-555-1001",industry:"Finance",locations:[{id:"loc1",name:"HQ — New York",address:"456 Business Blvd, NY 10001",floor:"Floors 10-15",contact:"Alice Brown"},{id:"loc2",name:"Branch — Chicago",address:"789 Commerce St, Chicago IL 60601",floor:"Floor 3",contact:"Tom Davis"}]},
  {id:"cl2",name:"Initech Solutions",companyId:"c3",email:"info@initech.com",phone:"+1-555-2001",industry:"Consulting",locations:[{id:"loc4",name:"Main Office — Austin",address:"789 Startup Lane, Austin TX 78701",floor:"Floor 2",contact:"Jane Smith"},{id:"loc5",name:"Remote — Dallas",address:"321 Tech Park, Dallas TX 75201",floor:"Floor 1",contact:"Rick Moore"}]},
  {id:"cl3",name:"Umbrella IT Services",companyId:"c1",email:"support@umbrella.com",phone:"+1-555-3001",industry:"Technology",locations:[{id:"loc6",name:"SF Headquarters",address:"123 Tech Ave, San Francisco CA 94107",floor:"All Floors",contact:"Sarah Johnson"}]},
  {id:"cl4",name:"Acme Internal IT",companyId:"c2",email:"itdesk@acmecorp.com",phone:"+1-555-4001",industry:"Manufacturing",locations:[{id:"loc7",name:"Factory Floor — NY",address:"456 Industrial Ave, Brooklyn NY 11201",floor:"Ground",contact:"Bob Wilson"},{id:"loc8",name:"Admin Building",address:"456 Business Blvd, New York NY 10001",floor:"Floor 5",contact:"John Doe"}]},
];
const SEED_USERS = [
  {id:"u1",name:"Randy Admin",email:"randy@omnisecurityinc.com",role:"admin",companyId:"c1",phone:"+1-555-0101",dept:"IT Administration",active:true,createdAt:dAgo(90),lastLogin:hAgo(1)},
  {id:"u2",name:"Mike Chen",email:"mike@itsolutions.com",role:"it_manager",companyId:"c1",phone:"+1-555-0102",dept:"IT Operations",active:true,createdAt:dAgo(80),lastLogin:hAgo(2)},
  {id:"u3",name:"Alex Rodriguez",email:"alex@itsolutions.com",role:"it_technician",companyId:"c1",phone:"+1-555-0103",dept:"IT Support",active:true,createdAt:dAgo(75),lastLogin:hAgo(0.5)},
  {id:"u4",name:"Emma Williams",email:"emma@itsolutions.com",role:"it_technician",companyId:"c1",phone:"+1-555-0104",dept:"IT Support",active:true,createdAt:dAgo(70),lastLogin:hAgo(1)},
  {id:"u5",name:"John Doe",email:"john@acmecorp.com",role:"end_user",companyId:"c2",phone:"+1-555-0105",dept:"Sales",active:true,createdAt:dAgo(60),lastLogin:hAgo(3)},
  {id:"u6",name:"Jane Smith",email:"jane@techstart.com",role:"end_user",companyId:"c3",phone:"+1-555-0106",dept:"Engineering",active:true,createdAt:dAgo(55),lastLogin:hAgo(4)},
  {id:"u7",name:"Bob Wilson",email:"bob@acmecorp.com",role:"end_user",companyId:"c2",phone:"+1-555-0107",dept:"Marketing",active:true,createdAt:dAgo(50),lastLogin:hAgo(8)},
];
const SEED_TYPES = [
  {id:"tt1",name:"Hardware Issue",priority:"high",slaHours:8,keywords:["hardware","computer","printer","monitor","keyboard","laptop","screen"],defaultAssignee:"u3",color:"#ef4444"},
  {id:"tt2",name:"Software Install",priority:"medium",slaHours:24,keywords:["install","software","application","app","program","license"],defaultAssignee:"u4",color:"#f59e0b"},
  {id:"tt3",name:"Network Problem",priority:"critical",slaHours:4,keywords:["network","internet","wifi","connection","disconnected"],defaultAssignee:"u3",color:"#dc2626"},
  {id:"tt4",name:"Password Reset",priority:"low",slaHours:4,keywords:["password","reset","locked","login","forgot"],defaultAssignee:"u4",color:"#10b981"},
  {id:"tt5",name:"Email Issue",priority:"medium",slaHours:8,keywords:["email","outlook","mail","inbox","calendar"],defaultAssignee:"u3",color:"#6366f1"},
  {id:"tt6",name:"Security Incident",priority:"critical",slaHours:2,keywords:["security","hack","breach","virus","malware","phishing"],defaultAssignee:"u2",color:"#7c3aed"},
  {id:"tt7",name:"VPN Access",priority:"medium",slaHours:8,keywords:["vpn","remote","tunnel"],defaultAssignee:"u4",color:"#8b5cf6"},
  {id:"tt8",name:"Others",priority:"low",slaHours:48,keywords:[],defaultAssignee:null,color:"#94a3b8"},
];
function mkT(id,title,desc,typeId,status,sub,asn,co,cl,loc,hrs,msgs,hist){
  var tt=SEED_TYPES.find(function(t){return t.id===typeId;});
  var cat=hAgo(hrs);
  var sla=new Date(new Date(cat).getTime()+(tt?tt.slaHours:24)*3600000).toISOString();
  var createMins=rnd(2,18);
  return {id,title,description:desc,typeId,customTypeName:null,status,priority:tt?tt.priority:"medium",submittedBy:sub,assignedTo:asn,companyId:co,clientId:cl||null,locationId:loc||null,createdAt:cat,updatedAt:hAgo(Math.max(0,hrs-1)),slaDeadline:sla,slaBreached:new Date()>new Date(sla)&&!["Closed","Resolved"].includes(status),timeToCreateMins:createMins,submittedAt:cat,formOpenedAt:new Date(new Date(cat).getTime()-createMins*60000).toISOString(),statusHistory:hist&&hist.length?hist:[{status,assignedTo:asn,timestamp:cat,changedBy:sub,note:"Ticket created"}],conversations:msgs||[],externalEmail:null,resolvedAt:["Resolved","Closed"].includes(status)?hAgo(Math.max(0,hrs-3)):null,closedAt:status==="Closed"?hAgo(Math.max(0,hrs-1)):null,deleted:false,aiReason:"Type: "+(tt?tt.name:"Others"),attachments:[]};
}
const SEED_TICKETS = [
  mkT("t1","Laptop screen flickering","Screen flickers on Dell XPS 15.","tt1","In Progress","u5","u3","c2","cl4","loc8",12,[{id:"m1",from:"u5",fromEmail:"john@acmecorp.com",to:["u3"],toEmails:["alex@itsolutions.com"],cc:[],subject:"Re: [#t1]",body:"Flickering every 5 min.",timestamp:hAgo(10),isExternal:false,status:"sent"},{id:"m2",from:"u3",fromEmail:"alex@itsolutions.com",to:["u5"],toEmails:["john@acmecorp.com"],cc:[],subject:"Re: [#t1]",body:"Bring laptop to IT at 2PM.\n\nAlex",timestamp:hAgo(9),isExternal:false,status:"sent"}],[{status:"Open",assignedTo:"u3",timestamp:hAgo(12),changedBy:"u5",note:"Ticket created"},{status:"In Progress",assignedTo:"u3",timestamp:hAgo(10),changedBy:"u3",note:"Diagnostic scheduled"}]),
  mkT("t2","Cannot connect to VPN","Error 789 on VPN. Windows 11.","tt7","Open","u6","u4","c3","cl2","loc4",3,[],[]),
  mkT("t3","Phishing email received","Fake IT domain. Five colleagues affected.","tt6","Escalated","u7","u2","c2","cl1","loc1",6,[{id:"m3",from:"u7",fromEmail:"bob@acmecorp.com",to:["u2"],toEmails:["mike@itsolutions.com"],cc:[],subject:"Re: [#t3]",body:"5 colleagues confirmed.",timestamp:hAgo(5),isExternal:false,status:"sent"},{id:"m4",from:"u2",fromEmail:"mike@itsolutions.com",to:["u7"],toEmails:["bob@acmecorp.com"],cc:[],subject:"Re: [#t3]",body:"Blocking domain now.\n\nMike",timestamp:hAgo(4),isExternal:false,status:"sent"}],[{status:"Open",assignedTo:"u2",timestamp:hAgo(6),changedBy:"u7",note:"Ticket created"},{status:"Escalated",assignedTo:"u2",timestamp:hAgo(4),changedBy:"u2",note:"Escalated"}]),
  mkT("t4","Outlook not syncing","Stopped syncing 3h ago.","tt5","Resolved","u5","u4","c2","cl4","loc7",24,[],[]),
  mkT("t5","AD Account locked","Locked before presentation.","tt4","Closed","u6","u4","c3","cl2","loc5",48,[],[]),
  mkT("t6","Adobe CS install","Need Adobe CS on 3 computers.","tt2","Open","u7","u4","c2","cl1","loc2",5,[],[]),
  mkT("t7","3rd floor outage","25+ users offline.","tt3","In Progress","u5","u3","c2","cl4","loc8",2,[],[]),
  mkT("t8","TEST - ignore","Test ticket.","tt8","Open","u5",null,"c2",null,null,1,[],[]),
  mkT("t9","New employee setup","Configure laptop for new hire.","tt2","Resolved","u7","u4","c2","cl4","loc8",72,[],[]),
  mkT("t10","Backup drive error","Not recognized after update.","tt1","Open","u6","u3","c3","cl2","loc4",8,[],[]),
];
const SEED_LOGS = [
  {id:"l1",action:"USER_ROLE_CHANGE",userId:"u1",target:"u2",detail:"Role changed to IT Manager",timestamp:dAgo(5)},
  {id:"l2",action:"COMPANY_CREATED",userId:"u1",target:"c3",detail:"Company TechStart Inc created",timestamp:dAgo(85)},
  {id:"l3",action:"TICKET_CREATED",userId:"u5",target:"t1",detail:"Ticket #t1 created",timestamp:hAgo(12)},
  {id:"l4",action:"TICKET_STATUS",userId:"u3",target:"t1",detail:"Status: Open → In Progress",timestamp:hAgo(10)},
  {id:"l6",action:"EMAIL_SENT",userId:"u3",target:"t1",detail:"Email sent to john@acmecorp.com",timestamp:hAgo(9)},
];

function mkOpt(v,l){ return {value:v,label:l}; }
const OPT_ROLES    = Object.keys(ROLE_META).map(function(k){ return mkOpt(k,ROLE_META[k].label); });
const OPT_PRIORITY = Object.keys(PRI_META).map(function(k){ return mkOpt(k,PRI_META[k].label); });
const OPT_STATUSES = ALL_STATUSES.map(function(s){ return mkOpt(s,s); });
function optCompanies(c){ return c.map(function(x){ return mkOpt(x.id,x.name); }); }
function optCompaniesNone(c){ return [mkOpt("","— None —")].concat(c.map(function(x){ return mkOpt(x.id,x.name); })); }
function optClients(c){ return [mkOpt("","— No Client —")].concat(c.map(function(x){ return mkOpt(x.id,x.name); })); }
function optLocs(l){ return [mkOpt("","— Select Location —")].concat(l.map(function(x){ return mkOpt(x.id,x.name); })); }
function optTypes(t){ return t.map(function(x){ return mkOpt(x.id,x.name+" — "+(PRI_META[x.priority]?.label||x.priority)+", SLA "+x.slaHours+"h"); }); }
function optTechs(u){ return [mkOpt("","— Unassigned —")].concat(u.filter(function(x){ return ["it_technician","it_manager","admin"].includes(x.role)&&x.active; }).map(function(x){ return mkOpt(x.id,x.name+" ("+(ROLE_META[x.role]?.label||x.role)+")"); })); }
function optAssignees(u){ return [mkOpt("","— Auto-assign —")].concat(u.filter(function(x){ return ["it_technician","it_manager","admin"].includes(x.role)&&x.active; }).map(function(x){ return mkOpt(x.id,x.name+" ("+(ROLE_META[x.role]?.label||x.role)+")"); })); }
function optTickets(t){ return t.map(function(x){ return mkOpt(x.id,"#"+x.id+" — "+x.title.slice(0,28)); }); }

function pieLabel(p){ return p.value>0?p.name+": "+p.value:""; }

class ErrorBoundary extends React.Component {
  constructor(props){super(props);this.state={error:null};}
  static getDerivedStateFromError(e){return{error:e.message};}
  render(){
    if(this.state.error) return (
      <div style={{padding:40,fontFamily:"monospace",background:"#fef2f2",minHeight:"100vh"}}>
        <div style={{fontSize:20,fontWeight:700,color:"#dc2626",marginBottom:16}}>⚠️ App Error</div>
        <pre style={{background:"#fff",padding:20,borderRadius:8,border:"1px solid #fecaca",fontSize:13,whiteSpace:"pre-wrap",color:"#7f1d1d"}}>{this.state.error}</pre>
        <button onClick={function(){this.setState({error:null});}.bind(this)} style={{marginTop:16,padding:"10px 20px",background:"#dc2626",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700}}>Try Again</button>
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

// ── LOGIN ──────────────────────────────────────────────────────────────────────
function LoginPage(p){ var users=p.users; var setUsers=p.setUsers; var companies=p.companies; var onLogin=p.onLogin;
  var [view,setView]=useState("login");
  var [loginEmail,setLoginEmail]=useState(""); var [loginPass,setLoginPass]=useState("");
  var [showP1,setShowP1]=useState(false); var [showP2,setShowP2]=useState(false); var [showP3,setShowP3]=useState(false);
  var [loginErr,setLoginErr]=useState(""); var [resetEmail,setResetEmail]=useState(""); var [resetErr,setResetErr]=useState("");
  var [sigName,setSigName]=useState(""); var [sigEmail,setSigEmail]=useState(""); var [sigPass,setSigPass]=useState(""); var [sigConf,setSigConf]=useState(""); var [sigPhone,setSigPhone]=useState(""); var [sigDept,setSigDept]=useState(""); var [sigErr,setSigErr]=useState("");
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
        {view==="login"&&<><h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 4px"}}>Welcome back 👋</h2><p style={{fontSize:13,color:"#94a3b8",margin:"0 0 22px"}}>Sign in to access your dashboard</p><form onSubmit={doLogin}><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:5}}>Email Address</label><FocusInput type="email" value={loginEmail} onChange={function(e){setLoginEmail(e.target.value);}} placeholder="you@company.com" autoFocus/></div><div style={{marginBottom:6}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:5}}>Password</label><div style={{position:"relative"}}><FocusInput type={showP1?"text":"password"} value={loginPass} onChange={function(e){setLoginPass(e.target.value);}} placeholder="••••••••" extraPad/><button type="button" onClick={function(){setShowP1(!showP1);}} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:16,color:"#94a3b8",padding:0}}>{showP1?"🙈":"👁️"}</button></div></div><div style={{textAlign:"right",marginBottom:18}}><button type="button" onClick={function(){setView("forgot");setResetEmail(loginEmail);setResetErr("");}} style={{background:"none",border:"none",color:"#0369a1",fontSize:12,fontWeight:600,cursor:"pointer",padding:0,textDecoration:"underline"}}>Forgot your password?</button></div><ErrBox msg={loginErr}/><PBtn type="submit" disabled={loading}>{loading?"⏳ Signing in…":"Sign In →"}</PBtn></form><div style={{marginTop:18,textAlign:"center"}}><span style={{fontSize:12,color:"#94a3b8"}}>Don't have an account? </span><button type="button" onClick={function(){setView("signup");setSigErr("");}} style={{background:"none",border:"none",color:"#0369a1",fontSize:12,fontWeight:700,cursor:"pointer",textDecoration:"underline"}}>Sign Up</button></div></>}
        {view==="signup"&&<><BackBtn onClick={function(){setView("login");setSigErr("");}} /><h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 4px"}}>Create an Account 🚀</h2><p style={{fontSize:13,color:"#94a3b8",margin:"0 0 18px"}}>Fill in your details. An admin will approve your account.</p><form onSubmit={doSignup}><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><div style={{marginBottom:10}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Full Name *</label><FocusInput type="text" value={sigName} onChange={function(e){setSigName(e.target.value);}} placeholder="Jane Smith" autoFocus/></div><div style={{marginBottom:10}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Phone</label><FocusInput type="tel" value={sigPhone} onChange={function(e){setSigPhone(e.target.value);}} placeholder="+1-555-0100"/></div></div><div style={{marginBottom:10}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Work Email *</label><FocusInput type="email" value={sigEmail} onChange={function(e){setSigEmail(e.target.value);}} placeholder="you@company.com"/></div><div style={{marginBottom:10}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Department</label><FocusInput type="text" value={sigDept} onChange={function(e){setSigDept(e.target.value);}} placeholder="Sales"/></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:4}}><div><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Password *</label><div style={{position:"relative"}}><FocusInput type={showP2?"text":"password"} value={sigPass} onChange={function(e){setSigPass(e.target.value);}} placeholder="Min 8 chars" extraPad/><button type="button" onClick={function(){setShowP2(!showP2);}} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#94a3b8",padding:0}}>{showP2?"🙈":"👁️"}</button></div></div><div><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Confirm *</label><div style={{position:"relative"}}><FocusInput type={showP3?"text":"password"} value={sigConf} onChange={function(e){setSigConf(e.target.value);}} placeholder="Repeat" extraPad/><button type="button" onClick={function(){setShowP3(!showP3);}} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#94a3b8",padding:0}}>{showP3?"🙈":"👁️"}</button></div></div></div>{sigPass.length>0&&<div style={{marginBottom:12}}><div style={{display:"flex",gap:4,marginBottom:3}}>{[1,2,3,4].map(function(i){ return <div key={i} style={{flex:1,height:4,borderRadius:2,background:i<=str?strColor[str]:"#e2e8f0"}}/>; })}</div><div style={{fontSize:10,color:strColor[str]}}>{strLabel[str]}</div></div>}<div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#92400e"}}>⚠️ New accounts require <strong>admin approval</strong>.</div><ErrBox msg={sigErr}/><PBtn type="submit" disabled={loading}>{loading?"⏳ Creating…":"Create Account →"}</PBtn></form></>}
        {view==="pending"&&<div style={{textAlign:"center",padding:"10px 0"}}><div style={{fontSize:56,marginBottom:14}}>⏳</div><h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 10px"}}>Account Pending Approval</h2><p style={{fontSize:13,color:"#64748b",lineHeight:1.7,margin:"0 0 18px"}}>Your account for <strong>{sigEmail}</strong> has been submitted.</p><PBtn onClick={function(){setView("login");setLoginErr("");}}>← Back to Sign In</PBtn></div>}
        {view==="forgot"&&<><BackBtn onClick={function(){setView("login");setResetErr("");}} /><div style={{textAlign:"center",marginBottom:22}}><div style={{fontSize:44,marginBottom:8}}>🔑</div><h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 6px"}}>Forgot Password?</h2></div><form onSubmit={doForgot}><div style={{marginBottom:16}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:5}}>Email Address</label><FocusInput type="email" value={resetEmail} onChange={function(e){setResetEmail(e.target.value);}} placeholder="you@company.com" autoFocus/></div><ErrBox msg={resetErr}/><PBtn type="submit" disabled={loading}>{loading?"⏳ Sending…":"Send Reset Link →"}</PBtn></form></>}
        {view==="sent"&&<div style={{textAlign:"center",padding:"10px 0"}}><div style={{fontSize:56,marginBottom:14}}>📧</div><h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 10px"}}>Check your inbox!</h2><p style={{fontSize:13,color:"#64748b",lineHeight:1.7,margin:"0 0 22px"}}>If an account exists for <strong>{resetEmail}</strong>, a reset link was sent.</p><PBtn onClick={function(){setView("login");setLoginErr("");}}>← Back to Sign In</PBtn></div>}
      </div>
      <p style={{textAlign:"center",color:"rgba(255,255,255,.4)",fontSize:11,marginTop:20}}>© 2025 Hoptix · A.eye Technology</p>
    </div>
  </div>;
}

// ── PROFILE MODAL ─────────────────────────────────────────────────────────────
function ProfileModal(p){ var curUser=p.curUser; var setUsers=p.setUsers; var showToast=p.showToast; var addLog=p.addLog; var onClose=p.onClose;
  var [tab,setTab]=useState("profile");
  var [name,setName]=useState(curUser.name); var [phone,setPhone]=useState(curUser.phone||""); var [dept,setDept]=useState(curUser.dept||"");
  var [curPw,setCurPw]=useState(""); var [newPw,setNewPw]=useState(""); var [confPw,setConfPw]=useState("");
  var [showC,setShowC]=useState(false); var [showN,setShowN]=useState(false); var [showK,setShowK]=useState(false);
  var [pwErr,setPwErr]=useState(""); var [pwOk,setPwOk]=useState(""); var [saving,setSaving]=useState(false);
  function pwStr(pw){ if(!pw||pw.length<8)return 1; if(pw.length>=12&&/[A-Z]/.test(pw)&&/[0-9]/.test(pw)&&/[^A-Za-z0-9]/.test(pw))return 4; if(pw.length>=10&&/[A-Z]/.test(pw)&&/[0-9]/.test(pw))return 3; return 2; }
  var strC=["","#ef4444","#f59e0b","#3b82f6","#10b981"]; var strL=["","Too short","Weak","Good","Strong ✅"]; var str=pwStr(newPw);
  var inp={width:"100%",padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#f8fafc",boxSizing:"border-box"};
  async function saveProfile(){ if(!name.trim()){showToast("Name cannot be empty","error");return;} setSaving(true); await new Promise(function(r){setTimeout(r,400);}); setUsers(function(prev){return prev.map(function(u){return u.id===curUser.id?Object.assign({},u,{name:name.trim(),phone:phone.trim(),dept:dept.trim()}):u;});}); addLog("PROFILE_UPDATED",curUser.id,curUser.name+" updated profile"); showToast("✅ Profile updated!"); setSaving(false); onClose(); }
  async function changePw(){ setPwErr(""); setPwOk(""); if(!curPw){setPwErr("Enter your current password.");return;} if(curPw!==getPassword(curUser.id)){setPwErr("Current password is incorrect.");return;} if(newPw.length<8){setPwErr("New password must be at least 8 characters.");return;} if(newPw!==confPw){setPwErr("Passwords do not match.");return;} if(newPw===curPw){setPwErr("New password must differ from current.");return;} setSaving(true); await new Promise(function(r){setTimeout(r,500);}); setPassword(curUser.id,newPw); addLog("PASSWORD_CHANGED",curUser.id,curUser.name+" changed password"); setSaving(false); setCurPw(""); setNewPw(""); setConfPw(""); setPwOk("✅ Password changed!"); showToast("Password updated!"); }
  return <Modal title="My Profile" onClose={onClose}>
    <div style={{display:"flex",alignItems:"center",gap:16,padding:"0 0 20px",borderBottom:"1px solid #e2e8f0",marginBottom:20}}><div style={{width:64,height:64,borderRadius:"50%",background:avCol(curUser.id),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:24,fontWeight:800}}>{inits(curUser.name)}</div><div><div style={{fontWeight:700,fontSize:16}}>{curUser.name}</div><div style={{fontSize:12,color:"#64748b"}}>{curUser.email}</div><div style={{marginTop:4}}><Badge label={ROLE_META[curUser.role]?.label||curUser.role} color={ROLE_META[curUser.role]?.color||"#6366f1"}/></div></div></div>
    <div style={{display:"flex",gap:6,marginBottom:20}}>{["profile","password"].map(function(t){ return <button key={t} onClick={function(){setTab(t);}} style={{background:tab===t?"#6366f1":"#f1f5f9",color:tab===t?"#fff":"#475569",border:"none",borderRadius:8,padding:"6px 18px",cursor:"pointer",fontSize:12,fontWeight:700}}>{t==="profile"?"👤 Profile":"🔑 Change Password"}</button>; })}</div>
    {tab==="profile"&&<div><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Full Name</label><input value={name} onChange={function(e){setName(e.target.value);}} style={inp}/></div><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Email Address</label><input value={curUser.email} disabled style={Object.assign({},inp,{background:"#f1f5f9",color:"#94a3b8",cursor:"not-allowed"})}/></div><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Phone</label><input value={phone} onChange={function(e){setPhone(e.target.value);}} style={inp}/></div><div style={{marginBottom:20}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Department</label><input value={dept} onChange={function(e){setDept(e.target.value);}} style={inp}/></div><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button onClick={onClose} style={{padding:"8px 18px",background:"#f1f5f9",color:"#475569",border:"none",borderRadius:8,fontWeight:600,fontSize:13,cursor:"pointer"}}>Cancel</button><button onClick={saveProfile} disabled={saving} style={{padding:"8px 18px",background:saving?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:8,fontWeight:600,fontSize:13,cursor:saving?"not-allowed":"pointer"}}>{saving?"⏳ Saving…":"💾 Save Changes"}</button></div></div>}
    {tab==="password"&&<div><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Current Password</label><div style={{position:"relative"}}><input type={showC?"text":"password"} value={curPw} onChange={function(e){setCurPw(e.target.value);}} placeholder="••••••••" style={Object.assign({},inp,{paddingRight:40})}/><button type="button" onClick={function(){setShowC(!showC);}} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:14,color:"#94a3b8"}}>{showC?"🙈":"👁️"}</button></div></div><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>New Password</label><div style={{position:"relative"}}><input type={showN?"text":"password"} value={newPw} onChange={function(e){setNewPw(e.target.value);}} placeholder="Min 8 characters" style={Object.assign({},inp,{paddingRight:40})}/><button type="button" onClick={function(){setShowN(!showN);}} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:14,color:"#94a3b8"}}>{showN?"🙈":"👁️"}</button></div>{newPw.length>0&&<div style={{marginTop:6}}><div style={{display:"flex",gap:4,marginBottom:3}}>{[1,2,3,4].map(function(i){ return <div key={i} style={{flex:1,height:4,borderRadius:2,background:i<=str?strC[str]:"#e2e8f0"}}/>; })}</div><div style={{fontSize:10,color:strC[str]}}>{strL[str]}</div></div>}</div><div style={{marginBottom:16}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Confirm New Password</label><div style={{position:"relative"}}><input type={showK?"text":"password"} value={confPw} onChange={function(e){setConfPw(e.target.value);}} placeholder="Repeat" style={Object.assign({},inp,{paddingRight:40})}/><button type="button" onClick={function(){setShowK(!showK);}} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:14,color:"#94a3b8"}}>{showK?"🙈":"👁️"}</button></div></div>{pwErr&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:14,color:"#dc2626",fontSize:13}}>⚠️ {pwErr}</div>}{pwOk&&<div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"10px 14px",marginBottom:14,color:"#166534",fontSize:13}}>{pwOk}</div>}<div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button onClick={onClose} style={{padding:"8px 18px",background:"#f1f5f9",color:"#475569",border:"none",borderRadius:8,fontWeight:600,fontSize:13,cursor:"pointer"}}>Cancel</button><button onClick={changePw} disabled={saving} style={{padding:"8px 18px",background:saving?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:8,fontWeight:600,fontSize:13,cursor:saving?"not-allowed":"pointer"}}>{saving?"⏳ Saving…":"🔑 Change Password"}</button></div></div>}
  </Modal>;
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function App(){
  var [users,setUsersR]       = useState(function(){ return loadState("hd_users",SEED_USERS); });
  var [companies,setCompR]    = useState(function(){ return loadState("hd_companies",SEED_COMPANIES); });
  var [clients,setClientsR]   = useState(function(){ return loadState("hd_clients",SEED_CLIENTS); });
  var [tickets,setTicketsR]   = useState(function(){ return loadState("hd_tickets",SEED_TICKETS); });
  var [ticketTypes,setTTR]    = useState(function(){ return loadState("hd_ticketTypes",SEED_TYPES); });
  var [logs,setLogsR]         = useState(function(){ return loadState("hd_logs",SEED_LOGS); });
  var [curUser,setCurUserR]   = useState(function(){ return loadState("hd_curUser",null); });
  var [page,setPageR]         = useState(function(){ return loadState("hd_page","dashboard"); });
  function setPage(v){ saveState("hd_page",v); setPageR(v); }
  var [selTicket,setSelTicket]= useState(null);
  var [toast,setToast]        = useState(null);
  var [breaches,setBreaches]  = useState([]);
  var [showProfile,setShowProfile] = useState(false);

  function setUsers(v){       var n=typeof v==="function"?v(users):v;       saveState("hd_users",n);       setUsersR(n); }
  function setCompanies(v){   var n=typeof v==="function"?v(companies):v;   saveState("hd_companies",n);   setCompR(n); }
  function setClients(v){     var n=typeof v==="function"?v(clients):v;     saveState("hd_clients",n);     setClientsR(n); }
  function setTickets(v){     var n=typeof v==="function"?v(tickets):v;     saveState("hd_tickets",n);     setTicketsR(n); }
  function setTicketTypes(v){ var n=typeof v==="function"?v(ticketTypes):v; saveState("hd_ticketTypes",n); setTTR(n); }
  function setLogs(v){        var n=typeof v==="function"?v(logs):v;        saveState("hd_logs",n);        setLogsR(n); }
  function setCurUser(u){     if(u)saveState("hd_curUser",u); else clearAuth(); setCurUserR(u); }

  var addLog = useCallback(function(action,target,detail,uId){
    var entry={id:uid(),action,userId:uId||curUser?.id,target,detail,timestamp:new Date().toISOString()};
    setLogsR(function(p){ var n=[entry].concat(p).slice(0,500); saveState("hd_logs",n); return n; });
  },[curUser]);

  var showToast = useCallback(function(msg,type){
    setToast({msg,type:type||"ok"});
    setTimeout(function(){setToast(null);},3000);
  },[]);

  useEffect(function(){
    function check(){ setBreaches(tickets.filter(function(t){ return !t.deleted&&!["Closed","Resolved"].includes(t.status)&&t.slaDeadline&&Date.now()>new Date(t.slaDeadline).getTime(); })); }
    check(); var iv=setInterval(check,30000); return function(){clearInterval(iv);};
  },[tickets]);

  var isAdmin=["admin","it_manager"].includes(curUser?.role);
  var isTech =["admin","it_manager","it_technician"].includes(curUser?.role);
  var visible=useMemo(function(){ return tickets.filter(function(t){ return !t.deleted&&(isTech||t.submittedBy===curUser?.id||t.assignedTo===curUser?.id); }); },[tickets,curUser,isTech]);

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
    {id:"activity_log",icon:"📋",label:"Activity Log",superAdmin:true},
    {id:"sms_tracker",icon:"💬",label:"SMS Tracker",admin:true},
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
          {page==="dashboard"    &&<PageDashboard   tickets={visible} users={users} ticketTypes={ticketTypes} companies={companies} clients={clients} setPage={setPage} setSelTicket={setSelTicket} breaches={breaches}/>}
          {page==="tickets"      &&<PageTickets     tickets={visible} users={users} companies={companies} clients={clients} ticketTypes={ticketTypes} curUser={curUser} setTickets={setTickets} addLog={addLog} showToast={showToast} setSelTicket={setSelTicket} setPage={setPage} isAdmin={isAdmin}/>}
          {page==="new_ticket"   &&<PageNewTicket   users={users} companies={companies} clients={clients} ticketTypes={ticketTypes} curUser={curUser} setTickets={setTickets} addLog={addLog} showToast={showToast} setPage={setPage}/>}
          {page==="time_tracking"&&<PageTimeTracking tickets={visible} users={users} ticketTypes={ticketTypes} curUser={curUser} isAdmin={isAdmin} isTech={isTech} setSelTicket={setSelTicket} setPage={setPage}/>}
          {page==="reports"      &&<PageReports     tickets={visible} users={users} ticketTypes={ticketTypes} companies={companies} clients={clients}/>}
          {page==="users"        &&<PageUsers       users={users} companies={companies} setUsers={setUsers} curUser={curUser} addLog={addLog} showToast={showToast}/>}
          {page==="companies"    &&<PageCompanies   companies={companies} users={users} setCompanies={setCompanies} addLog={addLog} showToast={showToast}/>}
          {page==="clients"      &&<PageClients     clients={clients} setClients={setClients} companies={companies} addLog={addLog} showToast={showToast}/>}
          {page==="ticket_types" &&<PageTicketTypes ticketTypes={ticketTypes} users={users} setTicketTypes={setTicketTypes} addLog={addLog} showToast={showToast}/>}
          {page==="activity_log" &&<PageActivityLog logs={logs} users={users}/>}
          {page==="sms_tracker"  &&<PageSmsTracker  tickets={visible} users={users} curUser={curUser} showToast={showToast} addLog={addLog}/>}
        </div>
      </div>
      {selTicket&&<TicketDetail ticket={tickets.find(function(t){return t.id===selTicket;})} setTickets={setTickets} users={users} ticketTypes={ticketTypes} companies={companies} clients={clients} curUser={curUser} isAdmin={isAdmin} isTech={isTech} addLog={addLog} showToast={showToast} onClose={function(){setSelTicket(null);}}/>}
      {showProfile&&<ProfileModal curUser={curUser} setUsers={setUsers} showToast={showToast} addLog={addLog} onClose={function(){setShowProfile(false);}}/>}
    </div>
  </ErrorBoundary>;
}

// ── TIME TRACKING PAGE ────────────────────────────────────────────────────────
function PageTimeTracking(p){
  var tickets=p.tickets; var users=p.users; var ticketTypes=p.ticketTypes; var curUser=p.curUser; var isAdmin=p.isAdmin; var isTech=p.isTech; var setSelTicket=p.setSelTicket; var setPage=p.setPage;
  var [search,setSearch]=useState(""); var [filterUser,setFilterUser]=useState(""); var [filterType,setFilterType]=useState(""); var [sortBy,setSortBy]=useState("submittedAt"); var [sortDir,setSortDir]=useState("desc");
  var [view,setView]=useState("table");

  // non-admins always see only their own tickets
  var scope=useMemo(function(){
    var base=tickets.filter(function(t){return !t.deleted;});
    if(!isAdmin) return base.filter(function(t){return t.submittedBy===curUser.id;});
    if(filterUser) return base.filter(function(t){return t.submittedBy===filterUser;});
    return base;
  },[tickets,curUser,isAdmin,filterUser]);

  var filtered=useMemo(function(){
    var q=search.toLowerCase();
    return scope.filter(function(t){
      return(!q||(t.title.toLowerCase().includes(q)||t.id.includes(q)))&&(!filterType||t.typeId===filterType);
    }).sort(function(a,b){
      var av,bv;
      if(sortBy==="submittedAt"){av=new Date(a.submittedAt||a.createdAt);bv=new Date(b.submittedAt||b.createdAt);}
      else if(sortBy==="formOpenedAt"){av=new Date(a.formOpenedAt||a.createdAt);bv=new Date(b.formOpenedAt||b.createdAt);}
      else if(sortBy==="timeToCreate"){av=a.timeToCreateMins||0;bv=b.timeToCreateMins||0;}
      else if(sortBy==="title"){av=a.title.toLowerCase();bv=b.title.toLowerCase();}
      else{av=new Date(a.createdAt);bv=new Date(b.createdAt);}
      if(av<bv)return sortDir==="asc"?-1:1;
      if(av>bv)return sortDir==="asc"?1:-1;
      return 0;
    });
  },[scope,search,filterType,sortBy,sortDir]);

  function fu(id){return users.find(function(x){return x.id===id;});}
  function ftt(id){return ticketTypes.find(function(x){return x.id===id;});}

  // stats
  var avgCreate=filtered.length?Math.round(filtered.reduce(function(a,t){return a+(t.timeToCreateMins||0);},0)/filtered.length):0;
  var fastest=filtered.length?filtered.reduce(function(a,t){return (t.timeToCreateMins||999)<(a.timeToCreateMins||999)?t:a;},filtered[0]):null;
  var slowest=filtered.length?filtered.reduce(function(a,t){return (t.timeToCreateMins||0)>(a.timeToCreateMins||0)?t:a;},filtered[0]):null;
  var byTypeTime=ticketTypes.map(function(tt){var mine=filtered.filter(function(t){return t.typeId===tt.id&&t.timeToCreateMins;});return {name:tt.name,color:tt.color,avg:mine.length?Math.round(mine.reduce(function(a,t){return a+t.timeToCreateMins;},0)/mine.length):0,count:mine.length};}).filter(function(x){return x.count>0;});

  // daily summary
  var dailySummary=useMemo(function(){
    var map={};
    filtered.forEach(function(t){
      var d=new Date(t.submittedAt||t.createdAt);
      var key=d.toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"});
      if(!map[key]) map[key]={date:key,rawDate:d,count:0,totalMins:0,tickets:[]};
      map[key].count+=1;
      map[key].totalMins+=(t.timeToCreateMins||0);
      map[key].tickets.push(t);
    });
    return Object.values(map).sort(function(a,b){return new Date(b.rawDate)-new Date(a.rawDate);});
  },[filtered]);

  // hourly heatmap data
  var hourBuckets=Array.from({length:24},function(_,h){
    var cnt=filtered.filter(function(t){return new Date(t.submittedAt||t.createdAt).getHours()===h;}).length;
    return {hour:h,label:(h===0?"12am":h<12?h+"am":h===12?"12pm":(h-12)+"pm"),count:cnt};
  });
  var maxHour=Math.max.apply(null,hourBuckets.map(function(h){return h.count;}));

  // day of week
  var DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  var dowBuckets=DOW.map(function(d,i){
    var cnt=filtered.filter(function(t){return new Date(t.submittedAt||t.createdAt).getDay()===i;}).length;
    return {day:d,count:cnt};
  });

  // by submitter (for admins)
  var bySubmitter=isTech?users.filter(function(u){return u.active;}).map(function(u){
    var mine=filtered.filter(function(t){return t.submittedBy===u.id;});
    if(!mine.length)return null;
    return {user:u,count:mine.length,avg:Math.round(mine.reduce(function(a,t){return a+(t.timeToCreateMins||0);},0)/mine.length),fastest:mine.reduce(function(a,t){return (t.timeToCreateMins||999)<(a.timeToCreateMins||999)?t:a;},mine[0]),slowest:mine.reduce(function(a,t){return (t.timeToCreateMins||0)>(a.timeToCreateMins||0)?t:a;},mine[0])};
  }).filter(Boolean):[];

  function toggleSort(col){if(sortBy===col){setSortDir(function(d){return d==="asc"?"desc":"asc";});}else{setSortBy(col);setSortDir("desc");}}
  function SortArrow(sp){ if(sortBy!==sp.col)return <span style={{color:"#cbd5e1",marginLeft:3}}>⇅</span>; return <span style={{marginLeft:3}}>{sortDir==="asc"?"↑":"↓"}</span>; }

  var techUsers=users.filter(function(u){return u.active;});

  return <div>
    {/* Header bar */}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
      <div>
        <div style={{fontWeight:800,fontSize:18,color:"#1e293b"}}>⏱️ Time Tracking</div>
        <div style={{fontSize:12,color:"#64748b",marginTop:2}}>Track when each ticket was submitted, how long it took to create, and submission patterns.</div>
      </div>
      <div style={{display:"flex",gap:6}}>
        <button onClick={function(){setView("table");}} style={{padding:"6px 14px",borderRadius:8,border:"1px solid "+(view==="table"?"#6366f1":"#e2e8f0"),background:view==="table"?"#6366f1":"#fff",color:view==="table"?"#fff":"#475569",fontSize:12,fontWeight:600,cursor:"pointer"}}>📋 Table</button>
        <button onClick={function(){setView("heatmap");}} style={{padding:"6px 14px",borderRadius:8,border:"1px solid "+(view==="heatmap"?"#6366f1":"#e2e8f0"),background:view==="heatmap"?"#6366f1":"#fff",color:view==="heatmap"?"#fff":"#475569",fontSize:12,fontWeight:600,cursor:"pointer"}}>🔥 Heatmap</button>
        <button onClick={function(){setView("daily");}} style={{padding:"6px 14px",borderRadius:8,border:"1px solid "+(view==="daily"?"#6366f1":"#e2e8f0"),background:view==="daily"?"#6366f1":"#fff",color:view==="daily"?"#fff":"#475569",fontSize:12,fontWeight:600,cursor:"pointer"}}>📅 Daily Summary</button>
      </div>
    </div>

    {/* Stats cards */}
    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
      <Stat label="Tickets Shown"    value={filtered.length}    icon="🎫" color="#6366f1"/>
      <Stat label="Total Create Time" value={(function(){ var t=filtered.reduce(function(a,tk){return a+(tk.timeToCreateMins||0);},0); return fmtMs(t); })()} icon="🕐" color="#8b5cf6" sub={filtered.length+" tickets combined"}/>
      <Stat label="Avg Create Time"  value={(function(){ var t=filtered.length?filtered.reduce(function(a,tk){return a+(tk.timeToCreateMins||0);},0)/filtered.length:0; return fmtMs(t); })()} icon="⏱" color="#0ea5e9" sub="time to fill form"/>
      <Stat label="Fastest Submit"   value={fastest?fmtMs(fastest.timeToCreateMins):"—"} icon="⚡" color="#10b981" sub={fastest?fastest.title.slice(0,18)+"…":""}/>
      <Stat label="Slowest Submit"   value={slowest?fmtMs(slowest.timeToCreateMins):"—"} icon="🐢" color="#f59e0b" sub={slowest?slowest.title.slice(0,18)+"…":""}/>
    </div>

    {/* Filters */}
    <Card style={{marginBottom:16,padding:"14px 16px"}}>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        <input value={search} onChange={function(e){setSearch(e.target.value);}} placeholder="🔍 Search tickets…" style={{flex:1,minWidth:160,padding:"7px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}/>
        <select value={filterType} onChange={function(e){setFilterType(e.target.value);}} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}>
          <option value="">All Types</option>
          {ticketTypes.map(function(t){return <option key={t.id} value={t.id}>{t.name}</option>;})}
        </select>
        {isAdmin&&<select value={filterUser} onChange={function(e){setFilterUser(e.target.value);}} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}>
          <option value="">All Users</option>
          {users.filter(function(u){return u.active;}).map(function(u){return <option key={u.id} value={u.id}>{u.name}</option>;})}
        </select>}
      </div>
    </Card>

    {/* DAILY SUMMARY VIEW */}
    {view==="daily"&&<div>
      {dailySummary.length===0&&<Card><div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No tickets match the current filters.</div></Card>}
      {dailySummary.length>0&&<>
        <Card style={{marginBottom:16,padding:"14px 18px"}}>
          <div style={{fontWeight:700,color:"#1e293b",marginBottom:4}}>📊 Total Create Time per Day</div>
          <div style={{fontSize:11,color:"#64748b",marginBottom:12}}>Sum of minutes spent filling out the ticket form, grouped by submission date.</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dailySummary.slice().reverse()} margin={{top:4,right:8,left:0,bottom:40}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
              <XAxis dataKey="date" tick={{fontSize:9}} angle={-30} textAnchor="end" height={60}/>
              <YAxis tick={{fontSize:10}} unit="m"/>
              <Tooltip
                formatter={function(v){ return [v+"m","Total Create Time"]; }}
                labelFormatter={function(l){ return "📅 "+l; }}
                contentStyle={{fontSize:12,borderRadius:8}}
              />
              <Bar dataKey="totalMins" name="Total Mins" radius={[5,5,0,0]}>
                {dailySummary.slice().reverse().map(function(_,i){ return <Cell key={i} fill={PAL[i%PAL.length]}/>; })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {/* Day-by-day total pills */}
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>
            {dailySummary.map(function(row){
              return <div key={row.date} style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"8px 14px",textAlign:"center",minWidth:90}}>
                <div style={{fontSize:10,color:"#64748b",fontWeight:600}}>{new Date(row.rawDate).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}</div>
                <div style={{fontSize:20,fontWeight:800,color:"#6366f1",margin:"2px 0"}}>{fmtMs(row.totalMins)}</div>
                <div style={{fontSize:10,color:"#94a3b8"}}>{row.count} ticket{row.count!==1?"s":""}</div>
              </div>;
            })}
          </div>
        </Card>
        <Card style={{padding:0,overflow:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:700}}>
            <thead>
              <tr style={{background:"#f8fafc"}}>
                {["Date","Tickets Submitted","Total Create Time","Avg per Ticket","Fastest","Slowest","Breakdown"].map(function(h){return <th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.4,borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>{h}</th>;})}
              </tr>
            </thead>
            <tbody>
              {dailySummary.map(function(row,i){
                var avg=row.count?Math.round(row.totalMins/row.count):0;
                var fastest=row.tickets.reduce(function(a,t){return (t.timeToCreateMins||999)<(a.timeToCreateMins||999)?t:a;},row.tickets[0]);
                var slowest=row.tickets.reduce(function(a,t){return (t.timeToCreateMins||0)>(a.timeToCreateMins||0)?t:a;},row.tickets[0]);
                var avgColor=avg<=5?"#10b981":avg<=15?"#f59e0b":"#ef4444";
                return <tr key={row.date} style={{borderBottom:"1px solid #f1f5f9",background:i%2===0?"#fff":"#fafafa"}}>
                  <td style={{padding:"10px 12px"}}>
                    <div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>{row.date}</div>
                    <div style={{fontSize:10,color:"#94a3b8",marginTop:2}}>{new Date(row.rawDate).toLocaleDateString("en-US",{weekday:"long"})}</div>
                  </td>
                  <td style={{padding:"10px 12px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:28,height:28,borderRadius:"50%",background:"#eef2ff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:13,color:"#6366f1"}}>{row.count}</div>
                      <span style={{fontSize:12,color:"#475569"}}>{row.count===1?"ticket":"tickets"}</span>
                    </div>
                  </td>
                  <td style={{padding:"10px 12px"}}>
                    <div style={{fontWeight:800,fontSize:16,color:"#6366f1"}}>{fmtMs(row.totalMins)}</div>
                  </td>
                  <td style={{padding:"10px 12px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <div style={{width:36,height:7,background:"#e2e8f0",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",width:Math.min(100,avg/30*100)+"%",background:avgColor,borderRadius:4}}/></div>
                      <span style={{fontWeight:700,color:avgColor,fontSize:13}}>{fmtMs(avg)}</span>
                    </div>
                  </td>
                  <td style={{padding:"10px 12px"}}>
                    <div style={{fontSize:12,fontWeight:600,color:"#10b981"}}>{fastest?fmtMs(fastest.timeToCreateMins):"—"}</div>
                    {fastest&&<div style={{fontSize:10,color:"#94a3b8",marginTop:1,maxWidth:120,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{fastest.title}</div>}
                  </td>
                  <td style={{padding:"10px 12px"}}>
                    <div style={{fontSize:12,fontWeight:600,color:"#f59e0b"}}>{slowest?fmtMs(slowest.timeToCreateMins):"—"}</div>
                    {slowest&&<div style={{fontSize:10,color:"#94a3b8",marginTop:1,maxWidth:120,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{slowest.title}</div>}
                  </td>
                  <td style={{padding:"10px 12px"}}>
                    <div style={{display:"flex",gap:3,flexWrap:"wrap",maxWidth:160}}>
                      {row.tickets.slice(0,6).map(function(t){
                        var m=t.timeToCreateMins||0;
                        var c=m<=5?"#10b981":m<=15?"#f59e0b":"#ef4444";
                        return <span key={t.id} title={t.title+" ("+fmtMs(m)+")"} style={{background:c+"22",color:c,border:"1px solid "+c+"44",borderRadius:4,padding:"1px 5px",fontSize:10,fontWeight:700,cursor:"default"}}>{fmtMs(m)}</span>;
                      })}
                      {row.tickets.length>6&&<span style={{fontSize:10,color:"#94a3b8",alignSelf:"center"}}>+{row.tickets.length-6}</span>}
                    </div>
                  </td>
                </tr>;
              })}
            </tbody>
            <tfoot>
              <tr style={{background:"#f0f9ff",borderTop:"2px solid #bae6fd"}}>
                <td style={{padding:"10px 12px",fontWeight:800,color:"#0369a1",fontSize:13}}>TOTAL</td>
                <td style={{padding:"10px 12px",fontWeight:800,color:"#0369a1",fontSize:13}}>{filtered.length} tickets</td>
                <td style={{padding:"10px 12px",fontWeight:800,color:"#0369a1",fontSize:18}}>{filtered.reduce(function(a,t){return a+(t.timeToCreateMins||0);},0)}<span style={{fontSize:12,fontWeight:400,color:"#0369a1"}}>m</span></td>
                <td style={{padding:"10px 12px",fontWeight:700,color:"#0369a1",fontSize:13}}>{filtered.length?Math.round(filtered.reduce(function(a,t){return a+(t.timeToCreateMins||0);},0)/filtered.length):0}m avg</td>
                <td colSpan={3}/>
              </tr>
            </tfoot>
          </table>
        </Card>
      </>}
    </div>}

    {/* TABLE VIEW */}
    {view==="table"&&<Card style={{padding:0,overflow:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",minWidth:860}}>
        <thead>
          <tr style={{background:"#f8fafc"}}>
            <th style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.4,borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>#</th>
            <th onClick={function(){toggleSort("title");}} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.4,borderBottom:"1px solid #e2e8f0",cursor:"pointer",whiteSpace:"nowrap"}}>Title <SortArrow col="title"/></th>
            <th style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.4,borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>Submitted By</th>
            <th style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.4,borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>Type</th>
            <th onClick={function(){toggleSort("formOpenedAt");}} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.4,borderBottom:"1px solid #e2e8f0",cursor:"pointer",whiteSpace:"nowrap"}}>Form Opened <SortArrow col="formOpenedAt"/></th>
            <th onClick={function(){toggleSort("submittedAt");}} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.4,borderBottom:"1px solid #e2e8f0",cursor:"pointer",whiteSpace:"nowrap"}}>Submitted At <SortArrow col="submittedAt"/></th>
            <th onClick={function(){toggleSort("timeToCreate");}} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.4,borderBottom:"1px solid #e2e8f0",cursor:"pointer",whiteSpace:"nowrap"}}>Create Time <SortArrow col="timeToCreate"/></th>
            <th style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.4,borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>Status</th>
            <th style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.4,borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}></th>
          </tr>
        </thead>
        <tbody>
          {filtered.length===0&&<tr><td colSpan={9} style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No tickets found.</td></tr>}
          {filtered.map(function(t,i){
            var submitter=fu(t.submittedBy); var tt=ftt(t.typeId); var sm=STATUS_META[t.status]||STATUS_META.Open;
            var createMin=t.timeToCreateMins||0;
            var createColor=createMin<=5?"#10b981":createMin<=15?"#f59e0b":"#ef4444";
            var submittedAt=t.submittedAt||t.createdAt; var formOpenedAt=t.formOpenedAt||t.createdAt;
            return <tr key={t.id} style={{borderBottom:"1px solid #f1f5f9",background:i%2===0?"#fff":"#fafafa"}}>
              <td style={{padding:"9px 12px",fontSize:11,color:"#94a3b8",fontWeight:600}}>#{t.id}</td>
              <td style={{padding:"9px 12px",maxWidth:180}}><div style={{fontWeight:600,color:"#1e293b",fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.title}</div></td>
              <td style={{padding:"9px 12px"}}>{submitter?<div style={{display:"flex",alignItems:"center",gap:6}}><Avatar name={submitter.name} id={submitter.id} size={20}/><span style={{fontSize:11}}>{submitter.name}</span></div>:<span style={{fontSize:11,color:"#94a3b8"}}>—</span>}</td>
              <td style={{padding:"9px 12px"}}>{tt?<Badge label={tt.name} color={tt.color}/>:<span style={{color:"#94a3b8",fontSize:11}}>—</span>}</td>
              <td style={{padding:"9px 12px"}}>
                <div style={{fontSize:11,color:"#334155",fontWeight:600}}>{fdtFull(formOpenedAt)}</div>
                <div style={{fontSize:10,color:"#94a3b8"}}>{ago(formOpenedAt)}</div>
              </td>
              <td style={{padding:"9px 12px"}}>
                <div style={{fontSize:11,color:"#334155",fontWeight:600}}>{fdtFull(submittedAt)}</div>
                <div style={{fontSize:10,color:"#94a3b8"}}>{ago(submittedAt)}</div>
              </td>
              <td style={{padding:"9px 12px"}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <div style={{width:40,height:6,background:"#e2e8f0",borderRadius:3,overflow:"hidden"}}>
                    <div style={{height:"100%",width:Math.min(100,createMin/30*100)+"%",background:createColor,borderRadius:3}}/>
                  </div>
                  <span style={{fontSize:12,fontWeight:700,color:createColor}}>{createMin}m</span>
                </div>
              </td>
              <td style={{padding:"9px 12px"}}><Badge label={t.status} color={sm.color} bg={sm.bg}/></td>
              <td style={{padding:"9px 12px"}}><Btn size="sm" variant="ghost" onClick={function(){setSelTicket(t.id);}}>View</Btn></td>
            </tr>;
          })}
        </tbody>
      </table>
    </Card>}

    {/* HEATMAP VIEW */}
    {view==="heatmap"&&<div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        {/* Hourly heatmap */}
        <Card>
          <div style={{fontWeight:700,color:"#1e293b",marginBottom:14}}>🕐 Tickets Submitted by Hour of Day</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(12,1fr)",gap:4,marginBottom:8}}>
            {hourBuckets.map(function(h){
              var intensity=maxHour>0?h.count/maxHour:0;
              var bg=h.count===0?"#f1f5f9":"rgba(99,102,241,"+Math.max(0.1,intensity)+")";
              return <div key={h.hour} title={h.label+": "+h.count+" tickets"} style={{height:36,borderRadius:6,background:bg,display:"flex",alignItems:"center",justifyContent:"center",cursor:"default",position:"relative"}}>
                {h.count>0&&<span style={{fontSize:10,fontWeight:700,color:intensity>0.5?"#fff":"#4338ca"}}>{h.count}</span>}
              </div>;
            })}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(12,1fr)",gap:4}}>
            {hourBuckets.map(function(h){return <div key={h.hour} style={{fontSize:8,color:"#94a3b8",textAlign:"center"}}>{h.label}</div>;})}
          </div>
          <div style={{marginTop:10,fontSize:11,color:"#64748b"}}>Hover over cells to see exact counts. Darker = more tickets.</div>
        </Card>

        {/* Day of week */}
        <Card>
          <div style={{fontWeight:700,color:"#1e293b",marginBottom:14}}>📅 Tickets by Day of Week</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={dowBuckets}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
              <XAxis dataKey="day" tick={{fontSize:11}}/>
              <YAxis tick={{fontSize:10}}/>
              <Tooltip/>
              <Bar dataKey="count" name="Tickets" radius={[4,4,0,0]}>
                {dowBuckets.map(function(e,i){return <Cell key={i} fill={PAL[i%PAL.length]}/>;} )}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Avg create time by type */}
      <Card>
        <div style={{fontWeight:700,color:"#1e293b",marginBottom:14}}>⏱ Average Create Time by Ticket Type</div>
        {byTypeTime.length===0&&<div style={{textAlign:"center",color:"#94a3b8",padding:20}}>No data.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {byTypeTime.sort(function(a,b){return b.avg-a.avg;}).map(function(t){
            var maxAvg=Math.max.apply(null,byTypeTime.map(function(x){return x.avg;}));
            return <div key={t.name} style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:130,fontSize:12,fontWeight:600,color:"#334155",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.name}</div>
              <div style={{flex:1,height:22,background:"#f1f5f9",borderRadius:6,overflow:"hidden",position:"relative"}}>
                <div style={{height:"100%",width:(maxAvg>0?t.avg/maxAvg*100:0)+"%",background:t.color,borderRadius:6,transition:"width .3s"}}/>
                <span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",fontSize:10,fontWeight:700,color:t.avg/maxAvg>0.4?"#fff":"#334155"}}>{t.avg}m avg</span>
              </div>
              <div style={{fontSize:11,color:"#94a3b8",width:50,textAlign:"right"}}>{t.count} tickets</div>
            </div>;
          })}
        </div>
      </Card>
    </div>}

    {/* BY USER VIEW — admin only */}
    {view==="byuser"&&isAdmin&&<div>
      {bySubmitter.length===0&&<Card><div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No user data in the current filter.</div></Card>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:14,marginBottom:16}}>
        {bySubmitter.map(function(row){
          var rm=ROLE_META[row.user.role];
          return <Card key={row.user.id} style={{borderTop:"3px solid "+avCol(row.user.id)}}>
            <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:14}}>
              <Avatar name={row.user.name} id={row.user.id} size={40}/>
              <div>
                <div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>{row.user.name}</div>
                <Badge label={rm?.label||row.user.role} color={rm?.color||"#6366f1"}/>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
              <div style={{background:"#f8fafc",borderRadius:8,padding:"8px 10px",textAlign:"center"}}>
                <div style={{fontSize:10,color:"#64748b",fontWeight:700,textTransform:"uppercase",marginBottom:2}}>Tickets</div>
                <div style={{fontSize:20,fontWeight:800,color:"#6366f1"}}>{row.count}</div>
              </div>
              <div style={{background:"#f8fafc",borderRadius:8,padding:"8px 10px",textAlign:"center"}}>
                <div style={{fontSize:10,color:"#64748b",fontWeight:700,textTransform:"uppercase",marginBottom:2}}>Avg Time</div>
                <div style={{fontSize:20,fontWeight:800,color:"#0ea5e9"}}>{row.avg}<span style={{fontSize:11,color:"#94a3b8"}}>m</span></div>
              </div>
            </div>
            {row.fastest&&<div style={{fontSize:11,color:"#64748b",marginBottom:4}}>⚡ Fastest: <strong>{fmtMs(row.fastest.timeToCreateMins)}</strong> — {row.fastest.title.slice(0,22)}</div>}
            {row.slowest&&<div style={{fontSize:11,color:"#64748b"}}>🐢 Slowest: <strong>{fmtMs(row.slowest.timeToCreateMins)}</strong> — {row.slowest.title.slice(0,22)}</div>}
          </Card>;
        })}
      </div>
      <Card style={{padding:0,overflow:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:700}}>
          <thead><tr style={{background:"#f8fafc"}}>
            {["User","Role","Dept","# Tickets","Avg Create Time","Fastest","Slowest","Last Submitted"].map(function(h){return <th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.4,borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>{h}</th>;} )}
          </tr></thead>
          <tbody>
            {bySubmitter.map(function(row){
              var rm=ROLE_META[row.user.role];
              var lastSub=filtered.filter(function(t){return t.submittedBy===row.user.id;}).sort(function(a,b){return new Date(b.submittedAt||b.createdAt)-new Date(a.submittedAt||a.createdAt);})[0];
              return <tr key={row.user.id} style={{borderBottom:"1px solid #f1f5f9"}}>
                <td style={{padding:"10px 12px"}}><div style={{display:"flex",gap:8,alignItems:"center"}}><Avatar name={row.user.name} id={row.user.id} size={26}/><div style={{fontWeight:600,fontSize:12}}>{row.user.name}</div></div></td>
                <td style={{padding:"10px 12px"}}><Badge label={rm?.label||row.user.role} color={rm?.color||"#6366f1"}/></td>
                <td style={{padding:"10px 12px",fontSize:12,color:"#64748b"}}>{row.user.dept||"—"}</td>
                <td style={{padding:"10px 12px",fontWeight:700,fontSize:13,color:"#6366f1"}}>{row.count}</td>
                <td style={{padding:"10px 12px"}}><span style={{fontWeight:700,color:row.avg<=5?"#10b981":row.avg<=15?"#f59e0b":"#ef4444",fontSize:13}}>{row.avg}m</span></td>
                <td style={{padding:"10px 12px",fontSize:11,color:"#10b981",fontWeight:600}}>{row.fastest?(row.fastest.timeToCreateMins||0)+"m":"-"}</td>
                <td style={{padding:"10px 12px",fontSize:11,color:"#f59e0b",fontWeight:600}}>{row.slowest?(row.slowest.timeToCreateMins||0)+"m":"-"}</td>
                <td style={{padding:"10px 12px",fontSize:11,color:"#64748b"}}>{lastSub?ago(lastSub.submittedAt||lastSub.createdAt):"—"}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </Card>
    </div>}
  </div>;
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function PageDashboard(p){ var tickets=p.tickets; var users=p.users; var ticketTypes=p.ticketTypes; var clients=p.clients; var setPage=p.setPage; var setSelTicket=p.setSelTicket; var breaches=p.breaches;
  var byStatus=ALL_STATUSES.map(function(s){ return {name:s,value:tickets.filter(function(t){return t.status===s;}).length,color:STATUS_META[s].color}; });
  var byType=ticketTypes.map(function(tt,i){ return {name:tt.name,value:tickets.filter(function(t){return t.typeId===tt.id;}).length,fill:PAL[i%PAL.length]}; }).filter(function(x){return x.value>0;});
  var byPri=Object.keys(PRI_META).map(function(k){ return {name:PRI_META[k].label,value:tickets.filter(function(t){return t.priority===k;}).length,color:PRI_META[k].color}; });
  var daily=Array.from({length:7},function(_,i){ var d=new Date(Date.now()-(6-i)*86400000); return {lbl:d.toLocaleDateString("en",{weekday:"short"}),created:tickets.filter(function(t){return new Date(t.createdAt).toDateString()===d.toDateString();}).length,resolved:tickets.filter(function(t){return t.resolvedAt&&new Date(t.resolvedAt).toDateString()===d.toDateString();}).length}; });
  var techs=users.filter(function(u){return ["it_technician","it_manager"].includes(u.role);});
  return <div>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
      <Stat label="Total Tickets"  value={tickets.length} icon="🎫" color="#6366f1"/>
      <Stat label="Open"           value={tickets.filter(function(t){return t.status==="Open";}).length} icon="📬" color="#f59e0b"/>
      <Stat label="In Progress"    value={tickets.filter(function(t){return t.status==="In Progress";}).length} icon="⚙️" color="#6366f1"/>
      <Stat label="Resolved"       value={tickets.filter(function(t){return t.status==="Resolved";}).length} icon="✅" color="#10b981"/>
      <Stat label="Escalated"      value={tickets.filter(function(t){return t.status==="Escalated";}).length} icon="🔺" color="#7c3aed" sub="need senior review"/>
      <Stat label="SLA Breaches"   value={breaches.length} icon="🚨" color="#ef4444" sub="need attention"/>
      <Stat label="Active Clients" value={clients.length} icon="🤝" color="#8b5cf6" sub={clients.reduce(function(a,c){return a+c.locations.length;},0)+" locations"}/>
    </div>
    {breaches.length>0&&<Card style={{marginBottom:20,borderLeft:"4px solid #ef4444",background:"#fef2f2"}}>
      <div style={{fontWeight:700,color:"#dc2626",marginBottom:10}}>🚨 SLA Breach Alerts</div>
      {breaches.slice(0,5).map(function(t){ return <div key={t.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#fff",padding:"8px 12px",borderRadius:8,border:"1px solid #fecaca",marginBottom:6}}><span style={{fontWeight:600,fontSize:12}}>#{t.id} — {t.title}</span><div style={{display:"flex",gap:8,alignItems:"center"}}><Badge label={t.status} color={STATUS_META[t.status]?.color||"#6366f1"}/><Btn size="sm" variant="ghost" onClick={function(){setSelTicket(t.id);}}>View</Btn></div></div>; })}
    </Card>}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginBottom:16}}>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>Tickets by Status</div><ResponsiveContainer width="100%" height={200}><PieChart><Pie data={byStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={pieLabel} fontSize={9}>{byStatus.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Pie><Tooltip/></PieChart></ResponsiveContainer></Card>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>7-Day Trend</div><ResponsiveContainer width="100%" height={200}><AreaChart data={daily}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="lbl" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Legend wrapperStyle={{fontSize:10}}/><Area type="monotone" dataKey="created" stroke="#6366f1" fill="#eef2ff" name="Created"/><Area type="monotone" dataKey="resolved" stroke="#10b981" fill="#d1fae5" name="Resolved"/></AreaChart></ResponsiveContainer></Card>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>By Priority</div><ResponsiveContainer width="100%" height={200}><BarChart data={byPri}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="value" radius={[4,4,0,0]}>{byPri.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Bar></BarChart></ResponsiveContainer></Card>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>Technician Workload</div>
        {techs.map(function(t){ var open=tickets.filter(function(tk){return tk.assignedTo===t.id&&!["Closed","Resolved"].includes(tk.status);}).length; var total=tickets.filter(function(tk){return tk.assignedTo===t.id;}).length; return <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}><Avatar name={t.name} id={t.id} size={26}/><div style={{flex:1}}><div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontWeight:600}}><span>{t.name}</span><span style={{color:"#6366f1"}}>{open} open / {total} total</span></div><div style={{background:"#e2e8f0",borderRadius:4,height:6,marginTop:4}}><div style={{background:"#6366f1",height:6,borderRadius:4,width:(total?Math.min(100,Math.round(open/total*100)):0)+"%"}}/></div></div></div>; })}
      </Card>
      <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>Tickets by Type</div>
        {byType.slice(0,7).map(function(t,i){ return <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid #f1f5f9"}}><span style={{fontSize:12,color:"#475569"}}>{t.name}</span><Badge label={t.value} color={PAL[i%PAL.length]}/></div>; })}
      </Card>
    </div>
  </div>;
}

// ── TICKET LIST ───────────────────────────────────────────────────────────────
function PageTickets(p){ var tickets=p.tickets; var users=p.users; var clients=p.clients; var ticketTypes=p.ticketTypes; var curUser=p.curUser; var setTickets=p.setTickets; var addLog=p.addLog; var showToast=p.showToast; var setSelTicket=p.setSelTicket; var setPage=p.setPage; var isAdmin=p.isAdmin;
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
        <thead><tr style={{background:"#f8fafc"}}>{["#","Title","Type","Priority","Status","Client","Location","Assigned To","SLA",""].map(function(h){return <th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.5,borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>{h}</th>;})}</tr></thead>
        <tbody>
          {filtered.length===0&&<tr><td colSpan={10} style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No tickets found</td></tr>}
          {filtered.map(function(t,i){ var asgn=fu(t.assignedTo); var type=ftt(t.typeId); var client=fcl(t.clientId); var loc=getLoc(t.clientId,t.locationId); var pri=PRI_META[t.priority]||PRI_META.medium; var sm=STATUS_META[t.status]||STATUS_META.Open; var sSla=getStatusSla(t); return <tr key={t.id} style={{borderBottom:"1px solid #f1f5f9",background:i%2===0?"#fff":"#fafafa"}}>
            <td style={{padding:"9px 12px",fontSize:11,color:"#94a3b8",fontWeight:600}}>#{t.id}</td>
            <td style={{padding:"9px 12px",maxWidth:180}}><div style={{fontWeight:600,color:"#1e293b",fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.title}</div><div style={{fontSize:10,color:"#94a3b8"}}>{ago(t.createdAt)}</div></td>
            <td style={{padding:"9px 12px"}}><Badge label={type?.name||"—"} color={type?.color||"#94a3b8"}/></td>
            <td style={{padding:"9px 12px"}}><Badge label={pri.label} color={pri.color} bg={pri.bg}/></td>
            <td style={{padding:"9px 12px"}}><Badge label={t.status} color={sm.color} bg={sm.bg}/></td>
            <td style={{padding:"9px 12px",fontSize:11,color:"#334155"}}>{client?<span>🤝 {client.name}</span>:<span style={{color:"#94a3b8"}}>—</span>}</td>
            <td style={{padding:"9px 12px",fontSize:11,color:"#334155"}}>{loc?<span>📍 {loc.name}</span>:<span style={{color:"#94a3b8"}}>—</span>}</td>
            <td style={{padding:"9px 12px"}}>{asgn?<div style={{display:"flex",alignItems:"center",gap:6}}><Avatar name={asgn.name} id={asgn.id} size={22}/><span style={{fontSize:11}}>{asgn.name}</span></div>:<span style={{fontSize:11,color:"#ef4444"}}>Unassigned</span>}</td>
            <td style={{padding:"9px 12px",minWidth:130}}>
              {sSla?<div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:3}}>
                  <span style={{color:sSla.breached?"#ef4444":"#64748b",fontWeight:600}}>{sSla.breached?"⚠️ Breached":"⏱ "+sSla.remaining+"h left"}</span>
                  <span style={{color:"#94a3b8"}}>{sSla.pct}%</span>
                </div>
                <div style={{height:5,background:"#e2e8f0",borderRadius:3,overflow:"hidden"}}>
                  <div style={{height:"100%",width:sSla.pct+"%",background:sSla.pct>=100?"#ef4444":sSla.pct>=75?"#f59e0b":"#10b981",borderRadius:3,transition:"width .3s"}}/>
                </div>
                <div style={{fontSize:9,color:"#94a3b8",marginTop:2}}>{sSla.hoursSpent}h / {sSla.hoursAllowed}h allowed</div>
              </div>:<span style={{fontSize:10,color:"#94a3b8"}}>— closed</span>}
            </td>
            <td style={{padding:"9px 12px"}}><div style={{display:"flex",gap:4}}><Btn size="sm" variant="ghost" onClick={function(){setSelTicket(t.id);}}>View</Btn>{isAdmin&&<Btn size="sm" variant="danger" onClick={function(){delTicket(t.id);}}>🗑</Btn>}</div></td>
          </tr>; })}
        </tbody>
      </table>
    </div>
  </div>;
}

// ── NEW TICKET ────────────────────────────────────────────────────────────────
function PageNewTicket(p){ var users=p.users; var companies=p.companies; var clients=p.clients; var ticketTypes=p.ticketTypes; var curUser=p.curUser; var setTickets=p.setTickets; var addLog=p.addLog; var showToast=p.showToast; var setPage=p.setPage;
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
    var now=new Date().toISOString();
    var sla=new Date(Date.now()+(tt?tt.slaHours:24)*3600000).toISOString();
    var mins=Math.max(0.017,(Date.now()-start)/60000); // decimal minutes, min ~1s
    var formOpenedAt=new Date(start).toISOString();
    var draft=Object.assign({},form,{id:"t"+Date.now(),status:"Open",priority:tt?tt.priority:"medium",submittedBy:curUser.id,assignedTo:assign.id,companyId:form.companyId,clientId:form.clientId,locationId:form.locationId,createdAt:now,updatedAt:now,submittedAt:now,formOpenedAt:formOpenedAt,slaDeadline:sla,slaBreached:false,timeToCreateMins:mins,statusHistory:[{status:"Open",assignedTo:assign.id,timestamp:now,changedBy:curUser.id,note:"Ticket created — "+assign.reason}],conversations:[],resolvedAt:null,closedAt:null,deleted:false,aiReason:assign.reason,attachments:attachments});
    setPreview({draft:draft,assign:assign});
  }
  function handleSubmit(){setTickets(function(prev){return prev.concat([preview.draft]);}); addLog("TICKET_CREATED",preview.draft.id,"Ticket \""+preview.draft.title+"\" created. "+preview.assign.reason); showToast("✅ Ticket submitted!"); setPage("tickets");}
  var previewData=[["Title",preview&&preview.draft.title],["Priority",preview&&PRI_META[preview.draft.priority]?.label],["SLA",preview&&fdt(preview.draft.slaDeadline)],["Submitted At",preview&&fdt(preview.draft.submittedAt)],["Create Time",preview&&preview.draft.timeToCreateMins+" min"],["Assigned To",preview&&(users.find(function(u){return u.id===preview.draft.assignedTo;})||{name:"Unassigned"}).name],["Attachments",preview&&preview.draft.attachments.length+" files"]];
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
function TicketDetail(p){ var ticket=p.ticket; var setTickets=p.setTickets; var users=p.users; var ticketTypes=p.ticketTypes; var companies=p.companies; var clients=p.clients; var curUser=p.curUser; var isAdmin=p.isAdmin; var isTech=p.isTech; var addLog=p.addLog; var showToast=p.showToast; var onClose=p.onClose;
  var [tab,setTab]=useState("details"); var [status,setStatus]=useState(ticket.status); var [asgn,setAsgn]=useState(ticket.assignedTo||""); var [note,setNote]=useState(""); var [typeId,setTypeId]=useState(ticket.typeId||"");
  var [msgTo,setMsgTo]=useState(""); var [msgCC,setMsgCC]=useState(""); var [msgSubj,setMsgSubj]=useState("Re: [#"+ticket.id+"] "+ticket.title); var [msgBody,setMsgBody]=useState("");
  var [smsTo,setSmsTo]=useState(""); var [smsBody,setSmsBody]=useState(""); var [smsLog,setSmsLog]=useState([]);
  var [emailSending,setEmailSending]=useState(false); var [smsSending,setSmsSending]=useState(false);
  function fu(id){return users.find(function(x){return x.id===id;});}
  var tt=ticketTypes.find(function(t){return t.id===ticket.typeId;}); var co=companies.find(function(c){return c.id===ticket.companyId;}); var client=clients.find(function(c){return c.id===ticket.clientId;}); var loc=client?client.locations.find(function(l){return l.id===ticket.locationId;}):null;
  function saveStatus(){
    var hist={status,assignedTo:asgn||null,timestamp:new Date().toISOString(),changedBy:curUser.id,note:note||"Status changed to "+status};
    var newTT=ticketTypes.find(function(t){return t.id===typeId;});
    var typeChanged=typeId&&typeId!==ticket.typeId;
    var newSlaDeadline=typeChanged&&newTT?new Date(new Date(ticket.createdAt).getTime()+newTT.slaHours*3600000).toISOString():ticket.slaDeadline;
    var newPriority=typeChanged&&newTT?newTT.priority:ticket.priority;
    if(typeChanged) hist.note=(note||"")+(note?" | ":"")+"Type changed to: "+newTT.name;
    setTickets(function(prev){return prev.map(function(t){return t.id!==ticket.id?t:Object.assign({},t,{status,assignedTo:asgn||null,typeId:typeId||t.typeId,priority:newPriority,slaDeadline:newSlaDeadline,updatedAt:new Date().toISOString(),slaBreached:new Date()>new Date(newSlaDeadline)&&!["Closed","Resolved"].includes(status),resolvedAt:status==="Resolved"&&!t.resolvedAt?new Date().toISOString():t.resolvedAt,closedAt:status==="Closed"&&!t.closedAt?new Date().toISOString():t.closedAt,statusHistory:(t.statusHistory||[]).concat([hist])});});});
    if(typeChanged) addLog("TICKET_TYPE_CHANGE",ticket.id,"Type changed to: "+newTT.name);
    addLog("TICKET_STATUS",ticket.id,"Status → "+status+". Assigned: "+(fu(asgn)?.name||"nobody")); showToast("Ticket updated"); setNote(""); onClose();
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

  // time tracking tab data
  var submitter=fu(ticket.submittedBy);
  var submittedAt=ticket.submittedAt||ticket.createdAt;
  var formOpenedAt=ticket.formOpenedAt||ticket.createdAt;
  var createMins=ticket.timeToCreateMins||0;
  var createColor=createMins<=5?"#10b981":createMins<=15?"#f59e0b":"#ef4444";

  var sSla=getStatusSla(ticket);
  var detailRows=[["Title",ticket.title],["Type",tt?.name||(ticket.customTypeName||"—")],["Priority",<Badge key="p" label={PRI_META[ticket.priority]?.label||ticket.priority} color={PRI_META[ticket.priority]?.color||"#6366f1"}/>],["Status",<Badge key="s" label={ticket.status} color={STATUS_META[ticket.status]?.color||"#6366f1"}/>],["Company",co?.name||"—"],["Submitted By",fu(ticket.submittedBy)?.name||"—"],["Assigned To",fu(ticket.assignedTo)?.name||"Unassigned"],["AI Reason",ticket.aiReason||"—"],["Created",fdt(ticket.createdAt)],["SLA Deadline",fdt(ticket.slaDeadline)],["Create Time",(ticket.timeToCreateMins||1)+" min"],["Overall SLA",ticket.slaBreached?<Badge key="sl" label="BREACHED" color="#ef4444"/>:<Badge key="sl2" label="✓ OK" color="#10b981"/>]];
  var TABS=["details","time","status","email","sms","history"].filter(function(t){if(t==="status")return isTech;return true;});
  return <Modal title={"Ticket #"+ticket.id+" — "+ticket.title} onClose={onClose} wide>
    <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
      {TABS.map(function(t){ var labels={details:"📋 Details",time:"⏱ Time",status:"🔄 Status",email:"📧 Email",sms:"📱 SMS",history:"📜 History"}; return <button key={t} onClick={function(){setTab(t);}} style={{background:tab===t?"#6366f1":"#f1f5f9",color:tab===t?"#fff":"#475569",border:"none",borderRadius:8,padding:"5px 14px",cursor:"pointer",fontSize:12,fontWeight:700}}>{labels[t]||t}</button>; })}
    </div>

    {tab==="details"&&<div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>{detailRows.map(function(pair){ var l=pair[0]; var v=pair[1]; return <div key={l} style={{background:"#f8fafc",padding:10,borderRadius:8}}><div style={{color:"#64748b",fontSize:10,fontWeight:700,textTransform:"uppercase",marginBottom:3}}>{l}</div><div style={{fontWeight:600,color:"#1e293b",fontSize:12}}>{v}</div></div>; })}</div>
      <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:14,marginBottom:14}}>
        <div style={{fontWeight:700,color:"#0369a1",fontSize:12,marginBottom:10}}>🤝 Client &amp; Location</div>
        {client?<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><div><div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",marginBottom:4}}>Client</div><div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>{client.name}</div><div style={{fontSize:11,color:"#64748b"}}>📧 {client.email}</div><div style={{fontSize:11,color:"#64748b"}}>📞 {client.phone}</div></div><div><div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",marginBottom:4}}>Location</div>{loc?<><div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>📍 {loc.name}</div><div style={{fontSize:11,color:"#64748b"}}>{loc.address}</div>{loc.floor&&<div style={{fontSize:11,color:"#64748b"}}>🏢 {loc.floor}</div>}{loc.contact&&<div style={{fontSize:11,color:"#64748b"}}>👤 {loc.contact}</div>}</>:<div style={{fontSize:12,color:"#94a3b8"}}>No location</div>}</div></div>:<div style={{fontSize:12,color:"#94a3b8"}}>No client associated.</div>}
      </div>
      <div style={{background:"#f8fafc",padding:12,borderRadius:8,fontSize:12,lineHeight:1.6,whiteSpace:"pre-wrap",color:"#334155"}}>{ticket.description}</div>
      {sSla&&<div style={{marginTop:14,background:sSla.breached?"#fef2f2":"#f0fdf4",border:"1px solid "+(sSla.breached?"#fecaca":"#bbf7d0"),borderRadius:10,padding:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{fontWeight:700,color:sSla.breached?"#dc2626":"#166534",fontSize:13}}>⏱ Status SLA — "{ticket.status}"</div>
          <Badge label={sSla.breached?"BREACHED":"✓ Within SLA"} color={sSla.breached?"#ef4444":"#10b981"}/>
        </div>
        <div style={{height:8,background:"#e2e8f0",borderRadius:4,overflow:"hidden",marginBottom:8}}>
          <div style={{height:"100%",width:sSla.pct+"%",background:sSla.pct>=100?"#ef4444":sSla.pct>=75?"#f59e0b":"#10b981",borderRadius:4,transition:"width .5s"}}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8}}>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#64748b",fontWeight:600,textTransform:"uppercase"}}>Allowed</div><div style={{fontWeight:800,fontSize:16,color:"#1e293b"}}>{sSla.hoursAllowed}h</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#64748b",fontWeight:600,textTransform:"uppercase"}}>Spent</div><div style={{fontWeight:800,fontSize:16,color:"#1e293b"}}>{sSla.hoursSpent}h</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#64748b",fontWeight:600,textTransform:"uppercase"}}>Remaining</div><div style={{fontWeight:800,fontSize:16,color:sSla.breached?"#ef4444":"#10b981"}}>{sSla.breached?"0h":sSla.remaining+"h"}</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#64748b",fontWeight:600,textTransform:"uppercase"}}>Used</div><div style={{fontWeight:800,fontSize:16,color:sSla.pct>=100?"#ef4444":sSla.pct>=75?"#f59e0b":"#10b981"}}>{sSla.pct}%</div></div>
        </div>
        <div style={{fontSize:10,color:"#94a3b8",marginTop:8}}>Entered "{ticket.status}" at: {fdtFull(sSla.enteredAt)}</div>
      </div>}
      {ticket.attachments&&ticket.attachments.length>0&&<div style={{marginTop:14}}><div style={{fontWeight:700,color:"#1e293b",fontSize:12,marginBottom:10}}>📎 Attachments ({ticket.attachments.length})</div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10}}>{ticket.attachments.map(function(a){ var isImg=a.type.startsWith("image/"); return <div key={a.id} style={{borderRadius:10,overflow:"hidden",border:"1px solid #e2e8f0",cursor:"pointer"}} onClick={function(){var w=window.open();w.document.write(isImg?'<img src="'+a.dataUrl+'" style="max-width:100%;"/>':'<video src="'+a.dataUrl+'" controls style="max-width:100%;"></video>');}}>{isImg?<img src={a.dataUrl} alt={a.name} style={{width:"100%",height:90,objectFit:"cover",display:"block"}}/>:<div style={{height:90,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#1e1b4b"}}><span style={{fontSize:32}}>▶️</span></div>}<div style={{padding:"6px 8px"}}><div style={{fontSize:10,fontWeight:600,color:"#334155",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{a.name}</div></div></div>; })}</div></div>}
    </div>}

    {tab==="time"&&<div>
      <div style={{background:"linear-gradient(135deg,#eef2ff,#f0f9ff)",border:"1px solid #c7d2fe",borderRadius:12,padding:20,marginBottom:16}}>
        <div style={{fontWeight:800,color:"#3730a3",fontSize:15,marginBottom:4}}>⏱️ Ticket Time Tracking</div>
        <div style={{fontSize:12,color:"#4338ca"}}>Full timestamp and creation time data for this ticket.</div>
      </div>
      {/* Submitter */}
      <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:16,marginBottom:14}}>
        <div style={{fontWeight:700,color:"#1e293b",fontSize:13,marginBottom:12}}>👤 Submitted By</div>
        {submitter?<div style={{display:"flex",gap:12,alignItems:"center"}}><Avatar name={submitter.name} id={submitter.id} size={42}/><div><div style={{fontWeight:700,fontSize:14,color:"#1e293b"}}>{submitter.name}</div><div style={{fontSize:12,color:"#64748b"}}>{submitter.email}</div><div style={{marginTop:4}}><Badge label={ROLE_META[submitter.role]?.label||submitter.role} color={ROLE_META[submitter.role]?.color||"#6366f1"}/></div></div></div>:<div style={{color:"#94a3b8",fontSize:12}}>Unknown user</div>}
      </div>
      {/* Timeline */}
      <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,padding:16,marginBottom:14}}>
        <div style={{fontWeight:700,color:"#1e293b",fontSize:13,marginBottom:16}}>📅 Submission Timeline</div>
        <div style={{display:"flex",flexDirection:"column",gap:0}}>
          {/* Form opened */}
          <div style={{display:"flex",gap:14,alignItems:"flex-start"}}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:"#eef2ff",border:"2px solid #6366f1",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>📝</div>
              <div style={{width:2,height:40,background:"#e2e8f0",margin:"4px 0"}}/>
            </div>
            <div style={{flex:1,paddingTop:4}}>
              <div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>Form Opened</div>
              <div style={{fontSize:12,color:"#334155",marginTop:2}}>{fdtFull(formOpenedAt)}</div>
              <div style={{fontSize:11,color:"#94a3b8",marginTop:1}}>{ago(formOpenedAt)}</div>
            </div>
          </div>
          {/* Create time bar */}
          <div style={{display:"flex",gap:14,alignItems:"flex-start"}}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:createColor+"22",border:"2px solid "+createColor,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>⏱</div>
              <div style={{width:2,height:40,background:"#e2e8f0",margin:"4px 0"}}/>
            </div>
            <div style={{flex:1,paddingTop:4}}>
              <div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>Time to Complete Form</div>
              <div style={{display:"flex",alignItems:"center",gap:10,marginTop:4}}>
                <div style={{flex:1,height:10,background:"#e2e8f0",borderRadius:5,overflow:"hidden"}}><div style={{height:"100%",width:Math.min(100,createMins/30*100)+"%",background:createColor,borderRadius:5}}/></div>
                <span style={{fontSize:16,fontWeight:800,color:createColor,minWidth:40}}>{createMins}m</span>
              </div>
              <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>{createMins<=5?"⚡ Very fast":createMins<=15?"✅ Normal pace":"🐢 Took a while"} · {fmtMs(createMins)}</div>
            </div>
          </div>
          {/* Submitted */}
          <div style={{display:"flex",gap:14,alignItems:"flex-start"}}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:"#d1fae5",border:"2px solid #10b981",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>✅</div>
              <div style={{width:2,height:40,background:"#e2e8f0",margin:"4px 0"}}/>
            </div>
            <div style={{flex:1,paddingTop:4}}>
              <div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>Ticket Submitted</div>
              <div style={{fontSize:12,color:"#334155",marginTop:2}}>{fdtFull(submittedAt)}</div>
              <div style={{fontSize:11,color:"#94a3b8",marginTop:1}}>{ago(submittedAt)}</div>
            </div>
          </div>
          {/* SLA deadline */}
          <div style={{display:"flex",gap:14,alignItems:"flex-start"}}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:ticket.slaBreached?"#fee2e2":"#fef3c7",border:"2px solid "+(ticket.slaBreached?"#ef4444":"#f59e0b"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>{ticket.slaBreached?"🚨":"⏳"}</div>
              {["Resolved","Closed"].includes(ticket.status)&&<div style={{width:2,height:40,background:"#e2e8f0",margin:"4px 0"}}/>}
            </div>
            <div style={{flex:1,paddingTop:4}}>
              <div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>SLA Deadline</div>
              <div style={{fontSize:12,color:"#334155",marginTop:2}}>{fdtFull(ticket.slaDeadline)}</div>
              <div style={{marginTop:4}}>{ticket.slaBreached&&!["Resolved","Closed"].includes(ticket.status)?<Badge label="⚠️ SLA BREACHED" color="#ef4444"/>:<Badge label="✓ Within SLA" color="#10b981"/>}</div>
            </div>
          </div>
          {/* Resolved */}
          {ticket.resolvedAt&&<div style={{display:"flex",gap:14,alignItems:"flex-start"}}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}><div style={{width:36,height:36,borderRadius:"50%",background:"#d1fae5",border:"2px solid #10b981",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🎉</div></div>
            <div style={{flex:1,paddingTop:4}}>
              <div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>Resolved</div>
              <div style={{fontSize:12,color:"#334155",marginTop:2}}>{fdtFull(ticket.resolvedAt)}</div>
              <div style={{fontSize:11,color:"#10b981",marginTop:1,fontWeight:600}}>Total resolution time: {Math.round((new Date(ticket.resolvedAt)-new Date(submittedAt))/3600000)}h</div>
            </div>
          </div>}
        </div>
      </div>
      {/* Raw data */}
      <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:16}}>
        <div style={{fontWeight:700,color:"#1e293b",fontSize:13,marginBottom:12}}>🗂 Raw Timestamps</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {[["Form Opened",formOpenedAt],["Submitted At",submittedAt],["Last Updated",ticket.updatedAt],["SLA Deadline",ticket.slaDeadline],["Resolved At",ticket.resolvedAt||null],["Closed At",ticket.closedAt||null]].map(function(pair){
            var l=pair[0]; var v=pair[1];
            return <div key={l} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:8,padding:"10px 12px"}}>
              <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",marginBottom:3}}>{l}</div>
              <div style={{fontSize:11,fontWeight:600,color:v?"#1e293b":"#94a3b8"}}>{v?fdtFull(v):"—"}</div>
              {v&&<div style={{fontSize:10,color:"#94a3b8",marginTop:2}}>{ago(v)}</div>}
            </div>;
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
      <div style={{marginBottom:16}}>
        <div style={{fontWeight:700,color:"#1e293b",marginBottom:10}}>📧 Send Email</div>
        <FInput label="To (comma-separated)" value={msgTo} onChange={function(e){setMsgTo(e.target.value);}} placeholder="john@client.com"/>
        <FInput label="CC" value={msgCC} onChange={function(e){setMsgCC(e.target.value);}} placeholder="manager@company.com"/>
        <FInput label="Subject" value={msgSubj} onChange={function(e){setMsgSubj(e.target.value);}}/>
        <FTextarea label="Message" value={msgBody} onChange={function(e){setMsgBody(e.target.value);}} rows={4} placeholder="Type your message…"/>
        <button onClick={sendEmail} disabled={emailSending} style={{background:emailSending?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:8,padding:"8px 18px",fontWeight:600,fontSize:13,cursor:emailSending?"not-allowed":"pointer"}}>{emailSending?"⏳ Sending…":"📤 Send Email"}</button>
      </div>
      <hr style={{margin:"14px 0",border:"none",borderTop:"1px solid #e2e8f0"}}/>
      <div style={{fontWeight:700,color:"#1e293b",marginBottom:10}}>📬 Conversation Trail ({(ticket.conversations||[]).length})</div>
      {(ticket.conversations||[]).length===0&&<div style={{color:"#94a3b8",fontSize:12}}>No messages yet.</div>}
      {(ticket.conversations||[]).map(function(m){ return <div key={m.id} style={{background:m.isExternal?"#fff7ed":"#f8fafc",border:"1px solid "+(m.isExternal?"#fed7aa":"#e2e8f0"),borderRadius:10,padding:12,marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><div style={{fontWeight:700,fontSize:12,color:m.isExternal?"#ea580c":"#1e293b"}}>{m.isExternal?"📬 EXTERNAL":"📧"} {m.fromEmail}{m.toEmails&&m.toEmails.length>0&&<span style={{color:"#64748b",fontWeight:400}}> → {m.toEmails.join(", ")}</span>}</div><div style={{display:"flex",gap:4,alignItems:"center"}}>{m.status==="sending"&&<span style={{fontSize:10,color:"#f59e0b"}}>⏳</span>}{m.status==="sent"&&<span style={{fontSize:10,color:"#10b981"}}>✅</span>}{m.status==="failed"&&<span style={{fontSize:10,color:"#ef4444"}}>❌</span>}<span style={{fontSize:10,color:"#94a3b8"}}>{fdt(m.timestamp)}</span></div></div>{m.cc&&m.cc.length>0&&<div style={{fontSize:11,color:"#94a3b8",marginBottom:4}}>CC: {m.cc.join(", ")}</div>}<div style={{fontSize:11,color:"#64748b",marginBottom:4}}>Subj: {m.subject}</div><div style={{fontSize:12,color:"#334155",whiteSpace:"pre-wrap",lineHeight:1.6}}>{m.body}</div></div>; })}
    </div>}
    {tab==="sms"&&<div>
      <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:10,marginBottom:14,fontSize:12}}>📱 <strong>SMS Tracker</strong> — Logged via Twilio API.</div>
      <FInput label="Phone Number" value={smsTo} onChange={function(e){setSmsTo(e.target.value);}} placeholder="+1-555-0123"/>
      <FTextarea label="Message" value={smsBody} onChange={function(e){setSmsBody(e.target.value);}} rows={3} placeholder="Type SMS…"/>
      <button onClick={sendSms} disabled={smsSending} style={{background:smsSending?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:8,padding:"8px 18px",fontWeight:600,fontSize:13,cursor:smsSending?"not-allowed":"pointer"}}>{smsSending?"⏳ Sending…":"📱 Send & Track SMS"}</button>
      <hr style={{margin:"14px 0",border:"none",borderTop:"1px solid #e2e8f0"}}/>
      <div style={{fontWeight:700,marginBottom:8}}>SMS Log</div>
      {smsLog.length===0&&<div style={{color:"#94a3b8",fontSize:12}}>No SMS tracked yet.</div>}
      {smsLog.map(function(s){ return <div key={s.id} style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:10,marginBottom:8,fontSize:12}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><div style={{fontWeight:700}}>📱 → {s.to}</div><Badge label={s.status} color={s.status==="delivered"?"#10b981":s.status==="failed"?"#ef4444":"#f59e0b"}/></div><div style={{color:"#334155"}}>{s.body}</div><div style={{fontSize:10,color:"#94a3b8",marginTop:4}}>By {s.from} · {fdt(s.ts)}</div></div>; })}
    </div>}
    {tab==="history"&&<div>
      <div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>📜 Status History</div>
      {(ticket.statusHistory||[]).slice().reverse().map(function(h,i){ return <div key={i} style={{display:"flex",gap:12,marginBottom:12}}><div style={{width:10,height:10,borderRadius:"50%",background:STATUS_META[h.status]?.color||"#6366f1",marginTop:4,flexShrink:0}}/><div style={{flex:1,background:"#f8fafc",borderRadius:8,padding:10}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><Badge label={h.status} color={STATUS_META[h.status]?.color||"#6366f1"}/><span style={{fontSize:10,color:"#94a3b8"}}>{fdt(h.timestamp)}</span></div><div style={{fontSize:11,color:"#64748b",marginTop:4}}>Assigned: <strong>{fu(h.assignedTo)?.name||"Unassigned"}</strong></div><div style={{fontSize:11,color:"#475569"}}>By: {fu(h.changedBy)?.name||"System"}</div>{h.note&&<div style={{fontSize:11,color:"#334155",marginTop:4,fontStyle:"italic"}}>{h.note}</div>}</div></div>; })}
    </div>}
  </Modal>;
}

// ── REPORTS ────────────────────────────────────────────────────────────────────
function PageReports(p){ var tickets=p.tickets; var users=p.users; var ticketTypes=p.ticketTypes; var clients=p.clients;
  var [view,setView]=useState("summary"); var [range,setRange]=useState("month"); var [aiInsight,setAiInsight]=useState(""); var [aiLoading,setAiLoading]=useState(false);
  var rangeStart=useMemo(function(){ var now=new Date(); if(range==="day")return new Date(now.getFullYear(),now.getMonth(),now.getDate()).toISOString(); if(range==="week")return new Date(now.getTime()-7*86400000).toISOString(); if(range==="month")return new Date(now.getTime()-30*86400000).toISOString(); if(range==="year")return new Date(now.getTime()-365*86400000).toISOString(); return new Date(0).toISOString(); },[range]);
  var rangeLabel={day:"Today",week:"Last 7 Days",month:"Last 30 Days",year:"Last 12 Months",all:"All Time"};
  var techs=users.filter(function(u){return ["it_technician","it_manager","admin"].includes(u.role);});
  var active=tickets.filter(function(t){return !t.deleted&&new Date(t.createdAt)>=new Date(rangeStart);});
  var allActive=tickets.filter(function(t){return !t.deleted;});
  function avgH(arr){return arr.length?Math.round(arr.reduce(function(a,t){return a+(new Date(t.resolvedAt||t.updatedAt)-new Date(t.createdAt))/3600000;},0)/arr.length):0;}
  function slaRt(arr){return arr.length?Math.round((1-arr.filter(function(t){return t.slaBreached;}).length/arr.length)*100):100;}
  function resolved(arr){return arr.filter(function(t){return ["Resolved","Closed"].includes(t.status);});}
  var byType=ticketTypes.map(function(tt,i){ var mine=active.filter(function(t){return t.typeId===tt.id;}); var res=resolved(mine); return {id:tt.id,name:tt.name,color:tt.color,priority:tt.priority,slaH:tt.slaHours,total:mine.length,open:mine.filter(function(t){return t.status==="Open";}).length,inProg:mine.filter(function(t){return t.status==="In Progress";}).length,resolved:res.length,breached:mine.filter(function(t){return t.slaBreached;}).length,slaRate:slaRt(mine),avgClose:avgH(res),fill:PAL[i%PAL.length]}; }).filter(function(x){return x.total>0;});
  var byUser=techs.map(function(t){ var mine=active.filter(function(tk){return tk.assignedTo===t.id;}); var res=resolved(mine); var avgStatus=ALL_STATUSES.map(function(s){ var sm=mine.filter(function(tk){return tk.status===s;}); return {s:s,h:sm.length?Math.round(sm.reduce(function(a,tk){return a+(new Date(tk.updatedAt)-new Date(tk.createdAt))/3600000;},0)/sm.length):0}; }); return {id:t.id,name:t.name,role:t.role,total:mine.length,open:mine.filter(function(t){return t.status==="Open";}).length,inProg:mine.filter(function(t){return t.status==="In Progress";}).length,escalated:mine.filter(function(t){return t.status==="Escalated";}).length,resolved:res.length,breached:mine.filter(function(t){return t.slaBreached;}).length,slaRate:slaRt(mine),avgClose:avgH(res),createMins:Math.round(mine.reduce(function(a,t){return a+(t.timeToCreateMins||0);},0)/Math.max(mine.length,1)),avgStatus:avgStatus}; });
  var byClient=clients.map(function(cl){ var mine=active.filter(function(t){return t.clientId===cl.id;}); var res=resolved(mine); return {id:cl.id,name:cl.name,industry:cl.industry,total:mine.length,open:mine.filter(function(t){return t.status==="Open";}).length,resolved:res.length,breached:mine.filter(function(t){return t.slaBreached;}).length,slaRate:slaRt(mine),avgClose:avgH(res)}; }).filter(function(x){return x.total>0;});
  var byLocation=clients.flatMap(function(cl){ return cl.locations.map(function(loc){ var mine=active.filter(function(t){return t.locationId===loc.id;}); var res=resolved(mine); return {id:loc.id,locName:loc.name,clientName:cl.name,address:loc.address,total:mine.length,open:mine.filter(function(t){return t.status==="Open";}).length,resolved:res.length,breached:mine.filter(function(t){return t.slaBreached;}).length,slaRate:slaRt(mine),avgClose:avgH(res)}; }); }).filter(function(x){return x.total>0;});
  var totalBreached=active.filter(function(t){return t.slaBreached;}).length;
  var totalSlaRate=slaRt(active); var avgCloseAll=avgH(resolved(active)); var avgCreateAll=Math.round(active.reduce(function(a,t){return a+(t.timeToCreateMins||0);},0)/Math.max(active.length,1));
  var avgPerStatus=ALL_STATUSES.map(function(s){ var mine=active.filter(function(t){return t.status===s;}); return {status:s,count:mine.length,color:STATUS_META[s].color,avgH:mine.length?Math.round(mine.reduce(function(a,t){return a+(new Date(t.updatedAt)-new Date(t.createdAt))/3600000;},0)/mine.length):0}; });
  var weeklyTrend=useMemo(function(){ return Array.from({length:12},function(_,i){ var wEnd=new Date(Date.now()-(11-i)*7*86400000); var wStart=new Date(wEnd.getTime()-7*86400000); var wT=allActive.filter(function(t){var d=new Date(t.createdAt);return d>=wStart&&d<wEnd;}); var row={label:"W"+(i+1)+" "+wEnd.toLocaleDateString("en",{month:"short",day:"numeric"}),total:wT.length,resolved:wT.filter(function(t){return ["Resolved","Closed"].includes(t.status);}).length,breached:wT.filter(function(t){return t.slaBreached;}).length}; ticketTypes.forEach(function(tt){row[tt.name]=wT.filter(function(t){return t.typeId===tt.id;}).length;}); return row; }); },[allActive,ticketTypes]);
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
  async function generateInsight(){ setAiLoading(true); setAiInsight(""); var summary={totalTickets:allActive.length,slaRate:slaRt(allActive),avgClose:avgH(resolved(allActive)),topTypes:top3Types.map(function(t){return t.name+" ("+t.total+")";}),breached:allActive.filter(function(t){return t.slaBreached;}).length,openCount:allActive.filter(function(t){return t.status==="Open";}).length,escalated:allActive.filter(function(t){return t.status==="Escalated";}).length,weeklyVolume:weeklyTrend.map(function(w){return w.label+": "+w.total;}),byType:byType.map(function(t){return t.name+": "+t.total+" tickets, SLA "+t.slaRate+"%";}),byUser:byUser.map(function(u){return u.name+": "+u.total+" tickets, SLA "+u.slaRate+"%, avg close "+u.avgClose+"h";})}; try{var res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,messages:[{role:"user",content:"You are an IT helpdesk analyst. Analyze this ticketing data and provide:\n1. Top 3 issues and their business impact\n2. SLA performance analysis\n3. Workload distribution observations\n4. 3 actionable recommendations\n5. Trend analysis from the 12-week data\n\nKeep it professional and concise. Use bullet points.\n\nData:\n"+JSON.stringify(summary,null,2)}]})}); var data=await res.json(); setAiInsight(data.content&&data.content[0]?data.content[0].text:"Unable to generate insight.");}catch(e){setAiInsight("Error: "+e.message);} setAiLoading(false); }
  function TH(hp){return <th style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.4,borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>{hp.children}</th>;}
  function TD(dp){return <td style={{padding:"9px 12px",fontSize:12,fontWeight:dp.bold?700:400,color:"#1e293b"}}>{dp.children}</td>;}
  var VIEWS=[{id:"summary",label:"📊 Summary"},{id:"trend",label:"📈 Trend"},{id:"by_type",label:"🏷️ By Type"},{id:"per_user",label:"👤 Per User"},{id:"per_client",label:"🤝 Per Client"},{id:"per_location",label:"📍 Per Location"},{id:"sla",label:"⏱ SLA & Time"}];
  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{VIEWS.map(function(v){return <Btn key={v.id} variant={view===v.id?"primary":"ghost"} onClick={function(){setView(v.id);}} size="sm">{v.label}</Btn>;})}</div><div style={{display:"flex",gap:6,alignItems:"center"}}><span style={{fontSize:12,color:"#64748b",fontWeight:600}}>Period:</span>{["day","week","month","year","all"].map(function(r){return <button key={r} onClick={function(){setRange(r);}} style={{padding:"5px 12px",borderRadius:8,border:"1px solid "+(range===r?"#6366f1":"#e2e8f0"),background:range===r?"#6366f1":"#fff",color:range===r?"#fff":"#475569",fontSize:11,fontWeight:600,cursor:"pointer"}}>{rangeLabel[r]}</button>;})}</div></div>
    <div style={{background:"#eef2ff",border:"1px solid #c7d2fe",borderRadius:8,padding:"8px 14px",marginBottom:16,fontSize:12,color:"#4338ca",fontWeight:600}}><span>📅 Showing: <strong>{rangeLabel[range]}</strong> — {active.length} tickets</span></div>
    {view==="summary"&&<div><div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}><Stat label="Total Tickets" value={active.length} icon="🎫" color="#6366f1"/><Stat label="SLA Rate" value={totalSlaRate+"%"} icon="🎯" color={slaColor(totalSlaRate)} sub={totalBreached+" breached"}/><Stat label="Avg Close Time" value={avgCloseAll+"h"} icon="⏱" color="#0ea5e9"/><Stat label="Avg Create Time" value={avgCreateAll+"m"} icon="📝" color="#8b5cf6"/><Stat label="Resolved" value={resolved(active).length} icon="✅" color="#10b981" sub={Math.round(resolved(active).length/Math.max(active.length,1)*100)+"% rate"}/><Stat label="Escalated" value={active.filter(function(t){return t.status==="Escalated";}).length} icon="🚨" color="#ef4444"/></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}><Card><div style={{fontWeight:700,marginBottom:12}}>Tickets by Status</div><ResponsiveContainer width="100%" height={200}><PieChart><Pie data={statusPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={pieLabel} fontSize={9}>{statusPieData.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Pie><Tooltip/></PieChart></ResponsiveContainer></Card><Card><div style={{fontWeight:700,marginBottom:12}}>Tickets by Priority</div><ResponsiveContainer width="100%" height={200}><BarChart data={byPriChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="value" radius={[4,4,0,0]}>{byPriChart.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Bar></BarChart></ResponsiveContainer></Card></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}><Card><div style={{fontWeight:700,marginBottom:12}}>Average Time per Status (hours)</div>{avgPerStatus.map(function(s){return <div key={s.status} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}><div style={{width:10,height:10,borderRadius:"50%",background:s.color,flexShrink:0}}/><div style={{flex:1,fontSize:12}}>{s.status}</div><Badge label={s.count+" tickets"} color={s.color}/><div style={{fontSize:12,fontWeight:700,color:"#1e293b",minWidth:40,textAlign:"right"}}>{s.avgH}h</div></div>;})}</Card><Card><div style={{fontWeight:700,marginBottom:12}}>Top Ticket Types</div>{byType.slice(0,6).map(function(t,i){return <div key={t.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f1f5f9"}}><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:8,height:8,borderRadius:"50%",background:t.color}}/><span style={{fontSize:12}}>{t.name}</span></div><div style={{display:"flex",gap:6,alignItems:"center"}}><Badge label={t.total+" tickets"} color={t.color}/><Badge label={t.slaRate+"%"} color={slaColor(t.slaRate)}/></div></div>;})}</Card></div></div>}
    {view==="trend"&&<div><div style={{marginBottom:16,display:"flex",alignItems:"center",gap:10}}><div style={{fontWeight:700,fontSize:14,color:"#1e293b"}}>📈 12-Week Ticket Trend</div></div><Card style={{marginBottom:16}}><div style={{fontWeight:700,marginBottom:12}}>Weekly Volume</div><ResponsiveContainer width="100%" height={260}><AreaChart data={weeklyTrend}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="label" tick={{fontSize:9}} angle={-25} textAnchor="end" height={50}/><YAxis tick={{fontSize:10}}/><Tooltip/><Legend wrapperStyle={{fontSize:11}}/><Area type="monotone" dataKey="total" stroke="#6366f1" fill="#eef2ff" name="Total" strokeWidth={2}/><Area type="monotone" dataKey="resolved" stroke="#10b981" fill="#d1fae5" name="Resolved" strokeWidth={2}/><Area type="monotone" dataKey="breached" stroke="#ef4444" fill="#fee2e2" name="Breached" strokeWidth={2}/></AreaChart></ResponsiveContainer></Card><Card style={{marginBottom:16}}><div style={{fontWeight:700,marginBottom:12}}>Issue Type Trend — Top 3</div><ResponsiveContainer width="100%" height={260}><LineChart data={weeklyTrend}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="label" tick={{fontSize:9}} angle={-25} textAnchor="end" height={50}/><YAxis tick={{fontSize:10}}/><Tooltip/><Legend wrapperStyle={{fontSize:11}}/>{trendLines}</LineChart></ResponsiveContainer></Card><Card style={{borderLeft:"4px solid #6366f1"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><div><div style={{fontWeight:700,fontSize:14,color:"#1e293b"}}>🤖 AI-Generated Insights</div><div style={{fontSize:11,color:"#64748b",marginTop:2}}>Analyzes trends and generates actionable recommendations</div></div><button onClick={generateInsight} disabled={aiLoading} style={{padding:"9px 18px",background:aiLoading?"#a5b4fc":"linear-gradient(135deg,#6366f1,#4338ca)",color:"#fff",border:"none",borderRadius:10,fontWeight:700,fontSize:13,cursor:aiLoading?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:6}}>{aiLoading?<><span style={{display:"inline-block",width:14,height:14,border:"2px solid #fff",borderTop:"2px solid transparent",borderRadius:"50%",animation:"spin .7s linear infinite"}}/> Analyzing…</>:"✨ Generate Insights"}</button></div>{!aiInsight&&!aiLoading&&<div style={{background:"#f8fafc",borderRadius:10,padding:20,textAlign:"center",color:"#94a3b8"}}><div style={{fontSize:32,marginBottom:8}}>🧠</div><div style={{fontSize:13,fontWeight:600,color:"#475569",marginBottom:4}}>Ready to analyze your data</div></div>}{aiLoading&&<div style={{background:"#f8fafc",borderRadius:10,padding:24,textAlign:"center"}}><div style={{fontSize:13,color:"#6366f1",fontWeight:600}}>🤖 Analyzing…</div></div>}{aiInsight&&!aiLoading&&<div style={{background:"#f8fafc",borderRadius:10,padding:20}}><div style={{fontSize:12,color:"#334155",lineHeight:1.9,whiteSpace:"pre-wrap"}}>{aiInsight}</div><div style={{marginTop:12,paddingTop:10,borderTop:"1px solid #e2e8f0",display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:10,color:"#94a3b8"}}>Generated {new Date().toLocaleString()}</span><button onClick={generateInsight} style={{background:"none",border:"1px solid #e2e8f0",borderRadius:6,padding:"4px 10px",fontSize:11,color:"#6366f1",cursor:"pointer",fontWeight:600}}>↻ Refresh</button></div></div>}</Card></div>}
    {view==="by_type"&&<div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginBottom:16}}><Card><div style={{fontWeight:700,marginBottom:12}}>Volume by Type</div><ResponsiveContainer width="100%" height={220}><BarChart data={byTypeVolChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:9}} angle={-20} textAnchor="end" height={40}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="total" radius={[4,4,0,0]}>{byTypeVolChart.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Bar></BarChart></ResponsiveContainer></Card><Card><div style={{fontWeight:700,marginBottom:12}}>SLA Rate by Type</div><ResponsiveContainer width="100%" height={220}><BarChart data={byTypeSlaChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:9}} angle={-20} textAnchor="end" height={40}/><YAxis tick={{fontSize:10}} domain={[0,100]}/><Tooltip/><Bar dataKey="slaRate" radius={[4,4,0,0]}>{byTypeSlaChart.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Bar></BarChart></ResponsiveContainer></Card></div><Card style={{padding:0,overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:750}}><thead><tr style={{background:"#f8fafc"}}><TH>Type</TH><TH>Priority</TH><TH>SLA Limit</TH><TH>Total</TH><TH>Open</TH><TH>In Progress</TH><TH>Resolved</TH><TH>Breached</TH><TH>SLA Rate</TH><TH>Avg Close</TH></tr></thead><tbody>{byType.map(function(t){return <tr key={t.id} style={{borderBottom:"1px solid #f1f5f9"}}><TD><Badge label={t.name} color={t.color}/></TD><TD><Badge label={PRI_META[t.priority]?.label} color={PRI_META[t.priority]?.color}/></TD><TD>{t.slaH}h</TD><TD bold>{t.total}</TD><TD><Badge label={t.open} color="#f59e0b"/></TD><TD><Badge label={t.inProg} color="#6366f1"/></TD><TD><Badge label={t.resolved} color="#10b981"/></TD><TD><Badge label={t.breached} color={t.breached>0?"#ef4444":"#10b981"}/></TD><TD><Badge label={t.slaRate+"%"} color={slaColor(t.slaRate)}/></TD><TD>{t.avgClose}h</TD></tr>;})}</tbody></table></Card></div>}
    {view==="per_user"&&<div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginBottom:16}}><Card><div style={{fontWeight:700,marginBottom:12}}>Tickets per Technician</div><ResponsiveContainer width="100%" height={220}><BarChart data={byUserStackChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Legend wrapperStyle={{fontSize:10}}/><Bar dataKey="resolved" fill="#10b981" name="Resolved" stackId="a"/><Bar dataKey="open" fill="#f59e0b" name="Open" stackId="a"/><Bar dataKey="inProg" fill="#6366f1" name="In Prog" stackId="a"/></BarChart></ResponsiveContainer></Card><Card><div style={{fontWeight:700,marginBottom:12}}>SLA Rate per Technician</div><ResponsiveContainer width="100%" height={220}><BarChart data={byUserSlaChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}} domain={[0,100]}/><Tooltip/><Bar dataKey="slaRate" radius={[4,4,0,0]}>{byUserSlaChart.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Bar></BarChart></ResponsiveContainer></Card></div><Card style={{padding:0,overflow:"auto",marginBottom:16}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:850}}><thead><tr style={{background:"#f8fafc"}}><TH>Technician</TH><TH>Total</TH><TH>Open</TH><TH>In Prog</TH><TH>Escalated</TH><TH>Resolved</TH><TH>Breached</TH><TH>SLA Rate</TH><TH>Avg Close</TH><TH>Avg Create</TH></tr></thead><tbody>{byUser.map(function(t){return <tr key={t.id} style={{borderBottom:"1px solid #f1f5f9"}}><TD><div style={{display:"flex",gap:8,alignItems:"center"}}><Avatar name={t.name} id={t.id} size={26}/><div><div style={{fontWeight:600,fontSize:12}}>{t.name}</div><div style={{fontSize:10,color:"#94a3b8"}}>{ROLE_META[t.role]?.label}</div></div></div></TD><TD bold>{t.total}</TD><TD><Badge label={t.open} color="#f59e0b"/></TD><TD><Badge label={t.inProg} color="#6366f1"/></TD><TD><Badge label={t.escalated} color="#ef4444"/></TD><TD><Badge label={t.resolved} color="#10b981"/></TD><TD><Badge label={t.breached} color={t.breached>0?"#ef4444":"#10b981"}/></TD><TD><Badge label={t.slaRate+"%"} color={slaColor(t.slaRate)}/></TD><TD>{t.avgClose}h</TD><TD>{t.createMins}m</TD></tr>;})}</tbody></table></Card><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>{byUser.filter(function(u){return u.total>0;}).map(function(u){return <Card key={u.id}><div style={{display:"flex",gap:8,alignItems:"center",marginBottom:12}}><Avatar name={u.name} id={u.id} size={28}/><div><div style={{fontWeight:700,fontSize:13}}>{u.name}</div><div style={{fontSize:10,color:"#94a3b8"}}>Avg time per status</div></div></div>{u.avgStatus.map(function(s){return <div key={s.s} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:"1px solid #f8fafc"}}><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:7,height:7,borderRadius:"50%",background:STATUS_META[s.s].color}}/><span style={{fontSize:11,color:"#475569"}}>{s.s}</span></div><span style={{fontSize:11,fontWeight:600,color:"#1e293b"}}>{s.h}h</span></div>;})}</Card>;})}</div></div>}
    {view==="per_client"&&<div>{byClient.length===0&&<Card><div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No client ticket data yet.</div></Card>}{byClient.length>0&&<><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginBottom:16}}><Card><div style={{fontWeight:700,marginBottom:12}}>Tickets per Client</div><ResponsiveContainer width="100%" height={220}><BarChart data={byClientVolChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="total" radius={[4,4,0,0]}>{byClientVolChart.map(function(_,i){return <Cell key={i} fill={PAL[i%PAL.length]}/>;})}</Bar></BarChart></ResponsiveContainer></Card><Card><div style={{fontWeight:700,marginBottom:12}}>SLA Rate per Client</div><ResponsiveContainer width="100%" height={220}><BarChart data={byClientSlaChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}} domain={[0,100]}/><Tooltip/><Bar dataKey="slaRate" radius={[4,4,0,0]}>{byClientSlaChart.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Bar></BarChart></ResponsiveContainer></Card></div><Card style={{padding:0,overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:650}}><thead><tr style={{background:"#f8fafc"}}><TH>Client</TH><TH>Industry</TH><TH>Total</TH><TH>Open</TH><TH>Resolved</TH><TH>Breached</TH><TH>SLA Rate</TH><TH>Avg Close</TH></tr></thead><tbody>{byClient.map(function(c,i){return <tr key={c.id} style={{borderBottom:"1px solid #f1f5f9"}}><TD><div style={{display:"flex",gap:8,alignItems:"center"}}><div style={{width:28,height:28,borderRadius:6,background:PAL[i%PAL.length],display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:12}}>{c.name[0]}</div><span style={{fontWeight:600}}>{c.name}</span></div></TD><TD>{c.industry||"—"}</TD><TD bold>{c.total}</TD><TD><Badge label={c.open} color="#f59e0b"/></TD><TD><Badge label={c.resolved} color="#10b981"/></TD><TD><Badge label={c.breached} color={c.breached>0?"#ef4444":"#10b981"}/></TD><TD><Badge label={c.slaRate+"%"} color={slaColor(c.slaRate)}/></TD><TD>{c.avgClose}h</TD></tr>;})}</tbody></table></Card></>}</div>}
    {view==="per_location"&&<div>{byLocation.length===0&&<Card><div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No location ticket data yet.</div></Card>}{byLocation.length>0&&<><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginBottom:16}}><Card><div style={{fontWeight:700,marginBottom:12}}>Tickets per Location</div><ResponsiveContainer width="100%" height={220}><BarChart data={byLocVolChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:9}} angle={-15} textAnchor="end" height={45}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="total" radius={[4,4,0,0]}>{byLocVolChart.map(function(_,i){return <Cell key={i} fill={PAL[i%PAL.length]}/>;})}</Bar></BarChart></ResponsiveContainer></Card><Card><div style={{fontWeight:700,marginBottom:12}}>SLA Rate per Location</div><ResponsiveContainer width="100%" height={220}><BarChart data={byLocSlaChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:9}} angle={-15} textAnchor="end" height={45}/><YAxis tick={{fontSize:10}} domain={[0,100]}/><Tooltip/><Bar dataKey="slaRate" radius={[4,4,0,0]}>{byLocSlaChart.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Bar></BarChart></ResponsiveContainer></Card></div><Card style={{padding:0,overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:700}}><thead><tr style={{background:"#f8fafc"}}><TH>Location</TH><TH>Client</TH><TH>Address</TH><TH>Total</TH><TH>Open</TH><TH>Resolved</TH><TH>Breached</TH><TH>SLA Rate</TH><TH>Avg Close</TH></tr></thead><tbody>{byLocation.map(function(l){return <tr key={l.id} style={{borderBottom:"1px solid #f1f5f9"}}><TD><div style={{display:"flex",gap:6,alignItems:"center"}}><span style={{fontSize:14}}>📍</span><span style={{fontWeight:600}}>{l.locName}</span></div></TD><TD>{l.clientName}</TD><td style={{padding:"9px 12px",fontSize:11,color:"#64748b",maxWidth:180,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{l.address}</td><TD bold>{l.total}</TD><TD><Badge label={l.open} color="#f59e0b"/></TD><TD><Badge label={l.resolved} color="#10b981"/></TD><TD><Badge label={l.breached} color={l.breached>0?"#ef4444":"#10b981"}/></TD><TD><Badge label={l.slaRate+"%"} color={slaColor(l.slaRate)}/></TD><TD>{l.avgClose}h</TD></tr>;})}</tbody></table></Card></>}</div>}
    {view==="sla"&&<div><div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}><Stat label="Overall SLA Rate" value={totalSlaRate+"%"} icon="🎯" color={slaColor(totalSlaRate)} sub={totalBreached+" breaches"}/><Stat label="Avg Close Time" value={avgCloseAll+"h"} icon="⏱" color="#0ea5e9"/><Stat label="Avg Create Time" value={avgCreateAll+"m"} icon="📝" color="#8b5cf6"/><Stat label="SLA Met" value={active.length-totalBreached} icon="✅" color="#10b981" sub={"out of "+active.length}/><Stat label="Critical Breaches" value={active.filter(function(t){return t.slaBreached&&t.priority==="critical";}).length} icon="🚨" color="#dc2626"/></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}><Card><div style={{fontWeight:700,marginBottom:12}}>SLA Rate by Type</div><ResponsiveContainer width="100%" height={220}><BarChart data={byTypeSlaChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:9}} angle={-15} textAnchor="end" height={45}/><YAxis tick={{fontSize:10}} domain={[0,100]}/><Tooltip/><Bar dataKey="slaRate" radius={[4,4,0,0]}>{byTypeSlaChart.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Bar></BarChart></ResponsiveContainer></Card><Card><div style={{fontWeight:700,marginBottom:12}}>SLA Rate per Technician</div><ResponsiveContainer width="100%" height={220}><BarChart data={byUserSlaChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}} domain={[0,100]}/><Tooltip/><Bar dataKey="slaRate" radius={[4,4,0,0]}>{byUserSlaChart.map(function(e,i){return <Cell key={i} fill={e.color}/>;})}</Bar></BarChart></ResponsiveContainer></Card></div><Card style={{marginBottom:16}}><div style={{fontWeight:700,marginBottom:12}}>Average Close Time per Technician</div><ResponsiveContainer width="100%" height={200}><BarChart data={byUserCloseChart}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="avgClose" fill="#0ea5e9" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></Card><Card><div style={{fontWeight:700,marginBottom:14}}>Average Time per Status</div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10}}>{avgPerStatus.map(function(s){return <div key={s.status} style={{background:STATUS_META[s.status].bg,border:"1px solid "+STATUS_META[s.status].color+"44",borderRadius:10,padding:14,textAlign:"center"}}><div style={{fontSize:11,fontWeight:700,color:STATUS_META[s.status].color,textTransform:"uppercase",marginBottom:4}}>{s.status}</div><div style={{fontSize:24,fontWeight:800,color:"#1e293b"}}>{s.avgH}<span style={{fontSize:12,fontWeight:400,color:"#64748b"}}>h</span></div><div style={{fontSize:11,color:"#64748b",marginTop:2}}>{s.count} tickets</div></div>;})}</div></Card></div>}
  </div>;
}

// ── USERS ─────────────────────────────────────────────────────────────────────
function PageUsers(p){ var users=p.users; var companies=p.companies; var setUsers=p.setUsers; var curUser=p.curUser; var addLog=p.addLog; var showToast=p.showToast;
  var [modal,setModal]=useState(null); var [form,setForm]=useState({});
  function fld(k,v){setForm(function(prev){return Object.assign({},prev,{[k]:v});});}
  var pendingUsers=users.filter(function(u){return !u.active;});
  function approveUser(u){setUsers(function(prev){return prev.map(function(x){return x.id===u.id?Object.assign({},x,{active:true}):x;});}); addLog("USER_APPROVED",u.id,u.name+" approved"); showToast("✅ Account approved!");}
  function save(){if(!form.name||!form.email){showToast("Name and email required","error");return;}     if(modal==="new"){var nu=Object.assign({},form,{id:uid(),createdAt:new Date().toISOString(),lastLogin:null});setUsers(function(prev){return prev.concat([nu]);});addLog("USER_CREATED",nu.id,"New user "+nu.name+" created");showToast("User created");}else{var old=users.find(function(u){return u.id===form.id;});setUsers(function(prev){return prev.map(function(u){return u.id===form.id?Object.assign({},form):u;});});if(old&&old.role!==form.role)addLog("USER_ROLE_CHANGE",form.id,"Role: "+ROLE_META[old.role]?.label+" → "+ROLE_META[form.role]?.label);showToast("User updated");}setModal(null); }
  return <div>
    {pendingUsers.length>0&&<div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:12,padding:16,marginBottom:20}}><div style={{fontWeight:700,color:"#92400e",marginBottom:10,fontSize:13}}>⏳ {pendingUsers.length} Account{pendingUsers.length>1?"s":""} Awaiting Approval</div>{pendingUsers.map(function(u){return <div key={u.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#fff",padding:"10px 14px",borderRadius:8,border:"1px solid #fde68a",marginBottom:6}}><div style={{display:"flex",gap:10,alignItems:"center"}}><Avatar name={u.name} id={u.id} size={32}/><div><div style={{fontWeight:600,fontSize:13}}>{u.name}</div><div style={{fontSize:11,color:"#64748b"}}>{u.email}</div></div></div><div style={{display:"flex",gap:6}}><Btn size="sm" variant="success" onClick={function(){approveUser(u);}}>✅ Approve</Btn><Btn size="sm" variant="danger" onClick={function(){setUsers(function(prev){return prev.filter(function(x){return x.id!==u.id;});});showToast("Account rejected");}}>✕ Reject</Btn></div></div>;})}</div>}
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}><div style={{fontWeight:700,fontSize:14}}>User Management ({users.length})</div><Btn onClick={function(){setForm({name:"",email:"",role:"end_user",companyId:companies[0]?.id||"",phone:"",dept:"",active:true});setModal("new");}}>➕ Add User</Btn></div>
    <Card style={{padding:0,overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:700}}><thead><tr style={{background:"#f8fafc"}}>{["User","Email","Role","Company","Status","Actions"].map(function(h){return <th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0"}}>{h}</th>;})}</tr></thead><tbody>{users.map(function(u){ var co=companies.find(function(c){return c.id===u.companyId;}); var rm=ROLE_META[u.role]; return <tr key={u.id} style={{borderBottom:"1px solid #f1f5f9"}}><td style={{padding:"10px 12px"}}><div style={{display:"flex",gap:8,alignItems:"center"}}><Avatar name={u.name} id={u.id} size={30}/><div><div style={{fontWeight:600,fontSize:12}}>{u.name}</div><div style={{fontSize:10,color:"#94a3b8"}}>Last: {ago(u.lastLogin)}</div></div></div></td><td style={{padding:"10px 12px",fontSize:12}}>{u.email}</td><td style={{padding:"10px 12px"}}><Badge label={rm?.label||u.role} color={rm?.color||"#6366f1"}/></td><td style={{padding:"10px 12px",fontSize:12}}>{co?.name||"—"}</td><td style={{padding:"10px 12px"}}><Badge label={u.active?"Active":"Pending"} color={u.active?"#10b981":"#f59e0b"}/></td><td style={{padding:"10px 12px"}}><div style={{display:"flex",gap:4}}><Btn size="sm" variant="ghost" onClick={function(){setForm(Object.assign({},u));setModal("edit");}}>✏️</Btn><Btn size="sm" variant={u.active?"warning":"success"} onClick={function(){setUsers(function(prev){return prev.map(function(x){return x.id===u.id?Object.assign({},x,{active:!x.active}):x;});});showToast(u.active?"Deactivated":"Activated");}}>{u.active?"Disable":"Enable"}</Btn>{u.id!==curUser.id&&<Btn size="sm" variant="danger" onClick={function(){setUsers(function(prev){return prev.filter(function(x){return x.id!==u.id;});});addLog("USER_DELETED",u.id,"User "+u.name+" deleted");showToast("Deleted");}}>🗑</Btn>}</div></td></tr>; })}</tbody></table></Card>
    {modal&&<Modal title={modal==="new"?"Add User":"Edit User"} onClose={function(){setModal(null);}}><FInput label="Full Name *" value={form.name||""} onChange={function(e){fld("name",e.target.value);}}/><FInput label="Email *" value={form.email||""} onChange={function(e){fld("email",e.target.value);}} type="email"/><FInput label="Phone" value={form.phone||""} onChange={function(e){fld("phone",e.target.value);}}/><FInput label="Department" value={form.dept||""} onChange={function(e){fld("dept",e.target.value);}}/><FSelect label="Role" value={form.role||"end_user"} onChange={function(e){fld("role",e.target.value);}} options={OPT_ROLES}/><FSelect label="Company" value={form.companyId||""} onChange={function(e){fld("companyId",e.target.value);}} options={optCompanies(companies)}/><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setModal(null);}}>Cancel</Btn><Btn onClick={save}>{modal==="new"?"Create":"Save"}</Btn></div></Modal>}
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
function PageTicketTypes(p){ var ticketTypes=p.ticketTypes; var users=p.users; var setTicketTypes=p.setTicketTypes; var addLog=p.addLog; var showToast=p.showToast;
  var [modal,setModal]=useState(null); var [form,setForm]=useState({}); var [kwInput,setKwInput]=useState("");
  function fld(k,v){setForm(function(prev){return Object.assign({},prev,{[k]:v});});}
  function save(){if(!form.name){showToast("Name required","error");return;}if(modal==="new"){var nt=Object.assign({},form,{id:uid(),keywords:form.keywords||[]});setTicketTypes(function(prev){return prev.concat([nt]);});addLog("TICKET_TYPE_CREATED",nt.id,"Type \""+nt.name+"\" created");showToast("Created");}else{setTicketTypes(function(prev){return prev.map(function(t){return t.id===form.id?Object.assign({},form):t;});});showToast("Updated");}setModal(null);}
  function addKw(){if(kwInput.trim()){fld("keywords",(form.keywords||[]).concat([kwInput.trim()]));setKwInput("");}}
  return <div><div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}><div style={{fontWeight:700,fontSize:14}}>Ticket Types ({ticketTypes.length})</div><Btn onClick={function(){setForm({name:"",priority:"medium",slaHours:24,color:"#6366f1",keywords:[],defaultAssignee:""});setModal("new");}}>➕ Add Type</Btn></div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:14}}>{ticketTypes.map(function(tt){ var asgn=users.find(function(u){return u.id===tt.defaultAssignee;}); return <Card key={tt.id}><div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><div style={{display:"flex",gap:8,alignItems:"center"}}><div style={{width:10,height:10,borderRadius:"50%",background:tt.color}}/><span style={{fontWeight:700,color:"#1e293b"}}>{tt.name}</span></div><div style={{display:"flex",gap:4}}><Btn size="sm" variant="ghost" onClick={function(){setForm(Object.assign({},tt,{keywords:(tt.keywords||[]).slice()}));setModal("edit");}}>✏️</Btn>{tt.name!=="Others"&&<Btn size="sm" variant="danger" onClick={function(){setTicketTypes(function(prev){return prev.filter(function(t){return t.id!==tt.id;});});addLog("TICKET_TYPE_DELETED",tt.id,"Type \""+tt.name+"\" deleted");showToast("Deleted");}}>🗑</Btn>}</div></div><div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}><Badge label={PRI_META[tt.priority]?.label||tt.priority} color={PRI_META[tt.priority]?.color||"#6366f1"}/><Badge label={"SLA "+tt.slaHours+"h"} color="#0ea5e9"/></div>{asgn&&<div style={{fontSize:11,color:"#64748b",marginBottom:6}}>👤 {asgn.name}</div>}<div style={{display:"flex",flexWrap:"wrap",gap:4}}>{(tt.keywords||[]).slice(0,5).map(function(k){return <span key={k} style={{background:"#f1f5f9",color:"#475569",fontSize:10,padding:"2px 6px",borderRadius:4}}>{k}</span>;})} {(tt.keywords||[]).length>5&&<span style={{fontSize:10,color:"#94a3b8"}}>+{(tt.keywords||[]).length-5}</span>}</div></Card>; })}</div>{modal&&<Modal title={modal==="new"?"Add Ticket Type":"Edit Ticket Type"} onClose={function(){setModal(null);}}><FInput label="Type Name *" value={form.name||""} onChange={function(e){fld("name",e.target.value);}}/><FSelect label="Priority" value={form.priority||"medium"} onChange={function(e){fld("priority",e.target.value);}} options={OPT_PRIORITY}/><FInput label="SLA Hours" value={form.slaHours||24} onChange={function(e){fld("slaHours",Number(e.target.value));}} type="number" min={1}/><FInput label="Color" value={form.color||"#6366f1"} onChange={function(e){fld("color",e.target.value);}} type="color"/><FSelect label="Default Assignee" value={form.defaultAssignee||""} onChange={function(e){fld("defaultAssignee",e.target.value);}} options={optAssignees(users)}/><div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Keywords</label><div style={{display:"flex",gap:6,marginBottom:6}}><input value={kwInput} onChange={function(e){setKwInput(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")addKw();}} placeholder="e.g. printer, monitor" style={{flex:1,padding:"6px 10px",border:"1px solid #e2e8f0",borderRadius:6,fontSize:12,outline:"none"}}/><Btn size="sm" onClick={addKw}>Add</Btn></div><div style={{display:"flex",flexWrap:"wrap",gap:4}}>{(form.keywords||[]).map(function(k,i){return <span key={i} onClick={function(){fld("keywords",(form.keywords||[]).filter(function(_,j){return j!==i;}));}} style={{background:"#eef2ff",color:"#4338ca",fontSize:11,padding:"2px 8px",borderRadius:4,cursor:"pointer"}}>{k} ×</span>;})}</div></div><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={function(){setModal(null);}}>Cancel</Btn><Btn onClick={save}>{modal==="new"?"Create":"Save"}</Btn></div></Modal>}</div>;
}

// ── ACTIVITY LOG ──────────────────────────────────────────────────────────────
const ACTION_META={USER_ROLE_CHANGE:{icon:"🔑",color:"#7c3aed",label:"Role Changed"},USER_CREATED:{icon:"👤",color:"#2563eb",label:"User Created"},USER_APPROVED:{icon:"✅",color:"#10b981",label:"User Approved"},USER_DELETED:{icon:"🗑",color:"#ef4444",label:"User Deleted"},PROFILE_UPDATED:{icon:"✏️",color:"#0ea5e9",label:"Profile Updated"},PASSWORD_CHANGED:{icon:"🔑",color:"#7c3aed",label:"Password Changed"},COMPANY_CREATED:{icon:"🏢",color:"#10b981",label:"Company Created"},COMPANY_DELETED:{icon:"🗑",color:"#ef4444",label:"Company Deleted"},TICKET_CREATED:{icon:"🎫",color:"#6366f1",label:"Ticket Created"},TICKET_STATUS:{icon:"🔄",color:"#f59e0b",label:"Status Updated"},TICKET_DELETED:{icon:"🗑",color:"#dc2626",label:"Ticket Deleted"},EMAIL_SENT:{icon:"📧",color:"#0ea5e9",label:"Email Sent"},SMS_SENT:{icon:"📱",color:"#8b5cf6",label:"SMS Sent"},CLIENT_CREATED:{icon:"🤝",color:"#10b981",label:"Client Added"},CLIENT_DELETED:{icon:"🗑",color:"#ef4444",label:"Client Removed"},LOCATION_ADDED:{icon:"📍",color:"#10b981",label:"Location Added"},LOCATION_REMOVED:{icon:"📍",color:"#ef4444",label:"Location Removed"},TICKET_TYPE_CREATED:{icon:"🏷️",color:"#10b981",label:"Type Created"},TICKET_TYPE_DELETED:{icon:"🏷️",color:"#ef4444",label:"Type Deleted"}};
function PageActivityLog(p){ var logs=p.logs; var users=p.users; var [filter,setFilter]=useState(""); function fu(id){return users.find(function(x){return x.id===id;});} var filtered=filter?logs.filter(function(l){return l.action===filter;}):logs; return <div><div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center"}}><div style={{fontWeight:700,fontSize:14,flex:1}}>Activity Log ({filtered.length})</div><select value={filter} onChange={function(e){setFilter(e.target.value);}} style={{padding:"7px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}><option value="">All Actions</option>{Object.keys(ACTION_META).map(function(k){return <option key={k} value={k}>{ACTION_META[k].label}</option>;})}</select></div><Card style={{padding:0}}>{filtered.map(function(log,i){ var am=ACTION_META[log.action]||{icon:"📝",color:"#6366f1",label:log.action}; var actor=fu(log.userId); return <div key={log.id} style={{display:"flex",gap:12,padding:"12px 16px",borderBottom:i<filtered.length-1?"1px solid #f1f5f9":"none",alignItems:"flex-start"}}><div style={{width:32,height:32,borderRadius:8,background:am.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{am.icon}</div><div style={{flex:1}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><Badge label={am.label} color={am.color}/><span style={{fontSize:10,color:"#94a3b8"}}>{fdt(log.timestamp)}</span></div><div style={{fontSize:12,color:"#334155",marginTop:4}}>{log.detail}</div>{actor&&<div style={{fontSize:11,color:"#94a3b8",marginTop:4,display:"flex",alignItems:"center",gap:4}}><Avatar name={actor.name} id={actor.id} size={14}/>By {actor.name}</div>}</div></div>; })}{filtered.length===0&&<div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No activity found</div>}</Card></div>; }

// ── SMS TRACKER ───────────────────────────────────────────────────────────────
function PageSmsTracker(p){ var tickets=p.tickets; var curUser=p.curUser; var showToast=p.showToast; var addLog=p.addLog;
  var [to,setTo]=useState(""); var [body,setBody]=useState(""); var [tid,setTid]=useState(tickets[0]?.id||""); var [sending,setSending]=useState(false);
  var [log,setLog]=useState([{id:"s1",to:"+1-555-0105",body:"Ticket #t1: Tech will call in 30 min.",from:"Alex Rodriguez",ticketId:"t1",ts:hAgo(2),status:"delivered"},{id:"s2",to:"+1-555-0107",body:"Security alert: Change your password now.",from:"Mike Chen",ticketId:"t3",ts:hAgo(1),status:"delivered"}]);
  async function send(){ if(!to.trim()||!body.trim()){showToast("Phone and message required","error");return;} setSending(true); var entry={id:uid(),to,body,from:curUser.name,ticketId:tid,ts:new Date().toISOString(),status:"sending"}; setLog(function(prev){return [entry].concat(prev);}); var result=await callSendSms({to,message:body,ticketId:tid}); setLog(function(prev){return prev.map(function(s){return s.id===entry.id?Object.assign({},s,{status:result.success?"delivered":"failed"}):s;}); }); addLog("SMS_SENT",tid,"SMS → "+to+(result.success?"":" [FAILED]")); showToast(result.success?"📱 SMS sent via Twilio!":"⚠️ SMS failed: "+result.error,result.success?"ok":"error"); setSending(false); if(result.success){setTo("");setBody("");} }
  return <div><div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,padding:14,marginBottom:20,fontSize:12}}><div style={{fontWeight:700,color:"#1e40af",marginBottom:6}}>📱 SMS Tracking — Twilio API Integration</div></div><div style={{display:"grid",gridTemplateColumns:"1fr 1.5fr",gap:20}}><Card><div style={{fontWeight:700,marginBottom:14}}>Send SMS</div><FInput label="To (phone)" value={to} onChange={function(e){setTo(e.target.value);}} placeholder="+1-555-0123"/><FSelect label="Link to Ticket" value={tid} onChange={function(e){setTid(e.target.value);}} options={optTickets(tickets)}/><FTextarea label="Message" value={body} onChange={function(e){setBody(e.target.value);}} rows={3} placeholder="Type SMS…"/><button onClick={send} disabled={sending} style={{background:sending?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:8,padding:"8px 18px",fontWeight:600,fontSize:13,cursor:sending?"not-allowed":"pointer"}}>{sending?"⏳ Sending…":"📤 Send & Track"}</button></Card><Card><div style={{fontWeight:700,marginBottom:14}}>SMS Log ({log.length})</div>{log.map(function(m){return <div key={m.id} style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:10,marginBottom:8}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><div style={{fontWeight:700,fontSize:12}}>📱 → {m.to}</div><Badge label={m.status} color={m.status==="delivered"?"#10b981":m.status==="failed"?"#ef4444":"#f59e0b"}/></div><div style={{fontSize:12,color:"#334155",marginBottom:4}}>{m.body}</div><div style={{fontSize:10,color:"#94a3b8",display:"flex",justifyContent:"space-between"}}><span>By {m.from} · #{m.ticketId}</span><span>{fdt(m.ts)}</span></div></div>;})}</Card></div></div>; }
