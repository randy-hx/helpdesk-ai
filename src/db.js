import { supabase } from './supabase.js'

// ── Users ──────────────────────────────────────────────────────────────────
export async function dbGetUsers(){
  var r=await supabase.from('users').select('*');
  return (r.data||[]).map(dbUserToApp);
}
export async function dbSaveUser(u){
  await supabase.from('users').upsert({id:u.id,name:u.name,email:u.email,role:u.role,company_id:u.companyId||null,phone:u.phone||'',dept:u.dept||'',active:u.active,created_at:u.createdAt,last_login:u.lastLogin});
}
export async function dbDeleteUser(id){
  await supabase.from('users').delete().eq('id',id);
}
export async function dbGetPassword(id){
  var r=await supabase.from('passwords').select('password').eq('user_id',id).single();
  return r.data?.password||'password123';
}
export async function dbSetPassword(id,pw){
  await supabase.from('passwords').upsert({user_id:id,password:pw});
}

// ── Companies ──────────────────────────────────────────────────────────────
export async function dbGetCompanies(){
  var r=await supabase.from('companies').select('*');
  return (r.data||[]).map(dbCompanyToApp);
}
export async function dbSaveCompany(c){
  await supabase.from('companies').upsert({id:c.id,name:c.name,domain:c.domain||'',address:c.address||'',phone:c.phone||'',industry:c.industry||'',size:c.size||'',created_at:c.createdAt});
}
export async function dbDeleteCompany(id){
  await supabase.from('companies').delete().eq('id',id);
}

// ── Clients ────────────────────────────────────────────────────────────────
export async function dbGetClients(){
  var r=await supabase.from('clients').select('*');
  return (r.data||[]).map(dbClientToApp);
}
export async function dbSaveClient(c){
  await supabase.from('clients').upsert({id:c.id,name:c.name,email:c.email||'',phone:c.phone||'',industry:c.industry||'',company_id:c.companyId||null,locations:c.locations||[]});
}
export async function dbDeleteClient(id){
  await supabase.from('clients').delete().eq('id',id);
}

// ── Ticket Types ───────────────────────────────────────────────────────────
export async function dbGetTicketTypes(){
  var r=await supabase.from('ticket_types').select('*');
  return (r.data||[]).map(dbTicketTypeToApp);
}
export async function dbSaveTicketType(t){
  await supabase.from('ticket_types').upsert({id:t.id,name:t.name,priority:t.priority,sla_hours:t.slaHours,color:t.color||'#6366f1',keywords:t.keywords||[],default_assignee:t.defaultAssignee||null});
}
export async function dbDeleteTicketType(id){
  await supabase.from('ticket_types').delete().eq('id',id);
}

// ── Tickets ────────────────────────────────────────────────────────────────
export async function dbGetTickets(){
  var r=await supabase.from('tickets').select('*').order('created_at',{ascending:false});
  if(r.error){console.error('dbGetTickets error',r.error);return[];}
  return (r.data||[]).map(dbTicketToApp);
}
export async function dbSaveTicket(t){
  var row=appTicketToDb(t);
  var r=await supabase.from('tickets').upsert(row);
  if(r.error)console.error('dbSaveTicket error',r.error,row);
}
export async function dbDeleteTicket(id){
  await supabase.from('tickets').update({deleted:true}).eq('id',id);
}

// ── Logs ───────────────────────────────────────────────────────────────────
export async function dbGetLogs(){
  var r=await supabase.from('logs').select('*').order('timestamp',{ascending:false}).limit(500);
  return r.data||[];
}
export async function dbAddLog(l){
  await supabase.from('logs').insert({id:l.id,action:l.action,user_id:l.userId||null,target:l.target||'',detail:l.detail||'',timestamp:l.timestamp});
}

// ── Schedules ──────────────────────────────────────────────────────────────
export async function dbGetSchedules(){
  var r=await supabase.from('schedules').select('*');
  var out={};
  (r.data||[]).forEach(function(s){
    // Support new perDay format stored in schedule_data column
    if(s.schedule_data){
      out[s.user_id]=s.schedule_data;
    } else if(s.days){
      // Legacy format — migrate to perDay on next save
      out[s.user_id]={days:s.days,startHour:s.start_hour,endHour:s.end_hour};
    }
  });
  return out;
}
export async function dbSaveSchedule(userId,sch){
  if(!sch){
    await supabase.from('schedules').delete().eq('user_id',userId);
  } else {
    // Always save full schedule object in schedule_data column
    var r=await supabase.from('schedules').upsert({
      user_id:userId,
      schedule_data:sch,
      // Keep legacy columns populated for backwards compat
      days:sch.days||null,
      start_hour:sch.startHour||null,
      end_hour:sch.endHour||null
    });
    if(r.error)console.error('dbSaveSchedule error',r.error);
  }
}

