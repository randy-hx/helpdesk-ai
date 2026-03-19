import { useState, useEffect, useMemo, useCallback } from "react";
import React from "react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from "recharts";

// ── CONSTANTS ────────────────────────────────────────────────────────────────
const PAL = ["#6366f1","#8b5cf6","#0ea5e9","#10b981","#f59e0b","#ef4444","#ec4899","#f97316"];
const FUNCTIONS_URL = "https://byuvyyycweowdupyvjgy.supabase.co/functions/v1";

const STATUS_META = {
  "Open":        { color:"#f59e0b", bg:"#fef3c7" },
  "In Progress": { color:"#6366f1", bg:"#eef2ff" },
  "Resolved":    { color:"#10b981", bg:"#d1fae5" },
  "Escalated":   { color:"#ef4444", bg:"#fee2e2" },
  "Closed":      { color:"#94a3b8", bg:"#f1f5f9" },
};
const ALL_STATUSES = ["Open","In Progress","Resolved","Escalated","Closed"];

const PRI_META = {
  critical:{ color:"#dc2626", bg:"#fee2e2", label:"Critical" },
  high:    { color:"#ef4444", bg:"#fef2f2", label:"High"     },
  medium:  { color:"#f59e0b", bg:"#fffbeb", label:"Medium"   },
  low:     { color:"#10b981", bg:"#f0fdf4", label:"Low"      },
};

const ROLE_META = {
  admin:         { label:"Administrator",  color:"#dc2626" },
  it_manager:    { label:"IT Manager",     color:"#7c3aed" },
  it_technician: { label:"IT Technician",  color:"#2563eb" },
  end_user:      { label:"End User",       color:"#059669" },
};

// ── UTILS ────────────────────────────────────────────────────────────────────
const uid    = () => "id_" + Date.now() + "_" + Math.random().toString(36).slice(2,6);
const hAgo   = h => new Date(Date.now() - h  * 3600000).toISOString();
const dAgo   = d => new Date(Date.now() - d  * 86400000).toISOString();
const fdt    = iso => iso ? new Date(iso).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "—";
const ago    = iso => { if(!iso) return "—"; const m=Math.floor((Date.now()-new Date(iso))/60000); if(m<1) return "just now"; if(m<60) return m+"m ago"; const h=Math.floor(m/60); if(h<24) return h+"h ago"; return Math.floor(h/24)+"d ago"; };
const inits  = n => { if (!n) return "??"; const parts = n.trim().split(" ").filter(Boolean); return parts.length >= 2 ? (parts[0][0]+parts[1][0]).toUpperCase() : n.slice(0,2).toUpperCase(); };
const avCol  = id => PAL[Math.abs((id||"").split("").reduce((a,c)=>a+c.charCodeAt(0),0)) % PAL.length];
const rnd    = (a,b) => Math.floor(Math.random()*(b-a+1))+a;

async function callSendEmail({ to, cc, subject, body, ticketId }) {
  try {
    const res = await fetch(FUNCTIONS_URL+"/send-email", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({to,cc,subject,body,ticketId}) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error||"Failed");
    return { success:true };
  } catch(e) { return { success:false, error:e.message }; }
}

async function callSendSms({ to, message, ticketId }) {
  try {
    const res = await fetch(FUNCTIONS_URL+"/send-sms", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({to,message,ticketId}) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error||"Failed");
    return { success:true };
  } catch(e) { return { success:false, error:e.message }; }
}

function aiAssign(title, desc, typeId, users, types) {
  const tt = types.find(t=>t.id===typeId);
  if (tt && tt.defaultAssignee) { const u=users.find(u=>u.id===tt.defaultAssignee&&u.active); if(u) return {id:u.id,reason:'Type "'+tt.name+'" → '+u.name}; }
  const text = (title+" "+desc).toLowerCase();
  for (const t of types) { if(!t.defaultAssignee) continue; for (const kw of (t.keywords||[])) { if(text.includes(kw.toLowerCase())) { const u=users.find(u=>u.id===t.defaultAssignee&&u.active); if(u) return {id:u.id,reason:'Keyword "'+kw+'" → '+u.name}; } } }
  const techs = users.filter(u=>u.role==="it_technician"&&u.active);
  if (techs.length) return {id:techs[0].id,reason:"Load-balanced → "+techs[0].name};
  return {id:null,reason:"No technician available"};
}

// ── SEED DATA ────────────────────────────────────────────────────────────────
const SEED_COMPANIES = [
  {id:"c1",name:"IT Solutions Corp",domain:"itsolutions.com",address:"123 Tech Ave, San Francisco, CA",phone:"+1-555-0100",industry:"Technology",size:"50-100",createdAt:dAgo(100)},
  {id:"c2",name:"Acme Corp",domain:"acmecorp.com",address:"456 Business Blvd, New York, NY",phone:"+1-555-0200",industry:"Manufacturing",size:"500-1000",createdAt:dAgo(90)},
  {id:"c3",name:"TechStart Inc",domain:"techstart.com",address:"789 Startup Lane, Austin, TX",phone:"+1-555-0300",industry:"Software",size:"10-50",createdAt:dAgo(85)},
];

const SEED_CLIENTS = [
  {id:"cl1",name:"Globex Corporation",companyId:"c2",email:"contact@globex.com",phone:"+1-555-1001",industry:"Finance",
    locations:[{id:"loc1",name:"HQ — New York",address:"456 Business Blvd, New York, NY 10001",floor:"Floors 10-15",contact:"Alice Brown"},{id:"loc2",name:"Branch — Chicago",address:"789 Commerce St, Chicago, IL 60601",floor:"Floor 3",contact:"Tom Davis"}]},
  {id:"cl2",name:"Initech Solutions",companyId:"c3",email:"info@initech.com",phone:"+1-555-2001",industry:"Consulting",
    locations:[{id:"loc4",name:"Main Office — Austin",address:"789 Startup Lane, Austin, TX 78701",floor:"Floor 2",contact:"Jane Smith"},{id:"loc5",name:"Remote — Dallas",address:"321 Tech Park, Dallas, TX 75201",floor:"Floor 1",contact:"Rick Moore"}]},
  {id:"cl3",name:"Umbrella IT Services",companyId:"c1",email:"support@umbrella.com",phone:"+1-555-3001",industry:"Technology",
    locations:[{id:"loc6",name:"SF Headquarters",address:"123 Tech Ave, San Francisco, CA 94107",floor:"All Floors",contact:"Sarah Johnson"}]},
  {id:"cl4",name:"Acme Internal IT",companyId:"c2",email:"itdesk@acmecorp.com",phone:"+1-555-4001",industry:"Manufacturing",
    locations:[{id:"loc7",name:"Factory Floor — NY",address:"456 Industrial Ave, Brooklyn, NY 11201",floor:"Ground",contact:"Bob Wilson"},{id:"loc8",name:"Admin Building",address:"456 Business Blvd, New York, NY 10001",floor:"Floor 5",contact:"John Doe"}]},
];

const SEED_USERS = [
  {id:"u1",name:"Randy Admin",    email:"randy@omnisecurityinc.com",role:"admin",   companyId:"c1",phone:"+1-555-0101",dept:"IT Administration",active:true,createdAt:dAgo(90),lastLogin:hAgo(1)},
  {id:"u2",name:"Mike Chen",     email:"mike@itsolutions.com", role:"it_manager",   companyId:"c1",phone:"+1-555-0102",dept:"IT Operations",    active:true,createdAt:dAgo(80),lastLogin:hAgo(2)},
  {id:"u3",name:"Alex Rodriguez",email:"alex@itsolutions.com", role:"it_technician",companyId:"c1",phone:"+1-555-0103",dept:"IT Support",       active:true,createdAt:dAgo(75),lastLogin:hAgo(0.5)},
  {id:"u4",name:"Emma Williams", email:"emma@itsolutions.com", role:"it_technician",companyId:"c1",phone:"+1-555-0104",dept:"IT Support",       active:true,createdAt:dAgo(70),lastLogin:hAgo(1)},
  {id:"u5",name:"John Doe",      email:"john@acmecorp.com",    role:"end_user",     companyId:"c2",phone:"+1-555-0105",dept:"Sales",            active:true,createdAt:dAgo(60),lastLogin:hAgo(3)},
  {id:"u6",name:"Jane Smith",    email:"jane@techstart.com",   role:"end_user",     companyId:"c3",phone:"+1-555-0106",dept:"Engineering",      active:true,createdAt:dAgo(55),lastLogin:hAgo(4)},
  {id:"u7",name:"Bob Wilson",    email:"bob@acmecorp.com",     role:"end_user",     companyId:"c2",phone:"+1-555-0107",dept:"Marketing",        active:true,createdAt:dAgo(50),lastLogin:hAgo(8)},
];

const SEED_TYPES = [
  {id:"tt1",name:"Hardware Issue",   priority:"high",    slaHours:8, keywords:["hardware","computer","printer","monitor","keyboard","laptop","screen"],defaultAssignee:"u3",color:"#ef4444"},
  {id:"tt2",name:"Software Install", priority:"medium",  slaHours:24,keywords:["install","software","application","app","program","license"],        defaultAssignee:"u4",color:"#f59e0b"},
  {id:"tt3",name:"Network Problem",  priority:"critical",slaHours:4, keywords:["network","internet","wifi","connection","disconnected"],              defaultAssignee:"u3",color:"#dc2626"},
  {id:"tt4",name:"Password Reset",   priority:"low",     slaHours:4, keywords:["password","reset","locked","login","forgot"],                        defaultAssignee:"u4",color:"#10b981"},
  {id:"tt5",name:"Email Issue",      priority:"medium",  slaHours:8, keywords:["email","outlook","mail","inbox","calendar"],                         defaultAssignee:"u3",color:"#6366f1"},
  {id:"tt6",name:"Security Incident",priority:"critical",slaHours:2, keywords:["security","hack","breach","virus","malware","phishing"],             defaultAssignee:"u2",color:"#7c3aed"},
  {id:"tt7",name:"VPN Access",       priority:"medium",  slaHours:8, keywords:["vpn","remote","tunnel"],                                             defaultAssignee:"u4",color:"#8b5cf6"},
  {id:"tt8",name:"Others",           priority:"low",     slaHours:48,keywords:[],                                                                    defaultAssignee:null,color:"#94a3b8"},
];

function mkT(id,title,desc,typeId,status,sub,asn,co,cl,loc,hrs,msgs,hist) {
  const tt=SEED_TYPES.find(t=>t.id===typeId);
  const cat=hAgo(hrs);
  const sla=new Date(new Date(cat).getTime()+(tt?tt.slaHours:24)*3600000).toISOString();
  return {id,title,description:desc,typeId,customTypeName:null,status,priority:tt?tt.priority:"medium",submittedBy:sub,assignedTo:asn,companyId:co,clientId:cl||null,locationId:loc||null,createdAt:cat,updatedAt:hAgo(Math.max(0,hrs-1)),slaDeadline:sla,slaBreached:new Date()>new Date(sla)&&!["Closed","Resolved"].includes(status),timeToCreateMins:rnd(2,18),statusHistory:hist&&hist.length?hist:[{status,assignedTo:asn,timestamp:cat,changedBy:sub,note:"Ticket created"}],conversations:msgs||[],externalEmail:null,resolvedAt:["Resolved","Closed"].includes(status)?hAgo(Math.max(0,hrs-3)):null,closedAt:status==="Closed"?hAgo(Math.max(0,hrs-1)):null,deleted:false,aiReason:"Type: "+(tt?tt.name:"Others"),attachments:[]};
}

const SEED_TICKETS = [
  mkT("t1","Laptop screen flickering","Screen flickers on Dell XPS 15.","tt1","In Progress","u5","u3","c2","cl4","loc8",12,
    [{id:"m1",from:"u5",fromEmail:"john@acmecorp.com",to:["u3"],toEmails:["alex@itsolutions.com"],cc:[],subject:"Re: [#t1]",body:"Flickering every 5 min.",timestamp:hAgo(10),isExternal:false,status:"sent"},
     {id:"m2",from:"u3",fromEmail:"alex@itsolutions.com",to:["u5"],toEmails:["john@acmecorp.com"],cc:[],subject:"Re: [#t1]",body:"Bring laptop to IT at 2PM.\n\nAlex",timestamp:hAgo(9),isExternal:false,status:"sent"}],
    [{status:"Open",assignedTo:"u3",timestamp:hAgo(12),changedBy:"u5",note:"Ticket created"},{status:"In Progress",assignedTo:"u3",timestamp:hAgo(10),changedBy:"u3",note:"Diagnostic scheduled"}]),
  mkT("t2","Cannot connect to VPN","Error 789 on VPN. Windows 11.","tt7","Open","u6","u4","c3","cl2","loc4",3,[],[]),
  mkT("t3","Phishing email received","Fake IT domain. Five colleagues affected.","tt6","Escalated","u7","u2","c2","cl1","loc1",6,
    [{id:"m3",from:"u7",fromEmail:"bob@acmecorp.com",to:["u2"],toEmails:["mike@itsolutions.com"],cc:[],subject:"Re: [#t3]",body:"5 colleagues confirmed.",timestamp:hAgo(5),isExternal:false,status:"sent"},
     {id:"m4",from:"u2",fromEmail:"mike@itsolutions.com",to:["u7"],toEmails:["bob@acmecorp.com"],cc:["security@soc.com"],subject:"Re: [#t3]",body:"Blocking domain now.\n\nMike",timestamp:hAgo(4),isExternal:false,status:"sent"},
     {id:"m5",from:null,fromEmail:"security@soc.com",to:["u2"],toEmails:["mike@itsolutions.com"],cc:[],subject:"[EXTERNAL] Analysis",body:"Domain blocked at DNS.",timestamp:hAgo(3),isExternal:true,status:"sent"}],
    [{status:"Open",assignedTo:"u2",timestamp:hAgo(6),changedBy:"u7",note:"Ticket created"},{status:"Escalated",assignedTo:"u2",timestamp:hAgo(4),changedBy:"u2",note:"Escalated to SOC"}]),
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
  {id:"l2",action:"COMPANY_CREATED", userId:"u1",target:"c3",detail:"Company TechStart Inc created",timestamp:dAgo(85)},
  {id:"l3",action:"TICKET_CREATED",  userId:"u5",target:"t1",detail:"Ticket #t1 created",timestamp:hAgo(12)},
  {id:"l4",action:"TICKET_STATUS",   userId:"u3",target:"t1",detail:"Status: Open → In Progress",timestamp:hAgo(10)},
  {id:"l5",action:"CLIENT_CREATED",  userId:"u1",target:"cl1",detail:"Client Globex Corporation added",timestamp:dAgo(30)},
  {id:"l6",action:"EMAIL_SENT",      userId:"u3",target:"t1",detail:"Email sent to john@acmecorp.com",timestamp:hAgo(9)},
];

// ── ERROR BOUNDARY ────────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e.message }; }
  render() {
    if (this.state.error) return (
      <div style={{ padding:40, fontFamily:"monospace", background:"#fef2f2", minHeight:"100vh" }}>
        <div style={{ fontSize:20, fontWeight:700, color:"#dc2626", marginBottom:16 }}>⚠️ App Error — please screenshot this and share</div>
        <pre style={{ background:"#fff", padding:20, borderRadius:8, border:"1px solid #fecaca", fontSize:13, whiteSpace:"pre-wrap", color:"#7f1d1d" }}>{this.state.error}</pre>
        <button onClick={()=>this.setState({error:null})} style={{ marginTop:16, padding:"10px 20px", background:"#dc2626", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontWeight:700 }}>Try Again</button>
      </div>
    );
    return this.props.children;
  }
}

