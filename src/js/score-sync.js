// Keep local taps visible while ordered, idempotent point operations are in flight.
export function compareScoreVersions(a,b) {
  const x=Date.parse(a||''),y=Date.parse(b||'');
  if(!Number.isFinite(x)||!Number.isFinite(y))return 0;
  if(x!==y)return x<y?-1:1;
  const fraction=s=>(String(s).match(/\.(\d+)/)?.[1]||'').padEnd(9,'0');
  return fraction(a).localeCompare(fraction(b));
}
export class ScoreSync {
  constructor({send,onRecord=()=>{},onChange=()=>{},onError=()=>{}}) {
    Object.assign(this,{send,onRecord,onChange,onError});this.courts=new Map();
  }
  status(id) {const c=this.courts.get(id);return{pending:c?.jobs.length||0,error:c?.error||null,matchId:c?.matchId};}
  hasPending(id) {const s=this.status(id);return !!(s.pending||s.error);}
  remember(c,record) {if(record&&(!c.latest||compareScoreVersions(record.updated_at,c.latest.updated_at)>=0))c.latest=record;}
  enqueue(id,matchId,operation) {
    let c=this.courts.get(id);
    if(c&&c.matchId!==matchId){this.cancel(id);c=null;}
    if(c?.error)throw c.error;
    if(!c){c={matchId,jobs:[],waiters:[],running:false,error:null,latest:null,cancelled:false};this.courts.set(id,c);}
    if(!c.jobs.length)c.latest=null;
    c.jobs.push(operation);this.onChange(id,this.status(id));void this.run(id,c);
  }
  observe(id,record) {
    const c=this.courts.get(id);if(!c||!this.hasPending(id))return false;
    if(c.matchId!==record.match_id){this.cancel(id);this.onError(id,Object.assign(new Error('Sân đã đổi trận. Các điểm chưa gửi của trận cũ đã dừng.'),{cancelled:true}));return false;}
    this.remember(c,record);return true;
  }
  async run(id,c) {
    if(c.running||c.error||c.cancelled)return;
    c.running=true;
    try {
      while(c.jobs.length&&!c.cancelled){
        const record=await this.send(id,c.matchId,c.jobs[0]);
        if(c.cancelled)return;
        this.remember(c,record);c.jobs.shift();this.onChange(id,this.status(id));
      }
      if(!c.cancelled){
        if(c.latest)this.onRecord(id,c.latest);
        for(const w of c.waiters.splice(0))w.resolve();
      }
    } catch(error) {
      if(!c.cancelled){c.error=error;for(const w of c.waiters.splice(0))w.reject(error);this.onChange(id,this.status(id));this.onError(id,error);}
    } finally {c.running=false;}
  }
  flush(id) {
    const c=this.courts.get(id);if(c?.error)return Promise.reject(c.error);
    if(!c?.jobs.length)return Promise.resolve();
    return new Promise((resolve,reject)=>c.waiters.push({resolve,reject}));
  }
  retry(id) {const c=this.courts.get(id);if(!c||c.running)return;c.error=null;this.onChange(id,this.status(id));void this.run(id,c);}
  cancel(id) {
    const c=this.courts.get(id);if(!c)return;
    c.cancelled=true;for(const w of c.waiters.splice(0))w.reject(new Error('Trận đã thay đổi. Vui lòng kiểm tra lại sân.'));
    this.courts.delete(id);this.onChange(id,this.status(id));
  }
}
