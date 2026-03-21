// ── REPLACE your entire LoginPage function with this ──────────────────────────
function LoginPage(p){
  var users=p.users;var setUsers=p.setUsers;var companies=p.companies;var onLogin=p.onLogin;var dbSetPassword=p.dbSetPassword;
  var[view,setView]=useState("login");
  var[loginEmail,setLoginEmail]=useState("");var[loginPass,setLoginPass]=useState("");
  var[showP1,setShowP1]=useState(false);var[showP2,setShowP2]=useState(false);var[showP3,setShowP3]=useState(false);
  var[loginErr,setLoginErr]=useState("");var[resetEmail,setResetEmail]=useState("");
  var[sigName,setSigName]=useState("");var[sigEmail,setSigEmail]=useState("");var[sigPass,setSigPass]=useState("");
  var[sigConf,setSigConf]=useState("");var[sigPhone,setSigPhone]=useState("");var[sigDept,setSigDept]=useState("");var[sigErr,setSigErr]=useState("");
  var[loading,setLoading]=useState(false);var[googleLoading,setGoogleLoading]=useState(false);
  var[rememberMe,setRememberMe]=useState(function(){try{return localStorage.getItem("hd_rememberMe")==="true";}catch(e){return false;}});

  // Handle Google OAuth redirect callback
  useEffect(function(){
    async function handleOAuthCallback(){
      var{data,error}=await supabase.auth.getSession();
      if(error||!data.session)return;
      var gUser=data.session.user;
      if(!gUser||!gUser.email)return;
      // Check if this Google user already has a local account
      var existing=users.find(function(u){return u.email.toLowerCase()===gUser.email.toLowerCase();});
      if(existing){
        if(!existing.active){setLoginErr("Your account is pending admin approval.");return;}
        onLogin(existing);
        return;
      }
      // Auto-create account from Google profile
      var meta=gUser.user_metadata||{};
      var nu={
        id:uid(),
        name:meta.full_name||meta.name||gUser.email.split("@")[0],
        email:gUser.email.toLowerCase(),
        role:"end_user",
        companyId:companies&&companies[0]?companies[0].id:"",
        phone:"",dept:"",
        active:false, // still requires admin approval
        createdAt:new Date().toISOString(),
        lastLogin:null,
        googleId:gUser.id
      };
      await dbSaveUser(nu);
      // No password needed for Google users — set a random one
      await dbSetPassword(nu.id, uid()+uid());
      setUsers(function(prev){return prev.concat([nu]);});
      setSigEmail(nu.email);
      setView("pending");
    }
    handleOAuthCallback();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[users.length]);

  useEffect(function(){try{var saved=localStorage.getItem("hd_savedCreds");if(saved){var creds=JSON.parse(saved);if(creds.email)setLoginEmail(creds.email);if(creds.pass)setLoginPass(creds.pass);setRememberMe(true);}}catch(e){};},[]);

  function pwStr(pw){if(!pw||pw.length<8)return 1;if(pw.length>=12&&/[A-Z]/.test(pw)&&/[0-9]/.test(pw)&&/[^A-Za-z0-9]/.test(pw))return 4;if(pw.length>=10&&/[A-Z]/.test(pw)&&/[0-9]/.test(pw))return 3;return 2;}
  var strLabel=["","Too short","Weak","Good","Strong ✅"];var strColor=["","#ef4444","#f59e0b","#3b82f6","#10b981"];var str=pwStr(sigPass);

  async function doGoogleSignIn(){
    setGoogleLoading(true);setLoginErr("");
    var{error}=await supabase.auth.signInWithOAuth({
      provider:"google",
      options:{redirectTo:window.location.origin}
    });
    if(error){setLoginErr("Google sign-in failed: "+error.message);setGoogleLoading(false);}
    // On success, browser redirects to Google — no further code runs here
  }

  async function doLogin(e){if(e&&e.preventDefault)e.preventDefault();setLoginErr("");if(!loginEmail.trim()||!loginPass.trim()){setLoginErr("Please enter your email and password.");return;}setLoading(true);var user=users.find(function(u){return u.email.toLowerCase()===loginEmail.toLowerCase().trim();});if(!user){setLoginErr("No account found with that email.");setLoading(false);return;}if(!user.active){setLoginErr("Your account is pending admin approval.");setLoading(false);return;}var pw=await dbGetPassword(user.id);if(loginPass!==pw){setLoginErr("Incorrect password.");setLoading(false);return;}try{if(rememberMe){localStorage.setItem("hd_savedCreds",JSON.stringify({email:loginEmail.trim(),pass:loginPass}));localStorage.setItem("hd_rememberMe","true");}else{localStorage.removeItem("hd_savedCreds");localStorage.setItem("hd_rememberMe","false");}}catch(ex){}setLoading(false);onLogin(user);}
  async function doForgot(e){e.preventDefault();if(!resetEmail.trim()){return;}setLoading(true);await new Promise(function(r){setTimeout(r,900);});setLoading(false);setView("sent");}
  async function doSignup(e){e.preventDefault();setSigErr("");if(!sigName.trim()){setSigErr("Full name is required.");return;}if(!sigEmail.trim()){setSigErr("Email is required.");return;}if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sigEmail.trim())){setSigErr("Enter a valid email.");return;}if(users.find(function(u){return u.email.toLowerCase()===sigEmail.toLowerCase().trim();})){setSigErr("An account with this email already exists.");return;}if(sigPass.length<8){setSigErr("Password must be at least 8 characters.");return;}if(sigPass!==sigConf){setSigErr("Passwords do not match.");return;}setLoading(true);var nu={id:uid(),name:sigName.trim(),email:sigEmail.trim().toLowerCase(),role:"end_user",companyId:companies&&companies[0]?companies[0].id:"",phone:sigPhone.trim(),dept:sigDept.trim(),active:false,createdAt:new Date().toISOString(),lastLogin:null};await dbSaveUser(nu);await dbSetPassword(nu.id,sigPass);setUsers(function(prev){return prev.concat([nu]);});setLoading(false);setView("pending");}

  function PBtn(bp){return<button type={bp.type||"button"} onClick={bp.onClick} disabled={bp.disabled} style={{width:"100%",padding:"14px",background:bp.disabled?"#7dd3fc":"linear-gradient(135deg,#0369a1,#0ea5e9)",color:"#fff",border:"none",borderRadius:10,fontSize:16,fontWeight:700,cursor:bp.disabled?"not-allowed":"pointer",marginTop:4}}>{bp.children}</button>;}
  function BackBtn(bp){return<button type="button" onClick={bp.onClick} style={{background:"none",border:"none",color:"#0369a1",fontSize:14,fontWeight:600,cursor:"pointer",padding:"0 0 16px 0",display:"flex",alignItems:"center",gap:4}}>← Back to Sign In</button>;}
  function ErrBox(ep){return ep.msg?<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:14,color:"#dc2626",fontSize:13}}>⚠️ {ep.msg}</div>:null;}

  // Google button shared between login & signup views
  function GoogleBtn(){return<button type="button" onClick={doGoogleSignIn} disabled={googleLoading} style={{width:"100%",padding:"13px",background:"#fff",color:"#1e293b",border:"1.5px solid #e2e8f0",borderRadius:10,fontSize:15,fontWeight:700,cursor:googleLoading?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:10,boxShadow:"0 1px 4px rgba(0,0,0,.08)",marginBottom:4}}>
    {/* Google "G" SVG */}
    <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/><path fill="none" d="M0 0h48v48H0z"/></svg>
    {googleLoading?"Connecting…":"Continue with Google"}
  </button>;}

  function Divider(){return<div style={{display:"flex",alignItems:"center",gap:10,margin:"14px 0"}}><div style={{flex:1,height:1,background:"#e2e8f0"}}/><span style={{fontSize:12,color:"#94a3b8",fontWeight:600}}>or</span><div style={{flex:1,height:1,background:"#e2e8f0"}}/></div>;}

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

        {view==="login"&&<>
          <h2 style={{fontSize:20,fontWeight:700,color:"#1e293b",margin:"0 0 4px"}}>Welcome back 👋</h2>
          <p style={{fontSize:13,color:"#94a3b8",margin:"0 0 16px"}}>Sign in to access your dashboard</p>
          <GoogleBtn/>
          <Divider/>
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

        {view==="signup"&&<>
          <BackBtn onClick={function(){setView("login");setSigErr("");}} />
          <h2 style={{fontSize:18,fontWeight:700,color:"#1e293b",margin:"0 0 6px"}}>Create an Account 🚀</h2>
          <p style={{fontSize:13,color:"#94a3b8",margin:"0 0 14px"}}>Use Google to sign up instantly, or fill in the form.</p>
          <GoogleBtn/>
          <Divider/>
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

        {view==="pending"&&<div style={{textAlign:"center",padding:"10px 0"}}><div style={{fontSize:48,marginBottom:12}}>⏳</div><h2 style={{fontSize:18,fontWeight:700,color:"#1e293b",margin:"0 0 10px"}}>Account Pending Approval</h2><p style={{fontSize:13,color:"#64748b",lineHeight:1.7,margin:"0 0 16px"}}>Your account for <strong>{sigEmail}</strong> has been submitted. An admin will review it shortly.</p><PBtn onClick={function(){setView("login");setLoginErr("");}}>← Back to Sign In</PBtn></div>}
        {view==="forgot"&&<><BackBtn onClick={function(){setView("login");}} /><div style={{textAlign:"center",marginBottom:20}}><div style={{fontSize:40,marginBottom:8}}>🔑</div><h2 style={{fontSize:18,fontWeight:700,color:"#1e293b",margin:"0 0 6px"}}>Forgot Password?</h2></div><div style={{marginBottom:16}}><label style={{display:"block",fontSize:12,fontWeight:600,color:"#475569",marginBottom:5}}>Email Address</label><FocusInput type="email" value={resetEmail} onChange={function(e){setResetEmail(e.target.value);}} placeholder="you@company.com"/></div><PBtn onClick={doForgot} disabled={loading}>{loading?"⏳ Sending…":"Send Reset Link →"}</PBtn></>}
        {view==="sent"&&<div style={{textAlign:"center",padding:"10px 0"}}><div style={{fontSize:48,marginBottom:12}}>📧</div><h2 style={{fontSize:18,fontWeight:700,color:"#1e293b",margin:"0 0 10px"}}>Check your inbox!</h2><p style={{fontSize:13,color:"#64748b",lineHeight:1.7,margin:"0 0 20px"}}>If an account exists for <strong>{resetEmail}</strong>, a reset link was sent.</p><PBtn onClick={function(){setView("login");setLoginErr("");}}>← Back to Sign In</PBtn></div>}
      </div>
      <p style={{textAlign:"center",color:"rgba(255,255,255,.4)",fontSize:11,marginTop:16}}>© 2025 Hoptix · A.eye Technology</p>
    </div>
  </div>;
}