// ── UI PRIMITIVES ────────────────────────────────────────────────────────────
function Badge({label,color,bg}) {
  return <span style={{background:bg||color+"22",color,border:"1px solid "+color+"44",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700,whiteSpace:"nowrap",display:"inline-block"}}>{label}</span>;
}
function Avatar({name,id,size=32}) {
  return <div style={{width:size,height:size,borderRadius:"50%",background:avCol(id||name),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:size*0.35,fontWeight:700,flexShrink:0}}>{inits(name)}</div>;
}
function Card({children,style}) {
  return <div style={{background:"#fff",borderRadius:12,border:"1px solid #e2e8f0",boxShadow:"0 1px 4px rgba(0,0,0,.06)",padding:20,...style}}>{children}</div>;
}
function Stat({label,value,icon,color,sub}) {
  return (
    <Card style={{flex:1,minWidth:150}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div>
          <div style={{color:"#64748b",fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5}}>{label}</div>
          <div style={{fontSize:28,fontWeight:800,color:color||"#6366f1",margin:"4px 0 2px"}}>{value}</div>
          {sub&&<div style={{fontSize:11,color:"#94a3b8"}}>{sub}</div>}
        </div>
        <span style={{fontSize:22}}>{icon}</span>
      </div>
    </Card>
  );
}
function Modal({title,onClose,children,wide}) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#fff",borderRadius:16,width:"100%",maxWidth:wide?820:560,maxHeight:"90vh",display:"flex",flexDirection:"column",boxShadow:"0 20px 60px rgba(0,0,0,.25)"}}>
        <div style={{padding:"16px 24px",borderBottom:"1px solid #e2e8f0",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div style={{fontSize:15,fontWeight:700,color:"#1e293b"}}>{title}</div>
          <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:"#94a3b8",lineHeight:1,padding:4}}>✕</button>
        </div>
        <div style={{padding:24,overflowY:"auto",flex:1}}>{children}</div>
      </div>
    </div>
  );
}
function FInput({label,...p}) {
  return (
    <div style={{marginBottom:14}}>
      {label&&<label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>{label}</label>}
      <input style={{width:"100%",padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#f8fafc",boxSizing:"border-box"}} {...p}/>
    </div>
  );
}
function FSelect({label,options,...p}) {
  return (
    <div style={{marginBottom:14}}>
      {label&&<label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>{label}</label>}
      <select style={{width:"100%",padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#f8fafc",boxSizing:"border-box"}} {...p}>
        {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
function FTextarea({label,...p}) {
  return (
    <div style={{marginBottom:14}}>
      {label&&<label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>{label}</label>}
      <textarea rows={4} style={{width:"100%",padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#f8fafc",resize:"vertical",boxSizing:"border-box"}} {...p}/>
    </div>
  );
}
function Btn({children,variant,size,style,...p}) {
  const v=variant||"primary", sm=size==="sm";
  const base={border:"none",cursor:"pointer",borderRadius:8,fontWeight:600,fontSize:sm?11:13,display:"inline-flex",alignItems:"center",gap:4,padding:sm?"5px 10px":"8px 18px"};
  const cols={primary:{background:"#6366f1",color:"#fff"},danger:{background:"#ef4444",color:"#fff"},success:{background:"#10b981",color:"#fff"},warning:{background:"#f59e0b",color:"#fff"},ghost:{background:"#f1f5f9",color:"#475569"}};
  return <button style={{...base,...(cols[v]||cols.primary),...style}} {...p}>{children}</button>;
}

// ── FOCUS INPUT (login forms) ────────────────────────────────────────────────
function FocusInput({extraPad,...props}) {
  const [focused,setFocused]=useState(false);
  return (
    <input {...props}
      onFocus={()=>setFocused(true)}
      onBlur={()=>setFocused(false)}
      style={{width:"100%",padding:extraPad?"11px 44px 11px 14px":"11px 14px",border:"1.5px solid "+(focused?"#0ea5e9":"#e2e8f0"),borderRadius:10,fontSize:14,outline:"none",boxSizing:"border-box",background:"#f8fafc",transition:"border-color .2s"}}
    />
  );
}

// ── LOGIN PAGE ───────────────────────────────────────────────────────────────
function LoginPage({users,setUsers,companies,onLogin}) {
  const [view,      setView]      = useState("login");
  const [loginEmail,setLoginEmail]= useState("");
  const [loginPass, setLoginPass] = useState("");
  const [showP1,    setShowP1]    = useState(false);
  const [showP2,    setShowP2]    = useState(false);
  const [showP3,    setShowP3]    = useState(false);
  const [loginErr,  setLoginErr]  = useState("");
  const [resetEmail,setResetEmail]= useState("");
  const [resetErr,  setResetErr]  = useState("");
  const [sigName,   setSigName]   = useState("");
  const [sigEmail,  setSigEmail]  = useState("");
  const [sigPass,   setSigPass]   = useState("");
  const [sigConf,   setSigConf]   = useState("");
  const [sigPhone,  setSigPhone]  = useState("");
  const [sigDept,   setSigDept]   = useState("");
  const [sigErr,    setSigErr]    = useState("");
  const [loading,   setLoading]   = useState(false);

  const pwStr = p => { if(!p||p.length<8) return 1; if(p.length>=12&&/[A-Z]/.test(p)&&/[0-9]/.test(p)&&/[^A-Za-z0-9]/.test(p)) return 4; if(p.length>=10&&/[A-Z]/.test(p)&&/[0-9]/.test(p)) return 3; return 2; };
  const strLabel=["","Too short","Weak","Good","Strong ✅"];
  const strColor=["","#ef4444","#f59e0b","#3b82f6","#10b981"];
  const str = pwStr(sigPass);

  const doLogin = async e => {
    e.preventDefault(); setLoginErr("");
    if (!loginEmail.trim()||!loginPass.trim()) { setLoginErr("Please enter your email and password."); return; }
    setLoading(true);
    await new Promise(r=>setTimeout(r,700));
    const user = users.find(u=>u.email.toLowerCase()===loginEmail.toLowerCase().trim());
    if (!user)        { setLoginErr("No account found with that email."); setLoading(false); return; }
    if (!user.active) { setLoginErr("Your account is pending admin approval."); setLoading(false); return; }
    if (loginPass !== getPassword(user.id)) { setLoginErr("Incorrect password. Please try again."); setLoading(false); return; }
    setLoading(false); onLogin(user);
  };

  const doForgot = async e => {
    e.preventDefault(); setResetErr("");
    if (!resetEmail.trim()) { setResetErr("Please enter your email address."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resetEmail.trim())) { setResetErr("Enter a valid email address."); return; }
    setLoading(true);
    await new Promise(r=>setTimeout(r,900));
    setLoading(false); setView("sent");
  };

  const doSignup = async e => {
    e.preventDefault(); setSigErr("");
    if (!sigName.trim()) { setSigErr("Full name is required."); return; }
    if (!sigEmail.trim()) { setSigErr("Email is required."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sigEmail.trim())) { setSigErr("Enter a valid email address."); return; }
    if (users.find(u=>u.email.toLowerCase()===sigEmail.toLowerCase().trim())) { setSigErr("An account with this email already exists."); return; }
    if (sigPass.length<8) { setSigErr("Password must be at least 8 characters."); return; }
    if (sigPass!==sigConf) { setSigErr("Passwords do not match."); return; }
    setLoading(true);
    await new Promise(r=>setTimeout(r,900));
    const nu = { id:uid(), name:sigName.trim(), email:sigEmail.trim().toLowerCase(), role:"end_user", companyId:companies&&companies[0]?companies[0].id:"", phone:sigPhone.trim(), dept:sigDept.trim(), active:false, createdAt:new Date().toISOString(), lastLogin:null };
    setUsers(prev=>[...prev,nu]);
    setLoading(false); setView("pending");
  };

  const PBtn = ({children,disabled,onClick,type}) => (
    <button type={type||"button"} onClick={onClick} disabled={disabled}
      style={{width:"100%",padding:"12px",background:disabled?"#7dd3fc":"linear-gradient(135deg,#0369a1,#0ea5e9)",color:"#fff",border:"none",borderRadius:10,fontSize:15,fontWeight:700,cursor:disabled?"not-allowed":"pointer",boxShadow:"0 4px 14px rgba(14,165,233,.35)",marginTop:4}}>
      {children}
    </button>
  );
  const BackBtn = ({onClick}) => (
    <button type="button" onClick={onClick} style={{background:"none",border:"none",color:"#0369a1",fontSize:13,fontWeight:600,cursor:"pointer",padding:"0 0 16px 0",display:"flex",alignItems:"center",gap:4}}>← Back to Sign In</button>
  );
  const ErrBox = ({msg}) => msg ? <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:14,color:"#dc2626",fontSize:13}}>⚠️ {msg}</div> : null;

  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#020e1f 0%,#041833 30%,#062d6b 65%,#0a3d8f 100%)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,fontFamily:"'Inter',system-ui,sans-serif",position:"relative"}}>
      <div style={{position:"absolute",inset:0,background:"rgba(2,14,31,0.62)"}}/>
      <div style={{width:"100%",maxWidth:440,position:"relative",zIndex:1}}>

        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:14,marginBottom:10}}>
            <div style={{width:54,height:54,borderRadius:"50%",background:"linear-gradient(135deg,#fff 60%,#b3d9ff)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 0 24px rgba(56,189,248,.5)"}}>
              <div style={{width:34,height:34,borderRadius:"50%",background:"linear-gradient(135deg,#0369a1,#0ea5e9)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <div style={{width:14,height:14,borderRadius:"50%",background:"#020e1f"}}/>
              </div>
            </div>
            <div style={{textAlign:"left"}}>
              <div style={{color:"#fff",fontSize:32,fontWeight:800,letterSpacing:-1,lineHeight:1}}>hoptix</div>
              <div style={{fontSize:12,letterSpacing:1}}><span style={{color:"#7dd3fc"}}>A.</span><span style={{color:"#38bdf8",fontStyle:"italic"}}>eye</span><span style={{color:"#94a3b8"}}> technology</span></div>
            </div>
          </div>
          <p style={{color:"#94a3b8",fontSize:13,margin:0}}>IT Helpdesk · Sign in to your workspace</p>
        </div>

        <div style={{background:"rgba(255,255,255,0.97)",borderRadius:20,padding:36,boxShadow:"0 25px 60px rgba(0,0,0,.5),0 0 0 1px rgba(56,189,248,.15)"}}>

          {/* LOGIN */}
          {view==="login"&&(
            <>
              <h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 4px"}}>Welcome back 👋</h2>
              <p style={{fontSize:13,color:"#94a3b8",margin:"0 0 22px"}}>Sign in to access your dashboard</p>
              <form onSubmit={doLogin}>
                <div style={{marginBottom:14}}>
                  <label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:5}}>Email Address</label>
                  <FocusInput type="email" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} placeholder="you@company.com" autoFocus/>
                </div>
                <div style={{marginBottom:6}}>
                  <label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:5}}>Password</label>
                  <div style={{position:"relative"}}>
                    <FocusInput type={showP1?"text":"password"} value={loginPass} onChange={e=>setLoginPass(e.target.value)} placeholder="••••••••" extraPad/>
                    <button type="button" onClick={()=>setShowP1(!showP1)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:16,color:"#94a3b8",padding:0}}>{showP1?"🙈":"👁️"}</button>
                  </div>
                </div>
                <div style={{textAlign:"right",marginBottom:18}}>
                  <button type="button" onClick={()=>{setView("forgot");setResetEmail(loginEmail);setResetErr("");}} style={{background:"none",border:"none",color:"#0369a1",fontSize:12,fontWeight:600,cursor:"pointer",padding:0,textDecoration:"underline"}}>Forgot your password?</button>
                </div>
                <ErrBox msg={loginErr}/>
                <PBtn type="submit" disabled={loading}>{loading?"⏳ Signing in…":"Sign In →"}</PBtn>
              </form>
              <div style={{marginTop:18,textAlign:"center"}}>
                <span style={{fontSize:12,color:"#94a3b8"}}>Don't have an account? </span>
                <button type="button" onClick={()=>{setView("signup");setSigErr("");setSigName("");setSigEmail("");setSigPass("");setSigConf("");setSigPhone("");setSigDept("");}} style={{background:"none",border:"none",color:"#0369a1",fontSize:12,fontWeight:700,cursor:"pointer",padding:0,textDecoration:"underline"}}>Sign Up</button>
              </div>
            </>
          )}

          {/* SIGN UP */}
          {view==="signup"&&(
            <>
              <BackBtn onClick={()=>{setView("login");setSigErr("");}}/>
              <h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 4px"}}>Create an Account 🚀</h2>
              <p style={{fontSize:13,color:"#94a3b8",margin:"0 0 18px"}}>Fill in your details. An admin will approve your account.</p>
              <form onSubmit={doSignup}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  <div style={{marginBottom:10}}>
                    <label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Full Name *</label>
                    <FocusInput type="text" value={sigName} onChange={e=>setSigName(e.target.value)} placeholder="Jane Smith" autoFocus/>
                  </div>
                  <div style={{marginBottom:10}}>
                    <label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Phone</label>
                    <FocusInput type="tel" value={sigPhone} onChange={e=>setSigPhone(e.target.value)} placeholder="+1-555-0100"/>
                  </div>
                </div>
                <div style={{marginBottom:10}}>
                  <label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Work Email *</label>
                  <FocusInput type="email" value={sigEmail} onChange={e=>setSigEmail(e.target.value)} placeholder="you@company.com"/>
                </div>
                <div style={{marginBottom:10}}>
                  <label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Department</label>
                  <FocusInput type="text" value={sigDept} onChange={e=>setSigDept(e.target.value)} placeholder="Sales"/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:4}}>
                  <div>
                    <label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Password *</label>
                    <div style={{position:"relative"}}>
                      <FocusInput type={showP2?"text":"password"} value={sigPass} onChange={e=>setSigPass(e.target.value)} placeholder="Min 8 chars" extraPad/>
                      <button type="button" onClick={()=>setShowP2(!showP2)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#94a3b8",padding:0}}>{showP2?"🙈":"👁️"}</button>
                    </div>
                  </div>
                  <div>
                    <label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Confirm *</label>
                    <div style={{position:"relative"}}>
                      <FocusInput type={showP3?"text":"password"} value={sigConf} onChange={e=>setSigConf(e.target.value)} placeholder="Repeat password" extraPad/>
                      <button type="button" onClick={()=>setShowP3(!showP3)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#94a3b8",padding:0}}>{showP3?"🙈":"👁️"}</button>
                    </div>
                  </div>
                </div>
                {sigPass.length>0&&(
                  <div style={{marginBottom:12}}>
                    <div style={{display:"flex",gap:4,marginBottom:3}}>{[1,2,3,4].map(i=><div key={i} style={{flex:1,height:4,borderRadius:2,background:i<=str?strColor[str]:"#e2e8f0",transition:"background .3s"}}/>)}</div>
                    <div style={{fontSize:10,color:strColor[str]}}>{strLabel[str]}</div>
                  </div>
                )}
                <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#92400e"}}>⚠️ New accounts require <strong>admin approval</strong> before you can sign in.</div>
                <ErrBox msg={sigErr}/>
                <PBtn type="submit" disabled={loading}>{loading?"⏳ Creating account…":"Create Account →"}</PBtn>
              </form>
            </>
          )}

          {/* PENDING */}
          {view==="pending"&&(
            <div style={{textAlign:"center",padding:"10px 0"}}>
              <div style={{fontSize:56,marginBottom:14}}>⏳</div>
              <h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 10px"}}>Account Pending Approval</h2>
              <p style={{fontSize:13,color:"#64748b",lineHeight:1.7,margin:"0 0 18px"}}>Your account for <strong style={{color:"#1e293b"}}>{sigEmail}</strong> has been submitted.</p>
              <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:14,marginBottom:16,textAlign:"left"}}>
                <div style={{fontSize:12,fontWeight:700,color:"#0369a1",marginBottom:6}}>📋 What happens next?</div>
                <div style={{fontSize:12,color:"#0c4a6e",lineHeight:1.9}}>1. Request sent to admin<br/>2. Admin reviews and approves<br/>3. You receive an email when approved<br/>4. Sign in with your credentials</div>
              </div>
              <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"10px 14px",marginBottom:20,fontSize:12,color:"#166534"}}>✅ Account created — awaiting activation</div>
              <PBtn onClick={()=>{setView("login");setLoginErr("");}}>← Back to Sign In</PBtn>
            </div>
          )}

          {/* FORGOT */}
          {view==="forgot"&&(
            <>
              <BackBtn onClick={()=>{setView("login");setResetErr("");}}/>
              <div style={{textAlign:"center",marginBottom:22}}>
                <div style={{fontSize:44,marginBottom:8}}>🔑</div>
                <h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 6px"}}>Forgot Password?</h2>
                <p style={{fontSize:13,color:"#94a3b8",margin:0}}>Enter your email and we'll send a reset link.</p>
              </div>
              <form onSubmit={doForgot}>
                <div style={{marginBottom:16}}>
                  <label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:5}}>Email Address</label>
                  <FocusInput type="email" value={resetEmail} onChange={e=>setResetEmail(e.target.value)} placeholder="you@company.com" autoFocus/>
                </div>
                <ErrBox msg={resetErr}/>
                <PBtn type="submit" disabled={loading}>{loading?"⏳ Sending…":"Send Reset Link →"}</PBtn>
              </form>
            </>
          )}

          {/* EMAIL SENT */}
          {view==="sent"&&(
            <div style={{textAlign:"center",padding:"10px 0"}}>
              <div style={{fontSize:56,marginBottom:14}}>📧</div>
              <h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 10px"}}>Check your inbox!</h2>
              <p style={{fontSize:13,color:"#64748b",lineHeight:1.7,margin:"0 0 6px"}}>If an account exists for <strong style={{color:"#1e293b"}}>{resetEmail}</strong>, you'll receive a reset link shortly.</p>
              <p style={{fontSize:12,color:"#94a3b8",margin:"0 0 22px"}}>Don't see it? Check your spam folder.</p>
              <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:14,marginBottom:22,textAlign:"left"}}>
                <div style={{fontSize:12,fontWeight:700,color:"#166534",marginBottom:6}}>✅ What happens next?</div>
                <div style={{fontSize:12,color:"#15803d",lineHeight:1.9}}>1. Open the email from Hoptix HelpDesk<br/>2. Click "Reset Password"<br/>3. Choose a new password<br/>4. Sign in</div>
              </div>
              <PBtn onClick={()=>{setView("login");setLoginErr("");}}>← Back to Sign In</PBtn>
            </div>
          )}
        </div>

        <p style={{textAlign:"center",color:"rgba(255,255,255,.4)",fontSize:11,marginTop:20,letterSpacing:.3}}>© 2025 Hoptix · A.eye Technology · All rights reserved</p>
      </div>
    </div>
  );
}