// ── Email Templates ────────────────────────────────────────────────────────
export async function dbGetEmailTemplates(){
  var r=await supabase.from('email_templates').select('*').order('created_at',{ascending:true});
  if(r.error){console.error('dbGetEmailTemplates',r.error);return[];}
  return r.data||[];
}
export async function dbSaveEmailTemplate(t){
  var r=await supabase.from('email_templates').upsert({id:t.id,name:t.name,subject:t.subject,body:t.body,default_cc:t.defaultCC||'',created_at:t.createdAt||new Date().toISOString()});
  if(r.error)console.error('dbSaveEmailTemplate',r.error);
}
export async function dbDeleteEmailTemplate(id){
  await supabase.from('email_templates').delete().eq('id',id);
}

// ── Time Sessions ──────────────────────────────────────────────────────────
export async function dbGetTimeSessions(ticketId){
  var r=await supabase.from('time_sessions').select('*').eq('ticket_id',ticketId).order('started_at',{ascending:true});
  if(r.error){console.error('dbGetTimeSessions',r.error);return[];}
  return r.data||[];
}
export async function dbSaveTimeSession(session){
  var r=await supabase.from('time_sessions').upsert([session]);
  if(r.error)console.error('dbSaveTimeSession',r.error);
}
export async function dbGetAllTimeSessions(){
  var r=await supabase.from('time_sessions').select('*').order('started_at',{ascending:false});
  if(r.error){console.error('dbGetAllTimeSessions',r.error);return[];}
  return r.data||[];
}

// ── Direct Chats ───────────────────────────────────────────────────────────
export async function dbGetDirectChats(userA,userB){
  try{
    // Fetch all messages involving either user, then filter client-side
    // Avoids complex PostgREST OR+AND syntax that fails silently
    var r=await supabase.from('direct_chats').select('*')
      .or('from_id.eq.'+userA+',from_id.eq.'+userB)
      .order('created_at',{ascending:true})
      .limit(500);
    if(r.error){console.error('dbGetDirectChats error',r.error);return[];}
    var all=r.data||[];
    return all.filter(function(m){
      return(m.from_id===userA&&m.to_id===userB)||(m.from_id===userB&&m.to_id===userA);
    });
  }catch(e){console.error('dbGetDirectChats',e);return[];}
}
export async function dbSaveDirectChat(msg){
  try{
    var r=await supabase.from('direct_chats').upsert({
      id:msg.id,
      from_id:msg.from_id,
      to_id:msg.to_id,
      message:msg.message,
      created_at:msg.created_at
    });
    if(r.error)console.error('dbSaveDirectChat error',r.error);
  }catch(e){console.error('dbSaveDirectChat',e);}
}

// ── Team / Group Chats ─────────────────────────────────────────────────────
export async function dbGetTeamGroups(){
  try{
    var r=await supabase.from('chat_groups').select('*').order('created_at',{ascending:true});
    if(r.error){console.error('dbGetTeamGroups error',r.error);return[];}
    return (r.data||[]).map(function(g){
      return{
        id:g.id,
        name:g.name,
        type:g.type||'custom',
        roleFilter:g.role_filter||null,
        memberIds:g.member_ids||[],
        createdBy:g.created_by||null,
        created_at:g.created_at
      };
    });
  }catch(e){console.error('dbGetTeamGroups',e);return[];}
}
export async function dbSaveTeamGroup(g){
  try{
    var r=await supabase.from('chat_groups').upsert({
      id:g.id,
      name:g.name,
      type:g.type||'custom',
      role_filter:g.roleFilter||null,
      member_ids:g.memberIds||[],
      created_by:g.createdBy||null,
      created_at:g.created_at||new Date().toISOString()
    });
    if(r.error)console.error('dbSaveTeamGroup error',r.error);
  }catch(e){console.error('dbSaveTeamGroup',e);}
}
export async function dbDeleteTeamGroup(id){
  try{
    await supabase.from('chat_groups').delete().eq('id',id);
    // Also delete all messages in this group
    await supabase.from('team_chats').delete().eq('group_id',id);
  }catch(e){console.error('dbDeleteTeamGroup',e);}
}
export async function dbGetTeamChats(groupId){
  try{
    var r=await supabase.from('team_chats').select('*')
      .eq('group_id',groupId)
      .order('created_at',{ascending:true})
      .limit(200);
    if(r.error){console.error('dbGetTeamChats error',r.error);return[];}
    return r.data||[];
  }catch(e){console.error('dbGetTeamChats',e);return[];}
}
export async function dbSaveTeamChat(msg){
  try{
    var r=await supabase.from('team_chats').upsert({
      id:msg.id,
      group_id:msg.group_id,
      user_id:msg.user_id,
      message:msg.message,
      created_at:msg.created_at
    });
    if(r.error)console.error('dbSaveTeamChat error',r.error);
  }catch(e){console.error('dbSaveTeamChat',e);}
}

