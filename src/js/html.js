import createDOMPurify from 'dompurify';

export function escapeHtml(value) {
  return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
export function safeImageUrl(value) {
  const text=String(value||'');
  if(/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(text))return text;
  try {const url=new URL(text);if(url.protocol==='https:')return url.href;}catch{}
  return '';
}

const actions=new Set(['appTriggerAvatarUpload','appViewPlayerProfile','appOpenSwapPlayerModal','appRemoveGuest','appUnassignSlot','appApplySwapPlayer','appBenchSelectPlayer','appBuyShopItem','appClaimGrip','appConfirmBet','appDeleteMatch','appDeleteMember','appDeleteSession','appEditMember','appEditSession','appEquipFrame','appLoadMoreHistory','appOpenAddGuestModal','appOpenAddMember','appOpenAddSessionForDate','appOpenLoginModal','appOpenCourtBetsModal','appOpenUserWallet','appQuickRSVP','appSelectBetAmount','appSelectBetTeam','appSelectCalendarDate','appStartSession','appSwitchTab','appToggleAttendance','appToggleEloShield','appToggleMemberRSVP']);
export function createHtmlSanitizer(win) {
  const purifier=createDOMPurify(win);
  purifier.addHook('uponSanitizeAttribute',(_node,data)=>{
    if(!/^on/i.test(data.attrName))return;
    const call=/^(?:event\.stopPropagation\(\);\s*)?window\.(app\w+)\(((?:'[A-Za-z0-9_-]*'|-?\d+|true|false)?(?:,\s*(?:'[A-Za-z0-9_-]*'|-?\d+|true|false))*)\)$/.exec(data.attrValue);
    if(data.attrName==='onclick'&&call&&actions.has(call[1]))data.forceKeepAttr=true;
    else data.keepAttr=false;
  });
  return html=>purifier.sanitize(String(html??''),{USE_PROFILES:{html:true},FORBID_TAGS:['script','iframe','object','embed','style'],FORBID_ATTR:['srcdoc']});
}
export function installSafeHtml(win=window) {
  const descriptor=Object.getOwnPropertyDescriptor(win.Element.prototype,'innerHTML');
  const sanitize=createHtmlSanitizer(win);
  Object.defineProperty(win.Element.prototype,'safeInnerHTML',{configurable:true,get(){return descriptor.get.call(this);},set(value){descriptor.set.call(this,sanitize(value));}});
  // Broken custom avatars use a fixed safe fallback; arbitrary onerror code is
  // never retained from HTML strings or saved member data.
  win.document.addEventListener('error',event=>{
    const image=event.target;
    if(image?.tagName==='IMG'&&image.dataset.fallback){const fallback=image.dataset.fallback;delete image.dataset.fallback;if(fallback.startsWith('data:image/svg+xml;utf8,'))image.src=fallback;}
  },true);
}