// ── PROFILE MODAL ─────────────────────────────────────────────────────────────
function ProfileModal({ curUser, setUsers, showToast, addLog, onClose }) {
  const [tab,       setTab]       = useState("profile");
  const [name,      setName]      = useState(curUser.name);
  const [phone,     setPhone]     = useState(curUser.phone||"");
  const [dept,      setDept]      = useState(curUser.dept||"");
  const [curPw,     setCurPw]     = useState("");
  const [newPw,     setNewPw]     = useState("");
  const [confPw,    setConfPw]    = useState("");
  const [showCur,   setShowCur]   = useState(false);
  const [showNew,   setShowNew]   = useState(false);
  const [showConf,  setShowConf]  = useState(false);
  const [pwErr,     setPwErr]     = useState("");
  const [pwOk,      setPwOk]      = useState("");
  const [saving,    setSaving]    = useState(false);

  const pwStr = p => { if(!p||p.length<8) return 1; if(p.length>=12&&/[A-Z]/.test(p)&&/[0-9]/.test(p)&&/[^A-Za-z0-9]/.test(p)) return 4; if(p.length>=10&&/[A-Z]/.test(p)&&/[0-9]/.test(p)) return 3; return 2; };
  const strLabel = ["","Too short","Weak — add uppercase & numbers","Good","Strong ✅"];
  const strColor = ["","#ef4444","#f59e0b","#3b82f6","#10b981"];
  const str = pwStr(newPw);

  const saveProfile = async () => {
    if (!name.trim()) { showToast("Name cannot be empty","error"); return; }
    setSaving(true);
    await new Promise(r=>setTimeout(r,400));
    setUsers(prev=>prev.map(u=>u.id===curUser.id?{...u,name:name.trim(),phone:phone.trim(),dept:dept.trim()}:u));
    addLog("PROFILE_UPDATED", curUser.id, `${curUser.name} updated their profile`);
    showToast("✅ Profile updated!");
    setSaving(false);
  };

  const changePassword = async () => {
    setPwErr(""); setPwOk("");
    if (!curPw)          { setPwErr("Enter your current password."); return; }
    if (curPw !== getPassword(curUser.id)) { setPwErr("Current password is incorrect."); return; }
    if (newPw.length < 8){ setPwErr("New password must be at least 8 characters."); return; }
    if (newPw !== confPw){ setPwErr("New passwords do not match."); return; }
    if (newPw === curPw) { setPwErr("New password must be different from current."); return; }
    setSaving(true);
    await new Promise(r=>setTimeout(r,500));
    setPassword(curUser.id, newPw);
    addLog("PASSWORD_CHANGED", curUser.id, `${curUser.name} changed their password`);
    setSaving(false);
    setCurPw(""); setNewPw(""); setConfPw("");
    setPwOk("✅ Password changed successfully!");
    showToast("Password updated!");
  };

  const inputStyle = { width:"100%", padding:"9px 12px", border:"1px solid #e2e8f0", borderRadius:8, fontSize:13, outline:"none", background:"#f8fafc", boxSizing:"border-box" };
  const pwInputStyle = { ...inputStyle, paddingRight:40 };

  return (
    <Modal title="My Profile" onClose={onClose}>
      {/* Avatar + name header */}
      <div style={{ display:"flex", alignItems:"center", gap:16, padding:"0 0 20px", borderBottom:"1px solid #e2e8f0", marginBottom:20 }}>
        <div style={{ width:64, height:64, borderRadius:"50%", background:avCol(curUser.id), display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:24, fontWeight:800 }}>
          {inits(curUser.name)}
        </div>
        <div>
          <div style={{ fontWeight:700, fontSize:16, color:"#1e293b" }}>{curUser.name}</div>
          <div style={{ fontSize:12, color:"#64748b" }}>{curUser.email}</div>
          <div style={{ marginTop:4 }}><Badge label={ROLE_META[curUser.role]?.label||curUser.role} color={ROLE_META[curUser.role]?.color||"#6366f1"}/></div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:6, marginBottom:20 }}>
        {["profile","password"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{ background:tab===t?"#6366f1":"#f1f5f9", color:tab===t?"#fff":"#475569", border:"none", borderRadius:8, padding:"6px 18px", cursor:"pointer", fontSize:12, fontWeight:700, textTransform:"capitalize" }}>
            {t==="profile"?"👤 Profile":"🔑 Change Password"}
          </button>
        ))}
      </div>

      {/* Profile tab */}
      {tab==="profile" && (
        <div>
          <div style={{ marginBottom:14 }}>
            <label style={{ display:"block", fontSize:12, fontWeight:600, color:"#475569", marginBottom:4 }}>Full Name</label>
            <input value={name} onChange={e=>setName(e.target.value)} style={inputStyle}/>
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={{ display:"block", fontSize:12, fontWeight:600, color:"#475569", marginBottom:4 }}>Email Address</label>
            <input value={curUser.email} disabled style={{ ...inputStyle, background:"#f1f5f9", color:"#94a3b8", cursor:"not-allowed" }}/>
            <div style={{ fontSize:10, color:"#94a3b8", marginTop:3 }}>Email cannot be changed. Contact your admin.</div>
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={{ display:"block", fontSize:12, fontWeight:600, color:"#475569", marginBottom:4 }}>Phone</label>
            <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+1-555-0100" style={inputStyle}/>
          </div>
          <div style={{ marginBottom:20 }}>
            <label style={{ display:"block", fontSize:12, fontWeight:600, color:"#475569", marginBottom:4 }}>Department</label>
            <input value={dept} onChange={e=>setDept(e.target.value)} placeholder="e.g. Sales" style={inputStyle}/>
          </div>
          <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
            <button onClick={onClose} style={{ padding:"8px 18px", background:"#f1f5f9", color:"#475569", border:"none", borderRadius:8, fontWeight:600, fontSize:13, cursor:"pointer" }}>Cancel</button>
            <button onClick={saveProfile} disabled={saving} style={{ padding:"8px 18px", background:saving?"#a5b4fc":"#6366f1", color:"#fff", border:"none", borderRadius:8, fontWeight:600, fontSize:13, cursor:saving?"not-allowed":"pointer" }}>
              {saving?"⏳ Saving…":"💾 Save Changes"}
            </button>
          </div>
        </div>
      )}

      {/* Password tab */}
      {tab==="password" && (
        <div>
          <div style={{ background:"#f0f9ff", border:"1px solid #bae6fd", borderRadius:8, padding:12, marginBottom:18, fontSize:12, color:"#0369a1" }}>
            🔒 Use a strong password with uppercase letters, numbers, and symbols.
          </div>

          {/* Current password */}
          <div style={{ marginBottom:14 }}>
            <label style={{ display:"block", fontSize:12, fontWeight:600, color:"#475569", marginBottom:4 }}>Current Password</label>
            <div style={{ position:"relative" }}>
              <input type={showCur?"text":"password"} value={curPw} onChange={e=>setCurPw(e.target.value)} placeholder="••••••••" style={pwInputStyle}/>
              <button type="button" onClick={()=>setShowCur(!showCur)} style={{ position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:14,color:"#94a3b8" }}>{showCur?"🙈":"👁️"}</button>
            </div>
          </div>

          {/* New password */}
          <div style={{ marginBottom:14 }}>
            <label style={{ display:"block", fontSize:12, fontWeight:600, color:"#475569", marginBottom:4 }}>New Password</label>
            <div style={{ position:"relative" }}>
              <input type={showNew?"text":"password"} value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder="Min 8 characters" style={pwInputStyle}/>
              <button type="button" onClick={()=>setShowNew(!showNew)} style={{ position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:14,color:"#94a3b8" }}>{showNew?"🙈":"👁️"}</button>
            </div>
            {newPw.length>0&&(
              <div style={{ marginTop:6 }}>
                <div style={{ display:"flex", gap:4, marginBottom:3 }}>{[1,2,3,4].map(i=><div key={i} style={{ flex:1,height:4,borderRadius:2,background:i<=str?strColor[str]:"#e2e8f0",transition:"background .3s" }}/>)}</div>
                <div style={{ fontSize:10, color:strColor[str] }}>{strLabel[str]}</div>
              </div>
            )}
          </div>

          {/* Confirm new password */}
          <div style={{ marginBottom:16 }}>
            <label style={{ display:"block", fontSize:12, fontWeight:600, color:"#475569", marginBottom:4 }}>Confirm New Password</label>
            <div style={{ position:"relative" }}>
              <input type={showConf?"text":"password"} value={confPw} onChange={e=>setConfPw(e.target.value)} placeholder="Repeat new password" style={pwInputStyle}/>
              <button type="button" onClick={()=>setShowConf(!showConf)} style={{ position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:14,color:"#94a3b8" }}>{showConf?"🙈":"👁️"}</button>
            </div>
            {confPw.length>0&&newPw!==confPw&&<div style={{ fontSize:11,color:"#ef4444",marginTop:3 }}>⚠️ Passwords do not match</div>}
            {confPw.length>0&&newPw===confPw&&newPw.length>=8&&<div style={{ fontSize:11,color:"#10b981",marginTop:3 }}>✅ Passwords match</div>}
          </div>

          {pwErr && <div style={{ background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:14,color:"#dc2626",fontSize:13 }}>⚠️ {pwErr}</div>}
          {pwOk  && <div style={{ background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"10px 14px",marginBottom:14,color:"#166534",fontSize:13 }}>{pwOk}</div>}

          <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
            <button onClick={onClose} style={{ padding:"8px 18px", background:"#f1f5f9", color:"#475569", border:"none", borderRadius:8, fontWeight:600, fontSize:13, cursor:"pointer" }}>Cancel</button>
            <button onClick={changePassword} disabled={saving} style={{ padding:"8px 18px", background:saving?"#a5b4fc":"#6366f1", color:"#fff", border:"none", borderRadius:8, fontWeight:600, fontSize:13, cursor:saving?"not-allowed":"pointer" }}>
              {saving?"⏳ Saving…":"🔑 Change Password"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── DEMO SWITCHER (admin only) ────────────────────────────────────────────────
function DemoSwitcher({users,curUser,onSwitch}) {
  const [open,setOpen]=useState(false);
  return (
    <div style={{padding:"0 8px 8px"}}>
      <button onClick={()=>setOpen(!open)} style={{width:"100%",padding:"7px 10px",background:"rgba(14,165,233,.2)",color:"#7dd3fc",border:"1px solid rgba(14,165,233,.3)",borderRadius:8,fontSize:11,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span>🎭 Demo Switcher</span><span style={{fontSize:9}}>{open?"▲":"▼"}</span>
      </button>
      {open&&(
        <div style={{background:"rgba(0,0,0,.25)",borderRadius:8,marginTop:4,overflow:"hidden"}}>
          {users.filter(u=>u.active).map(u=>{
            const rm=ROLE_META[u.role]; const isMe=u.id===curUser.id;
            return (
              <button key={u.id} onClick={()=>{onSwitch(u);setOpen(false);}} disabled={isMe}
                style={{width:"100%",padding:"8px 10px",background:isMe?"rgba(14,165,233,.2)":"transparent",border:"none",borderBottom:"1px solid rgba(255,255,255,.06)",cursor:isMe?"default":"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:8}}>
                <Avatar name={u.name} id={u.id} size={22}/>
                <div style={{flex:1,overflow:"hidden"}}>
                  <div style={{fontSize:11,color:"#e2e8f0",fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{u.name}</div>
                  <div style={{fontSize:9,fontWeight:700,color:rm?.color||"#7dd3fc"}}>{rm?.label}</div>
                </div>
                {isMe&&<span style={{fontSize:9,color:"#7dd3fc"}}>● you</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── PASSWORD STORE (separate from user objects) ───────────────────────────────
function getPasswords() {
  try { return JSON.parse(localStorage.getItem("hd_passwords")||"{}"); } catch { return {}; }
}
function getPassword(userId) {
  const pw = getPasswords();
  return pw[userId] || "password123";
}
function setPassword(userId, newPw) {
  try {
    const pw = getPasswords();
    pw[userId] = newPw;
    localStorage.setItem("hd_passwords", JSON.stringify(pw));
  } catch {}
}

// ── STORAGE HELPERS (persist to localStorage on live site) ───────────────────
function loadState(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch { return fallback; }
}
function saveState(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function clearAuth() {
  try { localStorage.removeItem("hd_curUser"); } catch {}
}

// ── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [users,       setUsersRaw]       = useState(() => loadState("hd_users",       SEED_USERS));
  const [companies,   setCompaniesRaw]   = useState(() => loadState("hd_companies",   SEED_COMPANIES));
  const [clients,     setClientsRaw]     = useState(() => loadState("hd_clients",     SEED_CLIENTS));
  const [tickets,     setTicketsRaw]     = useState(() => loadState("hd_tickets",     SEED_TICKETS));
  const [ticketTypes, setTicketTypesRaw] = useState(() => loadState("hd_ticketTypes", SEED_TYPES));
  const [logs,        setLogsRaw]        = useState(() => loadState("hd_logs",        SEED_LOGS));
  const [curUser,     setCurUserRaw]     = useState(() => loadState("hd_curUser",     null));
  const [page,        setPage]        = useState("dashboard");
  const [selTicket,   setSelTicket]   = useState(null);
  const [toast,       setToast]       = useState(null);
  const [breaches,    setBreaches]    = useState([]);
  const [showProfile, setShowProfile] = useState(false);

  // Wrap setters to also persist to localStorage
  const setUsers       = v => { const n = typeof v==="function"?v(users):v;       saveState("hd_users",n);       setUsersRaw(n); };
  const setCompanies   = v => { const n = typeof v==="function"?v(companies):v;   saveState("hd_companies",n);   setCompaniesRaw(n); };
  const setClients     = v => { const n = typeof v==="function"?v(clients):v;     saveState("hd_clients",n);     setClientsRaw(n); };
  const setTickets     = v => { const n = typeof v==="function"?v(tickets):v;     saveState("hd_tickets",n);     setTicketsRaw(n); };
  const setTicketTypes = v => { const n = typeof v==="function"?v(ticketTypes):v; saveState("hd_ticketTypes",n); setTicketTypesRaw(n); };
  const setLogs        = v => { const n = typeof v==="function"?v(logs):v;        saveState("hd_logs",n);        setLogsRaw(n); };
  const setCurUser     = u => { if(u) saveState("hd_curUser",u); else clearAuth(); setCurUserRaw(u); };

  const addLog = useCallback((action,target,detail,uId)=>{
    const entry = {id:uid(),action,userId:uId||curUser?.id,target,detail,timestamp:new Date().toISOString()};
    setLogs(p => { const n=[entry,...p].slice(0,500); saveState("hd_logs",n); return n; });
  },[curUser]);

  const showToast = useCallback((msg,type)=>{
    setToast({msg,type:type||"ok"});
    setTimeout(()=>setToast(null),3000);
  },[]);

  useEffect(()=>{
    const check=()=>setBreaches(tickets.filter(t=>!t.deleted&&!["Closed","Resolved"].includes(t.status)&&t.slaDeadline&&Date.now()>new Date(t.slaDeadline).getTime()));
    check();
    const iv=setInterval(check,30000);
    return ()=>clearInterval(iv);
  },[tickets]);

  const isAdmin = ["admin","it_manager"].includes(curUser?.role);
  const isTech  = ["admin","it_manager","it_technician"].includes(curUser?.role);
  const visible = useMemo(() =>
    tickets.filter(t => !t.deleted && (isTech || t.submittedBy===curUser?.id || t.assignedTo===curUser?.id)),
    [tickets, curUser, isTech]
  );

  if (!curUser) return <LoginPage users={users} setUsers={setUsers} companies={companies} onLogin={u=>setCurUser(u)}/>;

  const NAV=[
    {id:"dashboard",   icon:"🏠",label:"Dashboard"},
    {id:"tickets",     icon:"🎫",label:"Tickets"},
    {id:"new_ticket",  icon:"➕",label:"New Ticket"},
    {id:"reports",     icon:"📊",label:"Reports",     admin:true},
    {id:"users",       icon:"👥",label:"Users",       admin:true},
    {id:"companies",   icon:"🏢",label:"Companies",   superAdmin:true},
    {id:"clients",     icon:"🤝",label:"Clients",     superAdmin:true},
    {id:"ticket_types",icon:"🏷️",label:"Ticket Types",superAdmin:true},
    {id:"activity_log",icon:"📋",label:"Activity Log",superAdmin:true},
    {id:"sms_tracker", icon:"💬",label:"SMS Tracker", admin:true},
  ].filter(n=>{if(n.superAdmin) return curUser.role==="admin"; if(n.admin) return isAdmin; return true;});

  return (
    <ErrorBoundary>
    <div style={{display:"flex",height:"100vh",fontFamily:"'Inter',system-ui,sans-serif",background:"#f8fafc",fontSize:13,overflow:"hidden"}}>
      <style>{`*{box-sizing:border-box}::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:#f1f5f9}::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:4px}button:hover{opacity:.88}.nv:hover{background:rgba(14,165,233,.15)!important;color:#7dd3fc!important}`}</style>

      {/* SIDEBAR */}
      <div style={{width:220,background:"linear-gradient(180deg,#020e1f,#041833,#062d6b)",display:"flex",flexDirection:"column",flexShrink:0}}>
        <div style={{padding:"20px 16px 14px",borderBottom:"1px solid rgba(56,189,248,.15)"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:32,height:32,borderRadius:"50%",background:"linear-gradient(135deg,#fff 60%,#b3d9ff)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 0 12px rgba(56,189,248,.4)"}}>
              <div style={{width:20,height:20,borderRadius:"50%",background:"linear-gradient(135deg,#0369a1,#0ea5e9)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:"#020e1f"}}/>
              </div>
            </div>
            <div>
              <div style={{color:"#fff",fontWeight:800,fontSize:15,letterSpacing:-.3}}>hoptix</div>
              <div style={{color:"#38bdf8",fontSize:9,letterSpacing:.8}}>A.eye technology</div>
            </div>
          </div>
        </div>

        <div style={{padding:"8px 8px",flex:1,overflowY:"auto"}}>
          {NAV.map(n=>(
            <div key={n.id} className="nv" onClick={()=>setPage(n.id)}
              style={{padding:"9px 12px",borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",gap:8,marginBottom:2,background:page===n.id?"rgba(14,165,233,.25)":"transparent",color:page===n.id?"#fff":"#93c5fd",fontWeight:page===n.id?700:500,fontSize:12,transition:"all .15s",borderLeft:page===n.id?"3px solid #0ea5e9":"3px solid transparent"}}>
              <span style={{fontSize:14}}>{n.icon}</span>{n.label}
              {n.id==="tickets"&&breaches.length>0&&<span style={{marginLeft:"auto",background:"#ef4444",color:"#fff",borderRadius:10,padding:"1px 6px",fontSize:10}}>{breaches.length}</span>}
            </div>
          ))}
        </div>

        {curUser.role==="admin"&&<DemoSwitcher users={users} curUser={curUser} onSwitch={u=>{setCurUser(u);setPage("dashboard");}}/>}

        <div style={{padding:"12px 10px",borderTop:"1px solid rgba(56,189,248,.15)"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
            <Avatar name={curUser.name} id={curUser.id} size={32}/>
            <div style={{flex:1,overflow:"hidden"}}>
              <div style={{color:"#fff",fontSize:12,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{curUser.name}</div>
              <div style={{color:"#7dd3fc",fontSize:10}}>{ROLE_META[curUser.role]?.label}</div>
            </div>
          </div>
          <button onClick={()=>{ setCurUser(null); setPage("dashboard"); setSelTicket(null); }} style={{width:"100%",padding:"7px",background:"rgba(239,68,68,.2)",color:"#fca5a5",border:"1px solid rgba(239,68,68,.3)",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
            🚪 Sign Out
          </button>
        </div>
      </div>

      {/* MAIN */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",padding:"10px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div style={{fontWeight:700,fontSize:14,color:"#1e293b"}}>{(NAV.find(n=>n.id===page)||{icon:"",label:""}).icon} {(NAV.find(n=>n.id===page)||{label:"—"}).label}</div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            {breaches.length>0&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:20,padding:"4px 12px",color:"#dc2626",fontSize:11,fontWeight:700}}>⚠️ {breaches.length} SLA Breach{breaches.length>1?"es":""}</div>}
            <button onClick={()=>setShowProfile(true)} style={{ display:"flex", alignItems:"center", gap:8, background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:10, padding:"5px 12px 5px 6px", cursor:"pointer" }}>
              <Avatar name={curUser.name} id={curUser.id} size={28}/>
              <div style={{ textAlign:"left" }}>
                <div style={{fontWeight:700,fontSize:12}}>{curUser.name}</div>
                <div style={{fontSize:10,color:"#94a3b8"}}>{ROLE_META[curUser.role]?.label}</div>
              </div>
              <span style={{ fontSize:10, color:"#94a3b8", marginLeft:4 }}>▼</span>
            </button>
          </div>
        </div>

        {toast&&<div style={{position:"fixed",top:20,right:20,zIndex:10000,background:toast.type==="error"?"#ef4444":"#10b981",color:"#fff",padding:"10px 20px",borderRadius:10,fontWeight:600,fontSize:13,boxShadow:"0 4px 20px rgba(0,0,0,.2)"}}>{toast.msg}</div>}

        <div style={{flex:1,overflowY:"auto",padding:24}}>
          {page==="dashboard"   &&<PageDashboard   tickets={visible} users={users} ticketTypes={ticketTypes} companies={companies} clients={clients} setPage={setPage} setSelTicket={setSelTicket} breaches={breaches}/>}
          {page==="tickets"     &&<PageTickets     tickets={visible} users={users} companies={companies} clients={clients} ticketTypes={ticketTypes} curUser={curUser} setTickets={setTickets} addLog={addLog} showToast={showToast} setSelTicket={setSelTicket} setPage={setPage} isAdmin={isAdmin}/>}
          {page==="new_ticket"  &&<PageNewTicket   users={users} companies={companies} clients={clients} ticketTypes={ticketTypes} curUser={curUser} setTickets={setTickets} addLog={addLog} showToast={showToast} setPage={setPage}/>}
          {page==="reports"     &&<PageReports     tickets={visible} users={users} ticketTypes={ticketTypes} companies={companies}/>}
          {page==="users"       &&<PageUsers       users={users} companies={companies} setUsers={setUsers} curUser={curUser} addLog={addLog} showToast={showToast}/>}
          {page==="companies"   &&<PageCompanies   companies={companies} users={users} setCompanies={setCompanies} addLog={addLog} showToast={showToast}/>}
          {page==="clients"     &&<PageClients     clients={clients} setClients={setClients} companies={companies} addLog={addLog} showToast={showToast}/>}
          {page==="ticket_types"&&<PageTicketTypes ticketTypes={ticketTypes} users={users} setTicketTypes={setTicketTypes} addLog={addLog} showToast={showToast}/>}
          {page==="activity_log"&&<PageActivityLog logs={logs} users={users}/>}
          {page==="sms_tracker" &&<PageSmsTracker  tickets={visible} users={users} curUser={curUser} showToast={showToast} addLog={addLog}/>}
        </div>
      </div>

      {selTicket&&<TicketDetail ticket={tickets.find(t=>t.id===selTicket)} setTickets={setTickets} users={users} ticketTypes={ticketTypes} companies={companies} clients={clients} curUser={curUser} isAdmin={isAdmin} isTech={isTech} addLog={addLog} showToast={showToast} onClose={()=>setSelTicket(null)}/>}
      {showProfile&&<ProfileModal curUser={curUser} setUsers={setUsers} showToast={showToast} addLog={addLog} onClose={()=>setShowProfile(false)}/>}
    </div>
    </ErrorBoundary>
  );
}

// ── DASHBOARD ────────────────────────────────────────────────────────────────
function PageDashboard({tickets,users,ticketTypes,companies,clients,setPage,setSelTicket,breaches}) {
  const byStatus=ALL_STATUSES.map(s=>({name:s,value:tickets.filter(t=>t.status===s).length,color:STATUS_META[s].color}));
  const byType=ticketTypes.map((tt,i)=>({name:tt.name,value:tickets.filter(t=>t.typeId===tt.id).length,fill:PAL[i%PAL.length]})).filter(x=>x.value>0);
  const byPri=Object.entries(PRI_META).map(([k,v])=>({name:v.label,value:tickets.filter(t=>t.priority===k).length,color:v.color}));
  const daily=Array.from({length:7},(_,i)=>{const d=new Date(Date.now()-(6-i)*86400000);return{lbl:d.toLocaleDateString("en",{weekday:"short"}),created:tickets.filter(t=>new Date(t.createdAt).toDateString()===d.toDateString()).length,resolved:tickets.filter(t=>t.resolvedAt&&new Date(t.resolvedAt).toDateString()===d.toDateString()).length};});
  const techs=users.filter(u=>["it_technician","it_manager"].includes(u.role));
  return (
    <div>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
        <Stat label="Total Tickets"  value={tickets.length}                                    icon="🎫" color="#6366f1"/>
        <Stat label="Open"           value={tickets.filter(t=>t.status==="Open").length}        icon="📬" color="#f59e0b"/>
        <Stat label="In Progress"    value={tickets.filter(t=>t.status==="In Progress").length} icon="⚙️" color="#6366f1"/>
        <Stat label="Resolved"       value={tickets.filter(t=>t.status==="Resolved").length}    icon="✅" color="#10b981"/>
        <Stat label="SLA Breaches"   value={breaches.length}                                    icon="🚨" color="#ef4444" sub="need attention"/>
        <Stat label="Active Clients" value={clients.length}                                     icon="🤝" color="#8b5cf6" sub={clients.reduce((a,c)=>a+c.locations.length,0)+" locations"}/>
      </div>
      {breaches.length>0&&(
        <Card style={{marginBottom:20,borderLeft:"4px solid #ef4444",background:"#fef2f2"}}>
          <div style={{fontWeight:700,color:"#dc2626",marginBottom:10}}>🚨 SLA Breach Alerts</div>
          {breaches.slice(0,5).map(t=>(
            <div key={t.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#fff",padding:"8px 12px",borderRadius:8,border:"1px solid #fecaca",marginBottom:6}}>
              <span style={{fontWeight:600,fontSize:12}}>#{t.id} — {t.title}</span>
              <div style={{display:"flex",gap:8,alignItems:"center"}}><Badge label={t.status} color={STATUS_META[t.status]?.color||"#6366f1"}/><Btn size="sm" variant="ghost" onClick={()=>setSelTicket(t.id)}>View</Btn></div>
            </div>
          ))}
        </Card>
      )}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginBottom:16}}>
        <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>Tickets by Status</div>
          <ResponsiveContainer width="100%" height={200}><PieChart><Pie data={byStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({name,value})=>name+":"+value} fontSize={9}>{byStatus.map((e,i)=><Cell key={i} fill={e.color}/>)}</Pie><Tooltip/></PieChart></ResponsiveContainer>
        </Card>
        <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>7-Day Trend</div>
          <ResponsiveContainer width="100%" height={200}><AreaChart data={daily}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="lbl" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Legend wrapperStyle={{fontSize:10}}/><Area type="monotone" dataKey="created" stroke="#6366f1" fill="#eef2ff" name="Created"/><Area type="monotone" dataKey="resolved" stroke="#10b981" fill="#d1fae5" name="Resolved"/></AreaChart></ResponsiveContainer>
        </Card>
        <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>By Priority</div>
          <ResponsiveContainer width="100%" height={200}><BarChart data={byPri}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="value" radius={[4,4,0,0]}>{byPri.map((e,i)=><Cell key={i} fill={e.color}/>)}</Bar></BarChart></ResponsiveContainer>
        </Card>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>Technician Workload</div>
          {techs.map(t=>{const open=tickets.filter(tk=>tk.assignedTo===t.id&&!["Closed","Resolved"].includes(tk.status)).length;const total=tickets.filter(tk=>tk.assignedTo===t.id).length;return(
            <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
              <Avatar name={t.name} id={t.id} size={26}/>
              <div style={{flex:1}}><div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontWeight:600}}><span>{t.name}</span><span style={{color:"#6366f1"}}>{open} open / {total} total</span></div>
                <div style={{background:"#e2e8f0",borderRadius:4,height:6,marginTop:4}}><div style={{background:"#6366f1",height:6,borderRadius:4,width:(total?Math.min(100,Math.round(open/total*100)):0)+"%"}}/></div>
              </div>
            </div>
          );})}
        </Card>
        <Card><div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>Tickets by Type</div>
          {byType.slice(0,7).map((t,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid #f1f5f9"}}><span style={{fontSize:12,color:"#475569"}}>{t.name}</span><Badge label={t.value} color={PAL[i%PAL.length]}/></div>
          ))}
        </Card>
      </div>
    </div>
  );
}

// ── TICKET LIST ───────────────────────────────────────────────────────────────
function PageTickets({tickets,users,companies,clients,ticketTypes,curUser,setTickets,addLog,showToast,setSelTicket,setPage,isAdmin}) {
  const [search,setSearch]=useState(""); const [fStat,setFStat]=useState(""); const [fPri,setFPri]=useState(""); const [fType,setFType]=useState("");
  const filtered=tickets.filter(t=>{const q=search.toLowerCase();return(!q||t.title.toLowerCase().includes(q)||t.id.includes(q)||t.description.toLowerCase().includes(q))&&(!fStat||t.status===fStat)&&(!fPri||t.priority===fPri)&&(!fType||t.typeId===fType);});
  const delTicket=id=>{setTickets(prev=>prev.map(t=>t.id===id?{...t,deleted:true}:t));addLog("TICKET_DELETED",id,"Ticket #"+id+" deleted");showToast("Ticket deleted");};
  const u=id=>users.find(x=>x.id===id); const tt=id=>ticketTypes.find(x=>x.id===id); const cl=id=>clients.find(x=>x.id===id);
  const getLoc=(cid,lid)=>{const c=cl(cid);return c?c.locations.find(l=>l.id===lid):null;};
  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Search..." style={{flex:1,minWidth:160,padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}/>
        <select value={fStat} onChange={e=>setFStat(e.target.value)} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}><option value="">All Statuses</option>{ALL_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}</select>
        <select value={fPri} onChange={e=>setFPri(e.target.value)} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}><option value="">All Priorities</option>{Object.entries(PRI_META).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select>
        <select value={fType} onChange={e=>setFType(e.target.value)} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}><option value="">All Types</option>{ticketTypes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <Btn onClick={()=>setPage("new_ticket")}>➕ New Ticket</Btn>
      </div>
      <div style={{background:"#fff",borderRadius:12,border:"1px solid #e2e8f0",overflow:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:900}}>
          <thead><tr style={{background:"#f8fafc"}}>{["#","Title","Type","Priority","Status","Client","Location","Assigned To","SLA",""].map(h=><th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.5,borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
          <tbody>
            {filtered.length===0&&<tr><td colSpan={10} style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No tickets found</td></tr>}
            {filtered.map((t,i)=>{const asgn=u(t.assignedTo);const type=tt(t.typeId);const client=cl(t.clientId);const loc=getLoc(t.clientId,t.locationId);const pri=PRI_META[t.priority]||PRI_META.medium;const sm=STATUS_META[t.status]||STATUS_META.Open;return(
              <tr key={t.id} style={{borderBottom:"1px solid #f1f5f9",background:i%2===0?"#fff":"#fafafa"}}>
                <td style={{padding:"9px 12px",fontSize:11,color:"#94a3b8",fontWeight:600}}>#{t.id}</td>
                <td style={{padding:"9px 12px",maxWidth:180}}><div style={{fontWeight:600,color:"#1e293b",fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.title}</div><div style={{fontSize:10,color:"#94a3b8"}}>{ago(t.createdAt)}</div></td>
                <td style={{padding:"9px 12px"}}><Badge label={type?.name||"—"} color={type?.color||"#94a3b8"}/></td>
                <td style={{padding:"9px 12px"}}><Badge label={pri.label} color={pri.color} bg={pri.bg}/></td>
                <td style={{padding:"9px 12px"}}><Badge label={t.status} color={sm.color} bg={sm.bg}/></td>
                <td style={{padding:"9px 12px",fontSize:11,color:"#334155"}}>{client?<span>🤝 {client.name}</span>:<span style={{color:"#94a3b8"}}>—</span>}</td>
                <td style={{padding:"9px 12px",fontSize:11,color:"#334155"}}>{loc?<span>📍 {loc.name}</span>:<span style={{color:"#94a3b8"}}>—</span>}</td>
                <td style={{padding:"9px 12px"}}>{asgn?<div style={{display:"flex",alignItems:"center",gap:6}}><Avatar name={asgn.name} id={asgn.id} size={22}/><span style={{fontSize:11}}>{asgn.name}</span></div>:<span style={{fontSize:11,color:"#ef4444"}}>Unassigned</span>}</td>
                <td style={{padding:"9px 12px"}}>{t.slaBreached&&!["Closed","Resolved"].includes(t.status)?<Badge label="BREACHED" color="#ef4444"/>:<span style={{fontSize:10,color:"#10b981"}}>✓ OK</span>}</td>
                <td style={{padding:"9px 12px"}}><div style={{display:"flex",gap:4}}><Btn size="sm" variant="ghost" onClick={()=>setSelTicket(t.id)}>View</Btn>{isAdmin&&<Btn size="sm" variant="danger" onClick={()=>delTicket(t.id)}>🗑</Btn>}</div></td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── NEW TICKET ────────────────────────────────────────────────────────────────
function PageNewTicket({users,companies,clients,ticketTypes,curUser,setTickets,addLog,showToast,setPage}) {
  const [form,setForm]=useState({title:"",description:"",typeId:ticketTypes[0]?.id||"",companyId:curUser.companyId||companies[0]?.id||"",clientId:"",locationId:"",externalEmail:"",customTypeName:""});
  const [start]=useState(Date.now()); const [preview,setPreview]=useState(null); const [attachments,setAttachments]=useState([]); const [dragOver,setDragOver]=useState(false);
  const fld=(k,v)=>setForm(p=>({...p,[k]:v}));
  const selType=ticketTypes.find(t=>t.id===form.typeId); const isOthers=selType&&selType.name==="Others";
  const selClient=clients.find(c=>c.id===form.clientId); const availLocs=selClient?selClient.locations:[];
  const ACCEPTED=["image/jpeg","image/png","image/gif","image/webp","video/mp4","video/quicktime","video/webm"];
  const MAX_SIZE=20*1024*1024;
  const fmtSize=b=>b>1048576?(b/1048576).toFixed(1)+"MB":(b/1024).toFixed(0)+"KB";
  const processFiles=files=>{Array.from(files).forEach(file=>{if(!ACCEPTED.includes(file.type)){showToast("Unsupported: "+file.name,"error");return;}if(file.size>MAX_SIZE){showToast(file.name+" > 20MB","error");return;}const r=new FileReader();r.onload=e=>{setAttachments(prev=>{if(prev.length>=10){showToast("Max 10 attachments","error");return prev;}return[...prev,{id:uid(),name:file.name,type:file.type,size:file.size,dataUrl:e.target.result}];});};r.readAsDataURL(file);});};
  const removeAtt=id=>setAttachments(prev=>prev.filter(a=>a.id!==id));

  const handlePreview=()=>{
    if(!form.title.trim()||!form.description.trim()){showToast("Fill in title and description","error");return;}
    const assign=aiAssign(form.title,form.description,form.typeId,users,ticketTypes);
    const tt=ticketTypes.find(t=>t.id===form.typeId);
    const cat=new Date().toISOString(); const sla=new Date(Date.now()+(tt?tt.slaHours:24)*3600000).toISOString();
    const mins=Math.max(1,Math.round((Date.now()-start)/60000));
    const draft={id:"t"+Date.now(),...form,status:"Open",priority:tt?tt.priority:"medium",submittedBy:curUser.id,assignedTo:assign.id,createdAt:cat,updatedAt:cat,slaDeadline:sla,slaBreached:false,timeToCreateMins:mins,statusHistory:[{status:"Open",assignedTo:assign.id,timestamp:cat,changedBy:curUser.id,note:"Ticket created — "+assign.reason}],conversations:[],resolvedAt:null,closedAt:null,deleted:false,aiReason:assign.reason,attachments};
    setPreview({draft,assign});
  };
  const handleSubmit=()=>{setTickets(prev=>[...prev,preview.draft]);addLog("TICKET_CREATED",preview.draft.id,"Ticket \""+preview.draft.title+"\" created. "+preview.assign.reason);showToast("✅ Ticket submitted!");setPage("tickets");};

  return (
    <div style={{maxWidth:680,margin:"0 auto"}}>
      <Card>
        <div style={{fontWeight:700,fontSize:15,color:"#1e293b",marginBottom:18}}>📋 Submit New Ticket</div>
        <FInput label="Title *" value={form.title} onChange={e=>fld("title",e.target.value)} placeholder="Brief description"/>
        <FSelect label="Ticket Type *" value={form.typeId} onChange={e=>fld("typeId",e.target.value)} options={ticketTypes.map(t=>({value:t.id,label:t.name+" — "+(PRI_META[t.priority]?.label||t.priority)+", SLA "+t.slaHours+"h"}))}/>
        {isOthers&&<FInput label="Describe Type *" value={form.customTypeName} onChange={e=>fld("customTypeName",e.target.value)} placeholder="Describe this type"/>}
        <FSelect label="Company *" value={form.companyId} onChange={e=>fld("companyId",e.target.value)} options={companies.map(c=>({value:c.id,label:c.name}))}/>

        {/* Client & Location */}
        <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:14,marginBottom:14}}>
          <div style={{fontWeight:700,color:"#1e293b",fontSize:12,marginBottom:12}}>🤝 Client &amp; Location</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Client</label>
              <select value={form.clientId} onChange={e=>{fld("clientId",e.target.value);fld("locationId","");}} style={{width:"100%",padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:"#fff",boxSizing:"border-box"}}>
                <option value="">— No Client —</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Location</label>
              <select value={form.locationId} onChange={e=>fld("locationId",e.target.value)} disabled={!form.clientId} style={{width:"100%",padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",background:form.clientId?"#fff":"#f1f5f9",boxSizing:"border-box"}}>
                <option value="">— Select Location —</option>{availLocs.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>
          {selClient&&<div style={{marginTop:8,fontSize:11,color:"#475569",display:"flex",gap:16,flexWrap:"wrap"}}><span>📧 {selClient.email}</span><span>📞 {selClient.phone}</span>{form.locationId&&(()=>{const loc=availLocs.find(l=>l.id===form.locationId);return loc?<span>📍 {loc.address}</span>:null;})()}</div>}
        </div>

        <FTextarea label="Description *" value={form.description} onChange={e=>fld("description",e.target.value)} placeholder="Detailed description…" rows={5}/>
        <FInput label="External Email (optional)" value={form.externalEmail} onChange={e=>fld("externalEmail",e.target.value)} placeholder="external@client.com" type="email"/>

        {/* Attachments */}
        <div style={{marginBottom:14}}>
          <label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:6}}>📎 Attachments <span style={{fontWeight:400,color:"#94a3b8"}}>(images &amp; videos, max 10 · 20MB each)</span></label>
          <div onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={e=>{e.preventDefault();setDragOver(false);processFiles(e.dataTransfer.files);}} onClick={()=>document.getElementById("tfi").click()} style={{border:"2px dashed "+(dragOver?"#6366f1":"#cbd5e1"),borderRadius:10,padding:"20px 16px",textAlign:"center",cursor:"pointer",background:dragOver?"#eef2ff":"#f8fafc",marginBottom:10}}>
            <div style={{fontSize:24,marginBottom:6}}>🖼️</div>
            <div style={{fontSize:13,fontWeight:600,color:dragOver?"#4338ca":"#475569"}}>Drop images or videos here</div>
            <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>or click to browse · JPG, PNG, GIF, WebP, MP4, MOV</div>
          </div>
          <input id="tfi" type="file" multiple accept="image/*,video/*" style={{display:"none"}} onChange={e=>{processFiles(e.target.files);e.target.value="";}}/>
          {attachments.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(100px,1fr))",gap:8}}>{attachments.map(a=>(
            <div key={a.id} style={{position:"relative",borderRadius:8,overflow:"hidden",border:"1px solid #e2e8f0"}}>
              {a.type.startsWith("image/")?<img src={a.dataUrl} alt={a.name} style={{width:"100%",height:80,objectFit:"cover",display:"block"}}/>:<div style={{height:80,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,background:"#1e1b4b"}}><span style={{fontSize:28}}>🎬</span><span style={{fontSize:9,color:"#a5b4fc"}}>{a.name.slice(0,12)}</span></div>}
              <div style={{padding:"3px 6px",fontSize:9,color:"#64748b",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{a.name} · {fmtSize(a.size)}</div>
              <button onClick={e=>{e.stopPropagation();removeAtt(a.id);}} style={{position:"absolute",top:3,right:3,background:"rgba(0,0,0,.55)",color:"#fff",border:"none",borderRadius:"50%",width:18,height:18,cursor:"pointer",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>
          ))}</div>}
        </div>

        {selType&&<div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:8,padding:12,marginBottom:14,fontSize:12}}><div style={{fontWeight:700,color:"#0369a1",marginBottom:4}}>Auto-settings for "{selType.name}"</div><div style={{display:"flex",gap:16,color:"#0c4a6e",flexWrap:"wrap"}}><span>⚡ Priority: <strong>{PRI_META[selType.priority]?.label}</strong></span><span>⏱ SLA: <strong>{selType.slaHours}h</strong></span><span>🤖 AI will auto-assign</span></div></div>}
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={()=>setPage("tickets")}>Cancel</Btn><Btn onClick={handlePreview}>🔍 Preview &amp; Submit</Btn></div>
      </Card>
      {preview&&<Modal title="Confirm Submission" onClose={()=>setPreview(null)}>
        <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:12,marginBottom:14}}><div style={{fontWeight:700,color:"#166534",marginBottom:4}}>🤖 AI Assignment</div><div style={{fontSize:12,color:"#14532d"}}>{preview.assign.reason}</div></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>{[["Title",preview.draft.title],["Priority",PRI_META[preview.draft.priority]?.label],["SLA",fdt(preview.draft.slaDeadline)],["Assigned To",users.find(u=>u.id===preview.draft.assignedTo)?.name||"Unassigned"],["Client",clients.find(c=>c.id===preview.draft.clientId)?.name||"—"],["Attachments",preview.draft.attachments.length+" files"],["Create Time",preview.draft.timeToCreateMins+" min"]].map(([l,v])=><div key={l} style={{background:"#f8fafc",padding:10,borderRadius:8}}><div style={{color:"#64748b",fontSize:10,fontWeight:700,textTransform:"uppercase"}}>{l}</div><div style={{fontWeight:600,color:"#1e293b",marginTop:2,fontSize:12}}>{v||"—"}</div></div>)}</div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={()=>setPreview(null)}>Edit</Btn><Btn variant="success" onClick={handleSubmit}>✅ Confirm &amp; Submit</Btn></div>
      </Modal>}
    </div>
  );
}

// ── TICKET DETAIL ─────────────────────────────────────────────────────────────
function TicketDetail({ticket,setTickets,users,ticketTypes,companies,clients,curUser,isAdmin,isTech,addLog,showToast,onClose}) {
  const [tab,setTab]=useState("details"); const [status,setStatus]=useState(ticket.status); const [asgn,setAsgn]=useState(ticket.assignedTo||""); const [note,setNote]=useState("");
  const [msgTo,setMsgTo]=useState(""); const [msgCC,setMsgCC]=useState(""); const [msgSubj,setMsgSubj]=useState("Re: [#"+ticket.id+"] "+ticket.title); const [msgBody,setMsgBody]=useState("");
  const [smsTo,setSmsTo]=useState(""); const [smsBody,setSmsBody]=useState(""); const [smsLog,setSmsLog]=useState([]);
  const [emailSending,setEmailSending]=useState(false); const [smsSending,setSmsSending]=useState(false);
  const fu=id=>users.find(x=>x.id===id); const tt=ticketTypes.find(t=>t.id===ticket.typeId); const co=companies.find(c=>c.id===ticket.companyId);
  const client=clients.find(c=>c.id===ticket.clientId); const loc=client?client.locations.find(l=>l.id===ticket.locationId):null;
  const techs=users.filter(u=>["it_technician","it_manager","admin"].includes(u.role)&&u.active);

  const saveStatus=()=>{
    const hist={status,assignedTo:asgn||null,timestamp:new Date().toISOString(),changedBy:curUser.id,note:note||"Status changed to "+status};
    setTickets(prev=>prev.map(t=>t.id!==ticket.id?t:{...t,status,assignedTo:asgn||null,updatedAt:new Date().toISOString(),slaBreached:new Date()>new Date(t.slaDeadline)&&!["Closed","Resolved"].includes(status),resolvedAt:status==="Resolved"&&!t.resolvedAt?new Date().toISOString():t.resolvedAt,closedAt:status==="Closed"&&!t.closedAt?new Date().toISOString():t.closedAt,statusHistory:[...(t.statusHistory||[]),hist]}));
    addLog("TICKET_STATUS",ticket.id,"Status → "+status+". Assigned: "+(fu(asgn)?.name||"nobody")); showToast("Ticket updated"); setNote("");
  };

  const sendEmail=async()=>{
    if(!msgTo.trim()||!msgBody.trim()){showToast("Recipient and body required","error");return;}
    setEmailSending(true);
    const toList=msgTo.split(",").map(e=>e.trim()); const ccList=msgCC?msgCC.split(",").map(e=>e.trim()):[];
    const msg={id:uid(),from:curUser.id,fromEmail:curUser.email,to:[],toEmails:toList,cc:ccList,subject:msgSubj,body:msgBody,timestamp:new Date().toISOString(),isExternal:false,status:"sending"};
    setTickets(prev=>prev.map(t=>t.id===ticket.id?{...t,conversations:[...(t.conversations||[]),msg]}:t));
    const results=await Promise.all([...toList,...ccList].map(email=>callSendEmail({to:email,cc:ccList,subject:msgSubj,body:msgBody,ticketId:ticket.id})));
    const allOk=results.every(r=>r.success);
    setTickets(prev=>prev.map(t=>t.id===ticket.id?{...t,conversations:(t.conversations||[]).map(c=>c.id===msg.id?{...c,status:allOk?"sent":"failed"}:c)}:t));
    addLog("EMAIL_SENT",ticket.id,"Email sent to "+msgTo+(allOk?"":" [FAILED]")); showToast(allOk?"📧 Email sent via SendGrid!":"⚠️ Some emails failed",allOk?"ok":"error");
    setEmailSending(false); if(allOk){setMsgTo("");setMsgCC("");setMsgBody("");}
  };

  const sendSms=async()=>{
    if(!smsTo.trim()||!smsBody.trim()){showToast("Phone and message required","error");return;}
    setSmsSending(true);
    const entry={id:uid(),to:smsTo,body:smsBody,from:curUser.name,ts:new Date().toISOString(),status:"sending"};
    setSmsLog(prev=>[...prev,entry]);
    const result=await callSendSms({to:smsTo,message:smsBody,ticketId:ticket.id});
    setSmsLog(prev=>prev.map(s=>s.id===entry.id?{...s,status:result.success?"delivered":"failed"}:s));
    addLog("SMS_SENT",ticket.id,"SMS → "+smsTo+(result.success?"":" [FAILED]")); showToast(result.success?"📱 SMS sent via Twilio!":"⚠️ SMS failed: "+result.error,result.success?"ok":"error");
    setSmsSending(false); if(result.success){setSmsTo("");setSmsBody("");}
  };

  if (!ticket) return null;

  return (
    <Modal title={"Ticket #"+ticket.id+" — "+ticket.title} onClose={onClose} wide>
      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
        {["details","status","email","sms","history"].map(t=><button key={t} onClick={()=>setTab(t)} style={{background:tab===t?"#6366f1":"#f1f5f9",color:tab===t?"#fff":"#475569",border:"none",borderRadius:8,padding:"5px 14px",cursor:"pointer",fontSize:12,fontWeight:700,textTransform:"capitalize"}}>{t}</button>)}
      </div>

      {tab==="details"&&<div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
          {[["Title",ticket.title],["Type",tt?.name||(ticket.customTypeName||"—")],["Priority",<Badge key="p" label={PRI_META[ticket.priority]?.label||ticket.priority} color={PRI_META[ticket.priority]?.color||"#6366f1"}/>],["Status",<Badge key="s" label={ticket.status} color={STATUS_META[ticket.status]?.color||"#6366f1"}/>],["Company",co?.name||"—"],["Submitted By",fu(ticket.submittedBy)?.name||"—"],["Assigned To",fu(ticket.assignedTo)?.name||"Unassigned"],["AI Reason",ticket.aiReason||"—"],["Created",fdt(ticket.createdAt)],["SLA Deadline",fdt(ticket.slaDeadline)],["Create Time",(ticket.timeToCreateMins||1)+" min"],["SLA Status",ticket.slaBreached?<Badge key="sl" label="BREACHED" color="#ef4444"/>:<Badge key="sl2" label="✓ OK" color="#10b981"/>]].map(([l,v])=>(
            <div key={l} style={{background:"#f8fafc",padding:10,borderRadius:8}}><div style={{color:"#64748b",fontSize:10,fontWeight:700,textTransform:"uppercase",marginBottom:3}}>{l}</div><div style={{fontWeight:600,color:"#1e293b",fontSize:12}}>{v}</div></div>
          ))}
        </div>
        <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:14,marginBottom:14}}>
          <div style={{fontWeight:700,color:"#0369a1",fontSize:12,marginBottom:10}}>🤝 Client &amp; Location</div>
          {client?<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div><div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",marginBottom:4}}>Client</div><div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>{client.name}</div><div style={{fontSize:11,color:"#64748b"}}>📧 {client.email}</div><div style={{fontSize:11,color:"#64748b"}}>📞 {client.phone}</div></div>
            <div><div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",marginBottom:4}}>Location</div>{loc?<><div style={{fontWeight:700,color:"#1e293b",fontSize:13}}>📍 {loc.name}</div><div style={{fontSize:11,color:"#64748b"}}>{loc.address}</div>{loc.floor&&<div style={{fontSize:11,color:"#64748b"}}>🏢 {loc.floor}</div>}{loc.contact&&<div style={{fontSize:11,color:"#64748b"}}>👤 {loc.contact}</div>}</>:<div style={{fontSize:12,color:"#94a3b8"}}>No location specified</div>}</div>
          </div>:<div style={{fontSize:12,color:"#94a3b8"}}>No client associated.</div>}
        </div>
        <div style={{background:"#f8fafc",padding:12,borderRadius:8,fontSize:12,lineHeight:1.6,whiteSpace:"pre-wrap",color:"#334155"}}>{ticket.description}</div>
        {ticket.attachments&&ticket.attachments.length>0&&<div style={{marginTop:14}}>
          <div style={{fontWeight:700,color:"#1e293b",fontSize:12,marginBottom:10}}>📎 Attachments ({ticket.attachments.length})</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10}}>{ticket.attachments.map(a=>{const isImg=a.type.startsWith("image/");return(
            <div key={a.id} style={{borderRadius:10,overflow:"hidden",border:"1px solid #e2e8f0",cursor:"pointer"}} onClick={()=>{const w=window.open();w.document.write(isImg?'<img src="'+a.dataUrl+'" style="max-width:100%;"/>':'<video src="'+a.dataUrl+'" controls style="max-width:100%;"></video>');}}>
              {isImg?<img src={a.dataUrl} alt={a.name} style={{width:"100%",height:90,objectFit:"cover",display:"block"}}/>:<div style={{height:90,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#1e1b4b"}}><span style={{fontSize:32}}>▶️</span><span style={{fontSize:9,color:"#a5b4fc",marginTop:4}}>Click to play</span></div>}
              <div style={{padding:"6px 8px"}}><div style={{fontSize:10,fontWeight:600,color:"#334155",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{a.name}</div><div style={{fontSize:9,color:"#94a3b8"}}>{(a.size/1024).toFixed(0)} KB</div></div>
            </div>);})}</div>
        </div>}
      </div>}

      {tab==="status"&&isTech&&<div>
        <FSelect label="Update Status" value={status} onChange={e=>setStatus(e.target.value)} options={ALL_STATUSES.map(s=>({value:s,label:s}))}/>
        <FSelect label="Assign To" value={asgn} onChange={e=>setAsgn(e.target.value)} options={[{value:"",label:"— Unassigned —"},...techs.map(u=>({value:u.id,label:u.name+" ("+ROLE_META[u.role]?.label+")"}))]}/> 
        <FTextarea label="Note" value={note} onChange={e=>setNote(e.target.value)} placeholder="What was done or why?" rows={3}/>
        <Btn onClick={saveStatus}>💾 Save Changes</Btn>
      </div>}

      {tab==="email"&&<div>
        <div style={{marginBottom:16}}>
          <div style={{fontWeight:700,color:"#1e293b",marginBottom:10}}>📧 Send Email</div>
          <FInput label="To (comma-separated)" value={msgTo} onChange={e=>setMsgTo(e.target.value)} placeholder="john@client.com"/>
          <FInput label="CC" value={msgCC} onChange={e=>setMsgCC(e.target.value)} placeholder="manager@company.com"/>
          <FInput label="Subject" value={msgSubj} onChange={e=>setMsgSubj(e.target.value)}/>
          <FTextarea label="Message" value={msgBody} onChange={e=>setMsgBody(e.target.value)} rows={4} placeholder="Type your message…"/>
          <button onClick={sendEmail} disabled={emailSending} style={{background:emailSending?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:8,padding:"8px 18px",fontWeight:600,fontSize:13,cursor:emailSending?"not-allowed":"pointer"}}>{emailSending?"⏳ Sending…":"📤 Send Email"}</button>
        </div>
        <hr style={{margin:"14px 0",border:"none",borderTop:"1px solid #e2e8f0"}}/>
        <div style={{fontWeight:700,color:"#1e293b",marginBottom:10}}>📬 Conversation Trail ({(ticket.conversations||[]).length})</div>
        {(ticket.conversations||[]).length===0&&<div style={{color:"#94a3b8",fontSize:12}}>No messages yet.</div>}
        {(ticket.conversations||[]).map(m=>(
          <div key={m.id} style={{background:m.isExternal?"#fff7ed":"#f8fafc",border:"1px solid "+(m.isExternal?"#fed7aa":"#e2e8f0"),borderRadius:10,padding:12,marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <div style={{fontWeight:700,fontSize:12,color:m.isExternal?"#ea580c":"#1e293b"}}>{m.isExternal?"📬 EXTERNAL":"📧"} {m.fromEmail}{m.toEmails&&m.toEmails.length>0&&<span style={{color:"#64748b",fontWeight:400}}> → {m.toEmails.join(", ")}</span>}</div>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                {m.status==="sending"&&<span style={{fontSize:10,color:"#f59e0b",fontWeight:600}}>⏳</span>}
                {m.status==="sent"&&<span style={{fontSize:10,color:"#10b981",fontWeight:600}}>✅</span>}
                {m.status==="failed"&&<span style={{fontSize:10,color:"#ef4444",fontWeight:600}}>❌</span>}
                <div style={{fontSize:10,color:"#94a3b8"}}>{fdt(m.timestamp)}</div>
              </div>
            </div>
            {m.cc&&m.cc.length>0&&<div style={{fontSize:11,color:"#94a3b8",marginBottom:4}}>CC: {m.cc.join(", ")}</div>}
            <div style={{fontSize:11,color:"#64748b",marginBottom:4}}>Subj: {m.subject}</div>
            <div style={{fontSize:12,color:"#334155",whiteSpace:"pre-wrap",lineHeight:1.6}}>{m.body}</div>
          </div>
        ))}
      </div>}

      {tab==="sms"&&<div>
        <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:10,marginBottom:14,fontSize:12}}>📱 <strong>SMS Tracker</strong> — Logged via Twilio API.</div>
        <FInput label="Phone Number" value={smsTo} onChange={e=>setSmsTo(e.target.value)} placeholder="+1-555-0123"/>
        <FTextarea label="Message" value={smsBody} onChange={e=>setSmsBody(e.target.value)} rows={3} placeholder="Type SMS…"/>
        <button onClick={sendSms} disabled={smsSending} style={{background:smsSending?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:8,padding:"8px 18px",fontWeight:600,fontSize:13,cursor:smsSending?"not-allowed":"pointer"}}>{smsSending?"⏳ Sending…":"📱 Send & Track SMS"}</button>
        <hr style={{margin:"14px 0",border:"none",borderTop:"1px solid #e2e8f0"}}/>
        <div style={{fontWeight:700,marginBottom:8}}>SMS Log</div>
        {smsLog.length===0&&<div style={{color:"#94a3b8",fontSize:12}}>No SMS tracked yet.</div>}
        {smsLog.map(s=><div key={s.id} style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:10,marginBottom:8,fontSize:12}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><div style={{fontWeight:700}}>📱 → {s.to}</div><Badge label={s.status} color={s.status==="delivered"?"#10b981":s.status==="failed"?"#ef4444":"#f59e0b"}/></div><div style={{color:"#334155"}}>{s.body}</div><div style={{fontSize:10,color:"#94a3b8",marginTop:4}}>By {s.from} · {fdt(s.ts)}</div></div>)}
      </div>}

      {tab==="history"&&<div>
        <div style={{fontWeight:700,color:"#1e293b",marginBottom:12}}>📜 Status History</div>
        {(ticket.statusHistory||[]).slice().reverse().map((h,i)=>(
          <div key={i} style={{display:"flex",gap:12,marginBottom:12}}>
            <div style={{width:10,height:10,borderRadius:"50%",background:STATUS_META[h.status]?.color||"#6366f1",marginTop:4,flexShrink:0}}/>
            <div style={{flex:1,background:"#f8fafc",borderRadius:8,padding:10}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><Badge label={h.status} color={STATUS_META[h.status]?.color||"#6366f1"}/><span style={{fontSize:10,color:"#94a3b8"}}>{fdt(h.timestamp)}</span></div>
              <div style={{fontSize:11,color:"#64748b",marginTop:4}}>Assigned: <strong>{fu(h.assignedTo)?.name||"Unassigned"}</strong></div>
              <div style={{fontSize:11,color:"#475569"}}>By: {fu(h.changedBy)?.name||"System"}</div>
              {h.note&&<div style={{fontSize:11,color:"#334155",marginTop:4,fontStyle:"italic"}}>{h.note}</div>}
            </div>
          </div>
        ))}
      </div>}
    </Modal>
  );
}

// ── REPORTS ───────────────────────────────────────────────────────────────────
function PageReports({tickets,users,ticketTypes,companies}) {
  const [view,setView]=useState("overview");
  const techs=users.filter(u=>["it_technician","it_manager"].includes(u.role));
  const byComp=companies.map(c=>({name:c.name.split(" ")[0],tickets:tickets.filter(t=>t.companyId===c.id).length}));
  const byType=ticketTypes.map((tt,i)=>({name:tt.name,value:tickets.filter(t=>t.typeId===tt.id).length,fill:PAL[i%PAL.length]})).filter(x=>x.value>0);
  const techStats=techs.map(t=>{const mine=tickets.filter(tk=>tk.assignedTo===t.id);const res=mine.filter(tk=>["Resolved","Closed"].includes(tk.status));const brch=mine.filter(tk=>tk.slaBreached).length;const avgH=res.length?Math.round(res.reduce((a,tk)=>a+(new Date(tk.resolvedAt||tk.updatedAt)-new Date(tk.createdAt))/3600000,0)/res.length):0;return{name:t.name.split(" ")[0],total:mine.length,resolved:res.length,breached:brch,avgH,slaRate:mine.length?Math.round((1-brch/mine.length)*100):100};});
  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
        {["overview","per_user","sla","by_type"].map(v=><Btn key={v} variant={view===v?"primary":"ghost"} onClick={()=>setView(v)}>{v==="overview"?"📊 Overview":v==="per_user"?"👤 Per User":v==="sla"?"⏱ SLA":"🏷️ By Type"}</Btn>)}
      </div>
      {view==="overview"&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>
        <Card><div style={{fontWeight:700,marginBottom:12}}>By Company</div><ResponsiveContainer width="100%" height={220}><BarChart data={byComp}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="tickets" fill="#6366f1" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></Card>
        <Card><div style={{fontWeight:700,marginBottom:12}}>Type Distribution</div><ResponsiveContainer width="100%" height={220}><PieChart><Pie data={byType} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({name,percent})=>name+": "+(percent*100).toFixed(0)+"%"} fontSize={9}>{byType.map((e,i)=><Cell key={i} fill={e.fill}/>)}</Pie><Tooltip/></PieChart></ResponsiveContainer></Card>
        <Card><div style={{fontWeight:700,marginBottom:12}}>Resolution by Tech</div><ResponsiveContainer width="100%" height={220}><BarChart data={techStats}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="total" fill="#e2e8f0" name="Total" radius={[4,4,0,0]}/><Bar dataKey="resolved" fill="#10b981" name="Resolved" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></Card>
      </div>}
      {view==="per_user"&&<Card style={{padding:0,overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:700}}>
        <thead><tr style={{background:"#f8fafc"}}>{["Technician","Total","Open","In Prog","Resolved","Breached","Avg Res","SLA Rate"].map(h=><th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0"}}>{h}</th>)}</tr></thead>
        <tbody>{techs.map(t=>{const mine=tickets.filter(tk=>tk.assignedTo===t.id);const res=mine.filter(tk=>["Resolved","Closed"].includes(tk.status));const brch=mine.filter(tk=>tk.slaBreached).length;const avgH=res.length?Math.round(res.reduce((a,tk)=>a+(new Date(tk.resolvedAt||tk.updatedAt)-new Date(tk.createdAt))/3600000,0)/res.length):0;const rate=mine.length?Math.round((1-brch/mine.length)*100):100;return(
          <tr key={t.id} style={{borderBottom:"1px solid #f1f5f9"}}><td style={{padding:"10px 12px"}}><div style={{display:"flex",gap:8,alignItems:"center"}}><Avatar name={t.name} id={t.id} size={26}/><div><div style={{fontWeight:600,fontSize:12}}>{t.name}</div><div style={{fontSize:10,color:"#94a3b8"}}>{ROLE_META[t.role]?.label}</div></div></div></td><td style={{padding:"10px 12px",fontWeight:700,fontSize:12}}>{mine.length}</td><td style={{padding:"10px 12px"}}><Badge label={mine.filter(t=>t.status==="Open").length} color="#f59e0b"/></td><td style={{padding:"10px 12px"}}><Badge label={mine.filter(t=>t.status==="In Progress").length} color="#6366f1"/></td><td style={{padding:"10px 12px"}}><Badge label={res.length} color="#10b981"/></td><td style={{padding:"10px 12px"}}><Badge label={brch} color={brch>0?"#ef4444":"#10b981"}/></td><td style={{padding:"10px 12px",fontSize:12}}>{avgH}h</td><td style={{padding:"10px 12px"}}><Badge label={rate+"%"} color={rate>=80?"#10b981":rate>=60?"#f59e0b":"#ef4444"}/></td>
          </tr>);})}
        </tbody></table></Card>}
      {view==="sla"&&<div>
        <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap"}}>
          <Stat label="Overall SLA Rate" value={Math.round((1-tickets.filter(t=>t.slaBreached).length/Math.max(tickets.length,1))*100)+"%"} icon="⏱" color="#10b981"/>
          <Stat label="SLA Breaches" value={tickets.filter(t=>t.slaBreached).length} icon="🚨" color="#ef4444"/>
          <Stat label="Avg Create Time" value={Math.round(tickets.reduce((a,t)=>a+(t.timeToCreateMins||0),0)/Math.max(tickets.length,1))+"m"} icon="⏱" color="#6366f1"/>
        </div>
        <Card><div style={{fontWeight:700,marginBottom:12}}>SLA per Technician</div><ResponsiveContainer width="100%" height={280}><BarChart data={techStats}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="name" tick={{fontSize:11}}/><YAxis tick={{fontSize:11}} domain={[0,100]}/><Tooltip/><Legend wrapperStyle={{fontSize:10}}/><Bar dataKey="slaRate" fill="#10b981" name="SLA Rate %" radius={[4,4,0,0]}/><Bar dataKey="avgH" fill="#6366f1" name="Avg Res (h)" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></Card>
      </div>}
      {view==="by_type"&&<Card style={{padding:0,overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:650}}>
        <thead><tr style={{background:"#f8fafc"}}>{["Type","Priority","SLA","Total","Open","Resolved","Breached","Default Assignee"].map(h=><th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0"}}>{h}</th>)}</tr></thead>
        <tbody>{ticketTypes.map(tt=>{const mine=tickets.filter(t=>t.typeId===tt.id);const asgn=users.find(u=>u.id===tt.defaultAssignee);return(
          <tr key={tt.id} style={{borderBottom:"1px solid #f1f5f9"}}><td style={{padding:"10px 12px"}}><Badge label={tt.name} color={tt.color}/></td><td style={{padding:"10px 12px"}}><Badge label={PRI_META[tt.priority]?.label} color={PRI_META[tt.priority]?.color}/></td><td style={{padding:"10px 12px",fontSize:12}}>{tt.slaHours}h</td><td style={{padding:"10px 12px",fontWeight:700,fontSize:12}}>{mine.length}</td><td style={{padding:"10px 12px"}}><Badge label={mine.filter(t=>t.status==="Open").length} color="#f59e0b"/></td><td style={{padding:"10px 12px"}}><Badge label={mine.filter(t=>["Resolved","Closed"].includes(t.status)).length} color="#10b981"/></td><td style={{padding:"10px 12px"}}><Badge label={mine.filter(t=>t.slaBreached).length} color="#ef4444"/></td><td style={{padding:"10px 12px",fontSize:11}}>{asgn?.name||"Auto-assign"}</td>
          </tr>);})}
        </tbody></table></Card>}
    </div>
  );
}

// ── USERS ─────────────────────────────────────────────────────────────────────
function PageUsers({users,companies,setUsers,curUser,addLog,showToast}) {
  const [modal,setModal]=useState(null); const [form,setForm]=useState({});
  const fld=(k,v)=>setForm(p=>({...p,[k]:v}));
  const pendingUsers=users.filter(u=>!u.active);
  const approveUser=u=>{setUsers(prev=>prev.map(x=>x.id===u.id?{...x,active:true}:x));addLog("USER_APPROVED",u.id,u.name+" approved");showToast("✅ Account approved!");};
  const save=()=>{
    if(!form.name||!form.email){showToast("Name and email required","error");return;}
    if(modal==="new"){const nu={...form,id:uid(),createdAt:new Date().toISOString(),lastLogin:null};setUsers(prev=>[...prev,nu]);addLog("USER_CREATED",nu.id,"New user "+nu.name+" created");showToast("User created");}
    else{const old=users.find(u=>u.id===form.id);setUsers(prev=>prev.map(u=>u.id===form.id?{...form}:u));if(old&&old.role!==form.role)addLog("USER_ROLE_CHANGE",form.id,"Role: "+ROLE_META[old.role]?.label+" → "+ROLE_META[form.role]?.label);showToast("User updated");}
    setModal(null);
  };
  return (
    <div>
      {pendingUsers.length>0&&<div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:12,padding:16,marginBottom:20}}>
        <div style={{fontWeight:700,color:"#92400e",marginBottom:10,fontSize:13}}>⏳ {pendingUsers.length} Account{pendingUsers.length>1?"s":""} Awaiting Approval</div>
        {pendingUsers.map(u=>(
          <div key={u.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#fff",padding:"10px 14px",borderRadius:8,border:"1px solid #fde68a",marginBottom:6}}>
            <div style={{display:"flex",gap:10,alignItems:"center"}}><Avatar name={u.name} id={u.id} size={32}/><div><div style={{fontWeight:600,fontSize:13}}>{u.name}</div><div style={{fontSize:11,color:"#64748b"}}>{u.email}{u.dept?" · "+u.dept:""}</div><div style={{fontSize:10,color:"#94a3b8"}}>Requested: {fdt(u.createdAt)}</div></div></div>
            <div style={{display:"flex",gap:6}}><Btn size="sm" variant="success" onClick={()=>approveUser(u)}>✅ Approve</Btn><Btn size="sm" variant="danger" onClick={()=>{setUsers(prev=>prev.filter(x=>x.id!==u.id));showToast("Account rejected");}}>✕ Reject</Btn></div>
          </div>
        ))}
      </div>}
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}>
        <div style={{fontWeight:700,fontSize:14}}>User Management ({users.length})</div>
        <Btn onClick={()=>{setForm({name:"",email:"",role:"end_user",companyId:companies[0]?.id||"",phone:"",dept:"",active:true});setModal("new");}}>➕ Add User</Btn>
      </div>
      <Card style={{padding:0,overflow:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:700}}>
          <thead><tr style={{background:"#f8fafc"}}>{["User","Email","Role","Company","Status","Actions"].map(h=><th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #e2e8f0"}}>{h}</th>)}</tr></thead>
          <tbody>{users.map(u=>{const co=companies.find(c=>c.id===u.companyId);const rm=ROLE_META[u.role];return(
            <tr key={u.id} style={{borderBottom:"1px solid #f1f5f9"}}>
              <td style={{padding:"10px 12px"}}><div style={{display:"flex",gap:8,alignItems:"center"}}><Avatar name={u.name} id={u.id} size={30}/><div><div style={{fontWeight:600,fontSize:12}}>{u.name}</div><div style={{fontSize:10,color:"#94a3b8"}}>Last: {ago(u.lastLogin)}</div></div></div></td>
              <td style={{padding:"10px 12px",fontSize:12}}>{u.email}</td>
              <td style={{padding:"10px 12px"}}><Badge label={rm?.label||u.role} color={rm?.color||"#6366f1"}/></td>
              <td style={{padding:"10px 12px",fontSize:12}}>{co?.name||"—"}</td>
              <td style={{padding:"10px 12px"}}><Badge label={u.active?"Active":"Pending"} color={u.active?"#10b981":"#f59e0b"}/></td>
              <td style={{padding:"10px 12px"}}><div style={{display:"flex",gap:4}}>
                <Btn size="sm" variant="ghost" onClick={()=>{setForm({...u});setModal("edit");}}>✏️</Btn>
                <Btn size="sm" variant={u.active?"warning":"success"} onClick={()=>{setUsers(prev=>prev.map(x=>x.id===u.id?{...x,active:!x.active}:x));showToast(u.active?"Deactivated":"Activated");}}>{u.active?"Disable":"Enable"}</Btn>
                {u.id!==curUser.id&&<Btn size="sm" variant="danger" onClick={()=>{setUsers(prev=>prev.filter(x=>x.id!==u.id));addLog("USER_DELETED",u.id,"User "+u.name+" deleted");showToast("Deleted");}}>🗑</Btn>}
              </div></td>
            </tr>);})}
          </tbody>
        </table>
      </Card>
      {modal&&<Modal title={modal==="new"?"Add User":"Edit User"} onClose={()=>setModal(null)}>
        <FInput label="Full Name *" value={form.name||""} onChange={e=>fld("name",e.target.value)}/><FInput label="Email *" value={form.email||""} onChange={e=>fld("email",e.target.value)} type="email"/><FInput label="Phone" value={form.phone||""} onChange={e=>fld("phone",e.target.value)}/><FInput label="Department" value={form.dept||""} onChange={e=>fld("dept",e.target.value)}/>
        <FSelect label="Role" value={form.role||"end_user"} onChange={e=>fld("role",e.target.value)} options={Object.entries(ROLE_META).map(([k,v])=>({value:k,label:v.label}))}/>
        <FSelect label="Company" value={form.companyId||""} onChange={e=>fld("companyId",e.target.value)} options={companies.map(c=>({value:c.id,label:c.name}))}/>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={save}>{modal==="new"?"Create":"Save"}</Btn></div>
      </Modal>}
    </div>
  );
}

// ── COMPANIES ─────────────────────────────────────────────────────────────────
function PageCompanies({companies,users,setCompanies,addLog,showToast}) {
  const [modal,setModal]=useState(null); const [form,setForm]=useState({});
  const fld=(k,v)=>setForm(p=>({...p,[k]:v}));
  const save=()=>{if(!form.name){showToast("Name required","error");return;}if(modal==="new"){const nc={...form,id:uid(),createdAt:new Date().toISOString()};setCompanies(prev=>[...prev,nc]);addLog("COMPANY_CREATED",nc.id,'"'+nc.name+'" created');showToast("Created");}else{setCompanies(prev=>prev.map(c=>c.id===form.id?{...form}:c));showToast("Updated");}setModal(null);};
  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}><div style={{fontWeight:700,fontSize:14}}>Company Profiles ({companies.length})</div><Btn onClick={()=>{setForm({name:"",domain:"",address:"",phone:"",industry:"",size:""});setModal("new");}}>➕ Add Company</Btn></div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
        {companies.map(c=>{const members=users.filter(u=>u.companyId===c.id);return(
          <Card key={c.id}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}><div style={{width:44,height:44,borderRadius:10,background:avCol(c.id),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:16}}>{c.name[0]}</div><div style={{display:"flex",gap:6}}><Btn size="sm" variant="ghost" onClick={()=>{setForm({...c});setModal("edit");}}>✏️</Btn><Btn size="sm" variant="danger" onClick={()=>{setCompanies(prev=>prev.filter(x=>x.id!==c.id));addLog("COMPANY_DELETED",c.id,'"'+c.name+'" deleted');showToast("Deleted");}}>🗑</Btn></div></div>
            <div style={{fontWeight:700,color:"#1e293b",marginBottom:4}}>{c.name}</div>
            <div style={{fontSize:11,color:"#64748b"}}>🌐 {c.domain}</div><div style={{fontSize:11,color:"#64748b"}}>📍 {c.address}</div><div style={{fontSize:11,color:"#64748b"}}>📞 {c.phone}</div><div style={{fontSize:11,color:"#64748b",marginBottom:10}}>🏭 {c.industry} · {c.size}</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{members.slice(0,5).map(m=><Avatar key={m.id} name={m.name} id={m.id} size={24}/>)}{members.length>5&&<div style={{fontSize:10,color:"#94a3b8",alignSelf:"center"}}>+{members.length-5}</div>}</div>
          </Card>);})}
      </div>
      {modal&&<Modal title={modal==="new"?"Add Company":"Edit Company"} onClose={()=>setModal(null)}>
        <FInput label="Name *" value={form.name||""} onChange={e=>fld("name",e.target.value)}/><FInput label="Domain" value={form.domain||""} onChange={e=>fld("domain",e.target.value)}/><FInput label="Address" value={form.address||""} onChange={e=>fld("address",e.target.value)}/><FInput label="Phone" value={form.phone||""} onChange={e=>fld("phone",e.target.value)}/><FInput label="Industry" value={form.industry||""} onChange={e=>fld("industry",e.target.value)}/><FInput label="Size" value={form.size||""} onChange={e=>fld("size",e.target.value)}/>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={save}>{modal==="new"?"Create":"Save"}</Btn></div>
      </Modal>}
    </div>
  );
}

// ── CLIENTS ───────────────────────────────────────────────────────────────────
function PageClients({clients,setClients,companies,addLog,showToast}) {
  const [modal,setModal]=useState(null); const [selCl,setSelCl]=useState(null); const [form,setForm]=useState({}); const [lForm,setLForm]=useState({});
  const fld=(k,v)=>setForm(p=>({...p,[k]:v})); const lfld=(k,v)=>setLForm(p=>({...p,[k]:v}));
  const saveCl=()=>{if(!form.name){showToast("Name required","error");return;}if(modal==="newCl"){const nc={...form,id:uid(),locations:[]};setClients(prev=>[...prev,nc]);addLog("CLIENT_CREATED",nc.id,"Client \""+nc.name+"\" added");showToast("Client added");}else{setClients(prev=>prev.map(c=>c.id===form.id?{...form,locations:c.locations}:c));showToast("Updated");}setModal(null);};
  const saveLoc=()=>{if(!lForm.name||!lForm.address){showToast("Name and address required","error");return;}if(modal==="newLoc"){const nl={...lForm,id:uid()};setClients(prev=>prev.map(c=>c.id===selCl?{...c,locations:[...c.locations,nl]}:c));addLog("LOCATION_ADDED",selCl,"Location \""+nl.name+"\" added");showToast("Location added");}else{setClients(prev=>prev.map(c=>c.id===selCl?{...c,locations:c.locations.map(l=>l.id===lForm.id?{...lForm}:l)}:c));showToast("Updated");}setModal(null);};
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}><div style={{fontWeight:700,fontSize:14}}>Clients &amp; Locations ({clients.length} clients · {clients.reduce((a,c)=>a+c.locations.length,0)} locations)</div><Btn onClick={()=>{setForm({name:"",email:"",phone:"",industry:"",companyId:companies[0]?.id||""});setModal("newCl");}}>➕ Add Client</Btn></div>
      <div style={{display:"flex",flexDirection:"column",gap:16}}>
        {clients.map(cl=>{const co=companies.find(c=>c.id===cl.companyId);return(
          <Card key={cl.id}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
              <div style={{display:"flex",gap:14,alignItems:"center"}}>
                <div style={{width:48,height:48,borderRadius:12,background:avCol(cl.id),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:18}}>{cl.name[0]}</div>
                <div><div style={{fontWeight:700,color:"#1e293b",fontSize:14}}>{cl.name}</div><div style={{fontSize:11,color:"#64748b"}}>📧 {cl.email} · 📞 {cl.phone}</div><div style={{fontSize:11,color:"#64748b"}}>🏭 {cl.industry}{co?" · "+co.name:""}</div></div>
              </div>
              <div style={{display:"flex",gap:6}}><Btn size="sm" variant="ghost" onClick={()=>{setForm({...cl});setModal("editCl");}}>✏️ Edit</Btn><Btn size="sm" variant="danger" onClick={()=>{setClients(prev=>prev.filter(x=>x.id!==cl.id));addLog("CLIENT_DELETED",cl.id,"\""+cl.name+"\" removed");showToast("Removed");}}>🗑 Remove</Btn></div>
            </div>
            <div style={{background:"#f8fafc",borderRadius:10,padding:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><div style={{fontWeight:700,fontSize:12,color:"#475569"}}>📍 Locations ({cl.locations.length})</div><Btn size="sm" variant="primary" onClick={()=>{setSelCl(cl.id);setLForm({name:"",address:"",floor:"",contact:""});setModal("newLoc");}}>➕ Add Location</Btn></div>
              {cl.locations.length===0&&<div style={{fontSize:12,color:"#94a3b8",textAlign:"center",padding:"12px 0"}}>No locations added yet.</div>}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10}}>
                {cl.locations.map(loc=>(
                  <div key={loc.id} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:8,padding:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}><div style={{fontWeight:700,fontSize:12,color:"#1e293b"}}>📍 {loc.name}</div><div style={{display:"flex",gap:4}}><Btn size="sm" variant="ghost" onClick={()=>{setSelCl(cl.id);setLForm({...loc});setModal("editLoc");}}>✏️</Btn><Btn size="sm" variant="danger" onClick={()=>{setClients(prev=>prev.map(c=>c.id===cl.id?{...c,locations:c.locations.filter(l=>l.id!==loc.id)}:c));addLog("LOCATION_REMOVED",cl.id,"\""+loc.name+"\" removed");showToast("Removed");}}>🗑</Btn></div></div>
                    <div style={{fontSize:11,color:"#64748b"}}>📮 {loc.address}</div>{loc.floor&&<div style={{fontSize:11,color:"#64748b"}}>🏢 {loc.floor}</div>}{loc.contact&&<div style={{fontSize:11,color:"#64748b"}}>👤 {loc.contact}</div>}
                  </div>
                ))}
              </div>
            </div>
          </Card>);})}
      </div>
      {(modal==="newCl"||modal==="editCl")&&<Modal title={modal==="newCl"?"Add Client":"Edit Client"} onClose={()=>setModal(null)}>
        <FInput label="Client Name *" value={form.name||""} onChange={e=>fld("name",e.target.value)}/><FInput label="Email" value={form.email||""} onChange={e=>fld("email",e.target.value)} type="email"/><FInput label="Phone" value={form.phone||""} onChange={e=>fld("phone",e.target.value)}/><FInput label="Industry" value={form.industry||""} onChange={e=>fld("industry",e.target.value)}/>
        <FSelect label="Associated Company" value={form.companyId||""} onChange={e=>fld("companyId",e.target.value)} options={[{value:"",label:"— None —"},...companies.map(c=>({value:c.id,label:c.name}))]}/>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={saveCl}>{modal==="newCl"?"Add Client":"Save"}</Btn></div>
      </Modal>}
      {(modal==="newLoc"||modal==="editLoc")&&<Modal title={modal==="newLoc"?"Add Location":"Edit Location"} onClose={()=>setModal(null)}>
        <FInput label="Location Name *" value={lForm.name||""} onChange={e=>lfld("name",e.target.value)} placeholder="e.g. HQ — New York"/><FInput label="Address *" value={lForm.address||""} onChange={e=>lfld("address",e.target.value)}/><FInput label="Floor / Area" value={lForm.floor||""} onChange={e=>lfld("floor",e.target.value)}/><FInput label="On-site Contact" value={lForm.contact||""} onChange={e=>lfld("contact",e.target.value)}/>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={saveLoc}>{modal==="newLoc"?"Add Location":"Save"}</Btn></div>
      </Modal>}
    </div>
  );
}

// ── TICKET TYPES ──────────────────────────────────────────────────────────────
function PageTicketTypes({ticketTypes,users,setTicketTypes,addLog,showToast}) {
  const [modal,setModal]=useState(null); const [form,setForm]=useState({}); const [kwInput,setKwInput]=useState("");
  const fld=(k,v)=>setForm(p=>({...p,[k]:v}));
  const techs=users.filter(u=>["it_technician","it_manager","admin"].includes(u.role)&&u.active);
  const save=()=>{if(!form.name){showToast("Name required","error");return;}if(modal==="new"){const nt={...form,id:uid(),keywords:form.keywords||[]};setTicketTypes(prev=>[...prev,nt]);addLog("TICKET_TYPE_CREATED",nt.id,"Type \""+nt.name+"\" created");showToast("Created");}else{setTicketTypes(prev=>prev.map(t=>t.id===form.id?{...form}:t));showToast("Updated");}setModal(null);};
  const addKw=()=>{if(kwInput.trim()){fld("keywords",[...(form.keywords||[]),kwInput.trim()]);setKwInput("");}};
  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}><div style={{fontWeight:700,fontSize:14}}>Ticket Types ({ticketTypes.length})</div><Btn onClick={()=>{setForm({name:"",priority:"medium",slaHours:24,color:"#6366f1",keywords:[],defaultAssignee:""});setModal("new");}}>➕ Add Type</Btn></div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:14}}>
        {ticketTypes.map(tt=>{const asgn=users.find(u=>u.id===tt.defaultAssignee);return(
          <Card key={tt.id}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><div style={{display:"flex",gap:8,alignItems:"center"}}><div style={{width:10,height:10,borderRadius:"50%",background:tt.color}}/><span style={{fontWeight:700,color:"#1e293b"}}>{tt.name}</span></div>
            <div style={{display:"flex",gap:4}}><Btn size="sm" variant="ghost" onClick={()=>{setForm({...tt,keywords:[...(tt.keywords||[])]});setModal("edit");}}>✏️</Btn>{tt.name!=="Others"&&<Btn size="sm" variant="danger" onClick={()=>{setTicketTypes(prev=>prev.filter(t=>t.id!==tt.id));addLog("TICKET_TYPE_DELETED",tt.id,"Type \""+tt.name+"\" deleted");showToast("Deleted");}}>🗑</Btn>}</div></div>
            <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}><Badge label={PRI_META[tt.priority]?.label||tt.priority} color={PRI_META[tt.priority]?.color||"#6366f1"}/><Badge label={"SLA "+tt.slaHours+"h"} color="#0ea5e9"/></div>
            {asgn&&<div style={{fontSize:11,color:"#64748b",marginBottom:6}}>👤 {asgn.name}</div>}
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>{(tt.keywords||[]).slice(0,5).map(k=><span key={k} style={{background:"#f1f5f9",color:"#475569",fontSize:10,padding:"2px 6px",borderRadius:4}}>{k}</span>)}{(tt.keywords||[]).length>5&&<span style={{fontSize:10,color:"#94a3b8"}}>+{(tt.keywords||[]).length-5}</span>}</div>
          </Card>);})}
      </div>
      {modal&&<Modal title={modal==="new"?"Add Ticket Type":"Edit Ticket Type"} onClose={()=>setModal(null)}>
        <FInput label="Type Name *" value={form.name||""} onChange={e=>fld("name",e.target.value)}/>
        <FSelect label="Priority" value={form.priority||"medium"} onChange={e=>fld("priority",e.target.value)} options={Object.entries(PRI_META).map(([k,v])=>({value:k,label:v.label}))}/>
        <FInput label="SLA Hours" value={form.slaHours||24} onChange={e=>fld("slaHours",Number(e.target.value))} type="number" min={1}/>
        <FInput label="Color" value={form.color||"#6366f1"} onChange={e=>fld("color",e.target.value)} type="color"/>
        <FSelect label="Default Assignee" value={form.defaultAssignee||""} onChange={e=>fld("defaultAssignee",e.target.value)} options={[{value:"",label:"— Auto-assign —"},...techs.map(u=>({value:u.id,label:u.name+" ("+ROLE_META[u.role]?.label+")"}))]}/> 
        <div style={{marginBottom:14}}>
          <label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:4}}>Keywords</label>
          <div style={{display:"flex",gap:6,marginBottom:6}}><input value={kwInput} onChange={e=>setKwInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addKw()} placeholder="e.g. printer, monitor" style={{flex:1,padding:"6px 10px",border:"1px solid #e2e8f0",borderRadius:6,fontSize:12,outline:"none"}}/><Btn size="sm" onClick={addKw}>Add</Btn></div>
          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>{(form.keywords||[]).map((k,i)=><span key={i} onClick={()=>fld("keywords",(form.keywords||[]).filter((_,j)=>j!==i))} style={{background:"#eef2ff",color:"#4338ca",fontSize:11,padding:"2px 8px",borderRadius:4,cursor:"pointer"}}>{k} ×</span>)}</div>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={save}>{modal==="new"?"Create":"Save"}</Btn></div>
      </Modal>}
    </div>
  );
}

// ── ACTIVITY LOG ──────────────────────────────────────────────────────────────
const ACTION_META={USER_ROLE_CHANGE:{icon:"🔑",color:"#7c3aed",label:"Role Changed"},USER_CREATED:{icon:"👤",color:"#2563eb",label:"User Created"},USER_APPROVED:{icon:"✅",color:"#10b981",label:"User Approved"},USER_DELETED:{icon:"🗑",color:"#ef4444",label:"User Deleted"},PROFILE_UPDATED:{icon:"✏️",color:"#0ea5e9",label:"Profile Updated"},PASSWORD_CHANGED:{icon:"🔑",color:"#7c3aed",label:"Password Changed"},COMPANY_CREATED:{icon:"🏢",color:"#10b981",label:"Company Created"},COMPANY_DELETED:{icon:"🗑",color:"#ef4444",label:"Company Deleted"},TICKET_CREATED:{icon:"🎫",color:"#6366f1",label:"Ticket Created"},TICKET_STATUS:{icon:"🔄",color:"#f59e0b",label:"Status Updated"},TICKET_DELETED:{icon:"🗑",color:"#dc2626",label:"Ticket Deleted"},EMAIL_SENT:{icon:"📧",color:"#0ea5e9",label:"Email Sent"},SMS_SENT:{icon:"📱",color:"#8b5cf6",label:"SMS Sent"},CLIENT_CREATED:{icon:"🤝",color:"#10b981",label:"Client Added"},CLIENT_DELETED:{icon:"🗑",color:"#ef4444",label:"Client Removed"},LOCATION_ADDED:{icon:"📍",color:"#10b981",label:"Location Added"},LOCATION_REMOVED:{icon:"📍",color:"#ef4444",label:"Location Removed"},TICKET_TYPE_CREATED:{icon:"🏷️",color:"#10b981",label:"Type Created"},TICKET_TYPE_DELETED:{icon:"🏷️",color:"#ef4444",label:"Type Deleted"}};

function PageActivityLog({logs,users}) {
  const [filter,setFilter]=useState(""); const fu=id=>users.find(x=>x.id===id); const filtered=filter?logs.filter(l=>l.action===filter):logs;
  return(
    <div>
      <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center"}}><div style={{fontWeight:700,fontSize:14,flex:1}}>Activity Log ({filtered.length})</div>
        <select value={filter} onChange={e=>setFilter(e.target.value)} style={{padding:"7px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none"}}><option value="">All Actions</option>{Object.entries(ACTION_META).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select>
      </div>
      <Card style={{padding:0}}>
        {filtered.map((log,i)=>{const am=ACTION_META[log.action]||{icon:"📝",color:"#6366f1",label:log.action};const actor=fu(log.userId);return(
          <div key={log.id} style={{display:"flex",gap:12,padding:"12px 16px",borderBottom:i<filtered.length-1?"1px solid #f1f5f9":"none",alignItems:"flex-start"}}>
            <div style={{width:32,height:32,borderRadius:8,background:am.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{am.icon}</div>
            <div style={{flex:1}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><Badge label={am.label} color={am.color}/><span style={{fontSize:10,color:"#94a3b8"}}>{fdt(log.timestamp)}</span></div><div style={{fontSize:12,color:"#334155",marginTop:4}}>{log.detail}</div>{actor&&<div style={{fontSize:11,color:"#94a3b8",marginTop:4,display:"flex",alignItems:"center",gap:4}}><Avatar name={actor.name} id={actor.id} size={14}/>By {actor.name}</div>}</div>
          </div>);})}
        {filtered.length===0&&<div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No activity found</div>}
      </Card>
    </div>
  );
}

// ── SMS TRACKER ───────────────────────────────────────────────────────────────
function PageSmsTracker({tickets,users,curUser,showToast,addLog}) {
  const [to,setTo]=useState(""); const [body,setBody]=useState(""); const [tid,setTid]=useState(tickets[0]?.id||""); const [sending,setSending]=useState(false);
  const [log,setLog]=useState([{id:"s1",to:"+1-555-0105",body:"Ticket #t1: Tech will call in 30 min.",from:"Alex Rodriguez",ticketId:"t1",ts:hAgo(2),status:"delivered"},{id:"s2",to:"+1-555-0107",body:"Security alert: Change your password now.",from:"Mike Chen",ticketId:"t3",ts:hAgo(1),status:"delivered"}]);
  const send=async()=>{
    if(!to.trim()||!body.trim()){showToast("Phone and message required","error");return;}
    setSending(true); const entry={id:uid(),to,body,from:curUser.name,ticketId:tid,ts:new Date().toISOString(),status:"sending"};
    setLog(prev=>[entry,...prev]);
    const result=await callSendSms({to,message:body,ticketId:tid});
    setLog(prev=>prev.map(s=>s.id===entry.id?{...s,status:result.success?"delivered":"failed"}:s));
    addLog("SMS_SENT",tid,"SMS → "+to+(result.success?"":" [FAILED]")); showToast(result.success?"📱 SMS sent via Twilio!":"⚠️ SMS failed: "+result.error,result.success?"ok":"error");
    setSending(false); if(result.success){setTo("");setBody("");}
  };
  return(
    <div>
      <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,padding:14,marginBottom:20,fontSize:12}}><div style={{fontWeight:700,color:"#1e40af",marginBottom:6}}>📱 SMS Tracking — Twilio API Integration</div><div style={{color:"#1e3a8a",lineHeight:1.7}}>Messages logged with sender, recipient, timestamp, and ticket reference.<br/>Connect via: <code>TWILIO_ACCOUNT_SID</code> and <code>TWILIO_AUTH_TOKEN</code>.</div></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1.5fr",gap:20}}>
        <Card><div style={{fontWeight:700,marginBottom:14}}>Send SMS</div>
          <FInput label="To (phone)" value={to} onChange={e=>setTo(e.target.value)} placeholder="+1-555-0123"/>
          <FSelect label="Link to Ticket" value={tid} onChange={e=>setTid(e.target.value)} options={tickets.map(t=>({value:t.id,label:"#"+t.id+" — "+t.title.slice(0,28)}))}/>
          <FTextarea label="Message" value={body} onChange={e=>setBody(e.target.value)} rows={3} placeholder="Type SMS…"/>
          <button onClick={send} disabled={sending} style={{background:sending?"#a5b4fc":"#6366f1",color:"#fff",border:"none",borderRadius:8,padding:"8px 18px",fontWeight:600,fontSize:13,cursor:sending?"not-allowed":"pointer"}}>{sending?"⏳ Sending…":"📤 Send & Track"}</button>
        </Card>
        <Card><div style={{fontWeight:700,marginBottom:14}}>SMS Log ({log.length})</div>
          {log.map(m=><div key={m.id} style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:10,marginBottom:8}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><div style={{fontWeight:700,fontSize:12}}>📱 → {m.to}</div><Badge label={m.status} color={m.status==="delivered"?"#10b981":m.status==="failed"?"#ef4444":"#f59e0b"}/></div><div style={{fontSize:12,color:"#334155",marginBottom:4}}>{m.body}</div><div style={{fontSize:10,color:"#94a3b8",display:"flex",justifyContent:"space-between"}}><span>By {m.from} · #{m.ticketId}</span><span>{fdt(m.ts)}</span></div></div>)}
        </Card>
      </div>
    </div>
  );
}