// ── App Notifications ──────────────────────────────────────────────────────
export async function dbGetNotifications(userId){
  try{
    var r=await supabase.from('app_notifications').select('*')
      .eq('user_id',userId)
      .order('created_at',{ascending:false})
      .limit(50);
    if(r.error){console.error('dbGetNotifications error',r.error);return[];}
    return r.data||[];
  }catch(e){console.error('dbGetNotifications',e);return[];}
}
export async function dbSaveNotification(notif){
  try{
    var r=await supabase.from('app_notifications').upsert([notif]);
    if(r.error)console.error('dbSaveNotification error',r.error);
  }catch(e){console.error('dbSaveNotification',e);}
}
export async function dbMarkNotificationsRead(userId){
  try{
    var r=await supabase.from('app_notifications').update({read:true})
      .eq('user_id',userId).eq('read',false);
    if(r.error)console.error('dbMarkNotificationsRead error',r.error);
  }catch(e){console.error('dbMarkNotificationsRead',e);}
}

// ── Ticket Chats ───────────────────────────────────────────────────────────
export async function dbGetChats(ticketId){
  try{
    var r=await supabase.from('ticket_chats').select('*')
      .eq('ticket_id',ticketId)
      .order('created_at',{ascending:true});
    if(r.error){console.error('dbGetChats error',r.error);return[];}
    return r.data||[];
  }catch(e){console.error('dbGetChats',e);return[];}
}
export async function dbSaveChat(msg){
  try{
    var r=await supabase.from('ticket_chats').upsert([msg]);
    if(r.error)console.error('dbSaveChat error',r.error);
  }catch(e){console.error('dbSaveChat',e);}
}

// ── Converters ─────────────────────────────────────────────────────────────
function uuid(v){return(v&&v.trim&&v.trim()&&v!=='')?v:null;}

export function dbUserToApp(u){
  return{id:u.id,name:u.name,email:u.email,role:u.role,companyId:u.company_id||'',phone:u.phone||'',dept:u.dept||'',active:u.active,createdAt:u.created_at,lastLogin:u.last_login};
}
export function dbCompanyToApp(c){
  return{id:c.id,name:c.name,domain:c.domain||'',address:c.address||'',phone:c.phone||'',industry:c.industry||'',size:c.size||'',createdAt:c.created_at};
}
export function dbClientToApp(c){
  return{id:c.id,name:c.name,email:c.email||'',phone:c.phone||'',industry:c.industry||'',companyId:c.company_id||'',locations:c.locations||[]};
}
export function dbTicketTypeToApp(t){
  return{id:t.id,name:t.name,priority:t.priority,slaHours:t.sla_hours,color:t.color||'#6366f1',keywords:t.keywords||[],defaultAssignee:t.default_assignee||''};
}
export function dbTicketToApp(t){
  return{
    id:t.id,
    title:t.title||'',
    description:t.description||'',
    typeId:t.type_id||'',
    companyId:t.company_id||'',
    clientId:t.client_id||'',
    locationId:t.location_id||'',
    status:t.status||'Open',
    priority:(t.priority||'Medium').toLowerCase(),
    submittedBy:t.submitted_by||'',
    assignedTo:t.assigned_to||'',
    externalEmail:t.external_email||'',
    customTypeName:t.custom_type_name||'',
    slaDeadline:t.sla_deadline||null,
    slaBreached:t.sla_breached||false,
    timeToCreateMins:t.time_to_create_mins||0,
    statusHistory:t.status_history||[],
    statusTimeLog:t.status_time_log||[],
    conversations:t.conversations||[],
    attachments:t.attachments||[],
    aiReason:t.ai_reason||'',
    hasUnreadReply:t.has_unread_reply||false,
    deleted:t.deleted||false,
    closedAt:t.closed_at||null,
    submittedAt:t.submitted_at||t.created_at,
    formOpenedAt:t.form_opened_at||t.created_at,
    createdAt:t.created_at,
    updatedAt:t.updated_at||t.created_at
  };
}
export function appTicketToDb(t){
  return{
    id:t.id,
    title:t.title||'',
    description:t.description||'',
    type_id:uuid(t.typeId),
    company_id:uuid(t.companyId),
    client_id:uuid(t.clientId),
    location_id:uuid(t.locationId),
    status:t.status||'Open',
    priority:t.priority?t.priority.charAt(0).toUpperCase()+t.priority.slice(1).toLowerCase():'Medium',
    submitted_by:uuid(t.submittedBy),
    assigned_to:uuid(t.assignedTo),
    external_email:t.externalEmail||'',
    custom_type_name:t.customTypeName||'',
    sla_deadline:t.slaDeadline||null,
    sla_breached:t.slaBreached||false,
    time_to_create_mins:t.timeToCreateMins||0,
    status_history:t.statusHistory||[],
    status_time_log:t.statusTimeLog||[],
    conversations:t.conversations||[],
    attachments:t.attachments||[],
    ai_reason:t.aiReason||'',
    has_unread_reply:t.hasUnreadReply||false,
    deleted:t.deleted||false,
    closed_at:t.closedAt||null,
    submitted_at:t.submittedAt||t.createdAt||null,
    form_opened_at:t.formOpenedAt||t.createdAt||null,
    created_at:t.createdAt||null,
    updated_at:t.updatedAt||t.createdAt||null
  };
}
